// SGD 자원 깃발 경로 — 지금 영토(본부·배치 깃발·지금 깃발·세운 자원 깃발)에서 연맹 자원지를 영토에 넣는 깃발을 계산 (연구·깃발 비용 비율)
// 데이터: layouts/sgd.json(배치), layouts/sgd-area.json(다른 연맹 영토 blocks·margin, 스크린샷으로 본 땅 seen, 세운 자원 깃발 resFlags,
//   짓는 중 깃발 building, 연맹 창고 생산량 rates), mapdata.js(연맹 자원지)
// 사용법:
//   node tools/plan-sgd-resources.mjs                    → layouts/sgd-resource.json 저장
//     --rule edge|corner   깃발 연결 (기본 edge: 변이 닿아야 연결 — 어느 규칙에서도 통함, corner: 꼭짓점만 닿아도 연결)
//     --max 30             새 자원 깃발 최대 개수 (짓는 중 깃발 제외)   --depth 8   한 번에 이어 붙일 깃발 최대 개수
//     --goal ratio         (기본) 생산 비율 맞추기: 가치 = wmin × min(생산[종류] ÷ 비율[종류]) + 비율이 0이 아닌 종류의 새 자원지 수
//       --ratio 1,1,0.66,0.37   빵,나무,석재,철 목표 비율 (기본: 연맹 기술 전체 비용 152.3M·152.3M·99.8M·56.3M,
//                               깃발 211개 이후 비용도 1 : 1 : 0.67 : 0.36). --ratio 1,1,0,0 = 10-25 빵·나무 균형 계획
//       --wmin 3           비율 가중치 (클수록 모자란 쪽을 먼저)
//       --cw ratio|flat    새 자원지 수를 셀 때 종류별 무게 (ratio: 목표 비율만큼 — 넘치는 석재·철을 덜 쫓음, flat: 모두 1)
//     --goal weights --weights 100,4,3,1   나무,빵,석재,철 고정 가치 (10-24 나무 우선 계획)
//     --iters 500 --seed 2382   개선 단계 반복 횟수·난수 시작값 (깃발 1~4개를 빼고 다시 채워 같은 깃발 수로 가치가 크거나, 같은 가치를 더 적은 깃발로)
//     --out layouts/sgd-resource.json   저장할 파일   --dry   저장하지 않음
// 규칙: 자원지는 4칸 중 3칸 이상이 영토 안이면 연맹 자원(사이트 app.js와 같음). 깃발은 산·호수·자원지·구조물 금지구역·배치 자리 위에 두지 않고,
//   깃발 영토(7×7)는 다른 연맹 영토(둘레 margin칸 포함)와 겹치지 않으며 스크린샷으로 확인한 땅(seen, clip이 있으면 그 사각형 안만) 안에만 둡니다.
//   자원지 1곳 = rates.perNode K/h (10-25 확인 3.6K, 종류 무관). 생산량은 창고 화면 값 + 그 뒤 새로 얻는 자원지 × perNode
//   (rates.nodes = 창고 화면을 볼 때 이 영토의 연맹 자원지 수 빵·나무·석재·철. 그 뒤 세운 깃발로 늘어난 몫은 추정으로 더함).
// 계산: 짓는 중 깃발을 먼저 넣고, 매번 지금 영토에서 깃발 1~depth개를 이어 닿는 모든 자리를 너비 우선으로 훑어
//   (가치 증가 ÷ 깃발 수)가 가장 큰 경로를 확정. 끝나면 빼도 가치·연결이 그대로인 깃발을 빼고, 짓는 중 깃발 → 확정한 순서로 번호를 매깁니다.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const rel = p => path.resolve(ROOT, p);
const sandbox = { window: {}, setTimeout };
sandbox.self = sandbox.window;
vm.createContext(sandbox);
for (const f of ['mapdata.js', 'v2/core.js', 'v2/plan.js']) vm.runInContext(readFileSync(rel(f), 'utf8'), sandbox, { filename: f });
const { KS_MAPDATA: MD, KSCore: K, KSPlan: KP } = sandbox.window;
const G = K.G, BN = K.BN_COV;
const map = K.buildMap(inflateSync(Buffer.from(MD.TERRAIN_B64, 'base64')), inflateSync(Buffer.from(MD.NODES_B64, 'base64')));
const NAMES = ['빵', '나무', '석재', '철'];

