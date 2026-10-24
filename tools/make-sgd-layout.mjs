// SGD 자리 배치 만들기·검사 — 곰덫 1개(사냥 함정 1) 배치 (v2/core.js를 P.single로 실행)
// 지형·다른 연맹 영토·본부는 layouts/sgd-area.json에서 읽습니다. 다른 연맹 영토(둘레 margin칸 포함)에는 건물을 두지 않고, 우리 깃발 영토(7×7)도 겹치지 않게 합니다.
// 사용법:
//   node tools/make-sgd-layout.mjs                        곰덫1 자리를 찾아 layouts/sgd.json 저장 (전체 자리 100)
//   node tools/make-sgd-layout.mjs --trap X,Y             곰덫1 자리를 고정하고 도시·깃발만 계산
//     --total 100  --effort fast|normal|deep (기본 deep)  --seed 2382  --out 파일  --dry (저장하지 않음)
//     --refine 3   찾은 곰덫1 자리 주변 ±3칸을 곰덫 고정으로 다시 비교 (0이면 안 함, --trap을 주면 안 함)
//   node tools/make-sgd-layout.mjs --check layouts/sgd.json   규칙 검사만 (겹침·장애물·영토·깃발 연결·오와 열·다른 연맹 영토·깃발 영토 겹침)
// 자리 번호: 곰덫1 기준 줄 → 곰덫까지 거리 순 ("빈자리 N"의 N, /sgd 자리 번호와 같음)
// 깃발 번호: 설치 순서. 번호대로 지으면 매번 본부와 이어지고(변 접촉), 곰덫 → 번호가 작은 자리 순으로 영토가 넓어집니다.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const has = name => process.argv.includes(`--${name}`);
const rel = p => path.resolve(ROOT, p);

const sandbox = { window: {}, setTimeout };
sandbox.self = sandbox.window;
vm.createContext(sandbox);
for (const f of ['mapdata.js', 'v2/core.js', 'v2/plan.js']) vm.runInContext(readFileSync(rel(f), 'utf8'), sandbox, { filename: f });
const { KS_MAPDATA: MD, KSCore: K, KSPlan: KP } = sandbox.window;
const map = K.buildMap(inflateSync(Buffer.from(MD.TERRAIN_B64, 'base64')), inflateSync(Buffer.from(MD.NODES_B64, 'base64')));
const G = K.G, TRAP_NAME = '사냥 함정 1';

const area = JSON.parse(readFileSync(rel(arg('area', 'layouts/sgd-area.json')), 'utf8'));
const HQ = { x: area.hq.x, y: area.hq.y };
const M = area.margin || 0;   // 다른 연맹 영토 둘레 여유 칸 (스크린샷 좌표 오차 대비)
const BLOCKS = area.blocks.map(b => ({ x1: b.x1 - M, y1: b.y1 - M, x2: b.x2 + M, y2: b.y2 + M }));

const lineOf = (c, t) => K.lineOf(c.x - t.x, c.y - t.y);
const dist = (c, t) => Math.hypot(c.x + 1 - t.x - 1.5, c.y + 1 - t.y - 1.5);   // 도시 중심 → 곰덫 중심
const rankSeats = (seats, t) => seats.map(s => ({ ...s, l: lineOf(s, t), d: dist(s, t) })).sort((a, b) => a.l - b.l || a.d - b.d);

