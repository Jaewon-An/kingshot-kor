// v2 배치 만들기·검사 (v2/plan.js를 Node에서 실행 — /v2/admin의 "이름 배치 다시 계산"과 같은 계산)
// 사용법:
//   node tools/make-v2-layout.mjs                          layouts/current.json → layouts/v2.json (곰덫2 523,720 / 곰덫1 511,720)
//   node tools/make-v2-layout.mjs --from 파일 --t2 X,Y --t1 X,Y --total 100 --out 파일
//     --secure 2               두 곰덫의 2줄 안을 바깥 연맹원으로 꽉 채움 (기본). 곰덫별: --secure2 3 --secure1 2. 0이면 USB 원본과 같은 계산
//     --vip2 2 --vip1 1        (선택) 기존 배치에서 곰덫2 2줄·곰덫1 1줄 안에 있던 연맹원을 같은 줄 이내로 우선 배치. 기본은 곰덫1 1줄만
//   node tools/make-v2-layout.mjs --check layouts/v2.json  규칙 검사만
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const pt = s => { const [x, y] = s.split(',').map(Number); return { x, y }; };
const rel = p => path.resolve(ROOT, p);

const sandbox = { window: {} };
sandbox.self = sandbox.window;
vm.createContext(sandbox);
for (const f of ['mapdata.js', 'v2/core.js', 'v2/plan.js']) vm.runInContext(readFileSync(rel(f), 'utf8'), sandbox, { filename: f });
const { KS_MAPDATA: MD, KSCore: K, KSPlan: KP } = sandbox.window;
const map = K.buildMap(inflateSync(Buffer.from(MD.TERRAIN_B64, 'base64')), inflateSync(Buffer.from(MD.NODES_B64, 'base64')));
const lineText = l => `1줄 ${l[1]} · 2줄 ${l[2]} · 3줄 ${l[3]} · 4줄 이상 ${l[4]}`;
const linesText = s => `곰덫2 기준 ${lineText(s.lines)} | 곰덫1 기준 ${lineText(s.lines1)}`;

const checkFile = arg('check');
if (checkFile) {
  const r = KP.check(map, JSON.parse(readFileSync(rel(checkFile), 'utf8')));
  if (r.stats) console.log(`연맹원 ${r.stats.members} · 빈자리 ${r.stats.spare} · 깃발 ${r.stats.banners} · ${linesText(r.stats)}`);
  console.log(`검증 오류 ${r.errs.length}건`, r.errs.slice(0, 10));
  process.exit(r.errs.length ? 1 : 0);
}

const from = arg('from', 'layouts/current.json'), out = arg('out', 'layouts/v2.json');
const t2 = pt(arg('t2', '523,720')), t1 = pt(arg('t1', '511,720'));   // X−2-L 안: 곰덫1이 곰덫2 왼쪽
const num = (k, d) => (arg(k) != null ? Number(arg(k)) : d);
const { objects, stats } = KP.assign(map, JSON.parse(readFileSync(rel(from), 'utf8')), {
  t2, t1, total: num('total', 100), secure: num('secure'), secure2: num('secure2'), secure1: num('secure1'), vip2: num('vip2'), vip1: num('vip1'),
});
console.log(`곰덫2 ${t2.x},${t2.y} 곰덫1 ${t1.x},${t1.y} | 같은 상대 자리 ${stats.same}/${stats.members}명 | 옮긴 ${stats.moved.length}명 | 깃발 ${stats.banners} | 빈자리 ${stats.spare} | 검증 오류 ${stats.errs.length}`);
console.log(`  연맹원 ${linesText(stats)}`);
if (stats.vip.total) console.log(`  우선 배치 ${stats.vip.kept}/${stats.vip.total}명이 새 배치에서도 우선 줄 안${stats.vip.out.length ? ` · 밖: ${stats.vip.out.join(', ')}` : ''}`);
for (const m of stats.moved) console.log(`  옮김 ${m.n}: ${m.from.x},${m.from.y} → ${m.to.x},${m.to.y} (${m.d.toFixed(1)}칸)`);
if (stats.errs.length) { console.error('검증 오류가 있어 저장하지 않았습니다', stats.errs.slice(0, 5)); process.exit(1); }
writeFileSync(rel(out), JSON.stringify(objects, null, 1));
console.log(`저장: ${out} (기물 ${objects.length}개)`);