const area = JSON.parse(readFileSync(rel('layouts/sgd-area.json'), 'utf8'));
const layout = JSON.parse(readFileSync(rel('layouts/sgd.json'), 'utf8'));
const RULE = arg('rule', 'edge'), MAXF = Number(arg('max', 30)), DEPTH = Number(arg('depth', 8));
const GOAL = arg('goal', 'ratio'), WMIN = Number(arg('wmin', 3));
const CWMODE = arg('cw', 'ratio');   // 새 자원지 수를 셀 때 종류별 무게: ratio = 목표 비율만큼(빵·나무 1, 석재 0.66, 철 0.37), flat = 모두 1
const RATIO = (() => { const r = arg('ratio', '1,1,0.66,0.37').split(',').map(Number); return r.length === 4 && r.every(v => v >= 0) && r.some(v => v > 0) ? r : [1, 1, 0.66, 0.37]; })();
const [WB, WW, WS, WI] = (() => { const w = arg('weights', '100,4,3,1').split(',').map(Number); return [w[1], w[0], w[2], w[3]]; })();
const WT = [WB, WW, WS, WI];   // 종류 번호(0빵 1나무 2석재 3철) 순 가치 (--goal weights)
const RATES = area.rates || null, PER = RATES ? RATES.perNode : 3.6;
const CW = RATIO.map(r => r > 0 ? (CWMODE === 'flat' ? 1 : r / Math.max(...RATIO)) : 0);
const EQ = NAMES.map(nm => RATES ? RATES[nm] / PER : 0);   // 지금 생산량을 자원지 수로 (ratio 기준점)
const M = area.margin || 0;
const blocksM = area.blocks.map(b => ({ x1: b.x1 - M, y1: b.y1 - M, x2: b.x2 + M, y2: b.y2 + M }));

// 계산 범위: 스크린샷으로 본 땅을 감싸는 사각형
const quads = (area.seen || []).map(s => s.quad);
const clips = (area.seen || []).map(s => s.clip || null);
const allPts = quads.flat();
const X0 = Math.floor(Math.min(...allPts.map(p => p[0]))) - 4, X1 = Math.ceil(Math.max(...allPts.map(p => p[0]))) + 4;
const Y0 = Math.floor(Math.min(...allPts.map(p => p[1]))) - 4, Y1 = Math.ceil(Math.max(...allPts.map(p => p[1]))) + 4;
const W = X1 - X0 + 1, H = Y1 - Y0 + 1, N = W * H;
const id = (x, y) => (y - Y0) * W + (x - X0);
const inR = (x, y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1;
const inQuad = (q, x, y) => { // 볼록 사각형 안 (꼭짓점 순서 무관하게 부호 일치)
  let s = 0;
  for (let i = 0; i < 4; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4]; const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax); if (c !== 0) { if (s && Math.sign(c) !== s) return false; s = Math.sign(c); } }
  return true;
};
const seen = new Uint8Array(N);
const inClip = (c, x, y) => !c || (x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3]);
for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (quads.some((q, i) => inClip(clips[i], x, y) && inQuad(q, x + 0.5, y + 0.5))) seen[id(x, y)] = 1;
const inBlk = (bl, x, y) => bl.some(b => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2);

