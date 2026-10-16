/* v2 배치 도구 — 이름 배치 다시 계산 · 규칙 검사 (브라우저/Node 공용)
 * 원본: USB "킹샷2382_곰덫배치/code/src/assign2.js", "verify-json.js". 계산 순서는 원본과 같고, 곰덫 2줄 확보(2-1)만 더했습니다(opt.secure = 0이면 원본과 같음).
 * v2/core.js(KSCore)를 먼저 불러와야 합니다. 좌표는 게임 좌표(건물의 최소 X·Y 모서리 칸)입니다.
 */
(function (root) {
  'use strict';
  const K = root.KSCore, G = 1200;
  const HQ_DEFAULT = { x: 523, y: 759 };                               // 평원 본부
  const BLOCKS_DEFAULT = [{ x1: 544, y1: 724, x2: 1199, y2: 764 }];    // 다른 연맹 영토 (X 544 이상, Y 724~764)
  const T1_NAME = '사냥 함정 1', T2_NAME = '사냥 함정 2';
  const isSpare = n => !n || n === 'Player' || /^빈자리/.test(n);
  // 이용자가 아닌 성 — 연맹원으로 세지 않음. v2에서는 연맹 건물(연맹자원)로 두되 자리 번호는 차지함(fixed)
  const NON_MEMBERS = new Set(['개척자']);
  const isNonMember = n => NON_MEMBERS.has(String(n || '').trim());

  // 사이트 기물 → 게임 좌표. 깃발·본부는 가운데 핵심 칸(1×1, 3×3) 기준
  function toGame(o) {
    let cx = o.tx, cy = o.ty, w = o.w, h = o.h;
    if (o.type === 'two-tone') { const c = o.name.startsWith('본부') ? 3 : 1, off = Math.floor((o.w - c) / 2); cx += off; cy += off; w = h = c; }
    return { x: G - cy - h, y: G - cx - w };
  }
  const TPL = {
    'Player': ['#EFFFF3', 2, 'one-tone', 2], '곰덫': ['#FF7200', 3, 'one-tone', 3],
    '깃발 1': ['rgba(52, 152, 219, 0.5)', 7, 'two-tone', 1], '본부 1': ['rgba(52, 152, 219, 0.5)', 15, 'two-tone', 3],
    '연맹자원': ['#0F461E', 2, 'one-tone', 2],
  };
  function fromGame(name, gx, gy, nickname) {
    const [color, W, type, c] = TPL[name], off = (W - c) / 2;
    return { name, w: W, h: W, type, color, tx: G - gy - c - off, ty: G - gx - c - off, nickname };
  }

  // 배치 목록 → 본부·곰덫·깃발(설치 순서)·연맹 자원·연맹원·빈자리
  function readLayout(list) {
    const traps = list.filter(o => o.name === '곰덫');
    const t1o = traps.find(o => o.nickname === T1_NAME) || traps[0];
    const t2o = traps.find(o => o.nickname === T2_NAME) || traps.find(o => o !== t1o);
    const hqo = list.find(o => o.name === '본부 1');
    const num = o => { const m = /\d+/.exec(String(o.nickname)); return m ? +m[0] : Infinity; };
    const banners = list.filter(o => o.name === '깃발 1').map((o, i) => ({ o, i, k: num(o) }))
      .sort((a, b) => a.k - b.k || a.i - b.i).map(({ o }) => ({ ...toGame(o), o }));
    const players = list.filter(o => o.name === 'Player').map(o => ({ ...toGame(o), n: o.nickname, o }));
    const res = list.filter(o => o.name === '연맹자원').map(o => ({ ...toGame(o), n: o.nickname, o }));
    return {
      hq: hqo ? toGame(hqo) : null, hqo, t1: t1o ? toGame(t1o) : null, t1o, t2: t2o && t2o !== t1o ? toGame(t2o) : null, t2o,
      banners, res, fixed: res.filter(r => isNonMember(r.n)),   // fixed: 자리 번호를 차지하는 연맹 건물 (개척자)
      members: players.filter(p => !isSpare(p.n) && !isNonMember(p.n)), spare: players.filter(p => isSpare(p.n)),
    };
  }

  const dist = (c, t) => Math.hypot(c.x + 1 - t.x - 1.5, c.y + 1 - t.y - 1.5);   // 도시 중심 → 곰덫 중심
  const lineOf = (c, t) => K.lineOf(c.x - t.x, c.y - t.y);
  // 기준 곰덫: 곰덫1 1줄이거나 곰덫1에 더 가까운 줄이면 곰덫1, 아니면 곰덫2
  const refOf = (c, t1, t2) => { const l1 = lineOf(c, t1), l2 = lineOf(c, t2); return (l1 === 1 || l1 < l2) ? 1 : 2; };

  function hungarian(cost) {
    const n = cost.length, mm = cost[0].length, INF = 1e18;
    const u = new Array(n + 1).fill(0), v = new Array(mm + 1).fill(0), p = new Array(mm + 1).fill(0), way = new Array(mm + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i; let j0 = 0;
      const minv = new Array(mm + 1).fill(INF), used = new Array(mm + 1).fill(false);
      do {
        used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
        for (let j = 1; j <= mm; j++) if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= mm; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const res = new Array(n);
    for (let j = 1; j <= mm; j++) if (p[j]) res[p[j] - 1] = j - 1;
    return res;
  }

  /* 기존 배치(oldList)의 상대 위치를 새 곰덫 자리(opt.t2, opt.t1) 기준으로 옮겨 배치합니다.
   * 막힌 자리만 가까운 빈칸으로 옮기고, 두 곰덫의 opt.secure줄(기본 2줄, 곰덫별 opt.secure2·secure1) 안 빈칸은 가장 바깥 연맹원으로 채우고, 깃발을 다시 계산하고, 남는 영토 안 빈칸을 빈자리로 채웁니다(합계 opt.total).
   * 반환: { objects: 사이트 배치 목록, stats } — 실패하면 Error를 던집니다. */
  function assign(map, oldList, opt) {
    const nT2 = opt.t2, nT1 = opt.t1, HQ = opt.hq || HQ_DEFAULT, BLOCKS = opt.blocks || BLOCKS_DEFAULT;
    const OLD = readLayout(oldList);
    if (!OLD.t1 || !OLD.t2) throw new Error(`기준 배치에 곰덫 2개(${T1_NAME}·${T2_NAME})가 없습니다`);
    const oT1 = OLD.t1, oT2 = OLD.t2;
    const members = OLD.members.map(o => ({ n: o.n, x: o.x, y: o.y, l1: lineOf(o, oT1), l2: lineOf(o, oT2) }));
    for (const p of members) { p.ref = (p.l1 === 1 || p.l1 < p.l2) ? 1 : 2; const o = p.ref === 1 ? oT1 : oT2, nn = p.ref === 1 ? nT1 : nT2; p.tx = p.x - o.x + nn.x; p.ty = p.y - o.y + nn.y; p.ol = p.ref === 1 ? p.l1 : p.l2; }

    // 점유 격자 (게임 좌표)
    const occ = new Map();
    const mark = (x, y, s, v) => { for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) occ.set(yy * G + xx, v); };
    const inBlk = (x, y) => BLOCKS.some(b => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2);
    const cityBad = (x, y) => (map.flags[y * G + x] & (K.F_BLOCK | K.F_NODE | K.F_NOCITY)) || inBlk(x, y);
    const allyBad = (x, y) => (map.flags[y * G + x] & (K.F_BLOCK | K.F_NODE | K.F_NOALLY)) || inBlk(x, y);
    for (const [t, nm] of [[nT1, '곰덫1'], [nT2, '곰덫2']]) for (let y = t.y; y < t.y + 3; y++) for (let x = t.x; x < t.x + 3; x++)
      if (allyBad(x, y)) throw new Error(`${nm} 자리(${t.x},${t.y})에 곰덫을 세울 수 없습니다 (장애물·자원지·금지구역·다른 연맹 영토)`);
    const overlap = (a, b, sa, sb) => a.x < b.x + sb && b.x < a.x + sa && a.y < b.y + sb && b.y < a.y + sa;
    if (overlap(nT1, nT2, 3, 3)) throw new Error('곰덫1과 곰덫2가 겹칩니다');
    if (overlap(nT1, HQ, 3, 3) || overlap(nT2, HQ, 3, 3)) throw new Error('곰덫이 본부와 겹칩니다');
    mark(HQ.x, HQ.y, 3, 'hq'); mark(nT1.x, nT1.y, 3, 't1'); mark(nT2.x, nT2.y, 3, 't2');
    const free2 = (x, y) => { for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) if (occ.has(yy * G + xx) || cityBad(xx, yy)) return false; return true; };
    const px = nT2.x + 3 & 1, py = nT2.y + 3 & 1; // 기존과 같은 격자 방향
    const onGrid = (x, y) => ((x - px) & 1) === 0 && ((y - py) & 1) === 0;

    // 우선 배치 인원 (기존 배치 기준, 선택): 곰덫2 opt.vip2줄 안, 곰덫1 opt.vip1줄 안에 있던 연맹원. 기본 0 = 곰덫1 1줄 유지 인원만 보호
    const V2 = opt.vip2 != null ? opt.vip2 : 0, V1 = opt.vip1 != null ? opt.vip1 : 0;
    for (const p of members) p.vip = p.l2 <= V2 || p.l1 <= V1;
    // 1) 원래 상대 자리에 그대로 (곰덫1 1줄 → 우선 배치 인원 → 나머지, 각각 가까운 줄부터)
    const keeper = p => p.ref === 1 && p.l1 === 1; // 곰덫1 1줄 유지 인원
    const rank = p => keeper(p) ? 0 : p.vip ? 1 : 2;
    const order = members.slice().sort((a, b) => rank(a) - rank(b) || a.ol - b.ol);
    const moved = [];
    for (const p of order) {
      if (onGrid(p.tx, p.ty) && free2(p.tx, p.ty)) { p.nx = p.tx; p.ny = p.ty; mark(p.nx, p.ny, 2, 'c'); p.same = true; continue; }
      moved.push(p); p.same = false;
      if (p.vip || keeper(p)) { // 자리가 막히면 기준 곰덫의 같은 줄 이내 남은 칸 중 가장 가까운 곳 (곰덫1 1줄 인원은 곰덫1 1줄)
        const t = p.ref === 1 ? nT1 : nT2, r = 2 * p.ol + 5;
        let best = null, bd = 1e9;
        for (let y = t.y - r; y <= t.y + r; y++) for (let x = t.x - r; x <= t.x + r; x++)
          if (onGrid(x, y) && free2(x, y) && lineOf({ x, y }, t) <= p.ol) { const d = (x - p.tx) ** 2 + (y - p.ty) ** 2; if (d < bd) { bd = d; best = { x, y }; } }
        if (best) { p.nx = best.x; p.ny = best.y; mark(p.nx, p.ny, 2, 'c'); }
      }
    }
    // 2) 막힌 사람만 가까운 빈칸으로 (헝가리안)
    const pending = moved.filter(p => p.nx == null);
    if (pending.length) {
      const cand = [];
      for (let y = nT2.y - 20; y <= nT2.y + 20; y++) for (let x = nT2.x - 20; x <= nT1.x + 20; x++) if (onGrid(x, y) && free2(x, y)) cand.push({ x, y });
      if (cand.length < pending.length) throw new Error('옮길 빈칸이 모자랍니다. 곰덫 위치를 바꿔 보세요');
      const cost = pending.map(p => cand.map(c => (c.x - p.tx) ** 2 + (c.y - p.ty) ** 2 + 0.05 * dist(c, p.ref === 1 ? nT1 : nT2)));
      hungarian(cost).forEach((j, i) => { const p = pending[i]; p.nx = cand[j].x; p.ny = cand[j].y; mark(p.nx, p.ny, 2, 'c'); p.same = false; });
    }
    // 2-1) 곰덫 줄 확보: 두 곰덫의 opt.secure줄(기본 2줄) 안 빈칸을 가장 바깥 연맹원으로 채움 (헝가리안)
    //      곰덫마다 다르게: opt.secure2(곰덫2)·opt.secure1(곰덫1). 0이면 USB 원본과 같은 계산
    const S2 = opt.secure2 != null ? opt.secure2 : opt.secure != null ? opt.secure : 2;
    const S1 = opt.secure1 != null ? opt.secure1 : opt.secure != null ? opt.secure : 2;
    const inZone = (x, y) => lineOf({ x, y }, nT2) <= S2 || lineOf({ x, y }, nT1) <= S1;
    const ringOf = (x, y) => Math.min(lineOf({ x, y }, nT2) - S2, lineOf({ x, y }, nT1) - S1);   // 확보 구역 밖으로 몇 줄
    const secured = p => inZone(p.nx, p.ny);
    if (S2 > 0 || S1 > 0) {
      const slots = [], r = 2 * Math.max(S1, S2) + 2;
      for (let y = Math.min(nT1.y, nT2.y) - r; y <= Math.max(nT1.y, nT2.y) + r; y++) for (let x = Math.min(nT1.x, nT2.x) - r; x <= Math.max(nT1.x, nT2.x) + r; x++)
        if (onGrid(x, y) && free2(x, y) && inZone(x, y)) slots.push({ x, y });
      // 확보 구역에서 먼 사람부터, 같으면 두 곰덫 줄 합이 큰 사람(다른 곰덫에서도 먼 사람)부터
      const outer = members.filter(p => !secured(p)).map(p => { const c = { x: p.nx, y: p.ny }; return { p, l: ringOf(c.x, c.y), s: lineOf(c, nT1) + lineOf(c, nT2), d: Math.min(dist(c, nT1), dist(c, nT2)) }; })
        .sort((a, b) => b.l - a.l || b.s - a.s || b.d - a.d).slice(0, slots.length).map(o => o.p);
      if (outer.length) hungarian(outer.map(p => slots.map(c => (c.x - p.nx) ** 2 + (c.y - p.ny) ** 2))).forEach((j, i) => {
        const p = outer[i];
        for (let yy = p.ny; yy < p.ny + 2; yy++) for (let xx = p.nx; xx < p.nx + 2; xx++) occ.delete(yy * G + xx);
        p.nx = slots[j].x; p.ny = slots[j].y; mark(p.nx, p.ny, 2, 'c');
        if (p.same) { p.same = false; moved.push(p); }
      });
    }
    // 3) 깃발 (연맹원 자리 고정)
    const P = { hx: HQ.x, hy: HQ.y, rule: 'adjacent', cityInTerr: true, nodesBlock: true, grid: true, blocks: BLOCKS, lines: 3, fixT2: nT2, fixT1: nT1 };
    const L = { hq: HQ, t2: nT2, t1: nT1, cities: [], K2: 0, K1: 0 };
    // 깃발 칸이 없어 덮이지 않으면: 근처 연맹원 자리 하나를 깃발 칸으로 비우고 그 사람은 가장 가까운 빈칸으로
    let rb, holes = 0;
    for (let it = 0; it < 30; it++) {
      L.cities = members.map(p => ({ x: p.nx, y: p.ny, g: 2, d: 0, line: 9, label: p.n }));
      rb = K.rebanner(map, P, L);
      if (!rb.error) break;
      if (!rb.unc || !rb.unc.length) throw new Error(rb.error);
      let best = null, bs = -Infinity;
      for (const p of members) {
        let v = 0;
        for (const u of rb.unc) {
          let hit = false;
          for (let yy = p.ny; yy < p.ny + 2 && !hit; yy++) for (let xx = p.nx; xx < p.nx + 2 && !hit; xx++)
            if (Math.abs(xx - u.x) <= 3 && Math.abs(yy - u.y) <= 3 && !allyBad(xx, yy)) hit = true;
          if (hit) v++;
        }
        if (!v) continue;
        const sc = v * 10 - (p.vip ? 100 : 0) - (keeper(p) || secured(p) ? 25 : 0) - (p.same ? 3 : 0) + p.ol * 0.1;
        if (sc > bs) { bs = sc; best = p; }
      }
      if (!best) throw new Error(rb.error);
      mark(best.nx, best.ny, 2, 'h'); holes++;
      const cand = [];
      for (let y = nT2.y - 22; y <= nT2.y + 22; y++) for (let x = Math.min(nT1.x, nT2.x) - 22; x <= Math.max(nT1.x, nT2.x) + 22; x++) if (onGrid(x, y) && free2(x, y)) cand.push({ x, y, d: (x - best.tx) ** 2 + (y - best.ty) ** 2 });
      cand.sort((a, b) => a.d - b.d);
      best.nx = cand[0].x; best.ny = cand[0].y; mark(best.nx, best.ny, 2, 'c');
      if (best.same) { best.same = false; moved.push(best); }
    }
    if (rb.error) throw new Error(rb.error);
    for (const [k, v] of [...occ]) if (v === 'h') occ.delete(k); // 쓰지 않은 구멍은 빈자리 후보로
    for (const b of rb.banners) mark(b.x, b.y, 1, 'b');
    // 4) 남는 자리: 영토 안 빈칸을 곰덫2 가까운 순으로 (합계 total자리)
    const terr = new Set();
    const cov = (x, y, s, c) => { for (let yy = y - c; yy < y + s + c; yy++) for (let xx = x - c; xx < x + s + c; xx++) terr.add(yy * G + xx); };
    cov(HQ.x, HQ.y, 3, 6); rb.banners.forEach(b => cov(b.x, b.y, 1, 3));
    const covered2 = (x, y) => terr.has(y * G + x) && terr.has(y * G + x + 1) && terr.has((y + 1) * G + x) && terr.has((y + 1) * G + x + 1);
    const spareCand = [];
    for (let y = nT2.y - 20; y <= nT2.y + 20; y++) for (let x = nT2.x - 20; x <= nT1.x + 20; x++)
      if (onGrid(x, y) && free2(x, y) && covered2(x, y)) spareCand.push({ x, y, l: lineOf({ x, y }, nT2), d: dist({ x, y }, nT2) });
    spareCand.sort((a, b) => Math.min(a.l, 4) - Math.min(b.l, 4) || a.d - b.d);
    const nSpare = Math.max(0, (opt.total || 100) - members.length);
    const spare = [];
    for (const c of spareCand) { if (spare.length >= nSpare) break; if (free2(c.x, c.y)) { spare.push(c); mark(c.x, c.y, 2, 's'); } }
    // 연맹 자원 건물: 남은 빈자리 중 가장 바깥 자리들
    const res = OLD.res;
    spare.sort((a, b) => b.d - a.d);
    const resSpots = spare.splice(0, res.length);
    spare.sort((a, b) => a.d - b.d);

    const out = [fromGame('본부 1', HQ.x, HQ.y, '본부'), fromGame('곰덫', nT1.x, nT1.y, T1_NAME), fromGame('곰덫', nT2.x, nT2.y, T2_NAME)];
    rb.banners.forEach((b, i) => out.push(fromGame('깃발 1', b.x, b.y, `깃발 ${i + 1}`)));
    res.forEach((o, i) => { if (resSpots[i]) out.push(fromGame('연맹자원', resSpots[i].x, resSpots[i].y, o.n)); });
    members.forEach(p => out.push(fromGame('Player', p.nx, p.ny, p.n)));
    spare.forEach((s, i) => out.push(fromGame('Player', s.x, s.y, `빈자리 ${i + 1}`)));

    const lines = [0, 0, 0, 0, 0], lines1 = [0, 0, 0, 0, 0];   // 연맹원의 곰덫2·곰덫1 기준 줄 (4 = 4줄 이상)
    for (const p of members) { lines[Math.min(4, lineOf({ x: p.nx, y: p.ny }, nT2))]++; lines1[Math.min(4, lineOf({ x: p.nx, y: p.ny }, nT1))]++; }
    return {
      objects: out,
      stats: {
        members: members.length, same: members.filter(p => p.same).length, banners: rb.banners.length, spare: spare.length,
        res: resSpots.length, resMissing: res.length - resSpots.length, holes, lines, lines1,
        // 우선 배치 인원 중 새 배치에서도 곰덫2 V2줄·곰덫1 V1줄 안에 있는 사람
        vip: { total: members.filter(p => p.vip).length, kept: members.filter(p => p.vip && (lineOf({ x: p.nx, y: p.ny }, nT2) <= V2 || lineOf({ x: p.nx, y: p.ny }, nT1) <= V1)).length,
          out: members.filter(p => p.vip && !(lineOf({ x: p.nx, y: p.ny }, nT2) <= V2 || lineOf({ x: p.nx, y: p.ny }, nT1) <= V1)).map(p => p.n) },
        moved: moved.map(p => ({ n: p.n, from: { x: p.tx, y: p.ty }, to: { x: p.nx, y: p.ny }, d: Math.hypot(p.nx - p.tx, p.ny - p.ty) })),
        errs: check(map, out, { blocks: BLOCKS }).errs,
      },
    };
  }

  /* 사이트 배치를 게임 좌표로 되돌려 규칙 검사 (겹침·장애물·영토·깃발 연결·오와 열).
   * 깃발 연결은 opt.rule (기본 'corner': 영토 꼭짓점만 닿아도 연결 — 게임에서 확인, 'adjacent': 변이 맞닿아야 연결).
   * 반환: { errs: [문장], bad: [{ o: 기물, msg }], stats } */
  function check(map, list, opt) {
    const L0 = readLayout(list);
    if (!L0.t1 || !L0.t2) return { errs: [`곰덫 2개(${T1_NAME}·${T2_NAME})가 없습니다`], bad: [], stats: null };
    const cityObjs = list.filter(o => o.name === 'Player' || o.name === '연맹자원');
    const P = { nodesBlock: true, rule: (opt && opt.rule) || 'corner', cityInTerr: true, grid: true, blocks: (opt && opt.blocks) || BLOCKS_DEFAULT };
    const L = { hq: L0.hq || HQ_DEFAULT, t2: L0.t2, t1: L0.t1, banners: L0.banners, cities: cityObjs.map(o => ({ ...toGame(o), label: o.nickname })), K2: 0, K1: 0 };
    const r = K.inspect(map, P, L);
    const msgOf = name => { const e = r.errs.find(t => t.startsWith(name + ':')); return e ? e.slice(name.length + 1).trim() : '규칙 위반'; };
    const bad = [];
    if (r.bad.t2) bad.push({ o: L0.t2o, msg: msgOf('곰덫2') });
    if (r.bad.t1) bad.push({ o: L0.t1o, msg: msgOf('곰덫1') });
    for (const i of [...r.bad.banners].sort((a, b) => a - b)) if (L0.banners[i]) bad.push({ o: L0.banners[i].o, msg: msgOf(`깃발 ${i + 1}번`) });
    for (const i of [...r.bad.cities].sort((a, b) => a - b)) bad.push({ o: cityObjs[i], msg: msgOf(`도시 ${cityObjs[i].nickname}`) });
    const lines = [0, 0, 0, 0, 0], lines1 = [0, 0, 0, 0, 0];
    for (const m of L0.members) { lines[Math.min(4, lineOf(m, L0.t2))]++; lines1[Math.min(4, lineOf(m, L0.t1))]++; }
    return { errs: r.errs, bad, stats: { members: L0.members.length, spare: L0.spare.length, banners: L0.banners.length, lines, lines1 } };
  }

  // 브라우저: mapdata.js의 압축 지형으로 엔진 지도 만들기 (한 번만)
  let mapPromise = null;
  function loadMap() {
    if (!mapPromise) {
      const MD = root.KS_MAPDATA;
      const inflate = async b64 => {
        const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      };
      mapPromise = Promise.all([inflate(MD.TERRAIN_B64), inflate(MD.NODES_B64)]).then(([t, n]) => K.buildMap(t, n));
    }
    return mapPromise;
  }

  root.KSPlan = { HQ_DEFAULT, BLOCKS_DEFAULT, T1_NAME, T2_NAME, isSpare, toGame, fromGame, readLayout, refOf, lineOf, dist, assign, check, loadMap };
})(typeof self !== 'undefined' ? self : this);
