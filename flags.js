/* /flags — KOR 연맹 깃발 현황 (왕국 전체).
 * Shows layouts/flags.json, kept apart from the seat layout (layouts/current.json), read-only.
 * Loaded by app.js (startView) on the /flags page; app.js hands over what it needs as window.KS_APP.
 * Coordinates in flags.json are the in-game X/Y shown when tapping the object. */
(function () {
'use strict';

const A = window.KS_APP;
const $ = id => document.getElementById(id);
const DATA_URL = new URL('layouts/flags.json', A.BASE).href;
const EXTRA_KEY = 'ks-flags-extra';   // flags a viewer added by coordinates (this browser only)
const FLAG = '깃발 1';
const M = A.MAX_COORD, N = A.MAP_SIZE;
let data = null;
let mode = 'now';                      // 'now' = surveyed flags, 'plan' = optimisation proposal
let extra = [];
try { extra = JSON.parse(localStorage.getItem(EXTRA_KEY) || '[]').filter(e => Number.isFinite(e.x) && Number.isFinite(e.y)); }
catch (_) { extra = []; }
const saveExtra = () => { try { localStorage.setItem(EXTRA_KEY, JSON.stringify(extra)); } catch (_) { /* storage unavailable */ } };

// in-game X/Y -> tile position (a flag's X/Y is its centre, a building's is its far corner)
const flagAt = (x, y, label) => A.makeObject(FLAG, M - y - 3, M - x - 3, label);
const buildingAt = b => {
  const t = A.TEMPLATES[b.type];
  return A.makeObject(b.type, M - b.y - (t.w - 1), M - b.x - (t.h - 1), b.name);
};
const focus = o => { A.select([o]); A.centerOnTile(o.tx, o.ty, o.w, o.h); };

document.title = 'KOR 연맹 깃발 현황';
document.body.classList.add('flags-page');
const style = document.createElement('style');
style.textContent = `
  body.flags-page .input-unit, body.flags-page #find-btn { display: none; }
  #flags-section .note { font-size: 11px; line-height: 1.5; color: var(--muted); }
  #flags-section .note b { color: var(--text); font-weight: 600; }
  #fl-list .item.redundant span:first-child { color: #ffb74d; }
  #fl-list .item.new span:first-child { color: #7ee2a8; }
  #fl-list .item.removed span:first-child { color: var(--muted); text-decoration: line-through; }
  #fl-list .item.temp span:first-child { color: #d7b4ff; }
  #fl-list .item .del { background: none; color: var(--muted); padding: 0 4px; margin-left: 4px; }
  #fl-summary .item { cursor: default; }`;
document.head.append(style);

// the "Free castle spot" layer is about seating; there are no castles on this page
const freeCb = document.querySelector('[data-layer="free"]');
A.layers.free = false;
if (freeCb) { freeCb.checked = false; freeCb.closest('label').hidden = true; }

const section = document.createElement('section');
section.id = 'flags-section';
section.innerHTML = `
  <h3>KOR 연맹 깃발 · 왕국 #2382 <span class="muted">(자리배치와 별개)</span></h3>
  <div class="note" id="fl-scope"></div>
  <div class="row">
    <button class="btn-main" id="fl-now">현재 깃발</button>
    <button class="btn-sub" id="fl-plan">최적화안</button>
    <button class="btn-sub" id="fl-fit">왕국 전체 보기</button>
  </div>
  <div id="fl-summary" class="result"></div>
  <div id="fl-list" class="result"></div>
  <h3>깃발 추가 <span class="muted">(게임에서 깃발을 눌렀을 때 나오는 X, Y)</span></h3>
  <div class="row">
    <input id="fl-x" type="text" inputmode="numeric" placeholder="X">
    <input id="fl-y" type="text" inputmode="numeric" placeholder="Y">
    <button class="btn-main" id="fl-add">추가</button>
    <button class="btn-sub" id="fl-copy">추가한 목록 복사</button>
  </div>
  <div class="note">추가한 깃발은 이 브라우저에만 저장됩니다. "추가한 목록 복사"로 관리자에게 보내 주면 모두가 보는 목록에 반영합니다.</div>
  <label class="check"><input type="checkbox" id="fl-cities"><span id="fl-cities-label">KOR 성 위치 (참고)</span></label>`;
A.drawer.querySelector('.drawer-head').after(section);
if (window.innerWidth >= 700) A.drawer.hidden = false;

/* ---- analysis ---- */
const tilesOf = o => {
  const out = [];
  for (let y = o.ty; y < o.ty + o.h; y++) for (let x = o.tx; x < o.tx + o.w; x++) out.push(y * N + x);
  return out;
};

// territory size, node coverage (75%+ of a node inside), groups of touching flags, flags that add nothing
function analyse(flagObjs, buildings) {
  const cnt = new Map();
  for (const o of flagObjs) for (const k of tilesOf(o)) cnt.set(k, (cnt.get(k) || 0) + 1);
  const size = cnt.size;
  const nodeCount = [0, 0, 0, 0];
  for (const n of A.nodes) {
    let a = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (cnt.has((n.ty + dy) * N + n.tx + dx)) a++;
    if (a >= 3) nodeCount[n.t]++;
  }
  const outside = buildings.filter(b => !tilesOf(b).every(k => cnt.has(k)));
  // flags whose 7×7 areas overlap or touch belong to one territory group — corners included:
  // the 2026-10-15 screenshots show the fertile-land flags chained with only their territory corners touching
  const touch = (a, b) => a.tx <= b.tx + 7 && b.tx <= a.tx + 7 && a.ty <= b.ty + 7 && b.ty <= a.ty + 7;
  const seen = new Set();
  let groups = 0;
  for (const f of flagObjs) {
    if (seen.has(f)) continue;
    groups++;
    const stack = [f]; seen.add(f);
    while (stack.length) {
      const g = stack.pop();
      for (const h of flagObjs) if (!seen.has(h) && touch(g, h)) { seen.add(h); stack.push(h); }
    }
  }
  const uniq = new Map(flagObjs.map(o => [o, tilesOf(o).filter(k => cnt.get(k) === 1).length]));
  // greedy: a flag is redundant when the others already cover all of its tiles
  const redundant = new Set();
  for (const o of [...flagObjs].sort((a, b) => uniq.get(a) - uniq.get(b))) {
    const ts = tilesOf(o);
    if (ts.every(k => cnt.get(k) > 1)) { redundant.add(o); ts.forEach(k => cnt.set(k, cnt.get(k) - 1)); }
  }
  return { size, nodeCount, outside, groups, uniq, redundant };
}

/* ---- build the map objects for the current mode ---- */
let rows = [];   // [{ obj, kind: 'flag'|'new'|'temp', info }]
function build() {
  const removed = new Set(mode === 'plan' ? data.plan.remove.map(r => r.name) : []);
  rows = [];
  for (const f of data.flags) if (!removed.has(f.name)) rows.push({ obj: flagAt(f.x, f.y, f.name), kind: 'flag', info: f });
  if (mode === 'plan') for (const f of data.plan.add) rows.push({ obj: flagAt(f.x, f.y, f.name), kind: 'new', info: f });
  extra.forEach((f, i) => rows.push({ obj: flagAt(f.x, f.y, `추가 ${i + 1}`), kind: 'temp', info: f }));
  A.loadObjects([...rows.map(r => r.obj), ...data.buildings.map(buildingAt)]);
  // loadObjects copies the objects in order: point the rows at the copies the map now uses
  rows.forEach((r, i) => { r.obj = A.objects[i]; });
  render();
}

function render() {
  $('fl-now').className = mode === 'now' ? 'btn-main' : 'btn-sub';
  $('fl-plan').className = mode === 'plan' ? 'btn-main' : 'btn-sub';
  const sum = $('fl-summary'), list = $('fl-list');
  sum.innerHTML = ''; list.innerHTML = '';
  if (!A.terrainReady) {           // node coverage needs the terrain data; try again shortly
    sum.append(A.resultItem('지도 데이터 불러오는 중…', '', () => {}));
    setTimeout(render, 300);
    return;
  }
  const flagObjs = rows.map(r => r.obj);
  const buildings = A.objects.filter(o => !A.isTerritory(o));
  const a = analyse(flagObjs, buildings);
  const head = (box, text) => { const d = document.createElement('div'); d.className = 'grp'; d.textContent = text; box.append(d); };

  if (mode === 'plan') head(sum, data.plan.title);
  sum.append(A.resultItem('깃발', `${flagObjs.length}개 · 영토 ${a.size.toLocaleString()}칸 · 영토 묶음 ${a.groups}곳`, () => {}));
  const total = a.nodeCount.reduce((s, v) => s + v, 0);
  sum.append(A.resultItem('영토 안 연맹 자원지', `${total}곳 (${a.nodeCount.map((c, i) => `${A.NODE_NAMES[i]} ${c}`).join(' · ')})`, () => {}));
  sum.append(A.resultItem('연맹 건물 (곰덫·자원)', a.outside.length ? `영토 밖 ${a.outside.length}개` : `${buildings.length}개 모두 영토 안`, () => {}));

  const coords = f => `X:${f.x} Y:${f.y}`;
  const addRow = (r, label, meta, cls) => {
    const el = A.resultItem(label, meta, () => focus(r.obj));
    if (cls) el.classList.add(cls);
    list.append(el);
    return el;
  };

  // surveyed flags, grouped by area
  const areas = new Map();
  for (const r of rows.filter(r => r.kind === 'flag')) {
    const k = r.info.area || '기타';
    if (!areas.has(k)) areas.set(k, []);
    areas.get(k).push(r);
  }
  for (const [area, rs] of areas) {
    head(list, `${area} · ${rs.length}개`);
    for (const r of rs) {
      const red = a.redundant.has(r.obj);
      let tag = red ? '중복 · 빼도 영토 그대로' : `혼자 덮는 칸 ${a.uniq.get(r.obj)}`;
      if (!red && a.uniq.get(r.obj) === 0) {
        // overlaps a redundant flag completely: exactly one of the pair can go
        const dist = p => Math.abs(p.obj.tx - r.obj.tx) + Math.abs(p.obj.ty - r.obj.ty);
        const partner = rows.filter(p => a.redundant.has(p.obj) && dist(p) <= 4).sort((p, q) => dist(p) - dist(q))[0];
        tag = partner ? `${partner.info.name}을(를) 빼면 남겨야 함` : '다른 깃발과 완전히 겹침';
      }
      addRow(r, r.info.name, `${coords(r.info)} · ${tag}`, red ? 'redundant' : '');
    }
  }
  if (mode === 'plan') {
    head(list, `새로 설치 · ${data.plan.add.length}개`);
    for (const r of rows.filter(r => r.kind === 'new')) addRow(r, r.info.name, `${coords(r.info)} · ${r.info.note}`, 'new');
    head(list, `철거 · ${data.plan.remove.length}개`);
    for (const rm of data.plan.remove) {
      const f = data.flags.find(x => x.name === rm.name);
      if (!f) continue;
      const ghost = flagAt(f.x, f.y, f.name);
      const el = A.resultItem(f.name, `${coords(f)}${rm.alt ? ` · 또는 ${rm.alt}` : ''}`, () => A.centerOnTile(ghost.tx, ghost.ty, 7, 7));
      el.classList.add('removed');
      list.append(el);
    }
  }
  const temps = rows.filter(r => r.kind === 'temp');
  if (temps.length) {
    head(list, `직접 추가 (이 브라우저) · ${temps.length}개`);
    temps.forEach((r, i) => {
      const el = addRow(r, r.obj.nickname, coords(r.info), 'temp');
      const del = document.createElement('button');
      del.className = 'del'; del.textContent = '✕'; del.title = '지우기';
      del.onclick = e => { e.stopPropagation(); extra.splice(i, 1); saveExtra(); build(); };
      el.append(del);
    });
  }
}

/* ---- controls ---- */
$('fl-now').onclick = () => { mode = 'now'; build(); };
$('fl-plan').onclick = () => { mode = 'plan'; build(); };
$('fl-fit').onclick = () => {
  const { w, h } = A.viewSize();
  A.setCamera({ x: A.WORLD_SIZE / 2, y: A.WORLD_SIZE / 2, zoom: Math.min(w, h) / (A.WORLD_SIZE * Math.SQRT2) * 0.95 });
};
function addFlag() {
  const x = parseInt($('fl-x').value, 10), y = parseInt($('fl-y').value, 10);
  if (!(x >= 3 && x <= M - 3 && y >= 3 && y <= M - 3)) { A.toast('X, Y를 3~1196 사이 숫자로 넣으세요'); return; }
  if ([...data.flags, ...extra].some(f => f.x === x && f.y === y)) { A.toast('이미 있는 깃발입니다'); return; }
  extra.push({ x, y });
  saveExtra();
  build();
  const o = rows[rows.length - 1].obj;
  const why = A.terrainReady ? A.blockReason(o, o.tx, o.ty) : null;
  focus(o);
  A.toast(why ? `추가했습니다 (지도 데이터상: ${why})` : '추가했습니다');
  $('fl-x').value = ''; $('fl-y').value = '';
}
$('fl-add').onclick = addFlag;
[$('fl-x'), $('fl-y')].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') addFlag(); }));
$('fl-copy').onclick = () => {
  if (!extra.length) { A.toast('직접 추가한 깃발이 없습니다'); return; }
  const text = extra.map((f, i) => `추가 ${i + 1}: X:${f.x} Y:${f.y}`).join('\n');
  const done = () => A.toast(`${extra.length}개 복사했습니다`);
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => prompt('아래 내용을 복사하세요', text));
  else prompt('아래 내용을 복사하세요', text);
};
$('fl-cities').onchange = e => { A.live.show = e.target.checked; A.requestDraw(); };

/* ---- load ---- */
A.getJSON(DATA_URL).then(d => {
  data = d;
  const s = d.survey || {};
  const scope = $('fl-scope');
  const b = document.createElement('b'); b.textContent = s.scope || '';
  scope.append(b);
  if (s.searched) scope.append(document.createElement('br'), s.searched);
  if (s.source) scope.append(document.createElement('br'), `출처: ${s.source} · 갱신 ${d.updated || '-'}`);
  if (d.korCities && Array.isArray(d.korCities.list)) {
    A.applyLive({ kid: d.kingdom, cities: d.korCities.list });
    A.live.show = false;           // off by default: this page is about flags, not seating
    $('fl-cities-label').textContent = `KOR 성 위치 ${d.korCities.list.length}개 (참고 · ${d.korCities.source} ${d.korCities.date})`;
  }
  build();
  A.centerOnObjects();
  A.toast('KOR 연맹 깃발 현황 (자리배치와 별개)');
}).catch(err => { console.error(err); A.toast('깃발 데이터(layouts/flags.json)를 불러오지 못했습니다'); });
})();