// 배치 영토 (본부 15×15 · 배치 깃발 · 지금 서 있는 깃발 7×7)와 배치가 차지한 칸
const occ = new Uint8Array(N);
const mark = (x, y, s) => { for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) if (inR(xx, yy)) occ[id(xx, yy)] = 1; };
const base = [];   // 영토 사각형 {x0,y0,x1,y1,name}
const hq = KP.toGame(layout.find(o => o.name === '본부 1'));
base.push({ x0: hq.x - K.HQ_COV, y0: hq.y - K.HQ_COV, x1: hq.x + 2 + K.HQ_COV, y1: hq.y + 2 + K.HQ_COV, name: '본부' }); mark(hq.x, hq.y, 3);
const num = o => { const m = /\d+/.exec(String(o.nickname)); return m ? +m[0] : 0; };
for (const o of layout) {
  const g = KP.toGame(o);
  if (o.name === '곰덫') mark(g.x, g.y, 3);
  else if (o.name === 'Player' || o.name === '연맹자원') mark(g.x, g.y, 2);
  else if (o.name === '깃발 1') { mark(g.x, g.y, 1); base.push({ x0: g.x - BN, y0: g.y - BN, x1: g.x + BN, y1: g.y + BN, name: `깃발 ${num(o)}` }); }
}
for (const f of area.flags || []) { mark(f.x, f.y, 1); base.push({ x0: f.x - BN, y0: f.y - BN, x1: f.x + BN, y1: f.y + BN, name: `지금 깃발 ${f.x},${f.y}` }); }
for (const f of area.resFlags || []) { mark(f.x, f.y, 1); base.push({ x0: f.x - BN, y0: f.y - BN, x1: f.x + BN, y1: f.y + BN, name: `세운 깃발 ${f.x},${f.y}` }); }
const fixed = (area.building || []).map(f => ({ x: f.x, y: f.y, building: true }));   // 짓는 중 — 번호 1번부터, 빼지 않음
for (const f of fixed) mark(f.x, f.y, 1);

// 깃발을 둘 수 있는 칸
const BAD = K.F_BLOCK | K.F_NODE | K.F_NOALLY;
const sqOf = (x, y) => ({ x0: x - BN, y0: y - BN, x1: x + BN, y1: y + BN });
const ok = new Uint8Array(N);
for (let y = Y0 + BN; y <= Y1 - BN; y++) for (let x = X0 + BN; x <= X1 - BN; x++) {
  const i = id(x, y);
  if (occ[i] || (map.flags[y * G + x] & BAD) || inBlk(blocksM, x, y)) continue;
  let good = true;
  for (let yy = y - BN; yy <= y + BN && good; yy++) for (let xx = x - BN; xx <= x + BN && good; xx++) {
    if (inBlk(blocksM, xx, yy)) good = false;
    else if (!seen[id(xx, yy)] && !base.some(s => xx >= s.x0 && xx <= s.x1 && yy >= s.y0 && yy <= s.y1)) good = false;
  }
  if (good) ok[i] = 1;
}

// 연맹 자원지 (4칸 중 3칸 이상 영토면 연맹 자원). 다른 연맹 영토 안 자원지는 제외
const nodes = [];
{
  const raw = inflateSync(Buffer.from(MD.NODES_B64, 'base64'));
  for (let p = 0; p + 2 < raw.length; p += 3) {
    const v = (raw[p] << 16) | (raw[p + 1] << 8) | raw[p + 2];
    const t = (v >> 22) & 3, x = (v >> 11) & 2047, y = 1198 - (v & 2047);
    if (x >= X0 && x + 1 <= X1 && y >= Y0 && y + 1 <= Y1 && !inBlk(area.blocks, x, y) && !inBlk(area.blocks, x + 1, y + 1)) nodes.push({ x, y, t, k: nodes.length });
  }
}
const nodeAt = new Int32Array(N).fill(-1);
for (const n of nodes) for (let yy = n.y; yy < n.y + 2; yy++) for (let xx = n.x; xx < n.x + 2; xx++) nodeAt[id(xx, yy)] = n.k;

const linked = RULE === 'edge'
  ? (A, B) => { const xo = A.x0 <= B.x1 && B.x0 <= A.x1, yo = A.y0 <= B.y1 && B.y0 <= A.y1, xt = A.x0 <= B.x1 + 1 && B.x0 <= A.x1 + 1, yt = A.y0 <= B.y1 + 1 && B.y0 <= A.y1 + 1; return (xo && yt) || (xt && yo); }
  : (A, B) => A.x0 <= B.x1 + 1 && B.x0 <= A.x1 + 1 && A.y0 <= B.y1 + 1 && B.y0 <= A.y1 + 1;
// 깃발끼리 연결되는 상대 위치
const OFFS = [];
for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) if ((dx || dy) && linked(sqOf(0, 0), sqOf(dx, dy))) OFFS.push([dx, dy]);

