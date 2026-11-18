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

  // 각 칸을 중심으로 한 7×7 안에 src가 하나라도 있으면 1. 가로·세로로 나눠 한 번씩 훑는다.
  function dilate3(src) {
    const rows = new Uint8Array(SIZE * SIZE), out = new Uint8Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
      const base = y * SIZE;
      let count = src[base] + src[base + 1] + src[base + 2];
      for (let x = 0; x < SIZE; x++) {
        if (x + 3 < SIZE) count += src[base + x + 3];
        if (x >= 4) count -= src[base + x - 4];
        rows[base + x] = count ? 1 : 0;
      }
    }
    const columns = new Uint16Array(SIZE);
    for (let y = 0; y < 3; y++) for (let x = 0; x < SIZE; x++) columns[x] += rows[y * SIZE + x];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (y + 3 < SIZE) columns[x] += rows[(y + 3) * SIZE + x];
        if (y >= 4) columns[x] -= rows[(y - 4) * SIZE + x];
        out[y * SIZE + x] = columns[x] ? 1 : 0;
      }
    }
    return out;
  }

  // 거점 15×15 바로 바깥 네 변의 칸. outpostContacts와 같은 60칸이다.
  function ringCells(x, y) {
    const cells = [];
    for (let d = -6; d <= 8; d++) {
      cells.push(index(x + d, y - 7), index(x + d, y + 9), index(x - 7, y + d), index(x + 9, y + d));
    }
    return cells;
  }

  // 깃발 (x, y)의 7×7 영토가 거점 네 변 가운데 한 칸이라도 덮는가.
  function squareTouchesRing(x, y, p) {
    const across = (row, c0, c1) => row >= y - 3 && row <= y + 3 && x - 3 <= c1 && x + 3 >= c0;
    const down = (col, r0, r1) => col >= x - 3 && col <= x + 3 && y - 3 <= r1 && y + 3 >= r0;
    return across(p.y - 7, p.x - 6, p.x + 8) || across(p.y + 9, p.x - 6, p.x + 8)
      || down(p.x - 7, p.y - 6, p.y + 8) || down(p.x + 9, p.y - 6, p.y + 8);
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
    const defenseMask = new Uint8Array(SIZE * SIZE);
    const defenseBox = { x0: SIZE, y0: SIZE, x1: -1, y1: -1 };
    for (const trap of traps) {
      const x0 = Math.max(0, trap.x - trapRadius), x1 = Math.min(SIZE - 1, trap.x + trapRadius);
      const y0 = Math.max(0, trap.y - trapRadius), y1 = Math.min(SIZE - 1, trap.y + trapRadius);
      for (let y = y0; y <= y1; y++) defenseMask.fill(1, index(x0, y), index(x1, y) + 1);
      Object.assign(defenseBox, { x0: Math.min(defenseBox.x0, x0), y0: Math.min(defenseBox.y0, y0),
        x1: Math.max(defenseBox.x1, x1), y1: Math.max(defenseBox.y1, y1) });
    }
    const defense = [];
    for (let y = defenseBox.y0; y <= defenseBox.y1; y++) {
      for (let x = defenseBox.x0; x <= defenseBox.x1; x++) if (defenseMask[index(x, y)]) defense.push(index(x, y));
    }
    // 7×7 영토가 연맹 건설 금지구역이나 조사된 다른 연맹 영토에 걸리는 깃발 칸
    const blocked = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < blocked.length; i++) blocked[i] = (map.flags[i] & root.KSCore.F_NOALLY) || foreign[i] ? 1 : 0;
    const footBlocked = dilate3(blocked);
    const rings = outposts.map(p => ringCells(p.x, p.y));
    const ringOwners = new Map();
    rings.forEach((cells, p) => cells.forEach(i => ringOwners.set(i, [...(ringOwners.get(i) || []), p])));

    // 실측 영토에는 조사일의 KOR 점유가 우선한다. 확장분으로 타 연맹 선점 자원을 가져오지 않는다.
    const nodeTiles = nodes.map(([, x, y]) => {
      const i = index(x, y);
      return [i, i + 1, i + SIZE, i + SIZE + 1];
    });
    const eligible = nodeTiles.map(cells => cells.reduce((n, i) => n + baseArea.territory[i], 0) >= 3
      || cells.reduce((n, i) => n + foreign[i], 0) < 3);

    function territoryDetails(territory) {
      let trapCellsLost = 0, trapCellsChanged = 0;
      for (const i of defense) {
        if (territory[i] !== baseArea.territory[i]) {
          trapCellsChanged++;
          if (baseArea.territory[i]) trapCellsLost++;
        }
      }
      return { trapCellsLost, trapCellsChanged,
        outposts: outposts.map(p => ({ ...p, contacts: outpostContacts(territory, p.x, p.y) })) };
    }

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
      return {
        ...area, ...territoryDetails(territory), counts, owned,
        delta: counts.map((v, i) => referenceCounts ? v - referenceCounts[i] : 0)
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
      if (!footBlocked[key(to)]) return '';
      for (let y = to.y - 3; y <= to.y + 3; y++) {
        for (let x = to.x - 3; x <= to.x + 3; x++) {
          const i = index(x, y);
          if (map.flags[i] & root.KSCore.F_NOALLY) return '7×7 깃발 영토가 연맹 건설 금지구역과 겹칩니다.';
          if (foreign[i]) return '7×7 깃발 영토가 조사된 다른 연맹 영토와 겹칩니다.';
        }
      }
      return '';
    }

    // placementIssue(to) === ''와 같은 판정을 객체 없이 빠르게 한다.
    function placeable(x, y) {
      if (x < 3 || y < 3 || x + 3 >= SIZE || y + 3 >= SIZE) return false;
      for (const t of traps) if (Math.abs(t.x - x) <= trapRadius && Math.abs(t.y - y) <= trapRadius) return false;
      const i = index(x, y);
      return baseKeys.has(i) || (!map.kind[i] && !occupied[i] && !footBlocked[i]);
    }

    function checkConnection(flags, action) {
      const area = connectedTerritory(flags, hqs);
      const lost = flags.length - area.connectedFlags.size;
      if (lost) return action + ' 본부와 끊기는 깃발이 ' + lost + '개 있습니다.';
      const state = territoryDetails(area.territory);
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
      if (type === 'remove') return checkConnection(remaining, '철거 직후');
      return checkConnection([...remaining, to], type === 'move' ? '이동 후' : '건설 후');
    }

    // 시뮬레이터에서는 한 번에 옮긴다. 게임에서 철거를 먼저 할 때의 위험은 따로 안내한다.
    function moveWarning(flags, from) {
      if (!inWorld(from) || isProtected(from) || !flags.some(p => same(p, from))) return '';
      const remaining = flags.filter(p => !same(p, from));
      const risk = checkConnection(remaining, '철거 직후');
      return risk ? '게임에서 ' + risk + ' 철거 전에 연결을 보강하세요.' : '';
    }

    function siteNote(p) {
      if (!inWorld(p) || baseKeys.has(key(p)) || surveyed[key(p)]) return '';
      return '조사에서 공터를 확인하지 못한 위치입니다. 게임에서 건설 가능 여부를 확인하세요.';
    }

    // 지도 표시용 빠른 판정. 배치마다 깃발 연결 그래프·영토를 덮는 수를 한 번 만든다.
    // 결과는 issue()와 같다(모든 깃발이 이어지고 곰덫 방어 영토가 실측과 같을 때). 아니면 null을 돌려준다.
    const analyses = new WeakMap();
    function analyze(flags) {
      let result = analyses.get(flags);
      if (result) return result;
      const n = flags.length, keys = flags.map(key);
      const at = new Map(keys.map((k, i) => [k, i]));
      const area = connectedTerritory(flags, hqs);
      const details = territoryDetails(area.territory);
      const steady = at.size === n && area.connectedFlags.size === n && !details.trapCellsChanged
        && details.outposts.every((p, i) => !baseline.outposts[i].contacts || p.contacts);
      result = { steady };
      analyses.set(flags, result);
      if (!steady) return result;
      const adjacent = flags.map(() => []);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (Math.abs(flags[i].x - flags[j].x) <= 7 && Math.abs(flags[i].y - flags[j].y) <= 7) {
            adjacent[i].push(j);
            adjacent[j].push(i);
          }
        }
      }
      const rooted = flags.map(f => hqs.some(h => Math.abs(f.x - h.x - 1) <= 11 && Math.abs(f.y - h.y - 1) <= 11));
      const covers = new Uint8Array(SIZE * SIZE);
      const add = (x, y, width) => {
        for (let row = Math.max(0, y); row < Math.min(SIZE, y + width); row++) {
          for (let col = Math.max(0, x); col < Math.min(SIZE, x + width); col++) covers[index(col, row)]++;
        }
      };
      for (const h of hqs) add(h.x - 6, h.y - 6, 15);
      for (const f of flags) add(f.x - 3, f.y - 3, 7);
      // 본부를 뿌리로 한 DFS에서 철거하면 다른 깃발이 끊기는 깃발(절단점)을 찾는다.
      const cut = new Uint8Array(n), order = new Int32Array(n + 1).fill(-1), low = new Int32Array(n + 1);
      // 두 본부를 하나의 뿌리(n번)로 묶는다. 본부에 닿는 깃발은 양쪽 목록에 뿌리를 넣어야 뒤로 가는 연결이 보인다.
      const parent = new Int32Array(n + 1).fill(-1), rootNeighbors = [];
      for (let i = 0; i < n; i++) if (rooted[i]) rootNeighbors.push(i);
      const lists = adjacent.map((list, i) => rooted[i] ? [...list, n] : list);
      const neighbors = v => v === n ? rootNeighbors : lists[v];
      let time = 0;
      order[n] = low[n] = time++;
      const stack = [[n, 0]];
      while (stack.length) {
        const top = stack[stack.length - 1], v = top[0], list = neighbors(v);
        if (top[1] < list.length) {
          const u = list[top[1]++];
          if (order[u] < 0) {
            parent[u] = v;
            order[u] = low[u] = time++;
            stack.push([u, 0]);
          } else if (u !== parent[v]) low[v] = Math.min(low[v], order[u]);
        } else {
          stack.pop();
          const p = parent[v];
          if (p >= 0) {
            low[p] = Math.min(low[p], low[v]);
            if (p !== n && low[v] >= order[p]) cut[p] = 1;
          }
        }
      }
      Object.assign(result, { flags, n, at, adjacent, rooted, covers, cut,
        contacts: details.outposts.map(p => p.contacts) });
      return result;
    }

    // 깃발 s 하나만 덮던 칸을 잃을 때의 피해: 곰덫 방어 영토 칸 범위, 접촉이 0이 되는 거점
    function removalDamage(a, s) {
      const f = a.flags[s], lost = outposts.map(() => 0);
      let trap = null;
      for (let y = f.y - 3; y <= f.y + 3; y++) {
        for (let x = f.x - 3; x <= f.x + 3; x++) {
          const i = index(x, y);
          if (a.covers[i] !== 1) continue;
          if (defenseMask[i]) {
            trap = trap || { x0: x, y0: y, x1: x, y1: y };
            Object.assign(trap, { x0: Math.min(trap.x0, x), y0: Math.min(trap.y0, y), x1: Math.max(trap.x1, x), y1: Math.max(trap.y1, y) });
          }
          for (const p of ringOwners.get(i) || []) lost[p]++;
        }
      }
      const needs = [];
      outposts.forEach((p, i) => { if (baseline.outposts[i].contacts && a.contacts[i] - lost[i] <= 0) needs.push(i); });
      return { trap, needs };
    }

    // 지금 철거해도 issue()가 막지 않는 깃발 좌표 키
    function removable(flags) {
      const a = analyze(flags);
      if (!a.steady) return null;
      const result = new Set();
      for (let s = 0; s < a.n; s++) {
        if (a.cut[s] || isProtected(a.flags[s])) continue;
        const damage = removalDamage(a, s);
        if (!damage.trap && !damage.needs.length) result.add(index(a.flags[s].x, a.flags[s].y));
      }
      return result;
    }

    // 새 깃발 (x, y)의 7×7이 실측에서 KOR 영토가 아니던 곰덫 방어 영토 칸을 덮는가.
    function addsDefense(x, y) {
      if (x + 3 < defenseBox.x0 || x - 3 > defenseBox.x1 || y + 3 < defenseBox.y0 || y - 3 > defenseBox.y1) return false;
      for (let row = y - 3; row <= y + 3; row++) {
        for (let col = x - 3; col <= x + 3; col++) {
          const i = index(col, row);
          if (defenseMask[i] && !baseArea.territory[i]) return true;
        }
      }
      return false;
    }

    // from 깃발을 옮길 수 있는 칸(from이 없으면 새로 지을 수 있는 칸). mask는 x0·y0부터 w×h 칸.
    function targets(flags, from) {
      const a = analyze(flags);
      if (!a.steady) return null;
      const none = { x0: 0, y0: 0, w: 0, h: 0, mask: new Uint8Array(0), count: 0 };
      let s = -1;
      if (from) {
        s = inWorld(from) && a.at.has(key(from)) ? a.at.get(key(from)) : -2;
        if (s < 0 || isProtected(from)) return none;
      } else if (flags.length >= capacity) return none;
      // from을 뺀 그래프에서 본부에 이어지는 깃발과, 끊겨서 새 자리로 다시 이어야 하는 묶음
      const linked = new Uint8Array(a.n), queue = [];
      for (let i = 0; i < a.n; i++) if (i !== s && a.rooted[i]) { linked[i] = 1; queue.push(i); }
      for (let q = 0; q < queue.length; q++) {
        for (const j of a.adjacent[queue[q]]) if (j !== s && !linked[j]) { linked[j] = 1; queue.push(j); }
      }
      const group = new Int32Array(a.n).fill(-1);
      let groups = 0;
      for (let i = 0; i < a.n; i++) {
        if (i === s || linked[i] || group[i] >= 0) continue;
        group[i] = groups;
        const stack = [i];
        while (stack.length) {
          for (const j of a.adjacent[stack.pop()]) {
            if (j !== s && !linked[j] && group[j] < 0) { group[j] = groups; stack.push(j); }
          }
        }
        groups++;
      }
      const damage = s >= 0 ? removalDamage(a, s) : { trap: null, needs: [] };
      // 이어진 깃발에서 7칸, 본부 중심에서 11칸 안이어야 영토가 닿는다.
      const boxes = [];
      for (let i = 0; i < a.n; i++) if (linked[i]) boxes.push([a.flags[i].x, a.flags[i].y, 7]);
      for (const h of hqs) boxes.push([h.x + 1, h.y + 1, 11]);
      let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1;
      for (const [x, y, r] of boxes) {
        x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r);
        x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r);
      }
      x0 = Math.max(3, x0); y0 = Math.max(3, y0);
      x1 = Math.min(SIZE - 4, x1); y1 = Math.min(SIZE - 4, y1);
      if (x1 < x0 || y1 < y0) return none;
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const reach = new Uint8Array(w * h);
      const mark = (x, y, r, visit) => {
        for (let row = Math.max(y0, y - r); row <= Math.min(y1, y + r); row++) {
          for (let col = Math.max(x0, x - r); col <= Math.min(x1, x + r); col++) visit((row - y0) * w + col - x0);
        }
      };
      for (const [x, y, r] of boxes) mark(x, y, r, m => { reach[m] = 1; });
      let hits = null;
      if (groups) {
        // 끊긴 묶음마다 깃발 하나는 새 자리와 7칸 안이어야 한다.
        hits = new Uint16Array(w * h);
        const stamp = new Int32Array(w * h).fill(-1);
        for (let i = 0; i < a.n; i++) {
          const g = group[i];
          if (g >= 0) mark(a.flags[i].x, a.flags[i].y, 7, m => { if (stamp[m] !== g) { stamp[m] = g; hits[m]++; } });
        }
      }
      const mask = new Uint8Array(w * h);
      let count = 0;
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const m = row * w + col;
          if (!reach[m] || (hits && hits[m] !== groups)) continue;
          const x = x0 + col, y = y0 + row;
          if (a.at.has(index(x, y)) || !placeable(x, y) || addsDefense(x, y)) continue;
          const t = damage.trap;
          if (t && !(x - 3 <= t.x0 && x + 3 >= t.x1 && y - 3 <= t.y0 && y + 3 >= t.y1)) continue;
          if (damage.needs.some(p => !squareTouchesRing(x, y, outposts[p]))) continue;
          mask[m] = 1;
          count++;
        }
      }
      return { x0, y0, w, h, mask, count };
    }

    return { hqs, traps, baseline, evaluate, issue, isProtected, moveWarning, siteNote, removable, targets };
  }

  root.KSBannerSimulation = { create };
})(globalThis);