// 영토 칸 집합 (본부 15×15, 깃발 7×7)
function terrOf(banners) {
  const set = new Set();
  const cov = (x, y, s, c) => { for (let yy = y - c; yy < y + s + c; yy++) for (let xx = x - c; xx < x + s + c; xx++) set.add(yy * G + xx); };
  cov(HQ.x, HQ.y, 3, K.HQ_COV); banners.forEach(b => cov(b.x, b.y, 1, K.BN_COV));
  return set;
}
const covered = (set, o, s) => { for (let y = o.y; y < o.y + s; y++) for (let x = o.x; x < o.x + s; x++) if (!set.has(y * G + x)) return false; return true; };
// 영토 사각형끼리 연결: 변 접촉(adjacent) — 꼭짓점 접촉만 되는 게임에서도 그대로 통함
const sqOf = b => ({ x0: b.x - 3, y0: b.y - 3, x1: b.x + 3, y1: b.y + 3 });
const HQSQ = { x0: HQ.x - K.HQ_COV, y0: HQ.y - K.HQ_COV, x1: HQ.x + 2 + K.HQ_COV, y1: HQ.y + 2 + K.HQ_COV };
function linked(A, B) {
  const xo = A.x0 <= B.x1 && B.x0 <= A.x1, yo = A.y0 <= B.y1 && B.y0 <= A.y1;
  const xt = A.x0 <= B.x1 + 1 && B.x0 <= A.x1 + 1, yt = A.y0 <= B.y1 + 1 && B.y0 <= A.y1 + 1;
  return (xo && yt) || (xt && yo);
}

// 깃발 설치 순서: 곰덫1 → 아직 영토가 아닌 가장 앞 번호 자리를 먼저 덮음 (연맹원이 1번 자리부터 채우면 깃발이 가장 적게 듦).
// 지금 영토와 이어지는 깃발 중 ① 그 자리를 다 덮는 것 ② 그 자리 칸을 더 많이 덮는 것 ③ 새로 영토가 되는 자리 가치(앞 번호일수록 큼)가 큰 것.
// 그 자리에 닿는 깃발이 없으면 그 자리에 가장 가까운 깃발(다리)부터.
const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };   // 사전식 비교
function orderFlags(banners, trap, ranked) {
  const left = banners.slice(), done = [], sqs = [HQSQ];
  const N = ranked.length;
  const tiles = (set, o, s) => { let n = 0; for (let y = o.y; y < o.y + s; y++) for (let x = o.x; x < o.x + s; x++) if (set.has(y * G + x)) n++; return n; };
  while (left.length) {
    const terr = terrOf(done);
    const cand = left.filter(b => sqs.some(s => linked(s, sqOf(b))));
    if (!cand.length) throw new Error('본부와 이어지지 않는 깃발이 있습니다');
    const open = ranked.find(s => !covered(terr, s, 2));
    const tg = !covered(terr, trap, 3) ? { o: trap, s: 3 } : open ? { o: open, s: 2 } : null;
    let best = null, bk = null;
    for (const b of cand) {
      const t2 = terrOf(done.concat([b]));
      let v = 0;
      ranked.forEach((s, i) => { if (!covered(terr, s, 2) && covered(t2, s, 2)) v += N + 1 - i; });
      const full = tg && covered(t2, tg.o, tg.s) ? 1 : 0, part = tg ? tiles(t2, tg.o, tg.s) - tiles(terr, tg.o, tg.s) : 0;
      const d = tg ? Math.hypot(b.x - tg.o.x - tg.s / 2 + 0.5, b.y - tg.o.y - tg.s / 2 + 0.5) : 0;
      const key = full || part ? [full, part, v, -d] : [0, 0, -d, v];
      if (!bk || better(key, bk)) { bk = key; best = b; }
    }
    left.splice(left.indexOf(best), 1); done.push(best); sqs.push(sqOf(best));
  }
  return done;
}