// 영토 상태
function stateOf(flags) {
  const terr = new Uint8Array(N);
  const cov = s => { for (let y = Math.max(Y0, s.y0); y <= Math.min(Y1, s.y1); y++) for (let x = Math.max(X0, s.x0); x <= Math.min(X1, s.x1); x++) terr[id(x, y)] = 1; };
  base.forEach(cov); flags.forEach(f => cov(sqOf(f.x, f.y)));
  const cnt = new Uint8Array(nodes.length);
  for (const n of nodes) for (let yy = n.y; yy < n.y + 2; yy++) for (let xx = n.x; xx < n.x + 2; xx++) if (terr[id(xx, yy)]) cnt[n.k]++;
  return { terr, cnt };
}
const owned = st => nodes.filter(n => st.cnt[n.k] >= 3);
// 가치: 배치 영토(본부·배치 깃발·지금 깃발·세운 자원 깃발)보다 더 얻은 자원지 수 g[종류]로 계산
const cntOf = keys => { const c = [0, 0, 0, 0]; for (const k of keys) c[nodes[k].t]++; return c; };
const BASE_CNT = cntOf(owned(stateOf([])).map(n => n.k));
const RN = RATES && RATES.nodes ? RATES.nodes : BASE_CNT;   // 창고 화면을 볼 때의 연맹 자원지 수
for (let t = 0; t < 4; t++) EQ[t] += BASE_CNT[t] - RN[t];   // 그 뒤 세운 깃발 몫 (추정)
const Vof = g => GOAL === 'ratio'
  ? WMIN * Math.min(...RATIO.map((r, t) => r > 0 ? (EQ[t] + g[t]) / r : Infinity)) + g.reduce((s, c, t) => s + CW[t] * c, 0)
  : g.reduce((s, c, t) => s + c * WT[t], 0);
const gainedOf = flags => cntOf(owned(stateOf(flags)).map(n => n.k)).map((c, t) => c - BASE_CNT[t]);
let gCur = [0, 0, 0, 0];
const gainV = keys => { const c = cntOf(keys); return Vof(gCur.map((v, t) => v + c[t])) - Vof(gCur); };
// 깃발 하나를 더하면 새로 연맹 자원이 되는 자원지
function gainAt(st, x, y) {
  const add = new Map();
  for (let yy = y - BN; yy <= y + BN; yy++) for (let xx = x - BN; xx <= x + BN; xx++) {
    const i = id(xx, yy), k = nodeAt[i];
    if (k >= 0 && !st.terr[i]) add.set(k, (add.get(k) || 0) + 1);
  }
  const out = [];
  for (const [k, a] of add) if (st.cnt[k] < 3 && st.cnt[k] + a >= 3) out.push(k);
  return out;
}
function connectedAll(flags) { // 모든 깃발이 배치 영토와 이어지는지
  const sq = flags.map(f => sqOf(f.x, f.y)), seenF = new Uint8Array(sq.length), q = [];
  sq.forEach((s, i) => { if (base.some(b => linked(b, s))) { seenF[i] = 1; q.push(i); } });
  while (q.length) { const a = q.pop(); sq.forEach((s, i) => { if (!seenF[i] && linked(sq[a], s)) { seenF[i] = 1; q.push(i); } }); }
  return seenF.every(Boolean);
}

