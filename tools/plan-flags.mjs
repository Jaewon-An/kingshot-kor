// v2 깃발 재배치 최적화 · 작업 순서 (v2/flagplan.js를 Node에서 실행 — /v2/admin의 "깃발 재배치 최적화"와 같은 계산)
// 사용법:
//   node tools/plan-flags.mjs                     layouts/v2.json + layouts/flags.json(지금 깃발) → 결과만 출력
//   node tools/plan-flags.mjs --write             결과 깃발·빈자리로 layouts/v2.json을 바꿈
//   node tools/plan-flags.mjs --rule auto --cap 42 --tries 40 --keep-spares --from 파일 --out 파일
//     --rule auto(기본: 변 접촉 결과가 같으면 그것, 꼭짓점이 더 적으면 꼭짓점) | corner | edge
//     --cap  작업 중 깃발 수 상한 (기본: 없음). 주면 설치 전에 필요 없는 깃발을 먼저 철거하는 단계가 들어감
//     --keep-spares  빈자리를 지금 자리에 고정 (기본: 깃발을 정한 뒤 영토 안 남는 칸에 다시 놓음)
//   node tools/plan-flags.mjs --renumber [--write] 깃발 자리는 그대로, 번호만 작업 순서대로 (새로 지을 깃발 1, 2, … → 이미 있는 깃발)
//   node tools/plan-flags.mjs --fill-only [--write] 깃발은 그대로, 곰덫2 3줄 · 곰덫1 2줄 안 빈자리를 그 곰덫 기준 바깥 연맹원으로 채움
//     (최적화 실행 때도 마지막에 같은 줄 채우기를 함. --no-fill 이면 안 함. 기준이 되는 기존 배치: --old 파일, 기본 layouts/current.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const rel = p => path.resolve(ROOT, p);
const sandbox = { window: {} };
sandbox.self = sandbox.window;
vm.createContext(sandbox);
for (const f of ['mapdata.js', 'v2/core.js', 'v2/plan.js', 'v2/flagplan.js']) vm.runInContext(readFileSync(rel(f), 'utf8'), sandbox, { filename: f });
const { KS_MAPDATA: MD, KSCore: K, KSPlan: KP, KSFlagPlan: FP } = sandbox.window;
const map = K.buildMap(inflateSync(Buffer.from(MD.TERRAIN_B64, 'base64')), inflateSync(Buffer.from(MD.NODES_B64, 'base64')));

const from = arg('from', 'layouts/v2.json'), out = arg('out', from);
const list = JSON.parse(readFileSync(rel(from), 'utf8'));
const existing = JSON.parse(readFileSync(rel('layouts/flags.json'), 'utf8')).flags;
// 줄 채우기 기준이 되는 기존 배치 (/v2 명단의 곰덫 구분과 같음). --no-fill 이면 줄 채우기 안 함
const oldList = process.argv.includes('--no-fill') ? null : JSON.parse(readFileSync(rel(arg('old', 'layouts/current.json')), 'utf8'));
const showFill = fl => {
  if (!fl) return;
  console.log(`줄 채우기 (깃발 그대로): 곰덫2 1·2·3줄 ${fl.before.t2.join('·')} → ${fl.after.t2.join('·')}명 · 곰덫1 1·2줄 ${fl.before.t1.join('·')} → ${fl.after.t1.join('·')}명`);
  for (const m of fl.moved) console.log(`  옮김 (곰덫${m.trap} 쪽) ${m.n}: ${m.from.x},${m.from.y} → ${m.to.x},${m.to.y}`);
};
// --fill-only: 깃발은 그대로 두고 줄 채우기만 (번호·작업 순서는 다시)
if (process.argv.includes('--fill-only')) {
  const fl = FP.fillLines(map, list, oldList, {});
  showFill(fl);
  const rn = FP.renumber(fl.objects, existing, {});
  const chk = KP.check(map, rn.objects, { rule: rn.rule === 'edge' ? 'adjacent' : 'corner' });
  console.log(`규칙 검사: 위반 ${chk.errs.length}건`, chk.errs.slice(0, 5));
  if (process.argv.includes('--write') && !chk.errs.length) { writeFileSync(rel(out), JSON.stringify(rn.objects, null, 1)); console.log(`저장: ${out}`); }
  process.exit(chk.errs.length ? 1 : 0);
}