// ---------- 규칙 검사 ----------
function readSGD(list) {
  const trapO = list.find(o => o.name === '곰덫' && o.nickname === TRAP_NAME) || list.find(o => o.name === '곰덫');
  const num = o => { const m = /\d+/.exec(String(o.nickname)); return m ? +m[0] : Infinity; };
  const banners = list.filter(o => o.name === '깃발 1').map((o, i) => ({ o, i, k: num(o) })).sort((a, b) => a.k - b.k || a.i - b.i).map(({ o }) => KP.toGame(o));
  const cities = list.filter(o => o.name === 'Player' || o.name === '연맹자원').map(o => ({ ...KP.toGame(o), label: o.nickname }));
  const hqo = list.find(o => o.name === '본부 1');
  return { trap: trapO ? KP.toGame(trapO) : null, hq: hqo ? KP.toGame(hqo) : HQ, banners, cities, extraTraps: list.filter(o => o.name === '곰덫').length - 1 };
}
function check(list) {
  const S = readSGD(list);
  if (!S.trap) return { errs: [`곰덫(${TRAP_NAME})이 없습니다`] };
  const P = { nodesBlock: true, rule: 'corner', cityInTerr: true, grid: true, blocks: BLOCKS };
  const r = K.inspect(map, P, { hq: S.hq, t2: S.trap, t1: null, banners: S.banners, cities: S.cities, K2: 0, K1: 0 });
  const errs = r.errs.map(e => e.replace(/^곰덫2/, '곰덫1'));
  if (S.extraTraps > 0) errs.push(`곰덫이 ${S.extraTraps + 1}개입니다 (SGD는 곰덫1만)`);
  // 깃발 영토가 다른 연맹 영토와 겹치면 게임에서 세우지 못할 수 있음
  S.banners.forEach((b, i) => {
    const hit = BLOCKS.find(k => b.x - K.BN_COV <= k.x2 && b.x + K.BN_COV >= k.x1 && b.y - K.BN_COV <= k.y2 && b.y + K.BN_COV >= k.y1);
    if (hit) errs.push(`깃발 ${i + 1}번: 영토가 다른 연맹 영토와 겹침 (X ${hit.x1}~${hit.x2} · Y ${hit.y1}~${hit.y2})`);
  });
  const lines = [0, 0, 0, 0, 0, 0];
  for (const c of S.cities) lines[Math.min(5, lineOf(c, S.trap))]++;
  return { errs, S, lines };
}
const lineText = l => `1줄 ${l[1]} · 2줄 ${l[2]} · 3줄 ${l[3]} · 4줄 ${l[4]} · 5줄 이상 ${l[5]}`;
// 지금 서 있는 SGD 깃발이 새 배치에서 어떻게 되는지
function existingFlags(S) {
  return (area.flags || []).map(f => {
    const reused = S.banners.some(b => b.x === f.x && b.y === f.y);
    const on = S.cities.find(c => f.x >= c.x && f.x < c.x + 2 && f.y >= c.y && f.y < c.y + 2) ||
      (f.x >= S.trap.x && f.x < S.trap.x + 3 && f.y >= S.trap.y && f.y < S.trap.y + 3 ? { label: '곰덫1' } : null);
    return `${f.x},${f.y} ${reused ? '그대로 사용' : on ? `철거 필요 (${on.label} 자리)` : '배치와 겹치지 않음 (두어도 됨)'}`;
  });
}

const checkFile = arg('check');
if (checkFile) {
  const r = check(JSON.parse(readFileSync(rel(checkFile), 'utf8')));
  if (r.S) console.log(`곰덫1 ${r.S.trap.x},${r.S.trap.y} · 자리 ${r.S.cities.length} · 깃발 ${r.S.banners.length} · ${lineText(r.lines)}`);
  if (r.S) for (const t of existingFlags(r.S)) console.log(`  지금 SGD 깃발 ${t}`);
  console.log(`검증 오류 ${r.errs.length}건 (다른 연맹 영토는 여유 ${M}칸 포함)`, r.errs.slice(0, 10));
  process.exit(r.errs.length ? 1 : 0);
}

