/* 킹샷 곰덫 배치 최적화 엔진 (브라우저/Node 공용)
 * 좌표계: 게임 좌표(X 오른쪽, Y 위쪽). 건물 좌표 = 최소 X·최소 Y 칸(모서리).
 * 규칙 출처: kingshotguide.org Alliance Layout Planner (크기·영역·금지구역·지형 데이터)
 * 원본: USB "킹샷2382_곰덫배치/code/src/core.js". 구조물 목록만 사이트의 mapdata.js(같은 데이터)에서 읽습니다.
 * 먼저 mapdata.js를 불러와야 합니다 (window.KS_MAPDATA). 지형은 buildMap(TERRAIN 원본, NODES 원본)으로 넘깁니다.
 */
(function (root) {
  'use strict';
  const G = 1200;
  const F_BLOCK = 1, F_NODE = 2, F_NOCITY = 4, F_NOALLY = 8, F_NOHQ = 16;
  const FERTILE = [450, 749], RUINS = [552, 647], FORBID = [586, 613], PLAINS = [300, 899];
  const HQ_COV = 6, BN_COV = 3;
  const LAMBDA = 1;   // 깃발 1개 비용(거리합 단위)
  const MU = 0.3;     // 곰덫1–곰덫2 거리 비용

  // [x, y, 크기, 금지구역 크기, 도시허용, 종류]  게임 좌표·모서리 기준
  const MD = root && root.KS_MAPDATA;
  const STRUCTS = MD ? MD.STRUCTS.map(s => s.slice(0, 6)) : [];
  const KIND_NAME = { F: '요새', SA: '성소', BG: '건설 전초기지', DO: '방어 전초기지', RO: '연구 전초기지', AO: '공격 전초기지', GO: '채집 전초기지', PO: '생산 전초기지', TO: '훈련 전초기지', FL: '개척 산장' };

  // ---------- 지도 ----------
  function buildMap(terrRaw, nodeRaw) {
    const flags = new Uint8Array(G * G), kind = new Uint8Array(G * G); // kind 1산 2호수 3~6자원 7구조물 8왕성
    for (let yi = 0; yi < G; yi++) {
      const gy = G - 1 - yi;
      for (let xb = 0; xb < 300; xb++) {
        const v = terrRaw[300 * yi + xb];
        if (!v) continue;
        for (let r = 0; r < 4; r++) {
          const a = (v >> (2 * r)) & 3;
          if (a) { const i = gy * G + 4 * xb + r; kind[i] = a; flags[i] |= F_BLOCK; }
        }
      }
    }
    for (let p = 0; p + 2 < nodeRaw.length; p += 3) {
      const v = (nodeRaw[p] << 16) | (nodeRaw[p + 1] << 8) | nodeRaw[p + 2];
      const t = (v >> 22) & 3, x = (v >> 11) & 2047, yi = v & 2047;
      for (let e = 0; e < 2; e++) for (let s = 0; s < 2; s++) {
        const gx = x + s, gyi = yi + e;
        if (gx >= G || gyi >= G) continue;
        const i = (G - 1 - gyi) * G + gx;
        if (!kind[i]) { kind[i] = 3 + t; flags[i] |= F_NODE; }
      }
    }
    const rect = (x1, y1, x2, y2, f, k) => { // [x1,x2) × [y1,y2)
      for (let y = Math.max(0, y1); y < Math.min(G, y2); y++)
        for (let x = Math.max(0, x1); x < Math.min(G, x2); x++) {
          const i = y * G + x; flags[i] |= f; if (k) kind[i] = k;
        }
    };
    rect(RUINS[0], RUINS[0], RUINS[1] + 1, RUINS[1] + 1, F_NOALLY);
    rect(FORBID[0], FORBID[0], FORBID[1] + 1, FORBID[1] + 1, F_NOALLY | F_NOHQ);
    rect(FERTILE[0], FERTILE[0], FERTILE[1] + 1, FERTILE[1] + 1, F_NOHQ);
    const structs = STRUCTS.map(s => {
      const [x, y, size, fz, ce, k] = s;
      const zx = Math.round(x + size / 2 - fz / 2), zy = Math.round(y + size / 2 - fz / 2);
      return { x, y, size, k, name: KIND_NAME[k], zone: [zx, zy, zx + fz, zy + fz], ce: !!ce };
    });
    for (const s of structs) rect(s.zone[0], s.zone[1], s.zone[2], s.zone[3], s.ce ? F_NOALLY : F_NOALLY | F_NOCITY);
    for (const s of structs) rect(s.x, s.y, s.x + s.size, s.y + s.size, F_BLOCK, 7);
    rect(594, 594, 606, 606, F_BLOCK, 8);
    return { flags, kind, structs };
  }

  // ---------- 보조 ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const distRect = (px, py, lo, hi) => { // 점 → [lo,hi+1) 정사각 구역 거리
    const dx = px < lo ? lo - px : px > hi + 1 ? px - hi - 1 : 0;
    const dy = py < lo ? lo - py : py > hi + 1 ? py - hi - 1 : 0;
    return Math.hypot(dx, dy);
  };
  const zoneName = (x, y) => {
    const inZ = z => x >= z[0] && x <= z[1] && y >= z[0] && y <= z[1];
    if (inZ(FORBID)) return '금지구역';
    if (inZ(RUINS)) return '유적';
    if (inZ(FERTILE)) return '옥토';
    if (inZ(PLAINS)) return '평원';
    return '황무지';
  };

  // 줄 번호: 곰덫에 붙은 도시 = 1줄, 그 바깥 = 2줄 … (dx,dy = 도시 모서리 − 곰덫 모서리)
  function lineOf(dx, dy) {
    const gx = Math.max(-dx - 2, dx - 3, 0), gy = Math.max(-dy - 2, dy - 3, 0);
    return 1 + (Math.max(gx, gy) >> 1);
  }
  const LINE_W = 40; // 우선 줄 안 도시 1명의 가치(거리합 단위)

  // 곰덫 모서리 기준 도시 모서리 오프셋 [dx, dy, 중심거리, 정렬키, 줄]
  const OFFS = (() => {
    const a = [];
    for (let dy = -40; dy <= 40; dy++) for (let dx = -40; dx <= 40; dx++) {
      const d = Math.hypot(dx - 0.5, dy - 0.5);
      if (d <= 38) a.push([dx, dy, d, d, lineOf(dx, dy)]);
    }
    a.sort((p, q) => p[2] - q[2]);
    return a;
  })();
  const keyOf = (L, line, d) => (L && line <= L ? 0 : 1000) + d;
  const LISTS = {};
  function listFor(L) { // 우선 줄 칸을 먼저, 그다음 거리순
    if (LISTS[L]) return LISTS[L];
    const a = OFFS.map(o => [o[0], o[1], o[2], keyOf(L, o[4], o[2]), o[4]]);
    a.sort((p, q) => p[3] - q[3]);
    return (LISTS[L] = a);
  }
  const cut = (list, r) => list.filter(o => o[3] < 1000 || o[2] <= r);
  const radFor = K => Math.min(38, Math.max(30, Math.sqrt(Math.max(K, 1) * 4 * 1.9 / Math.PI) + 10));

  function prefix(w, h, fn) { // fn(lx,ly)→0/1, 크기 (w+1)*(h+1)
    const ps = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += fn(x, y);
        ps[(y + 1) * (w + 1) + x + 1] = ps[y * (w + 1) + x + 1] + row;
      }
    }
    return ps;
  }
  function rsum(ps, w, h, xa, ya, xb, yb) { // 포함 범위, 박스 로컬 좌표
    if (xa < 0) xa = 0; if (ya < 0) ya = 0; if (xb > w - 1) xb = w - 1; if (yb > h - 1) yb = h - 1;
    if (xa > xb || ya > yb) return 0;
    const W1 = w + 1;
    return ps[(yb + 1) * W1 + xb + 1] - ps[ya * W1 + xb + 1] - ps[(yb + 1) * W1 + xa] + ps[ya * W1 + xa];
  }

  // ---------- 컨텍스트 ----------
  function makeCtx(map, P) {
    let R = 90; // 지정한 곰덫이 멀면 계산 범위를 넓힘
    for (const t of [P.near, P.fixT2, P.fixT1]) if (t) R = Math.max(R, Math.max(Math.abs(t.x - P.hx), Math.abs(t.y - P.hy)) + 45);
    R = Math.min(R, 220);
    const x0 = Math.max(0, P.hx - R), y0 = Math.max(0, P.hy - R);
    const x1 = Math.min(G, P.hx + 3 + R), y1 = Math.min(G, P.hy + 3 + R);
    const W = x1 - x0, H = y1 - y0, N = W * H;
    const cityOK = new Uint8Array(N), allyOK = new Uint8Array(N);
    const blockMask = F_BLOCK | (P.nodesBlock ? F_NODE : 0);
    for (let ly = 0; ly < H; ly++) for (let lx = 0; lx < W; lx++) {
      const f = map.flags[(ly + y0) * G + lx + x0], i = ly * W + lx;
      if (f & blockMask) continue;
      if (!(f & F_NOCITY)) cityOK[i] = 1;
      if (!(f & F_NOALLY)) allyOK[i] = 1;
    }
    for (const b of P.blocks || []) { // 다른 연맹 영토: 어떤 건물도 금지
      for (let gy = Math.max(y0, b.y1); gy <= Math.min(y1 - 1, b.y2); gy++)
        for (let gx = Math.max(x0, b.x1); gx <= Math.min(x1 - 1, b.x2); gx++) {
          const i = (gy - y0) * W + gx - x0; cityOK[i] = 0; allyOK[i] = 0;
        }
    }
    const hq = { x: P.hx - x0, y: P.hy - y0 };
    const hqc = { x: P.hx + 1.5, y: P.hy + 1.5 };
    return { map, P, x0, y0, W, H, N, cityOK, allyOK, hq, hqc, L: P.lines || 0, Lg: { 2: P.lines || 0, 1: P.t1Lines != null ? P.t1Lines : (P.lines || 0) }, hqFertD: distRect(hqc.x, hqc.y, FERTILE[0], FERTILE[1]) };
  }

  // 곰덫 위치 조건 (로컬 모서리 좌표). 위치를 직접 지정한 경우 본부 거리 제한 없음
  function trapAllowed(ctx, lx, ly) {
    const gx = lx + ctx.x0, gy = ly + ctx.y0, cx = gx + 1.5, cy = gy + 1.5, P = ctx.P;
    if (!P.near && Math.hypot(cx - ctx.hqc.x, cy - ctx.hqc.y) > P.dmax) return false;
    if (P.trapMode === 'inside') return gx >= FERTILE[0] && gy >= FERTILE[0] && gx + 2 <= FERTILE[1] && gy + 2 <= FERTILE[1];
    if (P.trapMode === 'toward') return ctx.hqFertD <= 0 || distRect(cx, cy, FERTILE[0], FERTILE[1]) <= ctx.hqFertD - 3;
    return true;
  }

  // ---------- 상태 ----------
  function newState(ctx, par) {
    const st = { occ: new Uint8Array(ctx.N), own: new Int32Array(ctx.N).fill(-1), terr: new Uint16Array(ctx.N), cities: [], banners: [], traps: [], par: par || null };
    const { hq, W } = ctx;
    for (let y = hq.y; y < hq.y + 3; y++) for (let x = hq.x; x < hq.x + 3; x++) st.occ[y * W + x] = 2;
    addCov(st, ctx, hq.x, hq.y, 3, HQ_COV, 1);
    return st;
  }
  function addCov(st, ctx, x, y, s, c, d) {
    const { W, H } = ctx;
    const xa = Math.max(0, x - c), xb = Math.min(W, x + s + c), ya = Math.max(0, y - c), yb = Math.min(H, y + s + c);
    for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) st.terr[yy * W + xx] += d;
  }
  function canFoot(occ, ok, ctx, x, y, s) {
    const { W, H } = ctx;
    if (x < 0 || y < 0 || x + s > W || y + s > H) return false;
    for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) {
      const i = yy * W + xx; if (!ok[i] || occ[i]) return false;
    }
    return true;
  }
  // 오와 열 정렬: 모든 도시 모서리가 같은 2칸 격자(홀짝) 위
  const offGrid = (ctx, par, x, y) => par && (((x + ctx.x0 - par.x) & 1) || ((y + ctx.y0 - par.y) & 1));
  function canCity(st, ctx, x, y, needCov) {
    if (offGrid(ctx, st.par, x, y)) return false;
    if (!canFoot(st.occ, ctx.cityOK, ctx, x, y, 2)) return false;
    if (needCov) {
      const W = ctx.W, i = y * W + x;
      if (!st.terr[i] || !st.terr[i + 1] || !st.terr[i + W] || !st.terr[i + W + 1]) return false;
    }
    return true;
  }
  function placeCity(st, ctx, x, y, g, d, line) {
    const id = st.cities.length, W = ctx.W;
    st.cities.push({ x, y, g, d, line, k: keyOf(ctx.Lg[g], line, d), id, dead: false });
    for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) { st.occ[yy * W + xx] = 4; st.own[yy * W + xx] = id; }
  }
  function removeCity(st, ctx, c, reserve) {
    const W = ctx.W;
    for (let yy = c.y; yy < c.y + 2; yy++) for (let xx = c.x; xx < c.x + 2; xx++) { st.occ[yy * W + xx] = reserve ? 6 : 0; st.own[yy * W + xx] = -1; }
    c.dead = true;
  }
  function placeTrap(st, ctx, x, y, g) {
    const W = ctx.W;
    for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < x + 3; xx++) st.occ[yy * W + xx] = 3;
    st.traps.push({ x, y, g });
  }
  const bannerFree = (st, ctx, i) => ctx.allyOK[i] && (st.occ[i] === 0 || st.occ[i] === 6);
  function placeBanner(st, ctx, x, y) {
    st.occ[y * ctx.W + x] = 5; st.banners.push({ x, y });
    addCov(st, ctx, x, y, 1, BN_COV, 1);
  }
  const trapOf = (st, g) => st.traps.find(t => t.g === g);

  function pack(st, ctx, trap, g, K, list, needCov) {
    let n = 0;
    for (let k = 0; k < list.length && n < K; k++) {
      const o = list[k], x = trap.x + o[0], y = trap.y + o[1];
      if (canCity(st, ctx, x, y, needCov)) { placeCity(st, ctx, x, y, g, o[2], o[4]); n++; }
    }
    return n;
  }

  function requiredUncovered(st, ctx) {
    const W = ctx.W, U = [];
    for (const t of st.traps) for (let y = t.y; y < t.y + 3; y++) for (let x = t.x; x < t.x + 3; x++) if (!st.terr[y * W + x]) U.push(y * W + x);
    if (ctx.P.cityInTerr) for (const c of st.cities) {
      if (c.dead) continue;
      for (let y = c.y; y < c.y + 2; y++) for (let x = c.x; x < c.x + 2; x++) if (!st.terr[y * W + x]) U.push(y * W + x);
    }
    return U;
  }

  // ---------- 깃발 커버 ----------
  function ensureCovered(st, ctx, rng) {
    const { W, H, hq } = ctx, inside = ctx.P.rule === 'inside';
    for (let iter = 0; iter < 300; iter++) {
      const U = requiredUncovered(st, ctx);
      if (!U.length) return { ok: true };
      let bx0 = hq.x - HQ_COV, by0 = hq.y - HQ_COV, bx1 = hq.x + 2 + HQ_COV, by1 = hq.y + 2 + HQ_COV;
      for (const i of U) { const x = i % W, y = (i / W) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      for (const b of st.banners) { if (b.x - 3 < bx0) bx0 = b.x - 3; if (b.x + 3 > bx1) bx1 = b.x + 3; if (b.y - 3 < by0) by0 = b.y - 3; if (b.y + 3 > by1) by1 = b.y + 3; }
      bx0 = Math.max(0, bx0 - 5); by0 = Math.max(0, by0 - 5); bx1 = Math.min(W - 1, bx1 + 5); by1 = Math.min(H - 1, by1 + 5);
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
      const uM = new Uint8Array(bw * bh);
      for (const i of U) uM[((i / W | 0) - by0) * bw + (i % W) - bx0] = 1;
      const psU = prefix(bw, bh, (x, y) => uM[y * bw + x]);
      const psT = prefix(bw, bh, (x, y) => st.terr[(y + by0) * W + x + bx0] > 0 ? 1 : 0);
      const psF = prefix(bw, bh, (x, y) => bannerFree(st, ctx, (y + by0) * W + x + bx0) ? 1 : 0);
      const unc = [];
      for (const i of U) {
        const x = i % W - bx0, y = (i / W | 0) - by0;
        if (!rsum(psF, bw, bh, x - 3, y - 3, x + 3, y + 3)) unc.push(i);
      }
      if (unc.length) return { ok: false, unc };
      const conn = (x, y) => inside ? st.terr[(y + by0) * W + x + bx0] > 0
        : rsum(psT, bw, bh, x - 4, y - 3, x + 4, y + 3) + rsum(psT, bw, bh, x - 3, y - 4, x + 3, y + 4) > 0;
      let best = -1, bestKey = -1;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const i = (y + by0) * W + x + bx0;
        if (!bannerFree(st, ctx, i)) continue;
        const g = rsum(psU, bw, bh, x - 3, y - 3, x + 3, y + 3);
        if (!g || !conn(x, y)) continue;
        const key = g * 1000 + rng() * 50;
        if (key > bestKey) { bestKey = key; best = i; }
      }
      if (best < 0) { // 다리 깃발: 미커버 칸 쪽으로 전진
        const dist = new Int16Array(bw * bh).fill(-1), q = new Int32Array(bw * bh);
        let qh = 0, qt = 0;
        for (let k = 0; k < uM.length; k++) if (uM[k]) { dist[k] = 0; q[qt++] = k; }
        while (qh < qt) {
          const k = q[qh++], x = k % bw, y = (k / bw) | 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
            const nk = ny * bw + nx;
            if (dist[nk] < 0) { dist[nk] = dist[k] + 1; q[qt++] = nk; }
          }
        }
        let bk = 1e9;
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
          const i = (y + by0) * W + x + bx0;
          if (!bannerFree(st, ctx, i) || !conn(x, y)) continue;
          const key = dist[y * bw + x] + rng() * 0.5;
          if (key < bk) { bk = key; best = i; }
        }
        if (best < 0) return { ok: false, reason: 'disconnected' };
      }
      placeBanner(st, ctx, best % W, (best / W) | 0);
    }
    return { ok: false, reason: 'iter' };
  }

  // 커버 불가 칸 해소: 근처 도시 하나를 비워 깃발 자리 확보
  function repair(st, ctx, unc, lists) {
    const W = ctx.W;
    if (unc.some(i => st.occ[i] === 3)) return false;
    const pts = unc.map(i => [i % W, (i / W) | 0]);
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (const [x, y] of pts) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    let best = null, bv = -1, bd = -1;
    for (const c of st.cities) {
      if (c.dead || c.x > bx1 + 4 || c.x + 1 < bx0 - 4 || c.y > by1 + 4 || c.y + 1 < by0 - 4) continue;
      let v = 0;
      for (const [ux, uy] of pts) {
        let hit = false;
        for (let yy = c.y; yy < c.y + 2 && !hit; yy++) for (let xx = c.x; xx < c.x + 2 && !hit; xx++)
          if (ctx.allyOK[yy * W + xx] && Math.abs(xx - ux) <= 3 && Math.abs(yy - uy) <= 3) hit = true;
        if (hit) v++;
      }
      if (v > 0 && c.k < 1000) v -= 0.5; // 우선 줄 도시는 되도록 남김
      if (v > bv || (v === bv && v > 0 && c.k > bd)) { bv = v; bd = c.k; best = c; }
    }
    if (!best || bv <= 0) {
      const c = st.cities[st.own[unc[0]]];
      if (!c || c.dead) return false;
      best = c;
    }
    removeCity(st, ctx, best, true);
    pack(st, ctx, trapOf(st, best.g), best.g, 1, lists[best.g], false);
    return true;
  }

  // ---------- 영토 연결 검사 ----------
  function squares(st, ctx, skip) {
    const sq = [{ x0: ctx.hq.x - HQ_COV, y0: ctx.hq.y - HQ_COV, x1: ctx.hq.x + 2 + HQ_COV, y1: ctx.hq.y + 2 + HQ_COV, b: null }];
    for (const b of st.banners) if (b !== skip) sq.push({ x0: b.x - 3, y0: b.y - 3, x1: b.x + 3, y1: b.y + 3, b });
    return sq;
  }
  function linkOK(rule, A, B) {
    if (rule === 'inside') return B.b && B.b.x >= A.x0 && B.b.x <= A.x1 && B.b.y >= A.y0 && B.b.y <= A.y1;
    const xo = A.x0 <= B.x1 && B.x0 <= A.x1, yo = A.y0 <= B.y1 && B.y0 <= A.y1;
    const xt = A.x0 <= B.x1 + 1 && B.x0 <= A.x1 + 1, yt = A.y0 <= B.y1 + 1 && B.y0 <= A.y1 + 1;
    if (rule === 'corner') return xt && yt;   // 영토 꼭짓점만 닿아도 연결 (2026-10-15 게임 화면에서 확인 — 사이트 추가)
    return (xo && yt) || (xt && yo);
  }
  // HQ에서 도달 가능한 순서(=설치 순서). 미연결 시 null
  function buildOrder(st, ctx, skip) {
    const sq = squares(st, ctx, skip), rule = ctx.P.rule;
    const seen = new Uint8Array(sq.length); seen[0] = 1;
    const order = [], q = [0];
    while (q.length) {
      const a = q.shift();
      const nxt = [];
      for (let k = 1; k < sq.length; k++) if (!seen[k] && linkOK(rule, sq[a], sq[k])) { seen[k] = 1; nxt.push(k); }
      for (const k of nxt) { order.push(sq[k].b); q.push(k); }
    }
    return order.length === sq.length - 1 ? order : null;
  }

  function pruneBanners(st, ctx) {
    const W = ctx.W;
    for (let k = st.banners.length - 1; k >= 0; k--) {
      const b = st.banners[k];
      addCov(st, ctx, b.x, b.y, 1, BN_COV, -1);
      let ok = true;
      for (let y = Math.max(0, b.y - 3); y <= Math.min(ctx.H - 1, b.y + 3) && ok; y++)
        for (let x = Math.max(0, b.x - 3); x <= Math.min(W - 1, b.x + 3) && ok; x++) {
          const i = y * W + x;
          if (st.terr[i]) continue;
          const o = st.occ[i];
          if (o === 3 || (o === 4 && ctx.P.cityInTerr)) ok = false;
        }
      if (ok && !buildOrder(st, ctx, b)) ok = false;
      if (ok) { st.occ[b.y * W + b.x] = 0; st.banners.splice(k, 1); }
      else addCov(st, ctx, b.x, b.y, 1, BN_COV, 1);
    }
  }

  // 먼 도시부터 더 가까운 빈 자리로 이동
  function improve(st, ctx, lists) {
    const need = ctx.P.cityInTerr;
    for (let pass = 0; pass < 4; pass++) {
      let moved = 0;
      const alive = st.cities.filter(c => !c.dead).sort((a, b) => b.k - a.k);
      for (const c of alive) {
        const t = trapOf(st, c.g), list = lists[c.g];
        removeCity(st, ctx, c, false);
        let best = null;
        for (let k = 0; k < list.length; k++) {
          const o = list[k];
          if (o[3] >= c.k - 1e-9) break;
          const x = t.x + o[0], y = t.y + o[1];
          if (canCity(st, ctx, x, y, need)) { best = o; break; }
        }
        c.dead = false;
        if (best) { c.x = t.x + best[0]; c.y = t.y + best[1]; c.d = best[2]; c.line = best[4]; c.k = best[3]; moved++; }
        for (let yy = c.y; yy < c.y + 2; yy++) for (let xx = c.x; xx < c.x + 2; xx++) { st.occ[yy * ctx.W + xx] = 4; st.own[yy * ctx.W + xx] = c.id; }
      }
      if (!moved) break;
    }
  }

  function scoreOf(st, ctx, K2, K1) {
    const w1 = ctx.P.w1, t2 = trapOf(st, 2), t1 = trapOf(st, 1);
    const c2x = t2.x + 1.5, c2y = t2.y + 1.5, c1x = t1.x + 1.5, c1y = t1.y + 1.5;
    let s = 0, n2 = 0, n1 = 0;
    for (const c of st.cities) {
      if (c.dead) continue;
      if (c.g === 2) { n2++; s += c.d + w1 * Math.hypot(c.x + 1 - c1x, c.y + 1 - c1y); }
      else { n1++; s += c.d; }
      if (ctx.Lg[c.g] && c.line <= ctx.Lg[c.g]) s -= LINE_W;
    }
    s += MU * Math.hypot(c2x - c1x, c2y - c1y) + LAMBDA * st.banners.length;
    s += 500 * (Math.max(0, K2 - n2) + Math.max(0, K1 - n1));
    return s;
  }

  // 우선 줄 안의 빈칸·깃발칸을 도시 자리로 되찾기 (깃발은 다른 곳으로 재배치)
  function cloneSt(st) {
    return { occ: st.occ.slice(), own: st.own.slice(), terr: st.terr.slice(), cities: st.cities.map(c => ({ ...c })), banners: st.banners.map(b => ({ ...b })), traps: st.traps, par: st.par };
  }
  function removeBanner(st, ctx, b) {
    addCov(st, ctx, b.x, b.y, 1, BN_COV, -1);
    st.occ[b.y * ctx.W + b.x] = 0;
    st.banners.splice(st.banners.indexOf(b), 1);
  }
  function reclaim(st, ctx, lists, K2, K1, rng) {
    if (!ctx.Lg[1] && !ctx.Lg[2]) return st;
    const { W, H } = ctx;
    let cur = st, curScore = scoreOf(st, ctx, K2, K1);
    for (const g of [2, 1]) {
      for (const o of lists[g]) {
        if (o[3] >= 1000) break;
        const t = trapOf(cur, g), x = t.x + o[0], y = t.y + o[1];
        if (x < 0 || y < 0 || x + 2 > W || y + 2 > H || offGrid(ctx, cur.par, x, y)) continue;
        let ok = true;
        for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) {
          const i = yy * W + xx, v = cur.occ[i];
          if (!ctx.cityOK[i] || (v !== 0 && v !== 5)) ok = false;
        }
        if (!ok) continue;
        let worst = null;
        for (const c of cur.cities) if (!c.dead && c.g === g && (!worst || c.k > worst.k)) worst = c;
        if (!worst || worst.k < 1000) continue; // 바깥 줄 도시가 없으면 이득 없음
        const s2 = cloneSt(cur);
        for (const b of s2.banners.filter(b => b.x >= x && b.x < x + 2 && b.y >= y && b.y < y + 2)) removeBanner(s2, ctx, b);
        removeCity(s2, ctx, s2.cities[worst.id], false);
        placeCity(s2, ctx, x, y, g, o[2], o[4]);
        let good = false;
        for (let rep = 0; rep < 30; rep++) {
          const r = ensureCovered(s2, ctx, rng);
          if (r.ok) { good = true; break; }
          if (!r.unc || !repair(s2, ctx, r.unc, lists)) break;
        }
        if (!good || !buildOrder(s2, ctx, null)) continue;
        for (let i = 0; i < ctx.N; i++) if (s2.occ[i] === 6) s2.occ[i] = 0;
        pruneBanners(s2, ctx);
        const sc = scoreOf(s2, ctx, K2, K1);
        if (sc < curScore - 1e-9) { cur = s2; curScore = sc; }
      }
    }
    return cur;
  }

  function noisyList(base, noise, rng) {
    if (!noise) return base;
    const a = base.map(o => [o[0], o[1], o[2], o[3] + noise * rng(), o[4]]);
    a.sort((p, q) => p[3] - q[3]);
    return a;
  }

  // 한 번의 배치 시도
  function runOnce(ctx, T2, T1, K2, K1, rng, opt) {
    const st = newState(ctx, opt.par);
    placeTrap(st, ctx, T2.x, T2.y, 2); placeTrap(st, ctx, T1.x, T1.y, 1);
    const exact = { 2: cut(listFor(ctx.Lg[2]), radFor(K2)), 1: cut(listFor(ctx.Lg[1]), radFor(K1)) };
    const lists = { 2: noisyList(exact[2], opt.noise, rng), 1: noisyList(exact[1], opt.noise, rng) };
    if (opt.preBanners) {
      for (const b of opt.preBanners) if (bannerFree(st, ctx, b.y * ctx.W + b.x)) placeBanner(st, ctx, b.x, b.y);
      const fill = (T, g, K) => { // 영토 안 먼저, 모자라면 밖까지
        pack(st, ctx, T, g, K, exact[g], ctx.P.cityInTerr);
        const m = K - st.cities.filter(c => c.g === g && !c.dead).length;
        if (m > 0) pack(st, ctx, T, g, m, exact[g], false);
      };
      if (K1 && ctx.P.t1First) fill(T1, 1, K1);
      fill(T2, 2, K2);
      if (K1 && !ctx.P.t1First) fill(T1, 1, K1);
    } else {
      if (opt.holes) { // 7칸 격자 깃발 예약
        const { ox, oy } = opt.holes, R2 = Math.sqrt(K2 * 4 * 1.6 / Math.PI) + 4;
        for (let y = 0; y < ctx.H; y++) {
          if (((y - oy) % 7 + 7) % 7) continue;
          for (let x = 0; x < ctx.W; x++) {
            if (((x - ox) % 7 + 7) % 7) continue;
            const i = y * ctx.W + x;
            if (st.terr[i] && !opt.holesInHQ) continue;
            if (Math.hypot(x + 0.5 - T2.x - 1.5, y + 0.5 - T2.y - 1.5) > R2) continue;
            if (ctx.allyOK[i] && st.occ[i] === 0) st.occ[i] = 6;
          }
        }
      }
      if (K1 && ctx.P.t1First) pack(st, ctx, T1, 1, K1, lists[1], false);
      pack(st, ctx, T2, 2, K2, lists[2], false);
      if (K1 && !ctx.P.t1First) pack(st, ctx, T1, 1, K1, lists[1], false);
    }
    let ok = false;
    for (let rep = 0; rep < 80; rep++) {
      const r = ensureCovered(st, ctx, rng);
      if (r.ok) { ok = true; break; }
      if (!r.unc || !repair(st, ctx, r.unc, lists)) break;
    }
    if (!ok) return null;
    pruneBanners(st, ctx);
    for (let i = 0; i < ctx.N; i++) if (st.occ[i] === 6) st.occ[i] = 0;
    improve(st, ctx, exact);
    pruneBanners(st, ctx);
    let fin = reclaim(st, ctx, exact, K2, K1, rng);
    if (fin !== st) { improve(fin, ctx, exact); pruneBanners(fin, ctx); }
    fin.score = scoreOf(fin, ctx, K2, K1);
    return fin;
  }

  // ---------- 후보 탐색 (영토 무시 빠른 추정) ----------
  function quickPack(ctx, occ, trap, K, list, touched, other, w1, par) {
    let placed = 0, s = 0;
    const W = ctx.W;
    for (let k = 0; k < list.length && placed < K; k++) {
      const o = list[k], x = trap.x + o[0], y = trap.y + o[1];
      if (offGrid(ctx, par, x, y) || !canFoot(occ, ctx.cityOK, ctx, x, y, 2)) continue;
      for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) { occ[yy * W + xx] = 1; touched.push(yy * W + xx); }
      placed++; s += o[2];
      if (ctx.L && o[4] <= ctx.L) s -= LINE_W;
      if (other) s += w1 * Math.hypot(x + 1 - other.x - 1.5, y + 1 - other.y - 1.5);
    }
    return { s: s + 500 * (K - placed) };
  }
  function markFoot(occ, ctx, x, y, s, touched) {
    for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) { occ[yy * ctx.W + xx] = 1; touched.push(yy * ctx.W + xx); }
  }
  function estBanners(ctx, trap, K) { // 다리 깃발 대략치
    const r = Math.sqrt(K * 4 * 1.5 / Math.PI);
    const cx = trap.x + 1.5, cy = trap.y + 1.5, hx = ctx.hq.x + 1.5, hy = ctx.hq.y + 1.5;
    const gap = Math.max(0, Math.max(Math.abs(cx - hx), Math.abs(cy - hy)) - 7.5 - r);
    const area = Math.PI * r * r;
    return Math.ceil(gap / 7) + area / 40;
  }
  // 곰덫1을 곰덫2와 일직선, 사이에 도시 n줄 (격자 틈 쪽이면 1칸 더)
  function t1LineSpots(ctx, T2, n, par) {
    const gx = T2.x + ctx.x0, gy = T2.y + ctx.y0;
    const flushLo = (v, p) => p == null || ((v - 2 - p) & 1) === 0;
    const fx = flushLo(gx, par && par.x), fy = flushLo(gy, par && par.y);
    const lo = f => -(2 * n + 3 + (f ? 0 : 1)), hi = f => 2 * n + 3 + (par && f ? 1 : 0);
    return [{ x: T2.x + lo(fx), y: T2.y }, { x: T2.x + hi(fx), y: T2.y }, { x: T2.x, y: T2.y + lo(fy) }, { x: T2.x, y: T2.y + hi(fy) }];
  }
  function pickDiverse(arr, k, sep) {
    const out = [];
    for (const c of arr) {
      if (out.length >= k) break;
      if (out.every(o => Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) >= sep)) out.push(c);
    }
    return out;
  }

  // ---------- 메인 최적화 (비동기 진행률) ----------
  async function optimize(map, P, onProgress, shouldStop) {
    const ctx = makeCtx(map, P);
    const K2 = Math.max(0, Math.min(P.N, P.K2)), K1 = P.N - K2;
    const occ = new Uint8Array(ctx.N), touched = [];
    const reset = () => { for (const i of touched) occ[i] = 0; touched.length = 0; };
    const nq2 = cut(listFor(ctx.Lg[2]), radFor(K2)), nq1 = cut(listFor(ctx.Lg[1]), radFor(K1));
    const { hq, W, H } = ctx;
    const hqOcc = () => markFoot(occ, ctx, hq.x, hq.y, 3, touched);
    const lev = { fast: [3, 2, 12], normal: [5, 3, 30], deep: [8, 4, 70] }[P.effort] || [5, 3, 30];

    const pars = P.grid ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] : [null];
    let pairs = [];
    if (P.fixT2 && P.fixT1) { // 사용자가 옮긴 곰덫 위치 고정
      const T2 = { x: P.fixT2.x - ctx.x0, y: P.fixT2.y - ctx.y0 }, T1 = { x: P.fixT1.x - ctx.x0, y: P.fixT1.y - ctx.y0 };
      hqOcc();
      const ok2 = canFoot(occ, ctx.allyOK, ctx, T2.x, T2.y, 3);
      if (ok2) markFoot(occ, ctx, T2.x, T2.y, 3, touched);
      const ok1 = canFoot(occ, ctx.allyOK, ctx, T1.x, T1.y, 3);
      reset();
      if (!ok2 || !ok1) return { error: `${ok2 ? '곰덫1' : '곰덫2'} 자리에 곰덫을 세울 수 없습니다 (장애물·금지구역·겹침). 조금 옮긴 뒤 다시 시도하세요.` };
      for (const par of pars) pairs.push({ T2: { ...T2, par }, T1, par, q: 0 });
    } else {
    // 1) 곰덫2 후보 (정렬 모드면 격자 홀짝 4가지 중 최선)
    const c2 = [];
    for (let y = 0; y < H - 2; y++) for (let x = 0; x < W - 2; x++) {
      if (P.near && (Math.abs(x + ctx.x0 - P.near.x) > P.near.r || Math.abs(y + ctx.y0 - P.near.y) > P.near.r)) continue;
      if (!trapAllowed(ctx, x, y)) continue;
      if (!canFoot(occ, ctx.allyOK, ctx, x, y, 3)) continue;
      if (x + 3 > hq.x && x < hq.x + 3 && y + 3 > hq.y && y < hq.y + 3) continue;
      for (const par of pars) {
        hqOcc(); markFoot(occ, ctx, x, y, 3, touched);
        const q = quickPack(ctx, occ, { x, y }, K2, nq2, touched, null, 0, par);
        reset();
        c2.push({ x, y, par, s: q.s + LAMBDA * estBanners(ctx, { x, y }, P.N) });
      }
    }
    if (!c2.length) return { error: P.near ? '지정한 곰덫2 위치 주변에 곰덫을 세울 수 있는 칸이 없습니다. 좌표나 탐색 범위를 바꿔 보세요.' : '조건을 만족하는 곰덫 위치가 없습니다. 탐색 반경이나 위치 조건을 바꿔 보세요.' };
    c2.sort((a, b) => a.s - b.s);
    const T2s = P.near ? pickDiverse(c2, lev[0] + 3, 2) : pickDiverse(c2, lev[0], 3);

    // 2) 각 곰덫2마다 곰덫1 후보
    for (const T2 of T2s) {
      if (P.t1Gap) { // 곰덫1 일직선 규칙
        const SIDES = ['left', 'right', 'down', 'up'];
        for (const T1 of t1LineSpots(ctx, T2, P.t1Gap, T2.par).filter((t, i) => !P.t1Side || SIDES[i] === P.t1Side)) {
          hqOcc(); markFoot(occ, ctx, T2.x, T2.y, 3, touched);
          if (!canFoot(occ, ctx.allyOK, ctx, T1.x, T1.y, 3)) { reset(); continue; }
          markFoot(occ, ctx, T1.x, T1.y, 3, touched);
          const q2 = quickPack(ctx, occ, T2, K2, nq2, touched, T1, P.w1, T2.par);
          const q1 = K1 ? quickPack(ctx, occ, T1, K1, nq1, touched, null, 0, T2.par) : { s: 0 };
          reset();
          pairs.push({ T2, T1, par: T2.par, q: q2.s + q1.s });
        }
        continue;
      }
      const c1 = [];
      for (let y = Math.max(0, T2.y - 40); y < Math.min(H - 2, T2.y + 40); y++)
        for (let x = Math.max(0, T2.x - 40); x < Math.min(W - 2, T2.x + 40); x++) {
          if (Math.abs(x - T2.x) < 3 && Math.abs(y - T2.y) < 3) continue;
          if (!trapAllowed(ctx, x, y)) continue;
          hqOcc(); markFoot(occ, ctx, T2.x, T2.y, 3, touched);
          if (!canFoot(occ, ctx.allyOK, ctx, x, y, 3)) { reset(); continue; }
          markFoot(occ, ctx, x, y, 3, touched);
          const q2 = quickPack(ctx, occ, T2, K2, nq2, touched, { x, y }, P.w1, T2.par);
          const q1 = K1 ? quickPack(ctx, occ, { x, y }, K1, nq1, touched, null, 0, T2.par) : { s: 0 };
          reset();
          c1.push({ x, y, s: q2.s + q1.s + MU * Math.hypot(x - T2.x, y - T2.y) });
        }
      c1.sort((a, b) => a.s - b.s);
      for (const T1 of pickDiverse(c1, lev[1], 3)) pairs.push({ T2, T1, par: T2.par, q: T1.s });
    }
    pairs.sort((a, b) => a.q - b.q);
    }

    // 3) 정밀 배치 (무작위 재시작)
    let best = null, done = 0, last = Date.now();
    const total = pairs.length * lev[2];
    const rng = mulberry32(P.seed || 20382);
    for (const pr of pairs) {
      let local = null;
      for (let it = 0; it < lev[2]; it++) {
        if (shouldStop && shouldStop()) break;
        const opt = { noise: it === 0 ? 0 : rng() * 1.2, par: pr.par };
        if (it % 3 === 2) opt.holes = { ox: Math.floor(rng() * 7), oy: Math.floor(rng() * 7) };
        let st = runOnce(ctx, pr.T2, pr.T1, K2, K1, rng, opt);
        if (st) { // 깃발 고정 후 재배치
          const st2 = runOnce(ctx, pr.T2, pr.T1, K2, K1, rng, { noise: 0, par: pr.par, preBanners: st.banners.map(b => ({ x: b.x, y: b.y })) });
          if (st2 && st2.score < st.score) st = st2;
          if (!local || st.score < local.score) local = st;
        }
        done++;
        if (Date.now() - last > 40) {
          last = Date.now();
          if (onProgress) onProgress(done / total, best && best.score);
          await new Promise(r => setTimeout(r, 0));
        }
      }
      if (local && (!best || local.score < best.score)) best = local;
    }
    if (onProgress) onProgress(1, best && best.score);
    if (!best) return { error: '유효한 배치를 찾지 못했습니다. 조건을 완화해 보세요.' };
    return finalize(ctx, best, K2, K1);
  }

  // ---------- 결과 정리 (게임 좌표) ----------
  function finalize(ctx, st, K2, K1) {
    const { x0, y0 } = ctx;
    const order = buildOrder(st, ctx, null) || st.banners;
    const t2 = trapOf(st, 2), t1 = trapOf(st, 1);
    const g = o => ({ x: o.x + x0, y: o.y + y0 });
    const cities = st.cities.filter(c => !c.dead).map(c => ({ ...g(c), g: c.g, d: c.d, line: c.line }));
    const c2 = { x: t2.x + 1.5 + x0, y: t2.y + 1.5 + y0 }, c1 = { x: t1.x + 1.5 + x0, y: t1.y + 1.5 + y0 };
    for (const c of cities) {
      c.d2 = Math.hypot(c.x + 1 - c2.x, c.y + 1 - c2.y); c.d1 = Math.hypot(c.x + 1 - c1.x, c.y + 1 - c1.y);
      c.l2 = lineOf(c.x - t2.x - x0, c.y - t2.y - y0); c.l1 = lineOf(c.x - t1.x - x0, c.y - t1.y - y0);
    }
    const grp2 = cities.filter(c => c.g === 2).sort((a, b) => a.d2 - b.d2);
    const grp1 = cities.filter(c => c.g === 1).sort((a, b) => a.d1 - b.d1);
    grp2.forEach((c, i) => c.label = '2-' + String(i + 1).padStart(2, '0'));
    grp1.forEach((c, i) => c.label = '1-' + String(i + 1).padStart(2, '0'));
    const res = {
      hq: { x: ctx.P.hx, y: ctx.P.hy }, t2: g(t2), t1: g(t1),
      banners: order.map(g), cities: grp2.concat(grp1),
      K2, K1, score: st.score,
    };
    res.validation = validate(ctx.map, ctx.P, res);
    return res;
  }

  // ---------- 독립 규칙 검증 (건물별 문제 표시) ----------
  function inspect(map, P, L) {
    const errs = [], bad = { t2: false, t1: false, banners: new Set(), cities: new Set() };
    const blockMask = F_BLOCK | (P.nodesBlock ? F_NODE : 0);
    const objs = [{ t: 'hq', x: L.hq.x, y: L.hq.y, s: 3, name: '본부' },
      { t: 'trap', x: L.t2.x, y: L.t2.y, s: 3, k: 't2', name: '곰덫2' }, { t: 'trap', x: L.t1.x, y: L.t1.y, s: 3, k: 't1', name: '곰덫1' }]
      .concat(L.banners.map((b, i) => ({ t: 'banner', x: b.x, y: b.y, s: 1, k: 'b', i, name: `깃발 ${i + 1}번` })),
        L.cities.map((c, i) => ({ t: 'city', x: c.x, y: c.y, s: 2, k: 'c', i, name: `도시 ${c.label || i + 1}` })));
    const mark = o => { if (o.k === 't2') bad.t2 = true; else if (o.k === 't1') bad.t1 = true; else if (o.k === 'b') bad.banners.add(o.i); else if (o.k === 'c') bad.cities.add(o.i); };
    // 연결성: 본부에서 이어진 깃발만 영토로 인정
    const sq = [{ x0: L.hq.x - HQ_COV, y0: L.hq.y - HQ_COV, x1: L.hq.x + 2 + HQ_COV, y1: L.hq.y + 2 + HQ_COV, b: null }]
      .concat(L.banners.map(b => ({ x0: b.x - 3, y0: b.y - 3, x1: b.x + 3, y1: b.y + 3, b })));
    const seen = new Uint8Array(sq.length); seen[0] = 1; const q = [0];
    while (q.length) { const a = q.shift(); for (let k = 1; k < sq.length; k++) if (!seen[k] && linkOK(P.rule, sq[a], sq[k])) { seen[k] = 1; q.push(k); } }
    const terr = new Set();
    for (let k = 0; k < sq.length; k++) {
      if (!seen[k]) { bad.banners.add(k - 1); errs.push(`깃발 ${k}번: 본부 영토와 연결 끊김`); continue; }
      const s = sq[k];
      for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) terr.add(y * G + x);
    }
    const occ = new Map();
    for (const o of objs) {
      let problem = '';
      for (let y = o.y; y < o.y + o.s; y++) for (let x = o.x; x < o.x + o.s; x++) {
        if (x < 0 || y < 0 || x >= G || y >= G) { problem = problem || '지도 밖'; continue; }
        const i = y * G + x, f = map.flags[i];
        if (occ.has(i)) { problem = problem || `${occ.get(i).name}와 겹침`; mark(occ.get(i)); } else occ.set(i, o);
        if (o.t === 'hq') continue;
        if (f & blockMask) problem = problem || '산·호수·자원지·구조물 위';
        else if (o.t === 'city' && (f & F_NOCITY)) problem = problem || '도시 금지구역';
        else if (o.t !== 'city' && (f & F_NOALLY)) problem = problem || '연맹 건물 금지구역';
        if ((P.blocks || []).some(b => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2)) problem = problem || '다른 연맹 영토 침범';
        if ((o.t === 'trap' || (o.t === 'city' && P.cityInTerr)) && !terr.has(i)) problem = problem || '연맹 영토 밖';
      }
      if (problem) { mark(o); errs.push(`${o.name}: ${problem}`); }
    }
    if (L.cities.length < L.K2 + L.K1) errs.push(`도시 ${L.K2 + L.K1 - L.cities.length}개 배치 못함`);
    if (P.grid && L.cities.length) {
      const px = L.cities[0].x & 1, py = L.cities[0].y & 1;
      const bad = L.cities.filter(c => (c.x & 1) !== px || (c.y & 1) !== py).length;
      if (bad) errs.push(`오와 열이 어긋난 도시 ${bad}개`);
    }
    return { errs, bad };
  }
  const validate = (map, P, L) => inspect(map, P, L).errs;

  // 곰덫·도시는 그대로 두고 깃발만 다시 계산 (이동 후 연결 복구용)
  function rebanner(map, P, L) {
    const ctx = makeCtx(map, P), { x0, y0, W, H } = ctx;
    const loc = o => ({ x: o.x - x0, y: o.y - y0 });
    const inWin = (o, s) => o.x >= 0 && o.y >= 0 && o.x + s <= W && o.y + s <= H;
    const t2 = loc(L.t2), t1 = loc(L.t1);
    if (!inWin(t2, 3) || !inWin(t1, 3)) return { error: '곰덫이 본부에서 너무 멀리 있습니다.' };
    const st = newState(ctx, null);
    placeTrap(st, ctx, t2.x, t2.y, 2); placeTrap(st, ctx, t1.x, t1.y, 1);
    for (const c of L.cities) {
      const p = loc(c);
      if (!inWin(p, 2)) return { error: '본부에서 너무 멀리 있는 도시가 있습니다.' };
      placeCity(st, ctx, p.x, p.y, c.g, c.d, c.line);
    }
    const r = ensureCovered(st, ctx, mulberry32(11));
    if (!r.ok) return { unc: r.unc && r.unc.map(i => ({ x: i % W + x0, y: ((i / W) | 0) + y0 })), error: r.unc ? `깃발을 세울 빈칸이 없어 영토로 덮을 수 없는 칸이 ${r.unc.length}개 있습니다. '이 곰덫 위치로 다시 최적화'를 쓰세요.` : '본부와 이어지는 깃발 경로를 찾지 못했습니다.' };
    pruneBanners(st, ctx);
    const order = buildOrder(st, ctx, null) || st.banners;
    return { banners: order.map(b => ({ x: b.x + x0, y: b.y + y0 })) };
  }

  function checkHQ(map, P) {
    const w = [];
    for (let y = P.hy; y < P.hy + 3; y++) for (let x = P.hx; x < P.hx + 3; x++) {
      if (x < 0 || y < 0 || x >= G || y >= G) return ['본부 좌표가 지도 밖입니다.'];
      const f = map.flags[y * G + x];
      if (f & (F_BLOCK | F_NODE)) { w.push('본부 칸에 지형/자원지가 겹칩니다 — 좌표 기준(모서리/중심)을 확인하세요.'); break; }
    }
    if (map.flags[P.hy * G + P.hx] & F_NOHQ) w.push('본부는 평원/황무지에만 설치 가능합니다 (입력 좌표가 옥토 안).');
    return w;
  }

  const API = { G, FERTILE, RUINS, FORBID, PLAINS, HQ_COV, BN_COV, buildMap, optimize, validate, inspect, rebanner, checkHQ, lineOf, zoneName, KIND_NAME, F_BLOCK, F_NODE, F_NOCITY, F_NOALLY };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.KSCore = API;
})(typeof self !== 'undefined' ? self : this);
