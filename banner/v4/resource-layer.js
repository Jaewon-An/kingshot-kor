(() => {
  'use strict';

  const colors = ['#d9a400', '#2e8b3a', '#8a8f98', '#4a5a8c'];
  const spriteSize = 28;
  const empty = [];
  let pendingNodes;

  async function readNodes() {
    const bytes = Uint8Array.from(atob(window.KS_MAPDATA.NODES_B64), char => char.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const raw = new Uint8Array(await new Response(stream).arrayBuffer());
    const nodes = [];
    for (let i = 0; i < raw.length; i += 3) {
      const value = raw[i] << 16 | raw[i + 1] << 8 | raw[i + 2];
      const type = value >>> 22;
      const x = value >>> 11 & 2047;
      // 원본은 위부터 센 행 번호다. 지도에서는 2×2 자원지의 최소 Y를 쓴다.
      const y = window.KSCore.G - 2 - (value & 2047);
      nodes.push([type, x, y]);
    }
    return nodes;
  }

  function loadNodes() {
    if (!pendingNodes) {
      pendingNodes = readNodes().catch(error => {
        pendingNodes = undefined;
        throw error;
      });
    }
    return pendingNodes;
  }

  function create(redraw) {
    const sprite = new Image();
    sprite.onload = redraw;
    sprite.src = '/banner/res-icons.png';
    const binSize = 16;
    const binsPerRow = Math.ceil(window.KSCore.G / binSize);
    let indexedNodes, bins, rememberedFlags, rememberedHqs, nearby;

    function focusMask(nodes, flags, hqs) {
      if (nodes !== indexedNodes) {
        indexedNodes = nodes;
        bins = new Map();
        nodes.forEach(([, x, y], i) => {
          const key = Math.floor(y / binSize) * binsPerRow + Math.floor(x / binSize);
          if (!bins.has(key)) bins.set(key, []);
          bins.get(key).push(i);
        });
        nearby = null;
      }
      if (nearby && flags === rememberedFlags && hqs === rememberedHqs) return nearby;
      rememberedFlags = flags;
      rememberedHqs = hqs;
      nearby = new Uint8Array(nodes.length);
      function mark(center, radius) {
        // 2×2 자원지의 어느 한 칸이라도 주변 구역과 겹치면 포함한다.
        const left = Math.max(0, center.x - radius - 1), right = Math.min(window.KSCore.G - 1, center.x + radius);
        const low = Math.max(0, center.y - radius - 1), high = Math.min(window.KSCore.G - 1, center.y + radius);
        for (let by = Math.floor(low / binSize); by <= Math.floor(high / binSize); by++) {
          for (let bx = Math.floor(left / binSize); bx <= Math.floor(right / binSize); bx++) {
            for (const i of bins.get(by * binsPerRow + bx) || empty) {
              const [, x, y] = nodes[i];
              if (x >= left && x <= right && y >= low && y <= high) nearby[i] = 1;
            }
          }
        }
      }
      for (const p of flags) mark(p, 11);
      for (const p of hqs) mark(p, 15);
      return nearby;
    }

    function drawIcon(ctx, type, x, y, size) {
      const radius = size / 2;
      if (sprite.naturalWidth) {
        ctx.drawImage(sprite, type * spriteSize, 0, spriteSize, spriteSize,
          x - radius, y - radius, size, size);
      }
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      if (!sprite.naturalWidth) {
        ctx.fillStyle = colors[type];
        ctx.fill();
      }
      ctx.strokeStyle = colors[type];
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function drawChange(ctx, point, size) {
      const { type, x, y, gained } = point;
      drawIcon(ctx, type, x, y, size);
      const color = gained ? '#127246' : '#aa3236';
      const r = size / 2;
      const bx = x + .66 * r, by = y + .66 * r;
      const br = Math.max(4.6, r * .47);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx - br * .54, by);
      ctx.lineTo(bx + br * .54, by);
      if (gained) {
        ctx.moveTo(bx, by - br * .54);
        ctx.lineTo(bx, by + br * .54);
      }
      ctx.stroke();
    }

    function draw(ctx, nodes, camera, { emphasize = false, owned, baselineOwned, focusFlags, hqs, allResources = false } = {}) {
      if (!nodes?.length) return;
      const { clientWidth: width, clientHeight: height } = ctx.canvas;
      const originX = width / 2 - camera.x * camera.scale;
      const originY = height / 2 - camera.y * camera.scale;
      const step = camera.scale * Math.SQRT1_2;
      const overview = camera.scale < 3.5;
      const focus = overview && focusFlags && !allResources ? focusMask(nodes, focusFlags, hqs || empty) : null;
      const compact = overview && Boolean(focus || allResources);
      const size = compact ? Math.min(11, Math.max(9, 8 + camera.scale))
        : Math.min(30, Math.max(emphasize || focusFlags || allResources ? 14 : 0, camera.scale * 2.6));
      const useIcons = compact || size >= 11;
      const plots = useIcons ? null : colors.map(() => new Path2D());
      const halfDiagonal = 2 * step;
      const changed = [];
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      for (let i = 0; i < nodes.length; i++) {
        const ownershipChanged = owned && baselineOwned && Boolean(owned[i]) !== Boolean(baselineOwned[i]);
        if (focus && !focus[i] && !ownershipChanged) continue;
        const [type, x, y] = nodes[i];
        const px = originX + (x - y) * step;
        const py = originY - (x + y + 2) * step;
        if (px < -22 || py < -22 || px > width + 22 || py > height + 22) continue;
        if (ownershipChanged) {
          changed.push({ type, x: px, y: py, gained: Boolean(owned[i]) });
        } else if (useIcons) {
          drawIcon(ctx, type, px, py, size);
        } else {
          const path = plots[type];
          path.moveTo(px, py - halfDiagonal);
          path.lineTo(px + halfDiagonal, py);
          path.lineTo(px, py + halfDiagonal);
          path.lineTo(px - halfDiagonal, py);
          path.closePath();
        }
      }
      if (plots) {
        plots.forEach((path, type) => {
          ctx.fillStyle = colors[type];
          ctx.fill(path);
        });
      }
      for (const point of changed) drawChange(ctx, point, Math.max(16, size));
      ctx.restore();
    }

    return { draw };
  }

  window.KSResources = { create, loadNodes };
})();