// ---------- 탐색: (가치 증가 ÷ 깃발 수)가 가장 큰 경로부터 이어 붙이기 ----------
const score = flags => Vof(gainedOf(flags));
let seed = Number(arg('seed', 2382)) >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function grow(flags0, noise = 0) {   // noise > 0: 경로 점수를 조금씩 흔들어 다른 해를 찾음 (개선 단계)
  let flags = flags0.slice(), st = stateOf(flags);
  gCur = gainedOf(flags);
  while (flags.length - fixed.length < MAXF) {
    const taken = new Set(flags.map(f => id(f.x, f.y)));
    const depth = new Int16Array(N).fill(-1), parent = new Int32Array(N).fill(-1), sets = new Array(N);
    let frontier = [];
    for (const b of base.concat(flags.map(f => sqOf(f.x, f.y)))) {   // 지금 영토 사각형에 닿는 깃발 자리
      for (let y = Math.max(Y0, b.y0 - BN - 1); y <= Math.min(Y1, b.y1 + BN + 1); y++) for (let x = Math.max(X0, b.x0 - BN - 1); x <= Math.min(X1, b.x1 + BN + 1); x++) {
        const i = id(x, y);
        if (depth[i] !== -1 || !ok[i] || taken.has(i) || !linked(b, sqOf(x, y))) continue;
        depth[i] = 1; sets[i] = gainAt(st, x, y); frontier.push(i);
      }
    }
    let best = null;
    const consider = i => {
      const g = gainAt(st, X0 + i % W, Y0 + ((i / W) | 0));
      if (!g.length) return;   // 끝 깃발이 직접 자원을 더해야 함
      const v = gainV(sets[i]), sc = v / depth[i] * (noise ? 1 + noise * rnd() : 1);
      if (!best || sc > best.sc + 1e-9 || (Math.abs(sc - best.sc) < 1e-9 && depth[i] < best.d)) best = { i, sc, d: depth[i], v };
    };
    frontier.forEach(consider);
    for (let d = 2; d <= Math.min(DEPTH, MAXF - (flags.length - fixed.length)); d++) {
      const next = [];
      const cand = new Map();   // i → best parent
      for (const j of frontier) {
        const jx = X0 + j % W, jy = Y0 + ((j / W) | 0);
        for (const [dx, dy] of OFFS) {
          const x = jx + dx, y = jy + dy;
          if (!inR(x, y)) continue;
          const i = id(x, y);
          if (!ok[i] || taken.has(i) || depth[i] !== -1 && depth[i] < d) continue;
          const merged = new Set(sets[j]); for (const k of gainAt(st, x, y)) merged.add(k);
          const v = gainV([...merged]);
          const c = cand.get(i);
          if (!c || v > c.v) cand.set(i, { j, v, set: [...merged] });
        }
      }
      for (const [i, c] of cand) { if (depth[i] === -1) { depth[i] = d; parent[i] = c.j; sets[i] = c.set; next.push(i); } }
      next.forEach(consider);
      frontier = next;
      if (!next.length) break;
    }
    if (!best || best.v <= 0) break;
    const chain = [];
    for (let i = best.i; i >= 0; i = parent[i]) chain.unshift({ x: X0 + i % W, y: Y0 + ((i / W) | 0) });
    flags = flags.concat(chain);
    st = stateOf(flags);
    gCur = gainedOf(flags);
  }
  return flags;
}
// 빼도 되는 깃발 빼기 (가치·연결이 그대로면). 짓는 중 깃발은 그대로
function prune(flags) {
  const fullV = score(flags);
  for (let k = flags.length - 1; k >= fixed.length; k--) {
    const trial = flags.filter((_, i) => i !== k);
    if (score(trial) >= fullV - 1e-9 && connectedAll(trial)) flags = trial;
  }
  return flags;
}
// 영토와 이어진 깃발만 (몇 개를 뺀 뒤 끊긴 것 정리)
function keepLinked(flags) {
  const sq = flags.map(f => sqOf(f.x, f.y)), on = new Uint8Array(flags.length), q = [];
  sq.forEach((s, i) => { if (flags[i].building || base.some(b => linked(b, s))) { on[i] = 1; q.push(i); } });
  while (q.length) { const a = q.pop(); sq.forEach((s, i) => { if (!on[i] && linked(sq[a], s)) { on[i] = 1; q.push(i); } }); }
  return flags.filter((_, i) => on[i]);
}
let flags = prune(grow(fixed));
const greedyN = flags.length, greedyS = score(flags), greedyNodes = owned(stateOf(flags)).length;
// ---------- 개선: 깃발 1~4개(가까운 것끼리)를 빼고 다시 채워, 같은 깃발 수 안에서 가치가 크거나 같은 가치를 더 적은 깃발로 ----------
const ITERS = Number(arg('iters', 500));
{
  let bestS = greedyS;
  for (let it = 0; it < ITERS; it++) {
    const free = flags.slice(fixed.length);
    if (!free.length) break;
    const c = free[Math.floor(rnd() * free.length)], k = 1 + Math.floor(rnd() * 4);
    const drop = new Set(free.slice().sort((a, b) => Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y)) - Math.max(Math.abs(b.x - c.x), Math.abs(b.y - c.y))).slice(0, k));
    const trial = prune(grow(keepLinked(flags.filter(f => !drop.has(f))), 0.15));
    const sc = score(trial);
    if (sc > bestS + 1e-9 || (Math.abs(sc - bestS) < 1e-9 && trial.length < flags.length)) { flags = trial; bestS = sc; }
  }
}
console.log(`개선 전: 깃발 ${greedyN}개 · 연맹 자원지 ${greedyNodes}곳 · 가치 ${greedyS.toFixed(2)} → 개선 후(${ITERS}회): 깃발 ${flags.length}개 · 연맹 자원지 ${owned(stateOf(flags)).length}곳 · 가치 ${score(flags).toFixed(2)}`);