// --renumber: 깃발 자리는 그대로 두고 번호만 작업 순서대로 (새로 지을 깃발 1, 2, … → 이미 있는 깃발)
if (process.argv.includes('--renumber')) {
  const r = FP.renumber(list, existing, { cap: arg('cap') ? Number(arg('cap')) : undefined });
  const ex = new Set(existing.map(f => `${f.x},${f.y}`));
  const nb = r.order.filter(f => !ex.has(`${f.x},${f.y}`)).length;
  console.log(`작업 순서대로 번호 (${r.rule === 'edge' ? '변' : '꼭짓점'} 접촉 기준): 새로 지을 깃발 1~${nb}번, 이미 있는 깃발 ${nb + 1}~${r.order.length}번`);
  console.log(r.order.map((f, i) => `${i + 1}:${f.x},${f.y}${ex.has(`${f.x},${f.y}`) ? '(기존)' : ''}`).join(' '));
  if (process.argv.includes('--write')) { writeFileSync(rel(out), JSON.stringify(r.objects, null, 1)); console.log(`저장: ${out}`); }
  process.exit(0);
}
// (선택) 우선 구역 채우기: --secure2 3 --secure1 2 → 곰덫2 3줄·곰덫1 2줄 안 성 자리를 깃발로 막지 않고 바깥 연맹원으로 채움
const zoneOpt = { secure2: arg('secure2') != null ? Number(arg('secure2')) : undefined, secure1: arg('secure1') != null ? Number(arg('secure1')) : undefined };
const t0 = Date.now();
const r = FP.optimize(map, list, existing, {
  rule: arg('rule', 'auto'), cap: arg('cap') ? Number(arg('cap')) : undefined, tries: Number(arg('tries', 40)),
  refitSpares: !process.argv.includes('--keep-spares'), ...zoneOpt, oldList,
});
showFill(r.filled);
const xy = f => `${f.x},${f.y}`;
const RULE = { corner: '꼭짓점 접촉', edge: '변 접촉' };
console.log(`연결 규칙 ${RULE[r.rule]}${r.alt ? ` (비교: ${RULE[r.alt.rule]} 새로 ${r.alt.stats.build}개 · 전체 ${r.alt.stats.total}개)` : ''} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
console.log(`지금 깃발 ${r.stats.existing}개 → v2 깃발 ${r.stats.total}개 (계산 전 v2 배치 ${r.stats.before}개)`);
console.log(`  유지 ${r.stats.keep} · 새로 설치 ${r.stats.build} · 꼭 철거 ${r.stats.remove} · 그대로 둬도 되는 깃발 ${r.stats.unneeded}`);
console.log('  유지:', r.keep.map(f => `${f.name}(${xy(f)})`).join(' '));
const byWhy = new Map();
for (const e of r.remove) byWhy.set(e.why, [...(byWhy.get(e.why) || []), `${e.f.name}(${xy(e.f)})`]);
for (const [why, l] of byWhy) console.log(`  꼭 철거 · ${why}: ${l.join(' ')}`);
if (r.spareMoved.length) console.log(`  빈자리: 깃발을 정한 뒤 다시 놓음 (${KP.readLayout(r.objects).spare.length}칸)`);
{
  const RL = KP.readLayout(r.objects), inBlk = (x, y) => KP.BLOCKS_DEFAULT.some(b => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2);
  const Z = FP.zoneOf(map, RL, zoneOpt, inBlk), st = KP.check(map, r.objects).stats;
  if (Z.S2 || Z.S1) console.log(`우선 구역(곰덫2 ${Z.S2}줄 · 곰덫1 ${Z.S1}줄): 연맹원 ${RL.members.length - Z.outer.length}/${RL.members.length}명${Z.outer.length ? ` · 구역 밖: ${Z.outer.map(m => m.n).join(', ')}` : ' (전원)'}`);
  console.log(`  곰덫2 1·2·3줄 ${st.lines.slice(1, 4).join('·')}명 · 곰덫1 1·2줄 ${st.lines1.slice(1, 3).join('·')}명`);
  if (r.promoted && r.promoted.length) console.log(`  구역 채우기로 옮긴 연맹원: ${r.promoted.map(m => `${m.n} ${xy(m.from)}→${xy(m.to)}`).join(' / ')}`);
}
console.log(`작업 순서 (깃발 수 상한 ${Number.isFinite(r.plan.cap) ? r.plan.cap + '개' : '없음'}${r.plan.stuck ? ' · 일부 진행 불가' : ''})`);
const PH = { 1: '1단계 새 깃발 설치', 2: '2단계 새 자리 비우기 (꼭 철거)' };
let n = 0, ph = 0, b = 0;
for (const s of r.plan.steps) {
  if (s.phase !== ph) { ph = s.phase; console.log(` ${PH[ph]}`); }
  console.log(`  ${String(++n).padStart(2)}. ${s.op === 'build' ? `설치 #${++b}` : '철거'} ${s.f.name ? s.f.name + ' ' : ''}${xy(s.f)} — ${s.why}`);
}
const chk = KP.check(map, r.objects, { rule: r.rule === 'edge' ? 'adjacent' : 'corner' });
console.log(`규칙 검사 (결과 배치, ${RULE[r.rule]}): 위반 ${chk.errs.length}건`, chk.errs.slice(0, 5));
if (process.argv.includes('--write')) {
  if (chk.errs.length) { console.error('규칙 위반이 있어 저장하지 않았습니다'); process.exit(1); }
  writeFileSync(rel(out), JSON.stringify(r.objects, null, 1));
  console.log(`저장: ${out} (기물 ${r.objects.length}개)`);
}