// ---------- 계산 ----------
const total = Number(arg('total', 100));
const trapArg = arg('trap');
const fix = trapArg ? (([x, y]) => ({ x, y }))(trapArg.split(',').map(Number)) : null;
const P = {
  hx: HQ.x, hy: HQ.y, N: total, K2: total, single: true, t1Lines: 0, lines: 3, w1: 0, t1Gap: 0,
  trapMode: 'any', dmax: Number(arg('dmax', 40)), rule: 'adjacent', cityInTerr: true, nodesBlock: true, grid: true,
  blocks: BLOCKS, terrBlocks: BLOCKS, effort: arg('effort', 'deep'), seed: Number(arg('seed', 2382)), ...(fix ? { fixT2: fix } : {}),
};
for (const w of K.checkHQ(map, P)) console.warn('본부:', w);
const progress = label => { let last = -1; return p => { const pct = Math.floor(p * 10); if (pct !== last) { last = pct; process.stderr.write(`\r${label} ${pct * 10}%   `); } }; };
let res = await K.optimize(map, P, progress('곰덫1 자리 탐색'));
process.stderr.write('\n');
if (res.error) { console.error(res.error.replace(/곰덫2/g, '곰덫1')); process.exit(1); }
if (res.validation.length) { console.error('검증 오류', res.validation.slice(0, 5)); process.exit(1); }
// 자리 탐색은 빠른 추정으로 후보를 고르므로, 찾은 자리 주변 ±R칸을 곰덫 고정으로 다시 계산해 더 좋은 자리가 있으면 바꿈
// (빠른 강도로 훑고, 좋은 3곳만 같은 강도로 다시 비교)
const R = fix ? 0 : Number(arg('refine', 3));
if (R > 0) {
  const base = res.t2, near = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (!dx && !dy) continue;
    process.stderr.write(`\r주변 다시 계산 ${near.length + 1}/${(2 * R + 1) ** 2 - 1}   `);
    const t = { x: base.x + dx, y: base.y + dy };
    const r2 = await K.optimize(map, { ...P, effort: 'fast', fixT2: t });
    if (!r2.error && !r2.validation.length) near.push({ t, s: r2.score });
  }
  process.stderr.write('\n');
  near.sort((a, b) => a.s - b.s);
  for (const c of near.slice(0, 3)) {
    const r2 = await K.optimize(map, { ...P, fixT2: c.t }, progress(`곰덫1 ${c.t.x},${c.t.y} 정밀`));
    process.stderr.write('\n');
    if (!r2.error && !r2.validation.length && r2.score < res.score - 1e-9) res = r2;
  }
}

const trap = res.t2;
const ranked = rankSeats(res.cities.map(c => ({ x: c.x, y: c.y })), trap);
const flags = orderFlags(res.banners, trap, ranked);
const out = [KP.fromGame('본부 1', HQ.x, HQ.y, '본부'), KP.fromGame('곰덫', trap.x, trap.y, TRAP_NAME)];
flags.forEach((b, i) => out.push(KP.fromGame('깃발 1', b.x, b.y, `깃발 ${i + 1}`)));
ranked.forEach((s, i) => out.push(KP.fromGame('Player', s.x, s.y, `빈자리 ${i + 1}`)));

const r = check(out);
const hqTerr = terrOf([]);
console.log(`곰덫1 ${trap.x},${trap.y} (본부에서 ${Math.hypot(trap.x - HQ.x, trap.y - HQ.y).toFixed(1)}칸) | 자리 ${ranked.length}/${total} | 깃발 ${flags.length} | 점수 ${res.score.toFixed(1)} | 검증 오류 ${r.errs.length}`);
console.log(`  자리 줄: ${lineText(r.lines)} · 본부 영토 안 자리 ${ranked.filter(s => covered(hqTerr, s, 2)).length}`);
// 깃발을 번호대로 세울 때: 1번 자리부터 이어서 영토인 자리 수 (곰덫이 덮이는 시점 표시)
const prefix = t => { const i = ranked.findIndex(s => !covered(t, s, 2)); return i < 0 ? ranked.length : i; };
let acc = [];
const steps = flags.map((b, i) => { acc = acc.concat([b]); const t = terrOf(acc); return `${i + 1}:${prefix(t)}${covered(t, trap, 3) && !covered(terrOf(acc.slice(0, -1)), trap, 3) ? '(곰덫)' : ''}`; });
console.log(`  깃발 수 → 1~N번 자리 영토 (본부만 1~${prefix(hqTerr)}${covered(hqTerr, trap, 3) ? ', 곰덫 포함' : ''}): ${steps.join(' ')}`);
for (const t of existingFlags(r.S)) console.log(`  지금 SGD 깃발 ${t}`);
if (r.errs.length) { console.error('검증 오류가 있어 저장하지 않았습니다', r.errs.slice(0, 5)); process.exit(1); }
if (has('dry')) process.exit(0);
const outFile = arg('out', 'layouts/sgd.json');
writeFileSync(rel(outFile), JSON.stringify(out, null, 1));
console.log(`저장: ${outFile} (기물 ${out.length}개)`);