// 본부(와 지금 깃발)에서 배치 깃발 사각형까지 가장 적게 거치는 배치 깃발 목록 (배치 깃발은 변 접촉으로 계산됨)
const edgeLinked = (A, B) => { const xo = A.x0 <= B.x1 && B.x0 <= A.x1, yo = A.y0 <= B.y1 && B.y0 <= A.y1, xt = A.x0 <= B.x1 + 1 && B.x0 <= A.x1 + 1, yt = A.y0 <= B.y1 + 1 && B.y0 <= A.y1 + 1; return (xo && yt) || (xt && yo); };
const needMemo = new Map();
function needOf(target) {
  if (needMemo.has(target)) return needMemo.get(target);
  const prev = new Map(), roots = base.filter(b => !/^깃발 /.test(b.name)), q = roots.slice();
  roots.forEach(r => prev.set(r, null));
  while (q.length) { const a = q.shift(); for (const b of base) if (!prev.has(b) && edgeLinked(a, b)) { prev.set(b, a); q.push(b); } }
  const path = [];
  for (let b = target; b && /^깃발 /.test(b.name); b = prev.get(b)) path.unshift(b.name);
  needMemo.set(target, path);
  return path;
}

// 이미 세운 배치 깃발(area.layoutBuilt 번호)은 먼저 세울 목록에서 뺌
const LB = new Set((area.layoutBuilt || []).map(n => `깃발 ${n}`));
const needLeft = b => needOf(b).filter(n => !LB.has(n));

// ---------- 번호: 짓는 중 깃발 먼저, 그다음 남은 깃발 안에서 지금 영토부터 이어지는 경로 중 (가치 증가 ÷ 깃발 수)가 큰 것부터 ----------
const ordered = [];
{
  let left = flags.slice(), cur = [];
  const push = pick => {
    const have = new Set(owned(stateOf(cur)).map(n => n.k));
    // 이 깃발이 어디에 붙는지 (본부·배치 깃발·세운 깃발·앞 번호 자원 깃발). 배치 깃발이면 본부에서 그 깃발까지 먼저 세울 배치 깃발(needs)
    const s = sqOf(pick.x, pick.y);
    const onB = base.filter(b => linked(b, s)).sort((a, b) => needOf(a).length - needOf(b).length)[0];
    const onR = ordered.find(o => linked(sqOf(o.x, o.y), s));
    const got = owned(stateOf(cur.concat([pick]))).filter(n => !have.has(n.k));
    ordered.push({ no: ordered.length + 1, x: pick.x, y: pick.y, ...(pick.building ? { building: true } : {}), link: onB ? onB.name : `자원 ${onR.no}`, ...(onB && needLeft(onB).length ? { needs: needLeft(onB) } : {}), nodes: got.map(n => [n.x, n.y, n.t]) });
    cur.push(pick); left = left.filter(f => f !== pick);
  };
  for (const f of flags.filter(f => f.building)) push(f);
  while (left.length) {
    const terrSq = base.concat(cur.map(f => sqOf(f.x, f.y)));
    const prev = new Map(), q = [];
    for (const f of left) if (terrSq.some(b => linked(b, sqOf(f.x, f.y)))) { prev.set(f, null); q.push(f); }
    for (let h = 0; h < q.length; h++) for (const f of left) if (!prev.has(f) && linked(sqOf(q[h].x, q[h].y), sqOf(f.x, f.y))) { prev.set(f, q[h]); q.push(f); }
    const v0 = score(cur);
    let best = null;
    for (const f of q) {
      const path = []; for (let p = f; p; p = prev.get(p)) path.unshift(p);
      const sc = (score(cur.concat(path)) - v0) / path.length;
      if (!best || sc > best.sc + 1e-9 || (Math.abs(sc - best.sc) < 1e-9 && path.length < best.path.length)) best = { sc, path };
    }
    if (!best) throw new Error('이어지지 않는 깃발이 있습니다');
    best.path.forEach(push);
  }
}

