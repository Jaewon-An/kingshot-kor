/* /banner/v3/ — KOR 점령 거점 연결 최적 경로 (data.json).
 * data: view{x0..y1}, hq{plain, wild(지금), wildNew}, held[{name,x,y}](점령 거점 3×3 모서리), cands[{name,x,y,add,rank,flags}](주변 미점령 거점, 더 잇는 데 드는 깃발),
 *   v2(평원 본부 쪽 깃발 — 그대로), now(지금 깃발: 화면에서 추정), main/alts/stay/all6(연결안: w 황야 본부, flags, cost, A 평원 쪽 거점, B 황야 쪽, direct 바로 닿음),
 *   res{now,new}(영토 안 연맹 자원지 [빵,나무,돌,철]), steps(작업 순서 — main 기준), others/known/kor([y,x0,x1] 줄).
 *   11-13: assume.swap(무기 창고 교환 가정), gave, corners[{a,b,grp}], resfill.groups[{flags,got,early}], steps phase ⑥~⑧·op sweep, review.
 * 지형·연맹 자원지는 mapdata.js(KSPlan.loadMap). 진행은 서버 /api/banner/v3/steps(모든 기기 공유) + 이 브라우저 localStorage.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const KP = window.KSPlan, G = 1200;
  const cv = $('cv'), gx = cv.getContext('2d');
  const PHONE = matchMedia('(max-width: 900px)');
  if (PHONE.matches) for (const id of ['legend', 'flbox']) if ($(id)) $(id).open = false;
  const xy = (x, y) => `X:${x} Y:${y}`;
  function fail(msg) { const n = $('notice'); n.textContent = msg; n.className = 'notice err'; n.hidden = false; }
  let D, map, VX, VY, VW, VH, kind, PLAN, planKey = 'main';
  const C = {};
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['m-void', 'm-ground', 'm-fertile', 'm-mount', 'm-lake', 'm-node', 'm-struct', 'm-grid', 'c-hq', 'c-t2', 'c-banner', 'c-terr', 'c-pick', 'c-new', 'c-old', 'c-wild', 'c-cand', 'c-oth', 'ink', 'bg', 'ok', 'bad'])
      C[k] = cs.getPropertyValue('--' + k).trim();
  };
  const rgb = c => { const t = document.createElement('canvas').getContext('2d'); t.fillStyle = c; const h = t.fillStyle; return h.startsWith('#') ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : (h.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number); };

  async function load() {
    try { const r = await fetch('/banner/v3/data.json', { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); D = await r.json(); } catch (_) { fail('경로 데이터(data.json)를 불러오지 못했습니다. 새로고침해 주세요.'); return; }
    try { map = await KP.loadMap(); } catch (_) { fail('지도 데이터를 풀지 못했습니다. 최신 Chrome·Edge·Safari·Firefox에서 열어 주세요.'); return; }
    VX = D.view.x0; VY = D.view.y0; VW = D.view.x1 - VX + 1; VH = D.view.y1 - VY + 1;
    kind = new Uint8Array(VW * VH);
    for (let y = VY; y < VY + VH; y++) for (let x = VX; x < VX + VW; x++) {
      const k = map.kind[y * G + x]; kind[(y - VY) * VW + x - VX] = k === 1 ? 1 : k === 2 ? 2 : k >= 3 && k <= 6 ? 3 : k >= 7 ? 4 : 0;
    }
    readColors(); setup(); $('notice').hidden = true; $('main').hidden = false; fit();
  }

  // ---------- 연결안 ----------
  const PLANS = () => {   // 11-11 사용자: 추천안만 남김 · 11-13: 무기 창고 교환 가정
    const had = new Set([...D.v2, ...D.now].map(f => f[0] * G + f[1])), keep = D.main.flags.filter(f => had.has(f[0] * G + f[1])).length, sw = (D.assume || {}).swap;
    return [['main', D.main, `추천: 황야 본부 → ${xy(...D.main.w)}`, `깃발 ${D.main.flags.length}개(새로 ${D.main.flags.length - keep} + 지금 있는 ${keep}개 그대로)로 점령 거점 ${D.held.length}곳 연결, v2 위쪽 ${D.up.unused.length}개 철거${sw ? ` — ${sw.with}과 무기 창고 교환(${xy(...sw.give)} ↔ ${xy(...sw.take)}) 성사 가정` : ''}`]];
  };
  function setPlan(k) { planKey = k; PLAN = PLANS().find(p => p[0] === k)[1]; renderFacts(); renderFlags(); $('stepbox').hidden = k !== 'main'; draw(); }

  function setup() {
    $('stamp').textContent = `${D.updated} 기준 · 점령 거점 ${D.held.length}곳${(D.assume || {}).swap ? ' (무기 창고 교환 가정)' : ''}`;
    // 주변 거점
    const cs = D.cands.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99));
    let acc = D.main.flags.length;
    $('candsum').textContent = `${cs.filter(c => c.rank).length}곳 더 이음${cs.some(c => c.must) ? ` (필수 ${cs.filter(c => c.must && c.rank).length}곳)` : ''}`;
    $('cand').innerHTML = '<tr><th>거점</th><th>좌표</th><th class="n">혼자 붙이면</th><th class="n">차례로 붙이면</th><th class="n">누적</th></tr>' + cs.map(c => {
      if (!c.rank) return `<tr class="no"><td>${c.name}</td><td><button class="lnk" data-x="${c.x}" data-y="${c.y}">${xy(c.x, c.y)}</button></td><td class="n" colspan="3">지금은 못 이음</td></tr>`;
      acc += c.add; return `<tr><td>${c.rank}. ${c.name}${c.must ? ' <small>필수</small>' : ''}</td><td><button class="lnk" data-x="${c.x}" data-y="${c.y}">${xy(c.x, c.y)}</button></td><td class="n">${c.alone != null ? `+${c.alone}` : '—'}</td><td class="n">+${c.add}</td><td class="n">${acc}</td></tr>`;
    }).join('');
    $('cand').addEventListener('click', e => { const b = e.target.closest('button[data-x]'); if (b) goTo(+b.dataset.x + 1, +b.dataset.y + 1); });
    // 거점 종류 요약: 추천안 + 이을 수 있는 주변 거점까지 모두 이은 뒤
    const TYPES = ['건설소', '방어구 창고', '연구소', '무기 창고', '훈련 캠프', '원정 캠프', '채집 제단', '풍작 제단'];
    const typeOf = n => TYPES.find(t => n.includes(t)) || '기타', lvOf = n => (n.match(/Lv\.\d/) || [''])[0];
    const ownOf = n => (n.match(/\(([^)]*)\)/) || [, ''])[1];
    const rows = TYPES.map(t => {
      const on = D.held.filter(h => typeOf(h.name) === t).map(h => `${lvOf(h.name)} ${(D.retake || []).some(r => r.x === h.x && r.y === h.y) ? '되찾을 거점(지금 FUN)' : '점령'}`);
      const heldOff = [];
      const add = D.cands.filter(c => typeOf(c.name) === t && c.rank).map(c => `${lvOf(c.name)} ${ownOf(c.name)} +${c.add}`);
      const no = D.cands.filter(c => typeOf(c.name) === t && !c.rank).map(c => `${lvOf(c.name)} ${ownOf(c.name)}`).concat((D.gave || []).filter(c => typeOf(c.name) === t).map(c => `${lvOf(c.name)} ${xy(c.x, c.y)} — 교환으로 FUN에 넘김`)).concat((D.lost || []).filter(c => typeOf(c.name) === t).map(c => `${lvOf(c.name)} ${xy(c.x, c.y)} — 지금 ${c.to} 소유`)).concat((D.excluded || []).filter(c => typeOf(c.name) === t).map(c => `${lvOf(c.name)} ${ownOf(c.name)}${ownOf(c.name).includes('·') ? '' : ' (제외)'}`));
      const got = on.length + add.length > 0;
      return { t, got, html: `<tr class="${got ? '' : 'no'}"><td><b>${t}</b></td><td>${[...on, ...heldOff, ...add.map(v => `${v} 더 이음`)].join('<br>') || '<b class="warn">없음</b>'}</td><td>${no.join('<br>') || '—'}</td></tr>` };
    });
    const miss = rows.filter(r => !r.got).map(r => r.t);
    $('typesum').textContent = miss.length ? `연결 안 되는 종류 ${miss.length}: ${miss.join('·')}` : '모든 종류 연결';
    $('types').innerHTML = '<tr><th>종류</th><th>연결됨 (추천안 + 더 잇기)</th><th>못 이음 (소유)</th></tr>' + rows.map(r => r.html).join('');
    $('fl').addEventListener('click', e => { const b = e.target.closest('button[data-x]'); if (b) goTo(+b.dataset.x, +b.dataset.y); });
    setupSteps(); setPlan('main');
  }
  function renderFacts() {   // 11-14: 작업에 필요한 숫자만 — 진행 · 남은 건설 · 남은 철거
    if (!steps) return;
    const left = op => steps.slice(done).filter(st => opc(st) === op).length;
    $('facts').innerHTML = [['--c-pick', '진행', `${done}/${steps.length}`], ['--ok', '남은 건설', `${left('build')}개`], ['--c-new', '남은 철거', `${left('remove')}개`]]
      .map(([c, k, v]) => `<div><dt><i style="background:var(${c})"></i>${k}</dt><dd>${v}</dd></div>`).join('');
  }
  function renderFlags() {
    $('flsum').textContent = `${PLAN.flags.length}개`;
    const nowSet = new Set([...D.now, ...D.v2].map(f => f[0] * G + f[1]));
    $('fl').innerHTML = PLAN.flags.map(f => `<li><button class="lnk" data-x="${f[0]}" data-y="${f[1]}">${xy(f[0], f[1])}</button>${nowSet.has(f[0] * G + f[1]) ? ' <small>(지금 있음)</small>' : ''}</li>`).join('');
  }

  // ---------- 작업 순서 ----------
  let steps, done = 0, stepCur = null;
  const OP = { build: '깃발 건설', remove: '깃발 철거', hq: '황야 본부 이전', sweep: '남은 옛 깃발 정리' }, opc = st => (st.op === 'sweep' ? 'remove' : st.op);
  const PHASE = { 1: '① 황야 본부 이전 (건설소가 처음부터 본부에 닿게 먼저)', 2: '② 새 황야 본부 쪽 경로 건설', 3: '③ 평원 본부 쪽 새 경로 건설 (빈 칸 없으면 옛 깃발 먼저 철거)', 4: '④ 남은 옛 거점 연결 깃발 철거', 5: '⑤ v2 위쪽 깃발 정리 (곰덫 반경 밖 · 본부에서 먼 것부터)', 6: '⑥ 자원지 보강 — 추천안 영토에서 바로 잇는 묶음 (빵·나무 우선)', 7: '⑦ 주변 거점 연결 (닿아야 공격해 점령 가능)', 8: '⑧ 자원지 보강 — 주변 거점 길에서 잇는 묶음' };
  const KEY = 'banner-v3-steps', keyOf = st => `${st.op}${st.x},${st.y}`;
  function setupSteps() {
    steps = D.steps;
    if (D.phases) Object.assign(PHASE, D.phases);   // 11-13: 실제 깃발 기준으로 다시 짠 순서(끊김 최소)
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.keys)) while (done < steps.length && v.keys[done] === keyOf(steps[done])) done++; } catch (_) { /* 저장소 못 씀 */ }
    let ph = 0;
    $('stepl').innerHTML = steps.map((st, i) => `${st.phase !== ph ? `<li class="grp">${PHASE[(ph = st.phase)]}</li>` : ''}<li value="${i + 1}" data-k="${i}"><button class="lnk" data-k="${i}"><b class="opw op-${opc(st)}">${OP[st.op].slice(-2)}</b> ${where(st)}${st.chk ? ' <small title="짓기 전에 이 자리를 눌러 소속 연맹 확인">⚠</small>' : ''}${(st.phase >= 6 || D.phases) && st.why ? ` <small>${st.why}</small>` : ''}${st.join ? ` <small>끊긴 깃발 ${st.join}개 다시 이어짐</small>` : ''}${st.cut ? ` <small>✂ 이 단계에서 깃발 ${st.cut}개 끊김</small>` : ''}</button></li>`).join('');
    $('stepl').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) { const st = steps[+b.dataset.k]; goTo(st.x, st.y); } });
    $('stepcopy').addEventListener('click', () => { if (steps[done]) copy(steps[done]); });
    $('stepdone').addEventListener('click', () => { if (done < steps.length) { done++; save(); renderStep(); if (steps[done]) copy(steps[done], `${done}번 완료 · `); } });
    $('stepundo').addEventListener('click', () => { if (done) { done--; save(); renderStep(); } });
    $('stepmap').addEventListener('click', () => { const st = steps[done]; if (st) goTo(st.x, st.y); });
    renderStep();
    pull(); setInterval(() => { if (!document.hidden) pull(); }, 20000); document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  }
  const where = st => (st.op === 'hq' ? `${xy(...st.from)} → ${xy(st.x, st.y)}` : st.op === 'sweep' ? `약 ${st.left}개 — 목록에 없어도 새 계획 밖 거점 연결 깃발은 모두 철거` : xy(st.x, st.y));
  const saveLocal = () => { try { localStorage.setItem(KEY, JSON.stringify({ keys: steps.slice(0, done).map(keyOf) })); } catch (_) { /* 저장소 못 씀 */ } };
  // 진행 기록 서버 공유(11-13): /api/banner/v3/steps {keys, ver} — 누구나 PUT, base≠ver면 409(낡은 화면이 덮어쓰지 않음). 서버가 안 되면 이 기기에만 저장했다가 연결되면 올림.
  const API = '/api/banner/v3/steps'; let ver = null, dirty = false;
  const prefix = keys => { let n = 0; while (n < steps.length && keys[n] === keyOf(steps[n])) n++; return n; };
  function syncMsg(at, note) {
    let el = $('stepsync');
    if (!el) { el = document.createElement('small'); el.id = 'stepsync'; el.style.cssText = 'display:block;margin-top:.4em;opacity:.75'; $('stepmsg').after(el); }
    el.textContent = ver === null || dirty ? '서버에 연결되지 않아 이 기기에만 저장했습니다 — 연결되면 올립니다' : `모든 기기 공유${at ? ` · 마지막 저장 ${new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}${note ? ` · ${note}` : ''}`;
  }
  async function pull() {
    try {
      const r = await fetch(API, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status);
      const j = await r.json(); ver = j.ver || 0;
      if (dirty || (!Array.isArray(j.keys) && done)) return push();
      if (Array.isArray(j.keys)) { const n = prefix(j.keys); if (n !== done) { done = n; saveLocal(); renderStep(); } }
      syncMsg(j.updated_at);
    } catch (_) { syncMsg(); }
  }
  async function push() {
    saveLocal();
    if (ver === null) { dirty = true; syncMsg(); return; }
    try {
      const r = await fetch(API, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base: ver, keys: steps.slice(0, done).map(keyOf) }) });
      const j = await r.json();
      if (r.status === 409) { ver = j.ver; dirty = false; done = prefix(j.keys || []); saveLocal(); renderStep(); syncMsg(j.updated_at, '다른 기기에서 먼저 바뀌어 그 기록을 따랐습니다'); }
      else if (r.ok) { ver = j.ver; dirty = false; syncMsg(j.updated_at); }
      else throw new Error(r.status);
    } catch (_) { dirty = true; syncMsg(); }
  }
  const save = push;
  function copy(st, pre = '') {
    const t = `X:${st.x} Y:${st.y}`;
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => { $('stepmsg').textContent = `${pre}${t} 복사됨`; }, () => { $('stepmsg').textContent = `${pre}복사 안 됨: ${t}`; });
  }
  function renderStep() {
    const st = steps[done]; stepCur = st || null;
    $('stepsum').textContent = `${done}/${steps.length} 완료`;
    $('stepph').textContent = st ? `${done + 1}/${steps.length} · ${String(PHASE[st.phase]).split(' — ')[0]}` : '모든 작업을 마쳤습니다';
    $('stepop').innerHTML = st ? `<span class="opb op-${opc(st)}">${OP[st.op]}</span>${(st.phase >= 6 || D.phases) && st.why ? ` <small>${st.why}</small>` : ''}${st.cut ? ` <small>✂ 깃발 ${st.cut}개 끊김</small>` : ''}` : '';
    $('stepxy').textContent = st ? where(st) : '';
    if (st && st.chk) $('stepmsg').textContent = `⚠ 짓기 전에 이 자리를 눌러 소속 연맹을 확인하세요 (${st.chk.includes('adj') ? '다른 연맹 영토에 바로 붙는 자리' : '거점 아이콘·이름표에 가려 화면 판독이 불확실한 자리'}).`; else if ($('stepmsg').textContent.startsWith('⚠')) $('stepmsg').textContent = '';
    $('stepcard').className = `stepnow${st ? ` op-${opc(st)}` : ''}`;
    for (const id of ['stepcopy', 'stepdone', 'stepmap']) $(id).disabled = !st;
    $('stepundo').disabled = !done;
    renderFacts();
    document.querySelectorAll('#stepl li[data-k]').forEach(li => { const k = +li.dataset.k; li.classList.toggle('done', k < done); li.classList.toggle('cur', k === done); });
    draw();
  }

  // ---------- 지도 ----------
  const view = { cx: 0, cy: 0, s: 4, rot: true, now: true, oth: true, cand: true, res: false, mark: null };
  const SQ = Math.SQRT1_2;
  function mat(w, h) {
    const s = view.s, cx = view.cx, cy = view.cy;
    if (!view.rot) return [s, 0, 0, -s, w / 2 - cx * s, h / 2 + cy * s];
    const k = s * SQ; return [k, -k, -k, -k, w / 2 - k * (cx - cy), h / 2 + k * (cx + cy)];
  }
  function toWorld(sx, sy) {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!view.rot) return { x: view.cx + (sx - w / 2) / view.s, y: view.cy - (sy - h / 2) / view.s };
    const k = view.s * SQ, p = (sx - w / 2) / k, q = -(sy - h / 2) / k;
    return { x: view.cx + (p + q) / 2, y: view.cy + (q - p) / 2 };
  }
  function fit() {
    const pts = [D.hq.plain, D.hq.wild, D.main.w, ...D.held.map(h => [h.x, h.y]), ...PLAN.flags];
    const x0 = Math.min(...pts.map(p => p[0])) - 10, y0 = Math.min(...pts.map(p => p[1])) - 10, x1 = Math.max(...pts.map(p => p[0])) + 12, y1 = Math.max(...pts.map(p => p[1])) + 12;
    const w = cv.clientWidth, h = cv.clientHeight, bw = x1 - x0, bh = y1 - y0;
    view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
    view.s = Math.max(0.8, Math.min(40, view.rot ? Math.min(w, h) / ((bw + bh) * SQ) : Math.min(w / bw, h / bh)));
    draw();
  }
  let imgs = null;
  function buildImages() {
    const mk = () => { const c = document.createElement('canvas'); c.width = VW; c.height = VH; return c; };
    const paint = (fn) => { const c = mk(), g = c.getContext('2d'), im = g.createImageData(VW, VH), d = im.data; for (let i = 0; i < VW * VH; i++) { const v = fn(i); if (!v) continue; d.set(v, 4 * i); } g.putImageData(im, 0, 0); return c; };
    const rows = list => { const m = new Uint8Array(VW * VH); for (const [y, a, b] of list) for (let x = a; x <= b; x++) m[(y - VY) * VW + x - VX] = 1; return m; };
    const known = rows(D.known), oth = rows(D.others), kor = rows(D.kor);
    const col = [rgb(C['m-ground']), rgb(C['m-mount']), rgb(C['m-lake']), rgb(C['m-node']), rgb(C['m-struct'])];
    const nodeHi = [230, 160, 20];
    imgs = {
      terr: paint(i => [...col[kind[i]], 255]),
      nodeHi: paint(i => (kind[i] === 3 ? [...nodeHi, 255] : null)),
      unk: paint(i => (known[i] ? null : [...rgb(C['m-void']), 170])),
      oth: paint(i => (oth[i] ? [...rgb(C['c-oth']), 255] : null)),
      kor: paint(i => (kor[i] ? [...rgb(C['c-terr']), 255] : null)),
    };
  }
  let pending = false;
  function draw() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; paintMap(); }); } }
  function paintMap() {
    if (!kind || !PLAN) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    gx.setTransform(dpr, 0, 0, dpr, 0, 0); gx.fillStyle = C['m-void']; gx.fillRect(0, 0, w, h);
    if (!imgs) buildImages();
    const m = mat(w, h), s = view.s;
    gx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
    gx.imageSmoothingEnabled = false;
    // 이미지는 행 0 = Y 작은 쪽 → 아래위 뒤집어 그림(지도 좌표 y는 위로 증가)
    const put = (img, a = 1) => { gx.save(); gx.globalAlpha = a; gx.translate(VX, VY); gx.drawImage(img, 0, 0, VW, VH); gx.restore(); };
    put(imgs.terr); if (view.res) put(imgs.nodeHi);
    if (view.oth) put(imgs.oth, 0.32);
    put(imgs.kor, view.now ? 0.28 : 0.12);
    put(imgs.unk);
    const sq = (x, y, r, col, lw, dash) => { gx.strokeStyle = col; gx.lineWidth = lw / s; gx.setLineDash(dash ? dash.map(v => v / s) : []); gx.strokeRect(x - r, y - r, 1 + 2 * r, 1 + 2 * r); gx.setLineDash([]); };
    const dot = (x, y, col, sz = 1) => { gx.fillStyle = col; gx.fillRect(x + (1 - sz) / 2, y + (1 - sz) / 2, sz, sz); };
    // 평원 쪽 v2 깃발 (위쪽 중 새 경로에 안 쓰는 것은 빨간 점선 = 철거 가능)
    for (const [x, y] of D.v2) dot(x, y, C['c-banner']);
    for (const [x, y] of D.up.unused) { sq(x, y, 3, C.bad, 1.6, [3, 3]); dot(x, y, C.bad); }
    // 지금 깃발(추정)
    if (view.now) for (const [x, y] of D.now) { sq(x, y, 3, C['c-old'], 1.2, [4, 3]); dot(x, y, C['c-old']); }
    // 주변 거점
    if (view.cand) for (const c of D.cands) { sq(c.x + 1, c.y + 1, 7, C['c-cand'], 2, [6, 4]); dot(c.x, c.y, C['c-cand'], 3); if (planKey === 'main' && c.rank) for (const [x, y] of c.flags) sq(x, y, 3, C['c-cand'], 1.2, [2, 2]); }
    if (view.cand) for (const g of ((D.resfill || {}).groups || [])) for (const [x, y] of g.flags) sq(x, y, 3, C.ok, 1, [2, 2]);   // 자원지 보강 깃발(⑥·⑧)
    for (const c of (D.corners || [])) { gx.strokeStyle = C.bad; gx.lineWidth = 2 / s; gx.beginPath(); gx.arc((c.a[0] + c.b[0] + 1) / 2, (c.a[1] + c.b[1] + 1) / 2, 2.6, 0, 2 * Math.PI); gx.stroke(); }   // 꼭짓점으로만 이어지는 자리
    // 점령 거점
    for (const hq of D.held) { sq(hq.x + 1, hq.y + 1, 7, C['c-t2'], 2.4); gx.fillStyle = C['c-t2']; gx.fillRect(hq.x, hq.y, 3, 3); }
    // 본부
    sq(D.hq.plain[0] + 1, D.hq.plain[1] + 1, 7, C['c-hq'], 2); gx.fillStyle = C['c-hq']; gx.fillRect(D.hq.plain[0], D.hq.plain[1], 3, 3);
    sq(D.hq.wild[0] + 1, D.hq.wild[1] + 1, 7, C['c-wild'], 1.6, [5, 4]); gx.fillStyle = C['c-wild']; gx.globalAlpha = 0.5; gx.fillRect(D.hq.wild[0], D.hq.wild[1], 3, 3); gx.globalAlpha = 1;
    if (PLAN.w) { sq(PLAN.w[0] + 1, PLAN.w[1] + 1, 7, C['c-wild'], 3.2); gx.fillStyle = C['c-wild']; gx.fillRect(PLAN.w[0], PLAN.w[1], 3, 3); }
    // 새 경로
    // 11-14: 남은 작업을 테두리 색으로 — 새로 지을 깃발 녹색, 철거할 깃발 주황, 이미 지은 새 경로 깃발은 회색 실선
    if (planKey === 'main' && steps) {
      const tb = new Set(); for (let i = done; i < steps.length; i++) if (steps[i].op === 'build') tb.add(steps[i].x + ',' + steps[i].y);
      const have = [...(D.real || []), ...steps.slice(0, done).filter(st => st.op === 'build').map(st => [st.x, st.y])], isUp = (x, y) => !D.real || have.some(f => Math.abs(f[0] - x) <= 2 && Math.abs(f[1] - y) <= 2);   // 11-14 밤: 순서에서 뺀(보류) 새 경로 깃발은 점선
      for (const [x, y] of PLAN.flags) if (!tb.has(x + ',' + y)) { const up = isUp(x, y); sq(x, y, 3, C['c-old'], up ? 1.6 : 1, up ? null : [2, 3]); if (up) dot(x, y, C['c-old']); }
      for (let i = done; i < steps.length; i++) { const st = steps[i]; if (st.op === 'remove') { sq(st.x, st.y, 3, C['c-new'], 2.2); dot(st.x, st.y, C['c-new']); } }
      for (let i = done; i < steps.length; i++) { const st = steps[i]; if (st.op === 'build') { sq(st.x, st.y, 3, C.ok, 2.2); dot(st.x, st.y, C.ok); } }
    } else for (const [x, y] of PLAN.flags) { sq(x, y, 3, C['c-new'], 2.2); dot(x, y, C['c-new']); }
    if (planKey === 'main' && stepCur) { const p = stepCur, sz = p.op === 'hq' ? 3 : 1; gx.strokeStyle = p.op === 'remove' || p.op === 'sweep' ? C['c-new'] : p.op === 'build' ? C.ok : C['c-wild']; gx.lineWidth = 3 / s; gx.beginPath(); gx.arc(p.x + sz / 2, p.y + sz / 2, sz / 2 + 4, 0, Math.PI * 2); gx.stroke(); }
    if (view.mark) { gx.strokeStyle = C['c-pick']; gx.lineWidth = 3 / s; gx.strokeRect(view.mark.x, view.mark.y, 1, 1); gx.beginPath(); gx.arc(view.mark.x + 0.5, view.mark.y + 0.5, 3, 0, Math.PI * 2); gx.stroke(); }
    // 글자
    gx.setTransform(dpr, 0, 0, dpr, 0, 0); gx.textAlign = 'center'; gx.textBaseline = 'middle';
    const label = (x, y, t, col) => { const p = { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; gx.font = '600 12px "IBM Plex Sans KR", sans-serif'; const tw = gx.measureText(t).width + 8; gx.fillStyle = C.bg; gx.globalAlpha = 0.85; gx.fillRect(p.x - tw / 2, p.y - 9, tw, 18); gx.globalAlpha = 1; gx.fillStyle = col; gx.fillText(t, p.x, p.y); };
    for (const hq of D.held) label(hq.x + 1.5, hq.y + 10, hq.name + ((D.retake || []).some(r => r.x === hq.x && r.y === hq.y) ? ' (되찾기)' : ''), C['c-t2']);
    if (view.cand) for (const c of D.cands) label(c.x + 1.5, c.y + 10, c.name, C['c-cand']);
    label(D.hq.plain[0] + 1.5, D.hq.plain[1] - 8, '평원 본부', C['c-hq']);
    label(D.hq.wild[0] + 1.5, D.hq.wild[1] - 8, '황야 본부(지금)', C['c-wild']);
    if (PLAN.w && (PLAN.w[0] !== D.hq.wild[0] || PLAN.w[1] !== D.hq.wild[1])) label(PLAN.w[0] + 1.5, PLAN.w[1] - 8, '황야 본부(새 자리)', C['c-wild']);
    // 작업 순서 번호(11-14): 남은 단계의 깃발 자리에 번호 — 건설 초록, 철거 주황. 멀리서 보면 다음 30단계만, 가까이 보면 모두.
    if (planKey === 'main' && steps) {
      const all = s >= 3.2, fs = Math.max(9, Math.min(15, s * 2.2));
      gx.font = `700 ${fs}px "IBM Plex Sans KR", sans-serif`; gx.lineJoin = 'round';
      for (let i = steps.length - 1; i >= done; i--) {
        const st = steps[i]; if (st.op !== 'build' && st.op !== 'remove') continue;
        if (!all && i >= done + 30) continue;
        const px = m[0] * (st.x + 0.5) + m[2] * (st.y + 0.5) + m[4], py = m[1] * (st.x + 0.5) + m[3] * (st.y + 0.5) + m[5];
        if (px < -20 || py < -20 || px > w + 20 || py > h + 20) continue;
        gx.lineWidth = 3; gx.strokeStyle = C.bg; gx.strokeText(i + 1, px, py);
        gx.fillStyle = st.op === 'build' ? C.ok : C['c-new']; gx.fillText(i + 1, px, py);
      }
    }
  }
  // 이미지 행 순서: putImageData는 위→아래로 행 0..VH-1 = Y VY..VY+VH-1, 지도 변환이 y를 위로 뒤집으므로 그대로 맞음

  function info(x, y) {
    const parts = [xy(x, y)];
    const inSq = (f, r) => Math.abs(f[0] - x) <= r && Math.abs(f[1] - y) <= r;
    const pf = PLAN.flags.find(f => f[0] === x && f[1] === y); if (pf) parts.push('새 경로 깃발 자리');
    else if (PLAN.flags.some(f => inSq(f, 3))) parts.push('새 경로 영토');
    if (D.cands.some(c => c.flags.some(f => f[0] === x && f[1] === y))) parts.push('주변 거점 연결 깃발 자리'); else if (((D.resfill || {}).groups || []).some(g => g.flags.some(f => f[0] === x && f[1] === y))) parts.push('자원지 보강 깃발 자리');
    if (D.now.some(f => f[0] === x && f[1] === y)) parts.push('지금 깃발(추정)');
    for (const hq of D.held) if (x >= hq.x - 6 && x <= hq.x + 8 && y >= hq.y - 6 && y <= hq.y + 8) parts.push(`${hq.name} 금지 구역`);
    for (const c of D.cands) if (x >= c.x - 6 && x <= c.x + 8 && y >= c.y - 6 && y <= c.y + 8) parts.push(`${c.name} 금지 구역`);
    if (x >= VX && y >= VY && x < VX + VW && y < VY + VH) { const k = kind[(y - VY) * VW + x - VX]; const kn = ['', '산', '호수', '연맹 자원지', '구조물'][k]; if (kn) parts.push(kn); }
    return parts.join(' · ');
  }
  function goTo(x, y) { view.cx = x + 0.5; view.cy = y + 0.5; view.s = Math.max(view.s, 14); view.mark = { x, y }; $('readout').textContent = info(x, y); if (PHONE.matches) cv.scrollIntoView({ block: 'center', behavior: 'smooth' }); draw(); }
  const ptrs = new Map(); let pinch = null, downAt = null;
  cv.addEventListener('pointerdown', e => { try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ } ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); downAt = { x: e.offsetX, y: e.offsetY }; });
  cv.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    const cur = { x: e.offsetX, y: e.offsetY };
    if (downAt && Math.hypot(cur.x - downAt.x, cur.y - downAt.y) > 5) downAt = null;
    if (ptrs.size === 1) { const a = toWorld(prev.x, prev.y), b = toWorld(cur.x, cur.y); view.cx += a.x - b.x; view.cy += a.y - b.y; draw(); }
    else if (ptrs.size === 2) { const pts = [...ptrs.entries()].map(([id, p]) => (id === e.pointerId ? cur : p)), d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); if (pinch) zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, d / pinch); pinch = d; }
    ptrs.set(e.pointerId, cur);
  });
  const up = e => {
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (!ptrs.size && downAt && kind) { const w = toWorld(e.offsetX, e.offsetY), x = Math.floor(w.x), y = Math.floor(w.y); view.mark = { x, y }; $('readout').textContent = info(x, y); draw(); }
    downAt = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  function zoomAt(sx, sy, f) { const a = toWorld(sx, sy); view.s = Math.max(0.8, Math.min(40, view.s * f)); const b = toWorld(sx, sy); view.cx += a.x - b.x; view.cy += a.y - b.y; draw(); }
  const toggle = (id, key, after) => $(id).addEventListener('click', () => { view[key] = !view[key]; $(id).setAttribute('aria-pressed', String(view[key])); after ? after() : draw(); });
  toggle('rot', 'rot', fit); toggle('nowb', 'now'); toggle('othb', 'oth'); toggle('candb', 'cand'); toggle('resb', 'res');
  $('fit').addEventListener('click', fit);
  $('zin').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.35));
  $('zout').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.35));
  window.addEventListener('resize', draw);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); imgs = null; draw(); });
  load();
})();
