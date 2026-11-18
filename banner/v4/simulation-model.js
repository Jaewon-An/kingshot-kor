/* v4 실측 배치의 모의 철거·건설. 좌표는 게임 칸의 최소 X, 최소 Y다. */
(function (root) {
  'use strict';

  const SIZE = 1200;
  const index = (x, y) => y * SIZE + x;
  const key = p => index(p.x, p.y);
  const same = (a, b) => a.x === b.x && a.y === b.y;
  const inWorld = p => p && Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x >= 0 && p.y >= 0 && p.x < SIZE && p.y < SIZE;

  function rowMask(runs) {
    const mask = new Uint8Array(SIZE * SIZE);
    for (const [y, x0, x1] of runs) mask.fill(1, index(x0, y), index(x1, y) + 1);
    return mask;
  }

  function cover(mask, x, y, width) {
    const left = Math.max(0, x), right = Math.min(SIZE, x + width);
    for (let row = Math.max(0, y); row < Math.min(SIZE, y + width); row++) {
      mask.fill(1, index(left, row), index(right, row));
    }
  }

  // 본부 15×15와 깃발 7×7의 변·모서리 접촉을 모두 포함한다.
  function connectedTerritory(flags, hqs) {
    const territory = new Uint8Array(SIZE * SIZE);
    const connectedFlags = new Set();
    const queue = [];
    const hqCounts = hqs.map(() => 0);
    function visit(flag, hq) {
      connectedFlags.add(key(flag));
      queue.push({ flag, hq });
      hqCounts[hq]++;
      cover(territory, flag.x - 3, flag.y - 3, 7);
    }
    hqs.forEach(({ x, y }, i) => {
      cover(territory, x - 6, y - 6, 15);
      for (const flag of flags) {
        if (!connectedFlags.has(key(flag)) && Math.abs(flag.x - x - 1) <= 11 && Math.abs(flag.y - y - 1) <= 11) {
          visit(flag, i);
        }
      }
    });
    for (let i = 0; i < queue.length; i++) {
      const { flag, hq } = queue[i];
      for (const other of flags) {
        if (Math.abs(other.x - flag.x) <= 7 && Math.abs(other.y - flag.y) <= 7 && !connectedFlags.has(key(other))) {
          visit(other, hq);
        }
      }
    }
    return { territory, connectedFlags, hqCounts };
  }

  // 거점 15×15 바로 바깥의 네 변. 모서리 하나만 닿아서는 거점에 연결되지 않는다.
  function outpostContacts(territory, x, y) {
    let count = 0;
    for (let d = -6; d <= 8; d++) {
      count += territory[index(x + d, y - 7)] + territory[index(x + d, y + 9)]
        + territory[index(x - 7, y + d)] + territory[index(x + 9, y + d)];
    }
    return count;
  }

  function create({ flags: originalFlags, capacity, nodes, map, sites }) {
    const { hqs, traps, outposts, trapRadius } = sites;
    const baseKeys = new Set(originalFlags.map(key));
    const surveyed = rowMask(sites.allowed);
    const foreign = rowMask(sites.foreign);
    const occupied = rowMask(sites.occupied);
    const nearTrap = p => traps.some(t => Math.abs(t.x - p.x) <= trapRadius && Math.abs(t.y - p.y) <= trapRadius);
    const isProtected = p => Boolean(p && baseKeys.has(key(p)) && nearTrap(p));
    const baseArea = connectedTerritory(originalFlags, hqs);
    const defense = new Set();
    for (const trap of traps) {
      for (let y = trap.y - trapRadius; y <= trap.y + trapRadius; y++) {
        for (let x = trap.x - trapRadius; x <= trap.x + trapRadius; x++) defense.add(index(x, y));
      }
    }

    // 실측 영토에는 조사일의 KOR 점유가 우선한다. 확장분으로 타 연맹 선점 자원을 가져오지 않는다.
    const nodeTiles = nodes.map(([, x, y]) => {
      const i = index(x, y);
      return [i, i + 1, i + SIZE, i + SIZE + 1];
    });
    const eligible = nodeTiles.map(cells => cells.reduce((n, i) => n + baseArea.territory[i], 0) >= 3
      || cells.reduce((n, i) => n + foreign[i], 0) < 3);

    function evaluateArea(area, referenceCounts) {
      const { territory } = area;
      const counts = [0, 0, 0, 0];
      const owned = new Uint8Array(nodes.length);
      for (let n = 0; n < nodes.length; n++) {
        if (!eligible[n]) continue;
        let tiles = 0;
        for (const i of nodeTiles[n]) {
          if (territory[i] && (baseArea.territory[i] || !foreign[i])) tiles++;
        }
        if (tiles >= 3) {
          owned[n] = 1;
          counts[nodes[n][0]]++;
        }
      }
      let trapCellsLost = 0, trapCellsChanged = 0;
      for (const i of defense) {
        if (territory[i] !== baseArea.territory[i]) {
          trapCellsChanged++;
          if (baseArea.territory[i]) trapCellsLost++;
        }
      }
      return {
        ...area, counts, owned, trapCellsLost, trapCellsChanged,
        delta: counts.map((v, i) => referenceCounts ? v - referenceCounts[i] : 0),
        outposts: outposts.map(p => ({ ...p, contacts: outpostContacts(territory, p.x, p.y) }))
      };
    }
    const baseline = evaluateArea(baseArea);
    const evaluate = flags => evaluateArea(connectedTerritory(flags, hqs), baseline.counts);

    function placementIssue(to) {
      if (!inWorld(to) || to.x < 3 || to.y < 3 || to.x + 3 >= SIZE || to.y + 3 >= SIZE) {
        return '깃발 영토가 왕국 지도 밖으로 나갑니다.';
      }
      if (nearTrap(to)) return '곰덫 주변의 배치를 보호하는 구역입니다.';
      // 철거한 실측 깃발의 원위치는 조사 당시 설치 가능했던 자리다.
      if (baseKeys.has(key(to))) return '';
      const k = map.kind[key(to)];
      if (k) {
        if (k === 1) return '산 위에 깃발을 지을 수 없습니다.';
        if (k === 2) return '호수 위에 깃발을 지을 수 없습니다.';
        if (k >= 3 && k <= 6) return '연맹 자원지 위에 깃발을 지을 수 없습니다.';
        return '구조물 위에 깃발을 지을 수 없습니다.';
      }
      if (occupied[key(to)]) return '조사에서 도시나 연맹 건물이 확인된 자리입니다.';
      for (let y = to.y - 3; y <= to.y + 3; y++) {
        for (let x = to.x - 3; x <= to.x + 3; x++) {
          const i = index(x, y);
          if (map.flags[i] & root.KSCore.F_NOALLY) return '7×7 깃발 영토가 연맹 건설 금지구역과 겹칩니다.';
          if (foreign[i]) return '7×7 깃발 영토가 조사된 다른 연맹 영토와 겹칩니다.';
        }
      }
      return '';
    }

    function checkConnection(flags, action) {
      const state = evaluate(flags);
      const lost = flags.length - state.connectedFlags.size;
      if (lost) return action + ' 본부와 끊기는 깃발이 ' + lost + '개 있습니다.';
      const detached = state.outposts.filter((p, i) => baseline.outposts[i].contacts && !p.contacts);
      if (detached.length) return action + ' ' + detached.map(p => p.name).join(', ') + ' 연결이 끊깁니다.';
      if (state.trapCellsChanged) return action + ' 곰덫 주변 방어 영토가 달라집니다.';
      return '';
    }

    function issue(flags, operation) {
      const { type, from, to } = operation;
      if (!['remove', 'add', 'move'].includes(type)) return '알 수 없는 작업입니다.';
      let remaining = flags;
      if (type !== 'add') {
        if (!inWorld(from) || !flags.some(p => same(p, from))) return '해당 좌표에 깃발이 없습니다.';
        if (isProtected(from)) return '곰덫 주변의 기존 깃발은 고정되어 있습니다.';
        if (type === 'move' && inWorld(to) && same(from, to)) return '현재 깃발과 같은 자리입니다.';
        remaining = flags.filter(p => !same(p, from));
      }
      if (type !== 'remove') {
        if (!inWorld(to)) return '지도 안의 정수 좌표를 입력하세요.';
        if (remaining.length >= capacity) return '깃발 상한에 도달했습니다. 먼저 한 기를 철거하세요.';
        if (remaining.some(p => same(p, to))) return '이미 다른 깃발이 있는 자리입니다.';
        const invalid = placementIssue(to);
        if (invalid) return invalid;
      }
      if (type !== 'add') {
        const invalid = checkConnection(remaining, '철거 직후');
        if (invalid || type === 'remove') return invalid;
      }
      return checkConnection([...remaining, to], '건설 후');
    }

    function siteNote(p) {
      if (!inWorld(p) || baseKeys.has(key(p)) || surveyed[key(p)]) return '';
      return '조사에서 공터를 확인하지 못한 위치입니다. 게임에서 건설 가능 여부를 확인하세요.';
    }

    return { hqs, traps, baseline, evaluate, issue, isProtected, siteNote };
  }

  root.KSBannerSimulation = { create };
})(globalThis);