// ---------- 결과 ----------
const before = owned(stateOf([])), after = owned(stateOf(flags));
const byType = list => NAMES.map((nm, t) => `${nm} ${list.filter(n => n.t === t).length}`).join(' · ');
const rateOf = cnt => RATES ? cnt.map((c, t) => Math.round((RATES[NAMES[t]] + PER * (c - RN[t])) * 10) / 10) : null;
const fmt = r => r ? NAMES.map((nm, t) => `${nm} ${r[t]}K`).join(' · ') : '';
console.log(`연결 규칙 ${RULE} · ${GOAL === 'ratio' ? `생산 비율 빵·나무·석재·철 ${RATIO.join(' : ')} (wmin ${WMIN})` : `가치 나무 ${WW} 빵 ${WB} 석재 ${WS} 철 ${WI}`} · 계산 범위 X ${X0}~${X1} Y ${Y0}~${Y1} (스크린샷으로 본 땅 ${seen.reduce((a, b) => a + b, 0)}칸)`);
console.log(`지금 영토: ${byType(before)}${RATES ? ` · 생산 ${fmt(rateOf(BASE_CNT))} (${RATES.at} 창고 화면${BASE_CNT.some((c, t) => c !== RN[t]) ? ' + 그 뒤 세운 깃발 추정' : ''})` : ''}`);
console.log(`자원 깃발 ${ordered.length}개 (짓는 중 ${fixed.length}) 추가: ${byType(after)} (새로 ${after.length - before.length}곳)`);
const cnt = BASE_CNT.slice();
for (const f of ordered) {
  for (const n of f.nodes) cnt[n[2]]++;
  f.total = cnt.reduce((a, b) => a + b, 0); f.cnt = cnt.slice(); f.wood = cnt[1];
  if (RATES) f.rate = rateOf(cnt);
  console.log(`  자원 ${String(f.no).padStart(2)}  ${f.x},${f.y}${f.building ? ' (짓는 중)' : ''}  ← ${f.link.padEnd(12)}  +${f.nodes.map(n => NAMES[n[2]]).join(' ') || '(연결)'}  → ${RATES ? fmt(f.rate) : `자원 ${f.total}`}${f.needs && f.needs.length ? `  [먼저: ${f.needs.join('→')}]` : ''}`);
}
const inArea = nodes.filter(n => seen[id(n.x, n.y)]);
for (const t of [0, 1]) {
  const all = inArea.filter(n => n.t === t), got = new Set(after.filter(n => n.t === t).map(n => n.k));
  console.log(`스크린샷 범위 안 ${NAMES[t]} ${all.length}곳 중 ${all.filter(n => got.has(n.k)).length}곳 확보`);
}
if (process.argv.includes('--dry')) process.exit(0);
const out = {
  updated: area.updated, rule: RULE, goal: GOAL, ...(GOAL === 'ratio' ? { ratio: RATIO, wmin: WMIN } : { weights: { 나무: WW, 빵: WB, 석재: WS, 철: WI } }),
  note: GOAL === 'ratio'
    ? '자원지는 4칸 중 3칸 이상이 영토 안이면 연맹 자원. 번호 = 설치 순서 (짓는 중 깃발 먼저, 그다음 생산이 목표 비율 ratio(빵·나무·석재·철)에 가까워지는 순 — 모자란 종류부터). link = 이 깃발이 붙는 영토. cnt = 그 깃발까지 연맹 자원지 수 (빵·나무·석재·철), rate = 예상 생산량 K/h'
    : '자원지는 4칸 중 3칸 이상이 영토 안이면 연맹 자원. 번호 = 설치 순서. link = 이 깃발이 붙는 영토',
  ...(RATES ? { rates: RATES } : {}),
  built: (area.resFlags || []).map(f => [f.x, f.y]),
  baseCnt: BASE_CNT,
  baseRate: rateOf(BASE_CNT),
  flags: ordered,
  base: before.map(n => [n.x, n.y, n.t]),
};
const OUT = arg('out', 'layouts/sgd-resource.json');
writeFileSync(rel(OUT), JSON.stringify(out, null, 1));
console.log(`저장: ${OUT}`);
