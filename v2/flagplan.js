/* v2 깃발 재배치 최적화 · 작업 순서 (브라우저/Node 공용)
 * optimize: 지금 게임에 서 있는 깃발(layouts/flags.json)을 최대한 그대로 쓰면서, v2 배치의 곰덫·성·빈자리·연맹 자원을
 *           모두 영토로 덮고 본부와 이어지는 깃발 세트를 찾습니다. 새로 지을 깃발 수가 가장 적은 세트를 고릅니다.
 * schedule: 지금 깃발에서 그 세트로 가는 설치·철거 순서를 만듭니다. 매 단계 모든 깃발이 본부와 이어져 있고,
 *           깃발 수는 상한(기본: 지금 개수)을 넘지 않습니다.
 * 좌표는 게임 좌표. 깃발 영토 7×7(깃발 칸 ±3), 본부 영토 15×15. v2/core.js(KSCore), v2/plan.js(KSPlan)를 먼저 불러와야 합니다.
 */
(function (root) {
  'use strict';
  const K = root.KSCore, KP = root.KSPlan, G = 1200;

  // 영토 연결 규칙
  //   'corner' 7×7 영토가 꼭짓점만 닿아도 이어짐 — 2026-10-15 게임 화면의 옥토 방향 깃발 20개가 이렇게 이어져 있음 (기본)
  //   'edge'   변이 맞닿아야 이어짐 — USB 엔진(core.js)의 가정
  const sqFlag = f => ({ x0: f.x - 3, y0: f.y - 3, x1: f.x + 3, y1: f.y + 3 });
  const sqHQ = h => ({ x0: h.x - 6, y0: h.y - 6, x1: h.x + 8, y1: h.y + 8 });
  function touch(a, b, rule) {
    const xt = a.x0 <= b.x1 + 1 && b.x0 <= a.x1 + 1, yt = a.y0 <= b.y1 + 1 && b.y0 <= a.y1 + 1;
    if (rule !== 'edge') return xt && yt;
    const xo = a.x0 <= b.x1 && b.x0 <= a.x1, yo = a.y0 <= b.y1 && b.y0 <= a.y1;
    return (xo && yt) || (xt && yo);
  }
  const keyOf = f => f.x + ',' + f.y;

  // 본부에서 이어진 깃발을 본부에서 가까운 순(BFS)으로. hops: 본부에서 몇 번째 깃발인지
  function reach(hq, flags, rule) {
    const left = flags.slice(), out = [], q = [{ s: sqHQ(hq), hop: 0 }];
    while (q.length) {
      const a = q.shift();
      for (let i = 0; i < left.length;) {
        if (touch(a.s, sqFlag(left[i]), rule)) { const f = left.splice(i, 1)[0]; out.push({ f, hop: a.hop + 1 }); q.push({ s: sqFlag(f), hop: a.hop + 1 }); }
        else i++;
      }
    }
    return out;
  }
  const allLinked = (hq, flags, rule) => reach(hq, flags, rule).length === flags.length;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // v2 배치에서 영토가 꼭 덮어야 하는 칸(가중치)과 건물이 차지한 칸
  function siteOf(list) {
    const L = KP.readLayout(list);
    const hq = L.hq || KP.HQ_DEFAULT;
    const need = new Map(), occ = new Map();     // 칸 → 가중치 / 칸 → 무엇
    const put = (o, s, w, what) => { for (let y = o.y; y < o.y + s; y++) for (let x = o.x; x < o.x + s; x++) { if (w) need.set(y * G + x, w); occ.set(y * G + x, what); } };
    put(hq, 3, 0, { kind: 'hq', n: '본부' });
    for (const [t, n] of [[L.t1, KP.T1_NAME], [L.t2, KP.T2_NAME]]) if (t) put(t, 3, 5, { kind: 'trap', n });
    for (const m of L.members) {
      const close = (L.t1 && KP.lineOf(m, L.t1) <= 3) || (L.t2 && KP.lineOf(m, L.t2) <= 3);
      put(m, 2, close ? 2 : 1, { kind: 'city', n: m.n });
    }
    for (const r of L.res) put(r, 2, 1, { kind: 'res', n: r.n });
    for (const s of L.spare) put(s, 2, 1, { kind: 'spare', n: s.n, o: s.o });
    return { L, hq, need, occ };
  }

  /* 깃발 재배치 최적화.
   * list: v2 배치(사이트 형식), existing: [{x, y, name, area}] 지금 게임의 깃발.
   * opt: { rule: 'corner'|'edge', blocks, tries, cap, refitSpares }
   * 반환: { objects: 깃발·빈자리를 바꾼 v2 배치, keep, build, remove: [{f, why}] 꼭 철거, unneeded: 그대로 둬도 되는 깃발, spareMoved, plan, stats } */
  function optimize(map, list, existing, opt) {
    opt = opt || {};
    const rule = opt.rule || 'corner', blocks = opt.blocks || KP.BLOCKS_DEFAULT, tries = opt.tries || 40;
    const site = siteOf(list), { hq } = site;
    const need = new Map(site.need), occ = new Map(site.occ);
    const inBlk = (x, y) => blocks.some(b => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2);
    const allyOK = (x, y) => !(map.flags[y * G + x] & (K.F_BLOCK | K.F_NODE | K.F_NOALLY)) && !inBlk(x, y);

    // 기존 깃발 분류: 성·곰덫·자원 위 → 철거, 빈자리 위 → 그 빈자리를 비우고 깃발을 살림
    const remove = [], usable = [], droppedSpare = new Set();
    // 빈자리(기본): 모두 비우고 깃발을 먼저 정한 뒤 영토 안 남는 칸에 다시 놓음 (같은 수). opt.refitSpares = false면 빈자리 고정
    if (opt.refitSpares !== false) for (const s of site.L.spare) {
      droppedSpare.add(s.o);
      for (const [i, v] of [...occ]) if (v.o === s.o) { occ.delete(i); need.delete(i); }
    }
    // 우선 구역(곰덫2 secure2줄 · 곰덫1 secure1줄) 안의 빈 성 자리. 구역 밖 연맹원이 남아 있으면 그 자리는 연맹원 몫:
    // 깃발이 그런 자리를 써서 구역 밖에 남게 되는 연맹원 1명당 깃발 1.5개 값의 비용 (깃발이 정해진 뒤 promote가 남은 자리를 채움)
    const zone = zoneOf(map, site.L, opt, inBlk);
    const primeSeat = new Map();                       // 칸 → 자리 번호
    const nOuter = zone.outer.length;
    let nPrime = 0;
    if (nOuter) for (const s of zone.freeSeats(occ)) { for (let y = s.y; y < s.y + 2; y++) for (let x = s.x; x < s.x + 2; x++) primeSeat.set(y * G + x, nPrime); nPrime++; }
    const SEAT_COST = 1.5;
    const lostSeats = flags => { if (!nOuter) return 0; const hit = new Set(); for (const f of flags) { const s = primeSeat.get(f.y * G + f.x); if (s != null) hit.add(s); } return Math.max(0, nOuter - (nPrime - hit.size)); };
    const reserved = [];
    for (const f of existing) {
      const o = occ.get(f.y * G + f.x);
      if (o && o.kind !== 'spare') { remove.push({ f, why: `${o.n} 자리와 겹침` }); continue; }
      if (o && o.kind === 'spare') {
        droppedSpare.add(o.o);
        for (const [i, v] of [...occ]) if (v.o === o.o) { occ.delete(i); need.delete(i); }
      }
      usable.push(f);
    }

    // 계산 창: 덮어야 할 칸과 본부 영토 주변. 창 밖의 기존 깃발(예: 북쪽 본진)은 v2를 덮는 데 쓸 수 없으니 철거 후보
    let x0 = hq.x - 6, y0 = hq.y - 6, x1 = hq.x + 8, y1 = hq.y + 8;
    for (const i of need.keys()) { const x = i % G, y = (i / G) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    x0 = Math.max(0, x0 - 12); y0 = Math.max(0, y0 - 12); x1 = Math.min(G - 1, x1 + 12); y1 = Math.min(G - 1, y1 + 12);
    const near = usable.filter(f => f.x >= x0 && f.x <= x1 && f.y >= y0 && f.y <= y1);
    const W = x1 - x0 + 1, H = y1 - y0 + 1, N = W * H;
    const idx = (x, y) => (y - y0) * W + (x - x0);
    const req = new Float32Array(N), cand = new Uint8Array(N), base = new Uint8Array(N);
    for (const [i, w] of need) req[idx(i % G, (i / G) | 0)] = w;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (allyOK(x, y) && !occ.has(y * G + x)) cand[idx(x, y)] = 1;
    for (const f of existing) if (f.x >= x0 && f.x <= x1 && f.y >= y0 && f.y <= y1) cand[idx(f.x, f.y)] = 0;   // 기존 깃발 칸
    for (let y = Math.max(y0, hq.y - 6); y <= Math.min(y1, hq.y + 8); y++) for (let x = Math.max(x0, hq.x - 6); x <= Math.min(x1, hq.x + 8); x++) base[idx(x, y)] = 1;

    function covAdd(cnt, f, d) {
      for (let y = Math.max(y0, f.y - 3); y <= Math.min(y1, f.y + 3); y++) for (let x = Math.max(x0, f.x - 3); x <= Math.min(x1, f.x + 3); x++) cnt[idx(x, y)] += d;
    }
    // 이 사각형과 이어질 수 있는 깃발 칸 표시
    function markReach(mask, s) {
      const rects = rule === 'edge'
        ? [[s.x0 - 3, s.y0 - 4, s.x1 + 3, s.y1 + 4], [s.x0 - 4, s.y0 - 3, s.x1 + 4, s.y1 + 3]]
        : [[s.x0 - 4, s.y0 - 4, s.x1 + 4, s.y1 + 4]];
      for (const [a, b, c, d] of rects)
        for (let y = Math.max(y0, b); y <= Math.min(y1, d); y++) for (let x = Math.max(x0, a); x <= Math.min(x1, c); x++) mask[idx(x, y)] = 1;
    }

    // start: 미리 세워 둘 새 깃발 (국소 개선에서 남긴 것). 본부와 이어지는 것만 쓰임
    function once(rng, noise, start) {
      const placed = [];
      try { return attempt(rng, noise, placed, start || []); }
      finally { for (const i of placed) cand[i] = 1; }      // 다음 시도를 위해 후보 칸 되돌리기
    }
    function attempt(rng, noise, placed, start) {
      const cnt = new Int16Array(N), mask = new Uint8Array(N);
      const flags = [];                                   // {x, y, name?, existing}
      markReach(mask, sqHQ(hq));
      // 본부와 이어지는 기존 깃발(재사용은 공짜)과 미리 둘 새 깃발부터
      const pool = near.map(f => ({ ...f, existing: true })).concat(start.map(f => ({ x: f.x, y: f.y, existing: false })));
      const activate = () => {
        let any = true;
        while (any) {
          any = false;
          for (let i = 0; i < pool.length;) {
            const f = pool[i];
            if (mask[idx(f.x, f.y)]) {
              pool.splice(i, 1); flags.push(f); covAdd(cnt, f, 1); markReach(mask, sqFlag(f)); any = true;
              if (!f.existing) { const j = idx(f.x, f.y); cand[j] = 0; placed.push(j); }
            } else i++;
          }
        }
      };
      activate();
      for (let step = 0; step < 80; step++) {
        // 아직 안 덮인 칸
        const U = new Uint8Array(N); let left = 0;
        for (let i = 0; i < N; i++) if (req[i] && !cnt[i] && !base[i]) { U[i] = 1; left++; }
        if (!left) break;
        // 7×7 누적합으로 후보마다 새로 덮는 칸 (가중)
        const ps = new Float64Array((W + 1) * (H + 1));
        for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { const i = y * W + x; row += U[i] ? req[i] : 0; ps[(y + 1) * (W + 1) + x + 1] = ps[y * (W + 1) + x + 1] + row; } }
        const gain = (x, y) => {
          const xa = Math.max(0, x - 3), ya = Math.max(0, y - 3), xb = Math.min(W - 1, x + 3), yb = Math.min(H - 1, y + 3);
          return ps[(yb + 1) * (W + 1) + xb + 1] - ps[ya * (W + 1) + xb + 1] - ps[(yb + 1) * (W + 1) + xa] + ps[ya * (W + 1) + xa];
        };
        let best = -1, bestS = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!cand[i] || !mask[i]) continue;
          const g = gain(x, y);
          if (g <= 0) continue;
          const s = g * (primeSeat.has((y + y0) * G + x + x0) ? 0.35 : 1) * (1 + noise * (rng() - 0.5));   // 구역 안 성 자리는 되도록 피함
          if (s > bestS) { bestS = s; best = i; }
        }
        if (best < 0) {
          // 다리 깃발: 이어질 수 있는 칸 중 안 덮인 칸(또는 아직 못 쓴 기존 깃발)에 가장 가까운 곳
          const dist = new Int16Array(N).fill(-1), q = new Int32Array(N); let qh = 0, qt = 0;
          for (let i = 0; i < N; i++) if (U[i]) { dist[i] = 0; q[qt++] = i; }
          for (const f of pool) if (f.x >= x0 && f.x <= x1 && f.y >= y0 && f.y <= y1) { const i = idx(f.x, f.y); if (dist[i] < 0) { dist[i] = 0; q[qt++] = i; } }
          while (qh < qt) {
            const i = q[qh++], x = i % W, y = (i / W) | 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const j = ny * W + nx; if (dist[j] < 0) { dist[j] = dist[i] + 1; q[qt++] = j; }
            }
          }
          let bk = 1e9;
          for (let i = 0; i < N; i++) if (cand[i] && mask[i] && dist[i] >= 0) { const k = dist[i] + noise * rng(); if (k < bk) { bk = k; best = i; } }
          if (best < 0) return null;
        }
        const f = { x: x0 + best % W, y: y0 + ((best / W) | 0), existing: false };
        cand[best] = 0; placed.push(best); flags.push(f); covAdd(cnt, f, 1); markReach(mask, sqFlag(f));
        activate();
      }
      // 다 덮였는지
      for (let i = 0; i < N; i++) if (req[i] && !cnt[i] && !base[i]) return null;
      // 필요 없는 깃발 빼기: 새 깃발(나중 것부터) → 기존 깃발(멀리 있는 것부터, 시도마다 조금씩 섞음)
      const far = f => Math.abs(f.x - hq.x) + Math.abs(f.y - hq.y) + noise * rng() * 4;
      const order = flags.filter(f => !f.existing).reverse()
        .concat(flags.filter(f => f.existing).map(f => ({ f, k: far(f) })).sort((a, b) => b.k - a.k).map(e => e.f));
      let cur = flags.slice();
      for (const f of order) {
        let ok = true;
        for (let y = Math.max(y0, f.y - 3); y <= Math.min(y1, f.y + 3) && ok; y++) for (let x = Math.max(x0, f.x - 3); x <= Math.min(x1, f.x + 3) && ok; x++) {
          const i = idx(x, y); if (req[i] && !base[i] && cnt[i] < 2) ok = false;
        }
        if (!ok) continue;
        const rest = cur.filter(g => g !== f);
        if (!allLinked(hq, rest, rule)) continue;
        cur = rest; covAdd(cnt, f, -1);
      }
      const nNew = cur.filter(f => !f.existing).length;
      return { flags: cur, cost: nNew + 0.02 * cur.length + SEAT_COST * lostSeats(cur) };
    }

    let best = null;
    const rng = mulberry32(opt.seed || 20382);
    for (let t = 0; t < tries; t++) {
      const r = once(rng, t === 0 ? 0 : 0.15 + 0.6 * rng());
      if (r && (!best || r.cost < best.cost - 1e-9)) best = r;
    }
    if (!best) throw new Error('모든 자리를 덮는 깃발 배치를 찾지 못했습니다');
    // 국소 개선: 가장 좋은 배치에서 새 깃발 하나 주변(반경 7~13칸)의 새 깃발을 지우고 다시 채움. 나아지면 바꿈
    const lns = opt.lns != null ? opt.lns : tries * 3;
    for (let t = 0; t < lns; t++) {
      const news = best.flags.filter(f => !f.existing);
      if (!news.length) break;
      const c = news[Math.floor(rng() * news.length)], rad = 7 + Math.floor(rng() * 7);
      const start = news.filter(f => Math.max(Math.abs(f.x - c.x), Math.abs(f.y - c.y)) > rad);
      const r = once(rng, 0.1 + 0.5 * rng(), start);
      if (r && r.cost < best.cost - 1e-9) best = r;
    }

    const kept = new Set(best.flags.filter(f => f.existing).map(keyOf));
    // 쓰지 않는 기존 깃발: 자리와 겹치지 않으니 그대로 둬도 됨 (철거 표시 안 함)
    const unneeded = usable.filter(f => !kept.has(keyOf(f))).concat(reserved);
    const keep = usable.filter(f => kept.has(keyOf(f)));
    const build = best.flags.filter(f => !f.existing).map(f => ({ x: f.x, y: f.y }));

    // 깃발에 자리를 내준 빈자리는 영토 안 다른 빈칸으로 (assign과 같은 기준: 곰덫2 가까운 줄·거리 순)
    const finalFlags = keep.concat(build);
    const terr = new Set();
    const cov = (x, y, c, s) => { for (let yy = y - c; yy < y + s + c; yy++) for (let xx = x - c; xx < x + s + c; xx++) terr.add(yy * G + xx); };
    cov(hq.x, hq.y, 6, 3); finalFlags.forEach(f => cov(f.x, f.y, 3, 1));
    const taken = new Set(occ.keys()); finalFlags.forEach(f => taken.add(f.y * G + f.x));
    existing.forEach(f => taken.add(f.y * G + f.x));   // 지금 서 있는 깃발 칸에는 빈자리를 두지 않음 (철거가 늘지 않게)
    const L = site.L, T2 = L.t2;
    const par = L.members[0] ? { x: L.members[0].x & 1, y: L.members[0].y & 1 } : { x: 0, y: 0 };
    const cityOK = (x, y) => !(map.flags[y * G + x] & (K.F_BLOCK | K.F_NODE | K.F_NOCITY)) && !inBlk(x, y);
    const spots = [];
    for (let y = T2.y - 22; y <= T2.y + 22; y++) for (let x = T2.x - 26; x <= T2.x + 26; x++) {
      if (((x - par.x) & 1) || ((y - par.y) & 1)) continue;
      let ok = true;
      for (let yy = y; yy < y + 2 && ok; yy++) for (let xx = x; xx < x + 2 && ok; xx++) { const i = yy * G + xx; if (taken.has(i) || !terr.has(i) || !cityOK(xx, yy)) ok = false; }
      if (ok) spots.push({ x, y, l: KP.lineOf({ x, y }, T2), d: KP.dist({ x, y }, T2) });
    }
    spots.sort((a, b) => Math.min(a.l, 4) - Math.min(b.l, 4) || a.d - b.d);
    const spareMoved = [];
    const keptSpares = L.spare.filter(s => !droppedSpare.has(s.o));
    const spareTarget = opt.spareTotal != null ? opt.spareTotal : L.spare.length;
    const newSpares = [];
    for (const s of spots) {
      if (keptSpares.length + newSpares.length >= spareTarget) break;
      let free = true;
      for (let yy = s.y; yy < s.y + 2 && free; yy++) for (let xx = s.x; xx < s.x + 2 && free; xx++) if (taken.has(yy * G + xx)) free = false;
      if (!free) continue;
      for (let yy = s.y; yy < s.y + 2; yy++) for (let xx = s.x; xx < s.x + 2; xx++) taken.add(yy * G + xx);
      newSpares.push(s);
    }
    L.spare.filter(s => droppedSpare.has(s.o)).forEach((s, i) => spareMoved.push({ from: { x: s.x, y: s.y }, to: newSpares[i] ? { x: newSpares[i].x, y: newSpares[i].y } : null }));

    // 결과 배치: 빈자리는 곰덫2 가까운 순으로 번호. 깃발 번호와 작업 순서는 완성된 배치로 계산 (/v2 화면과 같은 결과)
    const spares = keptSpares.map(s => ({ x: s.x, y: s.y })).concat(newSpares.map(s => ({ x: s.x, y: s.y })))
      .map(s => ({ ...s, l: KP.lineOf(s, T2), d: KP.dist(s, T2) })).sort((a, b) => Math.min(a.l, 4) - Math.min(b.l, 4) || a.d - b.d);
    const objects = list.filter(o => o.name !== '깃발 1' && !(o.name === 'Player' && KP.isSpare(o.nickname)))
      .concat(finalFlags.map((f, i) => KP.fromGame('깃발 1', f.x, f.y, `깃발 ${i + 1}`)))
      .concat(spares.map((s, i) => KP.fromGame('Player', s.x, s.y, `빈자리 ${i + 1}`)));
    const rn = renumber(objects, existing, { rule, cap: opt.cap });
    return {
      objects: rn.objects, keep, build, remove, unneeded, spareMoved, plan: rn.plan, rule,
      stats: { existing: existing.length, keep: keep.length, build: build.length, remove: remove.length, unneeded: unneeded.length, total: finalFlags.length, lost: lostSeats(best.flags), before: (KP.readLayout(list).banners || []).length },
    };
  }

  /* 작업 순서: 지금 깃발(existing) → 목표 깃발(target). 매 단계 모든 깃발이 본부와 이어짐.
   * 철거는 꼭 필요한 것만: 새 배치의 성·곰덫·빈자리·연맹 자원 자리 위에 선 깃발. 필요 없는 다른 깃발은 그대로 둬도 됨.
   * opt.cap(깃발 수 상한)을 주면, 상한 때문에 설치하기 전 필요 없는 깃발을 먼저 철거하는 단계도 넣음 (기본: 상한 없음).
   * 설치는 곰덫·가까운 줄 성을 먼저 덮는 순.
   * 반환: { steps: [{op: 'build'|'remove', f, why, phase}], cap, stuck, left, optional: 그대로 둬도 되는 깃발 } */
  function schedule(list, existing, target, opt) {
    opt = opt || {};
    const rule = opt.rule || 'corner';
    const site = siteOf(list), { hq } = site;
    const tKeys = new Set(target.map(keyOf)), eKeys = new Set(existing.map(keyOf));
    let present = existing.slice();
    const toBuild = target.filter(f => !eKeys.has(keyOf(f))).map(f => ({ x: f.x, y: f.y }));
    const conflict = f => { const o = site.occ.get(f.y * G + f.x); return o ? o.n : null; };
    const must = existing.filter(f => !tKeys.has(keyOf(f)) && conflict(f));           // 꼭 철거
    const optional = existing.filter(f => !tKeys.has(keyOf(f)) && !conflict(f));      // 그대로 둬도 됨
    const cap = opt.cap > 0 ? opt.cap : Infinity;
    const steps = [];
    const covered = () => {
      const s = new Set();
      for (let y = hq.y - 6; y <= hq.y + 8; y++) for (let x = hq.x - 6; x <= hq.x + 8; x++) s.add(y * G + x);
      for (const f of present) for (let y = f.y - 3; y <= f.y + 3; y++) for (let x = f.x - 3; x <= f.x + 3; x++) s.add(y * G + x);
      return s;
    };
    // 설치: rule로 이어져야 함. 철거: 게임에서 실제로 이어진 것(꼭짓점 포함)이 끊기지 않아야 함
    const linkedSet = (set, r = rule) => new Set(reach(hq, set, r).map(x => x.f));
    const canStillBuild = set => { const r = linkedSet(set.concat(toBuild)); return toBuild.every(b => r.has(b)); };
    // 철거해도 지금 본부와 이어진 다른 깃발이 끊기지 않고, 남은 설치도 계속 이어질 수 있어야 함
    const removable = f => {
      const before = linkedSet(present, 'corner'), rest = present.filter(g => g !== f), after = linkedSet(rest, 'corner');
      for (const g of before) if (g !== f && !after.has(g)) return false;
      return canStillBuild(rest);
    };
    const isBase = f => f.area === '본진';
    const farFirst = (a, b) => (Math.abs(b.x - hq.x) + Math.abs(b.y - hq.y)) - (Math.abs(a.x - hq.x) + Math.abs(a.y - hq.y));
    const pick = pool => pool.filter(f => present.includes(f) && removable(f)).sort((a, b) => (isBase(a) - isBase(b)) || farFirst(a, b))[0] || null;
    const doRemove = (f, phase, why) => { present = present.filter(g => g !== f); steps.push({ op: 'remove', f, phase, why }); };
    let stuck = false;
    while (toBuild.length) {
      const cov = covered(), live = [...linkedSet(present)];
      const can = toBuild.filter(b => touch(sqHQ(hq), sqFlag(b), rule) || live.some(p => touch(sqFlag(p), sqFlag(b), rule)));
      if (can.length && present.length < cap) {
        // 아직 영토 밖인 곰덫·성을 가장 많이 덮는 깃발부터 (곰덫 5 · 1~3줄 성 2 · 나머지 1)
        const score = b => { let s = 0; for (let y = b.y - 3; y <= b.y + 3; y++) for (let x = b.x - 3; x <= b.x + 3; x++) { const i = y * G + x; if (!cov.has(i)) s += site.need.get(i) || 0; } return s; };
        can.sort((a, b) => score(b) - score(a) || (Math.abs(a.x - hq.x) + Math.abs(a.y - hq.y)) - (Math.abs(b.x - hq.x) + Math.abs(b.y - hq.y)));
        const b = can[0];
        toBuild.splice(toBuild.indexOf(b), 1); present.push(b);
        steps.push({ op: 'build', f: b, phase: 1, why: score(b) ? '새 자리 덮기' : '다리 깃발' });
        continue;
      }
      if (present.length < cap) { stuck = true; break; }   // 이어질 곳이 없음 (철거로는 해결 안 됨)
      // 깃발 수 상한: 꼭 철거할 것 → 필요 없는 것 순으로 하나 비움
      let r = pick(must);
      if (r) { doRemove(r, 1, `${conflict(r)} 자리와 겹침`); continue; }
      r = pick(optional);
      if (r) { doRemove(r, 1, '깃발 수 상한 때문에 (v2에 필요 없음)'); continue; }
      stuck = true; break;
    }
    // 남은 꼭 철거할 깃발: 새 자리에 들어가기 전에
    for (let r = pick(must); r; r = pick(must)) doRemove(r, 2, `${conflict(r)} 자리와 겹침`);
    const removed = new Set(steps.filter(s => s.op === 'remove').map(s => s.f));
    const leftMust = must.filter(f => !removed.has(f));
    if (leftMust.length) stuck = true;
    return { steps, cap, stuck, left: { build: toBuild, remove: leftMust }, optional: optional.filter(f => !removed.has(f)) };
  }

  /* 깃발 번호 순서: 새로 지을 깃발을 작업 순서(설치 순)대로 1, 2, … 그다음 이미 서 있어 그대로 쓰는 깃발(본부에서 가까운 순).
   * 작업 순서가 막혀 못 정한 깃발은 맨 뒤 */
  function workOrder(hq, flags, existing, plan, rule) {
    const ex = new Set(existing.map(keyOf)), seen = new Set(), out = [];
    const add = f => { const k = keyOf(f); if (!seen.has(k)) { seen.add(k); out.push(flags.find(g => keyOf(g) === k) || f); } };
    plan.steps.filter(s => s.op === 'build').forEach(s => add(s.f));
    reach(hq, flags, rule).map(r => r.f).filter(f => ex.has(keyOf(f))).forEach(add);
    flags.forEach(add);
    return out;
  }
  // 배치의 깃발 이름을 작업 순서대로 다시 매김 ("깃발 1" …). 반환: { objects, plan, rule, order }
  function renumber(list, existing, opt) {
    opt = opt || {};
    const L = KP.readLayout(list), hq = L.hq || KP.HQ_DEFAULT;
    const flags = L.banners.map(b => ({ x: b.x, y: b.y }));
    const rule = opt.rule || (reach(hq, flags, 'edge').length === flags.length ? 'edge' : 'corner');
    const plan = schedule(list, existing, flags, { rule, cap: opt.cap });
    const order = workOrder(hq, flags, existing, plan, rule);
    const num = new Map(order.map((f, i) => [keyOf(f), i + 1]));
    const objects = list.filter(o => o.name !== '깃발 1')
      .concat(order.map(f => KP.fromGame('깃발 1', f.x, f.y, `깃발 ${num.get(keyOf(f))}`)));
    return { objects, plan, rule, order };
  }

  /* 우선 구역(선택): 곰덫2 opt.secure2줄 ∪ 곰덫1 opt.secure1줄. 기본 0 = 끔. 성 격자는 연맹원 자리와 같은 홀짝.
   * 반환: { inZone(x, y), outBy(x, y): 구역 밖으로 몇 줄, outer: 구역 밖 연맹원, freeSeats(occ): 구역 안 빈 성 자리 } */
  function zoneOf(map, L, opt, inBlk) {
    opt = opt || {};
    const S2 = opt.secure2 != null ? opt.secure2 : 0, S1 = opt.secure1 != null ? opt.secure1 : 0;
    const T1 = L.t1, T2 = L.t2;
    const inZone = (x, y) => (!!T2 && KP.lineOf({ x, y }, T2) <= S2) || (!!T1 && KP.lineOf({ x, y }, T1) <= S1);
    const outBy = (x, y) => Math.min(T2 ? KP.lineOf({ x, y }, T2) - S2 : 99, T1 ? KP.lineOf({ x, y }, T1) - S1 : 99);
    const p0 = L.members[0] || L.spare[0];
    const par = p0 ? { x: p0.x & 1, y: p0.y & 1 } : { x: 0, y: 0 };
    const cityOK = (x, y) => !(map.flags[y * G + x] & (K.F_BLOCK | K.F_NODE | K.F_NOCITY)) && !inBlk(x, y);
    const outer = S2 > 0 || S1 > 0 ? L.members.filter(m => !inZone(m.x, m.y)) : [];
    function freeSeats(occ) {
      const ts = [T1, T2].filter(Boolean), out = [];
      if (!ts.length) return out;
      const r = 2 * Math.max(S1, S2) + 4;
      const xa = Math.min(...ts.map(t => t.x)) - r, xb = Math.max(...ts.map(t => t.x)) + r;
      const ya = Math.min(...ts.map(t => t.y)) - r, yb = Math.max(...ts.map(t => t.y)) + r;
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        if (((x - par.x) & 1) || ((y - par.y) & 1) || !inZone(x, y)) continue;
        let ok = true;
        for (let yy = y; yy < y + 2 && ok; yy++) for (let xx = x; xx < x + 2 && ok; xx++) if (occ.has(yy * G + xx) || !cityOK(xx, yy)) ok = false;
        if (ok) out.push({ x, y });
      }
      return out;
    }
    return { S2, S1, inZone, outBy, outer, freeSeats };
  }

  /* 구역 채우기: 깃발이 정해진 배치에서 영토 안 우선 구역의 빈 성 자리로 구역 밖 연맹원을 옮김
   * (구역에서 먼 사람부터, 그 사람과 가까운 자리로. 지금 깃발이 서 있는 자리는 되도록 피함). 그 자리의 빈자리는 비움.
   * 반환: { objects, moved: [{ n, from, to }] } */
  function promote(map, list, existing, opt) {
    opt = opt || {};
    const blocks = opt.blocks || KP.BLOCKS_DEFAULT;
    const inBlk = (x, y) => blocks.some(b => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2);
    const L = KP.readLayout(list), site = siteOf(list), hq = site.hq;
    const zone = zoneOf(map, L, opt, inBlk);
    if (!zone.outer.length) return { objects: list, moved: [] };
    const occ = new Map([...site.occ].filter(([, v]) => v.kind !== 'spare'));
    for (const b of L.banners) occ.set(b.y * G + b.x, { kind: 'flag' });
    const terr = new Set();
    for (let y = hq.y - 6; y <= hq.y + 8; y++) for (let x = hq.x - 6; x <= hq.x + 8; x++) terr.add(y * G + x);
    for (const b of L.banners) for (let y = b.y - 3; y <= b.y + 3; y++) for (let x = b.x - 3; x <= b.x + 3; x++) terr.add(y * G + x);
    const tiles = s => [s.y * G + s.x, s.y * G + s.x + 1, (s.y + 1) * G + s.x, (s.y + 1) * G + s.x + 1];
    const exT = new Set(existing.map(f => f.y * G + f.x));
    const seats = zone.freeSeats(occ).filter(s => tiles(s).every(i => terr.has(i)));
    const outer = zone.outer.slice().sort((a, b) => zone.outBy(b.x, b.y) - zone.outBy(a.x, a.y) || KP.dist(b, L.t2) - KP.dist(a, L.t2));
    const moved = [], taken = new Set();
    for (const m of outer) {
      let best = null, bd = Infinity;
      for (const s of seats) {
        if (taken.has(keyOf(s))) continue;
        const d = (s.x - m.x) ** 2 + (s.y - m.y) ** 2 + (tiles(s).some(i => exT.has(i)) ? 1e6 : 0);
        if (d < bd) { bd = d; best = s; }
      }
      if (!best) break;
      taken.add(keyOf(best)); moved.push({ n: m.n, o: m.o, from: { x: m.x, y: m.y }, to: { x: best.x, y: best.y } });
    }
    if (!moved.length) return { objects: list, moved };
    const movedObj = new Set(moved.map(m => m.o)), seatT = new Set(moved.flatMap(m => tiles(m.to)));
    const objects = list.filter(o => !movedObj.has(o) && !(o.name === 'Player' && KP.isSpare(o.nickname) && tiles(KP.toGame(o)).some(i => seatT.has(i))))
      .concat(moved.map(m => KP.fromGame('Player', m.to.x, m.to.y, m.n)));
    return { objects, moved: moved.map(({ n, from, to }) => ({ n, from, to })) };
  }

  /* 줄 채우기 (깃발은 그대로): 곰덫2 opt.fill2줄(기본 3) 안의 빈자리·빈칸을, 명단상 곰덫2 기준인데 그 줄 밖에 있는 연맹원으로 채움.
   * 그 때문에 곰덫1 opt.fill1줄(기본 2) 안이 비면, 곰덫1 기준인데 그 줄 밖에 있는 연맹원으로 다시 채움.
   * 명단상 기준 곰덫 = 기존 배치(oldList)에서 더 가까웠던 곰덫 (/v2 명단과 같음, 기존 배치에 없으면 새 자리 기준).
   * 고르는 순서: 다른 곰덫 핵심 줄(곰덫1 1~fill1줄 · 곰덫2 1~fill2줄)에 있지 않은 사람 → 기존 배치에서 그 곰덫에 가까웠던 사람.
   * 곰덫1 1줄 인원은 옮기지 않음. 떠난 자리는 빈자리가 되고 빈자리 총수는 그대로.
   * 반환: { objects, moved: [{ n, from, to, trap }], before, after: { t2: [줄별], t1: [줄별] } } */
  function fillLines(map, list, oldList, opt) {
    opt = opt || {};
    const F2 = opt.fill2 != null ? opt.fill2 : 3, F1 = opt.fill1 != null ? opt.fill1 : 2;
    const blocks = opt.blocks || KP.BLOCKS_DEFAULT;
    const inBlk = (x, y) => blocks.some(b => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2);
    const cityOK = (x, y) => !(map.flags[y * G + x] & (K.F_BLOCK | K.F_NODE | K.F_NOCITY)) && !inBlk(x, y);
    const L = KP.readLayout(list), T1 = L.t1, T2 = L.t2, hq = L.hq || KP.HQ_DEFAULT;
    const O = oldList ? KP.readLayout(oldList) : null;
    const oldBy = new Map(O && O.t1 && O.t2 ? O.members.map(m => [String(m.n).trim().toLowerCase(), m]) : []);
    const tiles = s => [s.y * G + s.x, s.y * G + s.x + 1, (s.y + 1) * G + s.x, (s.y + 1) * G + s.x + 1];
    const mem = L.members.map(m => {
      const o = oldBy.get(String(m.n).trim().toLowerCase());
      return { n: m.n, o: m.o, x: m.x, y: m.y, g: o ? KP.refOf(o, O.t1, O.t2) : KP.refOf(m, T1, T2), ol2: o ? KP.lineOf(o, O.t2) : 99, ol1: o ? KP.lineOf(o, O.t1) : 99 };
    });
    const lines = () => ({ t2: [1, 2, 3].map(k => mem.filter(m => KP.lineOf(m, T2) === k).length), t1: [1, 2].map(k => mem.filter(m => KP.lineOf(m, T1) === k).length) });
    const before = lines();
    // 막힌 칸: 본부·곰덫·연맹 자원·연맹원·깃발 칸 (빈자리는 비울 수 있음)
    const occ = new Set();
    const put = (s, n) => { for (let y = s.y; y < s.y + n; y++) for (let x = s.x; x < s.x + n; x++) occ.add(y * G + x); };
    put(hq, 3); put(T1, 3); put(T2, 3); L.res.forEach(r => put(r, 2)); mem.forEach(m => put(m, 2)); L.banners.forEach(b => occ.add(b.y * G + b.x));
    const terr = new Set();
    for (let y = hq.y - 6; y <= hq.y + 8; y++) for (let x = hq.x - 6; x <= hq.x + 8; x++) terr.add(y * G + x);
    L.banners.forEach(b => { for (let y = b.y - 3; y <= b.y + 3; y++) for (let x = b.x - 3; x <= b.x + 3; x++) terr.add(y * G + x); });
    const p0 = L.members[0] || L.spare[0], par = { x: p0.x & 1, y: p0.y & 1 };
    const vacancies = (t, F) => {
      const out = [], r = 2 * F + 4;
      for (let y = t.y - r; y <= t.y + r; y++) for (let x = t.x - r; x <= t.x + r; x++) {
        if (((x - par.x) & 1) || ((y - par.y) & 1) || KP.lineOf({ x, y }, t) > F) continue;
        const ts = tiles({ x, y });
        if (ts.every(i => !occ.has(i) && terr.has(i) && cityOK(i % G, (i / G) | 0))) out.push({ x, y });
      }
      return out;
    };
    const moved = [];
    const move = (m, s, trap) => {
      for (const i of tiles(m)) occ.delete(i);
      for (const i of tiles(s)) occ.add(i);
      moved.push({ n: m.n, o: m.o, from: { x: m.x, y: m.y }, to: { x: s.x, y: s.y }, trap });
      m.x = s.x; m.y = s.y;
    };
    // 곰덫(t, 줄 F)의 빈자리를 그 곰덫 기준(g) 바깥 연맹원으로. 다른 곰덫(ot, 줄 oF)의 핵심 줄에 있는 사람은 뒤로
    const fill = (g, t, F, ot, oF) => {
      const seats = vacancies(t, F);
      if (!seats.length) return;
      const cand = mem.filter(m => m.g === g && KP.lineOf(m, t) > F && KP.lineOf(m, T1) !== 1)
        .map(m => ({ m, core: KP.lineOf(m, ot) <= oF ? 1 : 0, ol: g === 2 ? m.ol2 : m.ol1, d: KP.dist(m, t) }))
        .sort((a, b) => a.core - b.core || a.ol - b.ol || a.d - b.d)
        .slice(0, seats.length).map(c => c.m);
      for (const m of cand) {   // 각자 가장 가까운 남은 자리로
        let best = null, bd = Infinity;
        for (const s of seats) { const d = (s.x - m.x) ** 2 + (s.y - m.y) ** 2; if (!s.used && d < bd) { bd = d; best = s; } }
        if (!best) break;
        best.used = true; move(m, best, g);
      }
    };
    if (F2 > 0) fill(2, T2, F2, T1, F1);
    if (F1 > 0) fill(1, T1, F1, T2, F2);
    if (!moved.length) return { objects: list, moved, before, after: before };
    // 빈자리: 새로 들어간 자리에 있던 빈자리는 떠난 자리로 (총수 그대로), 곰덫2 가까운 순으로 번호
    const taken = new Set(moved.flatMap(m => tiles(m.to)));
    const keepSp = L.spare.filter(s => !tiles(s).some(i => taken.has(i))).map(s => ({ x: s.x, y: s.y }));
    const freed = moved.map(m => m.from).filter(f => !tiles(f).some(i => occ.has(i)));
    const spares = keepSp.concat(freed.slice(0, L.spare.length - keepSp.length))
      .map(s => ({ ...s, l: KP.lineOf(s, T2), d: KP.dist(s, T2) })).sort((a, b) => Math.min(a.l, 4) - Math.min(b.l, 4) || a.d - b.d);
    const movedObj = new Set(moved.map(m => m.o));
    const objects = list.filter(o => !movedObj.has(o) && !(o.name === 'Player' && KP.isSpare(o.nickname)))
      .concat(moved.map(m => KP.fromGame('Player', m.to.x, m.to.y, m.n)))
      .concat(spares.map((s, i) => KP.fromGame('Player', s.x, s.y, `빈자리 ${i + 1}`)));
    return { objects, moved: moved.map(({ n, from, to, trap }) => ({ n, from, to, trap })), before, after: lines() };
  }

  /* 전체: 깃발 최적화 → 구역 채우기 → (옮긴 사람이 있으면) 다시 깃발 최적화 … 바뀌지 않을 때까지. 빈자리 수는 처음 그대로 */
  function optimizeFull(map, list, existing, opt) {
    opt = { ...(opt || {}) };
    if (opt.spareTotal == null) opt.spareTotal = KP.readLayout(list).spare.length;
    let cur = list;
    const promoted = [];
    for (let round = 0; round < 4; round++) {
      const r = optimizeAuto(map, cur, existing, opt);
      const p = promote(map, r.objects, existing, opt);
      if (!p.moved.length || round === 3) {
        r.promoted = promoted;
        // 줄 채우기 (깃발 그대로): 기존 배치(opt.oldList)를 받았을 때만. 번호·작업 순서는 채운 배치로 다시
        if (opt.oldList && opt.fill !== false) {
          const fl = fillLines(map, r.objects, opt.oldList, opt);
          if (fl.moved.length) { const rn = renumber(fl.objects, existing, { rule: r.rule, cap: opt.cap }); r.objects = rn.objects; r.plan = rn.plan; }
          r.filled = fl;
        }
        return r;
      }
      promoted.push(...p.moved);
      cur = p.objects;
    }
  }

  /* 규칙 자동 선택: 변 접촉(엄격)으로 찾은 배치는 꼭짓점 규칙에서도 통하므로, 새로 지을 깃발이 같으면 그쪽을 씀.
   * 꼭짓점 규칙이 더 적게 지을 때만 꼭짓점 결과를 씀 (게임 화면으로 확인한 규칙). */
  function optimizeAuto(map, list, existing, opt) {
    opt = opt || {};
    if (opt.rule && opt.rule !== 'auto') return optimize(map, list, existing, opt);
    const edge = optimize(map, list, existing, { ...opt, rule: 'edge' });
    const corner = optimize(map, list, existing, { ...opt, rule: 'corner' });
    const cost = s => s.build + 1.5 * s.lost + 0.02 * s.total;   // optimize와 같은 비용 (구역 자리 손실 포함)
    const r = cost(corner.stats) < cost(edge.stats) - 1e-9 ? corner : edge;
    r.alt = r === edge ? { rule: 'corner', stats: corner.stats } : { rule: 'edge', stats: edge.stats };
    return r;
  }

  root.KSFlagPlan = { optimize: optimizeFull, optimizeAuto, optimizeRule: optimize, promote, zoneOf, fillLines, schedule, renumber, workOrder, reach, touch, sqFlag, sqHQ, siteOf };
})(typeof self !== 'undefined' ? self : this);
