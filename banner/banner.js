/* /banner/v1/·/banner/v2/ 공용 — KOR 깃발·영토 지도. 데이터 주소는 <script data-src="…/data.json">.
 * v1/data.json: 2026-10-29 스크린샷을 다시 이어 붙여 읽은 KOR 깃발(flags)·다른 연맹 깃발(others)·본부·확인된 범위(coverage, [y, x0, x1] 줄; 휴대폰 캡처 포함).
 * v2/data.json: 재배치안 — flags[].fixed(곰덫 주변·본부 위쪽 고정)·keep(그대로), remove(철거할 자리), extra(여분 깃발: 점선, 깃발이 더 늘면),
 *   plan(곰덫2 중심 t, 적 최근접 거리 r·방향별 dir, 지금 값 r1·dir1, 여분까지 rx·dirx, 옛 본부 hq1, 지금 깃발 수 nNow),
 *   steps(작업 순서 [{op: build|remove|hq, x, y, phase 1 본부 이전 준비·2 본부 이전·3 나머지, why, n 깃발 수, r 곰덫2 최근접}]; 진행은 이 브라우저 localStorage).
 * 영토: 본부 15×15(KSCore.HQ_COV) + 깃발마다 7×7(BN_COV). 다른 연맹은 본부·깃발 영역에서 KOR 땅을 뺀 칸. 지형은 mapdata.js.
 */
(function () {
  'use strict';
  const SRC = (document.currentScript && document.currentScript.dataset.src) || '/banner/v1/data.json';
  const $ = id => document.getElementById(id);
  const COPY_LABEL = $('copy').textContent;
  const KP = window.KSPlan, K = window.KSCore, G = 1200;
  const cv = $('cv'), gx = cv.getContext('2d'), tip = $('tip');
  const xy = o => `X:${o.x} Y:${o.y}`;
  const PHONE = matchMedia('(max-width: 900px)');
  if (PHONE.matches) for (const id of ['legend', 'othbox', 'chkbox', 'bnbox', 'steplbox']) if ($(id)) $(id).open = false;   // 휴대폰: 긴 목록은 접어 둠
  const factsHome = $('facts').parentNode;
  const placeFacts = () => (PHONE.matches ? $('legend').before($('facts')) : factsHome.append($('facts')));
  PHONE.addEventListener('change', placeFacts); placeFacts();
  const [F0, F1] = K.FERTILE;
  function fail(msg) { const n = $('notice'); n.textContent = msg; n.className = 'notice err'; n.hidden = false; }

  // ---------- 불러오기 ----------
  let D, HQ, traps, flags, others, othHQ, ALLY, CX, CY, CW, CH, kind, cov, korSet, othSet, korOf, removed = [], extras = [], PLAN = null;
  const flagTag = f => (f.ex ? '여분' : !PLAN ? '' : f.fixed ? '고정' : f.keep ? '그대로' : '새로');
  const byNo = no => (no > flags.length ? extras[no - flags.length - 1] : flags[no - 1]);   // 여분 깃발은 번호를 이어서
  // 다른 연맹마다 색: [깃발·본부, 영토] CSS 변수 (모르는 연맹은 SGD 색)
  const ALLY_COL = { SGD: ['c-fflag', 'c-fterr'], EoB: ['c-eflag', 'c-eterr'], TWN: ['c-tflag', 'c-tterr'] };
  const colOf = a => ALLY_COL[a] || ALLY_COL.SGD;
  const inBox = (x, y) => x >= CX && y >= CY && x < CX + CW && y < CY + CH;
  const idx = (x, y) => (y - CY) * CW + x - CX;
  async function load() {
    let map;
    try { const r = await fetch(SRC, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); D = await r.json(); } catch (_) { fail('깃발 데이터(data.json)를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.'); return; }
    try { map = await KP.loadMap(); } catch (_) { fail('지도 데이터를 풀지 못했습니다. 최신 Chrome·Edge·Safari·Firefox에서 열어 주세요.'); return; }
    HQ = D.hq; traps = D.traps || [];
    flags = D.flags.map((f, i) => ({ x: f.x, y: f.y, no: i + 1, fixed: !!f.fixed, keep: !!f.keep }));
    removed = D.remove || []; PLAN = D.plan || null;
    extras = (D.extra || []).map((f, i) => ({ x: f.x, y: f.y, no: flags.length + i + 1, ex: true }));
    others = (D.others || []).map((f, i) => ({ x: f.x, y: f.y, no: i + 1, a: f.a || '다른 연맹', note: f.note || '' }));
    othHQ = (D.otherHQ || []).map(h => ({ x: h.x, y: h.y, a: h.a || '다른 연맹' }));
    ALLY = [...new Set(othHQ.map(h => h.a).concat(others.map(f => f.a)))];
    CX = D.view.x0; CY = D.view.y0; CW = D.view.x1 - CX + 1; CH = D.view.y1 - CY + 1;
    kind = new Uint8Array(CW * CH);
    for (let y = CY; y < CY + CH; y++) for (let x = CX; x < CX + CW; x++) {
      const k = map.kind[y * G + x];
      kind[idx(x, y)] = k === 1 ? 1 : k === 2 ? 2 : k >= 3 && k <= 6 ? 3 : k >= 7 ? 4 : 0;
    }
    cov = new Uint8Array(CW * CH);
    for (const [y, a, b] of D.coverage) for (let x = a; x <= b; x++) if (inBox(x, y)) cov[idx(x, y)] = 1;
    // 칸마다 어느 영역인지: korOf = 덮는 KOR 깃발 번호들(본부는 0)
    korSet = new Uint8Array(CW * CH); othSet = new Uint8Array(CW * CH); korOf = new Map();
    const each = (x0, y0, s, fn) => { for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) if (inBox(x, y)) fn(idx(x, y)); };
    const addKor = (i, n) => { korSet[i] = 1; if (!korOf.has(i)) korOf.set(i, []); korOf.get(i).push(n); };
    each(HQ.x - K.HQ_COV, HQ.y - K.HQ_COV, 3 + 2 * K.HQ_COV, i => addKor(i, 0));
    flags.forEach(f => each(f.x - K.BN_COV, f.y - K.BN_COV, 1 + 2 * K.BN_COV, i => addKor(i, f.no)));
    // othSet: 칸을 차지한 다른 연맹 번호(ALLY 순서 + 1). KOR 땅은 빼고, 본부 영역을 깃발보다 먼저
    const addOth = a => i => { if (!korSet[i] && !othSet[i]) othSet[i] = ALLY.indexOf(a) + 1; };
    othHQ.forEach(h => each(h.x - K.HQ_COV, h.y - K.HQ_COV, 3 + 2 * K.HQ_COV, addOth(h.a)));
    others.forEach(f => each(f.x - K.BN_COV, f.y - K.BN_COV, 1 + 2 * K.BN_COV, addOth(f.a)));
    const chg = D.changes || [];
    $('stamp').textContent = PLAN ? `${D.updated} 깃발 기준 재배치안` : `${D.updated} 스크린샷 기준` + (chg.length ? ` · 이후 변경 ${chg.length}건 반영` : '');
    if (chg.length && $('chgbox')) {
      $('chgsum').textContent = `${chg.length}건`; $('chgbox').hidden = false;
      $('chg').replaceChildren(...chg.map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
    }
    $('src').textContent = D.source;
    $('notice').hidden = true;
    $('main').hidden = false;
    start();
  }

  const kindAt = (x, y) => inBox(x, y) ? kind[idx(x, y)] : 0;
  const inFertile = (x, y) => x >= F0 && x <= F1 && y >= F0 && y <= F1;
  const flagAt = new Map();
  function start() {
    flags.concat(extras).forEach(f => flagAt.set(f.y * G + f.x, f)); others.forEach(f => flagAt.set(f.y * G + f.x, { ...f, oth: true }));
    // ---------- 요약 ----------
    let korTiles = 0; const othTiles = ALLY.map(() => 0);
    for (let i = 0; i < korSet.length; i++) { korTiles += korSet[i]; if (othSet[i]) othTiles[othSet[i] - 1]++; }
    const flagsOf = a => others.filter(f => f.a === a), hqOf = a => othHQ.filter(h => h.a === a);
    $('facts').innerHTML = [
      ...(PLAN ? [['--c-t2', '적 최근접 거리', `${PLAN.r}칸 (지금 ${PLAN.r1})`]] : []),
      ...(PLAN && PLAN.rx ? [['--c-banner', `여분 ${extras.length}개까지`, `${PLAN.rx}칸`]] : []),
      ['--c-banner', 'KOR 깃발', `${flags.length}개`], ['--c-terr', 'KOR 영토', `${korTiles.toLocaleString('ko-KR')}칸`],
      ['--c-hq', '평원 본부', xy(HQ)], ...ALLY.map(a => [`--${colOf(a)[0]}`, `${a} 깃발`, `${flagsOf(a).length}개`]),
    ].map(([c, k, v]) => `<div><dt><i style="background:var(${c})"></i>${k}</dt><dd>${v}</dd></div>`).join('');
    // ---------- 목록 ----------
    $('bnsum').textContent = PLAN ? `${flags.length}개 · 새로 ${flags.filter(f => !f.fixed && !f.keep).length} · 고정 ${flags.filter(f => f.fixed).length}${extras.length ? ` · 여분 ${extras.length}` : ''}` : `${flags.length}개`;
    $('bn').innerHTML = flags.concat(extras).map(f => `<li data-no="${f.no}"><button type="button" class="lnk" data-no="${f.no}">X:${f.x} Y:${f.y}</button>${flagTag(f) && flagTag(f) !== '새로' ? `<span class="tagn">${flagTag(f)}</span>` : ''}</li>`).join('');
    if ($('rm')) {
      $('rmsum').textContent = `${removed.length}개`;
      $('rm').innerHTML = removed.map(f => `<li><button type="button" class="lnk" data-x="${f.x}" data-y="${f.y}">X:${f.x} Y:${f.y}</button></li>`).join('');
    }
    $('othsum').textContent = ALLY.join(' · ');
    const item = (o, a, tag) => `<li><button type="button" class="lnk" style="color:var(--${colOf(a)[0]})" data-x="${o.x}" data-y="${o.y}">X:${o.x} Y:${o.y}</button>${tag ? `<span class="tagn">${tag}</span>` : ''}</li>`;
    $('oth').innerHTML = ALLY.map((a, j) => `<li class="grp">${a} · 깃발 ${flagsOf(a).length}개 · 영토 ${othTiles[j]}칸</li>` +
      hqOf(a).map(h => item(h, a, '평원 본부')).join('') + flagsOf(a).map(f => item(f, a, f.note)).join('')).join('');
    const ck = D.check || {};
    if (PLAN) {
      const DIRS = ['북', '동', '남', '서'];
      $('check').innerHTML = [
        PLAN.nUp ? `곰덫 주변 깃발 ${PLAN.nTrap}개(v2 배치도 계획분)와 본부 위쪽 깃발 ${PLAN.nUp}개(거점과 이어짐)는 고정, 나머지 ${flags.filter(f => !f.fixed).length}개를 옮기거나 새로 세웠습니다. ` +
          (PLAN.nNow && flags.length > PLAN.nNow ? `깃발 수는 지금 ${PLAN.nNow}개에 남은 건설 가능 ${flags.length - PLAN.nNow}개를 더한 ${flags.length}개입니다.` : `깃발 수는 ${flags.length}개 그대로입니다.`)
          : `곰덫 주변 깃발 ${flags.filter(f => f.fixed).length}개(v2 배치도 계획분)는 고정, 나머지를 옮겼습니다. 깃발 수는 ${flags.length}개 그대로입니다.`,
        ...(PLAN.overlap != null ? [`옮긴 깃발끼리 영역이 겹치는 칸은 ${PLAN.overlap}칸입니다. 줄마다 엇갈리게(벽돌 모양) 폭 1칸 틈을 두고 놓아 깃발 하나가 막는 땅을 늘렸습니다.`] : []),
        `곰덫2에서 적이 도시를 옮길 수 있는 가장 가까운 2×2 빈자리: 지금 ${PLAN.r1}칸 → 재배치 ${PLAN.r}칸.`,
        '방향별(화면 기준): ' + DIRS.map(k => `${k} ${PLAN.dir1[k].d}→${PLAN.dir[k].d}칸`).join(' · '),
        ...(extras.length && PLAN.rx ? [`여분 깃발 ${extras.length}개(점선)는 깃발이 더 늘면 세울 곳입니다. 모두 세우면 가장 가까운 적 자리가 ${PLAN.r}칸 → ${PLAN.rx}칸(` + DIRS.map(k => `${k} ${PLAN.dirx[k].d}`).join(' · ') + ')이 됩니다. 이 계획의 깃발은 그대로 두고 더하는 자리입니다.'] : []),
        `모든 깃발이 본부와 이어지고(꼭짓점만 닿아도 연결${PLAN.nUp ? ', 본부 위쪽 깃발은 거점으로 이어짐' : ''}), 영토 안에 도시를 옮길 수 있는 2×2 구멍이 없습니다. 폭 1칸 틈은 도시가 못 들어가서 남겨 두었습니다.`,
        `평원 본부는 ${xy(HQ)}로 이전한 것으로 계산했습니다(지금 ${xy(PLAN.hq1)}).`,
        'SGD 영토는 우호 연맹으로 보고 적이 쓸 수 없는 곳으로, EoB·TWN 영토는 적이 쓸 수 있는 곳으로 계산했습니다. 연맹원 도시·곰덫·연맹 건물은 v2 배치도 위치 기준입니다.',
      ].map(s => `<li>${s}</li>`).join('');
    } else $('check').innerHTML = [
      '스크린샷끼리 겹치는 부분, 자원지 왕관 배지, 호수 모양을 지형 데이터(mapdata.js)와 맞춰 스크린샷 22장의 위치를 정했습니다.',
      '평원 본부 좌표 팝업(X:523 Y:759)과 지도 위 KOR 본부 아이콘 자리가 맞습니다.',
      `깃발마다 7×7로 그린 영토 경계가 스크린샷의 파란 경계선과 ${Math.round((ck.line_match || 0) * 100)}% 겹칩니다(나머지는 파란 레벨 배지 같은 아이콘).`,
      `v2 배치도에 기록된 깃발 19개 중 ${ck.v2_flags_matched || 0}개가 같은 자리에 있습니다. 단 v2.json의 깃발 좌표는 실제보다 X·Y가 ${ck.v2_offset || 3}칸씩 작게 저장돼 있습니다(본부는 6칸).`,
      '좌표 팝업 2장, 위치를 확정하지 못한 2장(깃발 없음)은 지도에서 뺐습니다.',
    ].map(s => `<li>${s}</li>`).join('');
    if (D.steps && D.steps.length && $('stepbox')) setupSteps(D.steps);
    readColors();
    const u = new URLSearchParams(location.search), fno = +u.get('f'), at = /^(\d+),(\d+)$/.exec(u.get('at') || '');
    if (fno && byNo(fno)) pick(byNo(fno), true);
    else if (at) { fit(); goTo(+at[1], +at[2]); }
    else fit();
  }

  // ---------- 색 ----------
  let C = {};
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['m-void', 'm-ground', 'm-fertile', 'm-mount', 'm-lake', 'm-node', 'm-struct', 'm-grid', 'm-edge', 'c-hq', 'c-t2', 'c-banner', 'c-terr', 'c-pick', 'on-obj', 'c-fflag', 'c-fterr', 'c-eflag', 'c-eterr', 'c-tflag', 'c-tterr', 'c-fixed'])
      C[k] = cs.getPropertyValue('--' + k).trim();
    if (!C['c-fixed']) C['c-fixed'] = C['c-banner'];
  };
  const rgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const n = m ? parseInt(m[1], 16) : 0x808080; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  let terrImg = null, unkImg = null, korImg = null, korEdge = null, othImgs = [];
  function buildImages() {
    const mk = () => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; return c; };
    const paintMask = (test, col, alpha) => {
      const c = mk(), g = c.getContext('2d'), im = g.createImageData(CW, CH), d = im.data;
      for (let i = 0; i < CW * CH; i++) { const v = test(i); if (!v) continue; const c3 = v === true ? col : v; d[4 * i] = c3[0]; d[4 * i + 1] = c3[1]; d[4 * i + 2] = c3[2]; d[4 * i + 3] = alpha; }
      g.putImageData(im, 0, 0); return c;
    };
    const col = [rgb(C['m-ground']), rgb(C['m-mount']), rgb(C['m-lake']), rgb(C['m-node']), rgb(C['m-struct'])], fe = rgb(C['m-fertile']);
    terrImg = paintMask(i => { const k = kind[i]; return k ? col[k] : inFertile(CX + i % CW, CY + Math.floor(i / CW)) ? fe : col[0]; }, null, 255);
    unkImg = paintMask(i => !cov[i], rgb(C['m-void']), 175);
    const edgesOf = set => {
      const p = new Path2D(), on = (x, y) => x >= 0 && y >= 0 && x < CW && y < CH && set[y * CW + x];
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
        if (!set[y * CW + x]) continue;
        const wx = CX + x, wy = CY + y;
        if (!on(x - 1, y)) { p.moveTo(wx, wy); p.lineTo(wx, wy + 1); }
        if (!on(x + 1, y)) { p.moveTo(wx + 1, wy); p.lineTo(wx + 1, wy + 1); }
        if (!on(x, y - 1)) { p.moveTo(wx, wy); p.lineTo(wx + 1, wy); }
        if (!on(x, y + 1)) { p.moveTo(wx, wy + 1); p.lineTo(wx + 1, wy + 1); }
      }
      return p;
    };
    korImg = paintMask(i => korSet[i] === 1, rgb(C['c-terr']), 255); korEdge = edgesOf(korSet);
    othImgs = ALLY.map((a, j) => ({ a, img: paintMask(i => othSet[i] === j + 1, rgb(C[colOf(a)[1]]), 255), edge: edgesOf(othSet.map(v => (v === j + 1 ? 1 : 0))) }));
  }

  // ---------- 보기 ----------
  const view = { cx: 0, cy: 0, s: 8, rot: true, names: true, each: true, oth: true, rm: true, sel: null, mark: null, cur: null, step: null };
  const SQ = Math.SQRT1_2;
  function mat(w, h) {
    const s = view.s, cx = view.cx, cy = view.cy;
    if (!view.rot) return [s, 0, 0, -s, w / 2 - cx * s, h / 2 + cy * s];
    const k = s * SQ; return [k, -k, -k, -k, w / 2 - k * (cx - cy), h / 2 + k * (cx + cy)];
  }
  const toScreen = (x, y) => { const m = mat(cv.clientWidth, cv.clientHeight); return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; };
  function toWorld(sx, sy) {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!view.rot) return { x: view.cx + (sx - w / 2) / view.s, y: view.cy - (sy - h / 2) / view.s };
    const k = view.s * SQ, p = (sx - w / 2) / k, q = -(sy - h / 2) / k;
    return { x: view.cx + (p + q) / 2, y: view.cy + (q - p) / 2 };
  }
  function fit() {
    const pts = flags.concat(extras, others, othHQ, [HQ]).map(f => [f.x, f.y]);
    const x0 = Math.min(...pts.map(p => p[0])) - 4, y0 = Math.min(...pts.map(p => p[1])) - 4;
    const x1 = Math.max(...pts.map(p => p[0])) + 5, y1 = Math.max(...pts.map(p => p[1])) + 5;
    const w = cv.clientWidth, h = cv.clientHeight, bw = x1 - x0, bh = y1 - y0;
    view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
    view.s = Math.max(2, Math.min(60, view.rot ? Math.min(w, h) / ((bw + bh) * SQ) : Math.min(w / bw, h / bh)));
    draw();
  }

  let pending = false;
  function draw() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; paint(); }); } }
  function paint() {
    if (!kind) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    gx.setTransform(dpr, 0, 0, dpr, 0, 0); gx.fillStyle = C['m-void']; gx.fillRect(0, 0, w, h);
    if (!terrImg) buildImages();
    const m = mat(w, h), s = view.s;
    gx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
    gx.imageSmoothingEnabled = false;
    gx.drawImage(terrImg, CX, CY, CW, CH);
    gx.drawImage(unkImg, CX, CY, CW, CH);
    const fillA = 0.24;
    gx.globalAlpha = fillA; gx.drawImage(korImg, CX, CY, CW, CH); gx.globalAlpha = 1;
    if (view.oth) for (const o of othImgs) {
      gx.globalAlpha = fillA; gx.drawImage(o.img, CX, CY, CW, CH); gx.globalAlpha = 1;
      gx.strokeStyle = C[colOf(o.a)[1]]; gx.lineWidth = 2 / s; gx.setLineDash([5 / s, 3 / s]); gx.stroke(o.edge); gx.setLineDash([]);
    }
    if (s >= 7) {
      gx.beginPath();
      for (let x = CX; x <= CX + CW; x++) { gx.moveTo(x, CY); gx.lineTo(x, CY + CH); }
      for (let y = CY; y <= CY + CH; y++) { gx.moveTo(CX, y); gx.lineTo(CX + CW, y); }
      gx.strokeStyle = C['m-grid']; gx.lineWidth = 1 / s; gx.stroke();
    }
    if (view.each) { // 깃발 하나하나의 영역 7×7
      gx.strokeStyle = C['c-terr']; gx.globalAlpha = 0.55; gx.lineWidth = 1 / s;
      const r = K.BN_COV; flags.forEach(f => gx.strokeRect(f.x - r, f.y - r, 1 + 2 * r, 1 + 2 * r)); gx.globalAlpha = 1;
    }
    gx.strokeStyle = C['c-terr']; gx.lineWidth = 2.2 / s; gx.stroke(korEdge);
    if (PLAN) { // 재배치안: 곰덫2 중심 안전 반경, 방향별 가장 가까운 적 도시 자리(2×2), 옛 본부 자리
      const [tx, ty] = PLAN.t;
      gx.strokeStyle = C['c-t2']; gx.lineWidth = 2 / s; gx.setLineDash([6 / s, 4 / s]);
      gx.beginPath(); gx.arc(tx, ty, PLAN.r, 0, Math.PI * 2); gx.stroke(); gx.setLineDash([]);
      for (const k in PLAN.dir) { const p = PLAN.dir[k]; gx.lineWidth = 3 / s; gx.strokeRect(p.x, p.y, 2, 2); }
      if (PLAN.rx) { gx.globalAlpha = 0.5; gx.lineWidth = 1.4 / s; gx.setLineDash([2 / s, 4 / s]); gx.beginPath(); gx.arc(tx, ty, PLAN.rx, 0, Math.PI * 2); gx.stroke(); gx.setLineDash([]); gx.globalAlpha = 1; }
      if (PLAN.hq1) { gx.strokeStyle = C['c-hq']; gx.lineWidth = 1.6 / s; gx.setLineDash([3 / s, 2 / s]); gx.strokeRect(PLAN.hq1.x, PLAN.hq1.y, 3, 3); gx.setLineDash([]); }
    }
    if (view.rm && removed.length) { // 철거할 깃발 자리
      gx.strokeStyle = C['m-edge']; gx.globalAlpha = 0.6; gx.lineWidth = 1.4 / s; gx.setLineDash([2 / s, 1.5 / s]);
      removed.forEach(f => gx.strokeRect(f.x + 0.12, f.y + 0.12, 0.76, 0.76)); gx.setLineDash([]); gx.globalAlpha = 1;
    }
    const box = (o, sz, fill, inset) => { gx.fillStyle = fill; gx.fillRect(o.x + inset, o.y + inset, sz - 2 * inset, sz - 2 * inset); };
    traps.forEach(t => { gx.strokeStyle = C['c-t2']; gx.lineWidth = 2 / s; gx.strokeRect(t.x + 0.1, t.y + 0.1, 2.8, 2.8); });
    box(HQ, 3, C['c-hq'], 0.05);
    flags.forEach(f => box(f, 1, f.fixed ? C['c-fixed'] : C['c-banner'], 0.04));
    if (extras.length) { // 여분 깃발: 깃발 칸과 영역(7×7)을 점선으로
      const r = K.BN_COV; gx.strokeStyle = C['c-banner']; gx.setLineDash([3 / s, 2 / s]);
      gx.lineWidth = 1.8 / s; extras.forEach(f => gx.strokeRect(f.x - r, f.y - r, 1 + 2 * r, 1 + 2 * r));
      gx.lineWidth = 2.2 / s; extras.forEach(f => gx.strokeRect(f.x + 0.1, f.y + 0.1, 0.8, 0.8)); gx.setLineDash([]);
    }
    if (view.oth) { others.forEach(f => box(f, 1, C[colOf(f.a)[0]], 0.04)); othHQ.forEach(h => box(h, 3, C[colOf(h.a)[0]], 0.05)); }
    if (view.sel) { const f = view.sel, r = K.BN_COV; gx.strokeStyle = C['c-pick']; gx.lineWidth = 3.5 / s; gx.strokeRect(f.x - r, f.y - r, 1 + 2 * r, 1 + 2 * r); gx.strokeRect(f.x - 0.25, f.y - 0.25, 1.5, 1.5); }
    if (view.mark) { const p = view.mark; gx.strokeStyle = C['c-pick']; gx.lineWidth = 3.5 / s; gx.beginPath(); gx.arc(p.x + 0.5, p.y + 0.5, 1.6, 0, Math.PI * 2); gx.stroke(); gx.strokeRect(p.x, p.y, 1, 1); }
    if (view.step) { const p = view.step, sz = p.op === 'hq' ? 3 : 1; gx.strokeStyle = C['c-t2']; gx.lineWidth = 3 / s; gx.beginPath(); gx.arc(p.x + sz / 2, p.y + sz / 2, sz / 2 + 1.8, 0, Math.PI * 2); gx.stroke(); }
    if (view.cur) { gx.strokeStyle = C['m-edge']; gx.lineWidth = 2 / s; gx.strokeRect(view.cur.x, view.cur.y, 1, 1); }
    // 글자
    gx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gx.textAlign = 'center'; gx.textBaseline = 'middle';
    const label = (o, sz, text, px, color, halo) => {
      const p = toScreen(o.x + sz / 2, o.y + sz / 2);
      if (p.x < -40 || p.y < -20 || p.x > w + 40 || p.y > h + 20) return;
      gx.font = `600 ${px}px "IBM Plex Sans KR", "Malgun Gothic", sans-serif`;
      if (halo) { gx.lineWidth = 3; gx.strokeStyle = halo; gx.strokeText(text, p.x, p.y + 0.5); }
      gx.fillStyle = color; gx.fillText(text, p.x, p.y + 0.5);
    };
    if (view.names && s >= 9) flags.forEach(f => label(f, 1, String(f.no), Math.min(12, Math.max(8, s * 0.55)), C['on-obj']));
    if (view.names && s >= 9) extras.forEach(f => label(f, 1, String(f.no), Math.min(12, Math.max(8, s * 0.55)), C['c-banner'], C['m-ground']));
    const big = Math.min(15, Math.max(10, s * 0.75));
    label(HQ, 3, '본부', big, C['on-obj']);
    if (view.oth) othHQ.forEach(h => label(h, 3, h.a, big * 0.9, C['on-obj']));
    if (s >= 6) traps.forEach(t => label(t, 3, t.n.replace('곰덫', '덫'), big * 0.85, C['c-t2'], C['m-ground']));
    if (PLAN && s >= 5) for (const k in PLAN.dir) { const p = PLAN.dir[k]; label(p, 2, `${k} ${p.d}`, big * 0.8, C['c-t2'], C['m-ground']); }
    if (PLAN && PLAN.hq1 && s >= 6) label(PLAN.hq1, 3, '옛 본부', big * 0.75, C['c-hq'], C['m-ground']);
  }

  // ---------- 선택 ----------
  function setURL(k, v) {
    const u = new URL(location.href);
    for (const p of ['at', 'f']) u.searchParams.delete(p);
    if (k) u.searchParams.set(k, v);
    history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : ''));
  }
  function listOn(no) {
    document.querySelectorAll('#bn li.on').forEach(li => li.classList.remove('on'));
    const li = no && document.querySelector(`#bn li[data-no="${no}"]`);
    if (li) li.classList.add('on');
  }
  function pick(f, center) {
    view.sel = f; view.mark = null; listOn(f.no); setURL('f', f.no);
    $('readout').textContent = `KOR 깃발 ${f.no}번${flagTag(f) ? ` (${flagTag(f)})` : ''} · ${xy(f)} · 영역 X ${f.x - K.BN_COV}~${f.x + K.BN_COV}, Y ${f.y - K.BN_COV}~${f.y + K.BN_COV}`;
    if (center) { view.cx = f.x + 0.5; view.cy = f.y + 0.5; view.s = Math.max(view.s, 18); if (PHONE.matches) cv.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    draw();
  }
  function goTo(x, y) {
    view.cx = x + 0.5; view.cy = y + 0.5; view.s = Math.max(view.s, 18);
    markAt(x, y);
    if (PHONE.matches) cv.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function markAt(x, y) {
    view.sel = null; view.mark = { x, y }; listOn(null); setURL('at', `${x},${y}`);
    $('readout').textContent = infoAt(x, y).line; draw();
  }
  function infoAt(x, y) {
    const f = flagAt.get(y * G + x), parts = [];
    if (f) parts.push(f.oth ? `${f.a} 깃발${f.note ? ` (${f.note})` : ''}` : `KOR 깃발 ${f.no}번${flagTag(f) ? ` (${flagTag(f)})` : ''}`);
    if (removed.some(r => r.x === x && r.y === y)) parts.push('철거할 깃발 자리');
    const ex = extras.filter(e => e !== f && Math.abs(e.x - x) <= K.BN_COV && Math.abs(e.y - y) <= K.BN_COV);
    if (ex.length) parts.push(`여분 깃발 ${ex.map(e => e.no).join('·')}번 영역(점선)`);
    if (x >= HQ.x && x < HQ.x + 3 && y >= HQ.y && y < HQ.y + 3) parts.push('KOR 평원 본부');
    if (PLAN && PLAN.hq1 && x >= PLAN.hq1.x && x < PLAN.hq1.x + 3 && y >= PLAN.hq1.y && y < PLAN.hq1.y + 3) parts.push('옛 본부 자리');
    for (const h of othHQ) if (x >= h.x && x < h.x + 3 && y >= h.y && y < h.y + 3) parts.push(`${h.a} 평원 본부`);
    for (const t of traps) if (x >= t.x && x < t.x + 3 && y >= t.y && y < t.y + 3) parts.push(t.n);
    if (inBox(x, y)) {
      const i = idx(x, y), ns = korOf.get(i);
      if (ns) { const fl = ns.filter(n => n > 0); parts.push('KOR 영토' + (fl.length ? ` · 깃발 ${fl.join('·')}번 영역` : '') + (ns.includes(0) ? ' · 본부 영역' : '')); }
      else if (othSet[i]) parts.push(`${ALLY[othSet[i] - 1]} 영토`);
      const kn = ['', '산', '호수', '자원지', '구조물'][kind[i]]; if (kn) parts.push(kn);
      if (!cov[i]) parts.push('스크린샷 밖');
    }
    if (PLAN) parts.push(`곰덫2에서 ${Math.hypot(x + 0.5 - PLAN.t[0], y + 0.5 - PLAN.t[1]).toFixed(1)}칸`);
    const text = parts.join(' · ') || (inFertile(x, y) ? '옥토' : '빈 땅');
    return { text, line: `칸 X:${x} Y:${y} · ${text}`, flag: f };
  }
  $('bn').addEventListener('click', e => { const b = e.target.closest('button[data-no]'); if (b) pick(byNo(+b.dataset.no), true); });
  $('oth').addEventListener('click', e => { const b = e.target.closest('button[data-x]'); if (b) goTo(+b.dataset.x, +b.dataset.y); });
  if ($('rm')) $('rm').addEventListener('click', e => { const b = e.target.closest('button[data-x]'); if (b) goTo(+b.dataset.x, +b.dataset.y); });

  // ---------- 지도 조작 ----------
  const ptrs = new Map(); let pinch = null, downAt = null;
  cv.addEventListener('pointerdown', e => { try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); downAt = { x: e.offsetX, y: e.offsetY }; cv.classList.add('drag'); });
  cv.addEventListener('pointermove', e => {
    if (!kind) return;
    const prev = ptrs.get(e.pointerId);
    if (prev) {
      const cur = { x: e.offsetX, y: e.offsetY };
      if (downAt && Math.hypot(cur.x - downAt.x, cur.y - downAt.y) > 5) { downAt = null; tip.hidden = true; }
      if (ptrs.size === 1) { const a = toWorld(prev.x, prev.y), b = toWorld(cur.x, cur.y); view.cx += a.x - b.x; view.cy += a.y - b.y; draw(); }
      else if (ptrs.size === 2) {
        const pts = [...ptrs.entries()].map(([id, p]) => id === e.pointerId ? cur : p), d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinch) zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, d / pinch); pinch = d;
      }
      ptrs.set(e.pointerId, cur); return;
    }
    hover(e.offsetX, e.offsetY);
  });
  const up = e => {
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (!ptrs.size) {
      cv.classList.remove('drag');
      if (downAt && kind) {
        const w = toWorld(e.offsetX, e.offsetY), x = Math.floor(w.x), y = Math.floor(w.y), f = flagAt.get(y * G + x);
        hover(e.offsetX, e.offsetY);
        if (e.pointerType !== 'mouse') tip.hidden = true;
        if (f && !f.oth) pick(f, false); else markAt(x, y);
      }
    }
    downAt = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !ptrs.size) { tip.hidden = true; view.cur = null; draw(); } });
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  function zoomAt(sx, sy, f) { const a = toWorld(sx, sy); view.s = Math.max(2, Math.min(60, view.s * f)); const b = toWorld(sx, sy); view.cx += a.x - b.x; view.cy += a.y - b.y; draw(); }
  function hover(sx, sy) {
    const wp = toWorld(sx, sy), x = Math.floor(wp.x), y = Math.floor(wp.y), info = infoAt(x, y);
    const b = document.createElement('b'); b.textContent = `X:${x}  Y:${y}`;
    tip.replaceChildren(b, document.createTextNode(info.text));
    tip.hidden = false;
    const W = cv.clientWidth, H = cv.clientHeight, tw = tip.offsetWidth, th = tip.offsetHeight;
    let lx = sx + 16, ly = sy + 18; if (lx + tw > W - 6) lx = sx - tw - 12; if (ly + th > H - 6) ly = sy - th - 12;
    tip.style.transform = `translate(${Math.max(6, lx)}px, ${Math.max(6, ly)}px)`;
    if (!view.cur || view.cur.x !== x || view.cur.y !== y) { view.cur = { x, y }; draw(); }
  }
  const toggle = (id, key, after) => $(id).addEventListener('click', () => { view[key] = !view[key]; $(id).setAttribute('aria-pressed', String(view[key])); after ? after() : draw(); });
  toggle('rot', 'rot', fit); toggle('lbl', 'names'); toggle('each', 'each'); toggle('othb', 'oth'); if ($('rmb')) toggle('rmb', 'rm');
  $('fit').addEventListener('click', fit);
  $('zin').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.35));
  $('zout').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.35));

  // ---------- 작업 순서 (v2): 지금 작업 · 좌표 복사 · 작업완료(다음 좌표 복사) · 완료 취소 ----------
  function setupSteps(steps) {
    const OP = { build: '깃발 건설', remove: '깃발 철거', hq: '평원 본부 이전' };
    const PHASE = { 1: '① 본부 이전 준비 (먼저)', 2: '② 평원 본부 이전', 3: '③ 나머지 깃발 재배치' };
    const KEY = 'banner-v2-steps';
    let h = 5381; for (const st of steps) for (const c of `${st.op}${st.x},${st.y};`) h = (h * 33 + c.charCodeAt(0)) | 0;
    const sig = String(h >>> 0);   // 순서가 바뀌면 진행 기록을 새로
    let done = 0;
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && v.sig === sig) done = Math.min(steps.length, Math.max(0, v.done | 0)); } catch (_) { /* 저장소 못 씀 */ }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ sig, done })); } catch (_) { /* 저장소 못 씀 */ } };
    const where = st => (st.op === 'hq' ? `X:${st.from[0]} Y:${st.from[1]} → X:${st.x} Y:${st.y}` : `X:${st.x} Y:${st.y}`);
    let msgT = 0;
    const msg = t => { $('stepmsg').textContent = t; if ($('sbn')) { $('sbn').textContent = t; clearTimeout(msgT); msgT = setTimeout(render, 2500); } };
    const copyXY = (st, pre) => {
      const text = `X:${st.x} Y:${st.y}`;
      const fallback = () => { const t = $('copytext'); t.value = text; t.hidden = false; t.select(); msg(`복사 안 됨 · 맨 아래 칸에서 ${text} 복사`); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => msg(`${pre}${text} 복사됨`), fallback);
      else fallback();
    };
    let ph = 0;
    $('stepl').innerHTML = steps.map((st, i) => {
      const head = st.phase !== ph ? `<li class="grp">${PHASE[(ph = st.phase)]}</li>` : '';
      return `${head}<li value="${i + 1}" data-k="${i}"><button type="button" class="lnk" data-k="${i}">${OP[st.op]} ${where(st)}</button></li>`;
    }).join('');
    let shown = null;   // '지도에서 보기'로 찍은 자리: 다른 작업으로 넘어가면 지움
    function render() {
      const st = steps[done];
      if (shown && shown !== st && view.mark && view.mark.x === shown.x && view.mark.y === shown.y) { view.mark = null; $('readout').textContent = ''; shown = null; }
      $('stepsum').textContent = `${done}/${steps.length} 완료`;
      $('stepph').textContent = st ? `${done + 1}/${steps.length} · ${PHASE[st.phase]}` : '모든 작업을 마쳤습니다';
      $('stepop').textContent = st ? OP[st.op] : '';
      $('stepxy').textContent = st ? where(st) : '';
      for (const id of ['stepcopy', 'stepdone', 'stepmap', 'sbcopy', 'sbdone']) if ($(id)) $(id).disabled = !st;
      if ($('sbn')) { $('sbn').textContent = st ? `${done + 1}/${steps.length} · ${OP[st.op]}` : '모든 작업을 마쳤습니다'; $('sbxy').textContent = st ? `X:${st.x} Y:${st.y}` : ''; }
      $('stepundo').disabled = !done;
      document.querySelectorAll('#stepl li[data-k]').forEach(li => { const k = +li.dataset.k; li.classList.toggle('done', k < done); li.classList.toggle('cur', k === done); });
      const cur = document.querySelector('#stepl li.cur'), box = $('stepl');
      if (cur) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 3);
      view.step = st || null; draw();
    }
    const doCopy = () => { if (steps[done]) copyXY(steps[done], ''); };
    let lastDone = 0;
    const doDone = () => {   // 다음 작업 좌표를 바로 복사 (지도는 움직이지 않음). 두 번 눌림 방지 0.6초
      if (done >= steps.length || Date.now() - lastDone < 600) return;
      lastDone = Date.now(); done++; save(); render();
      if (steps[done]) copyXY(steps[done], `${done}번 완료 · `); else msg('모든 작업을 마쳤습니다');
    };
    $('stepcopy').addEventListener('click', doCopy); $('stepdone').addEventListener('click', doDone);
    if ($('stepbar')) {   // 휴대폰: 작업 카드가 화면 밖이면 아래 고정 바
      $('sbcopy').addEventListener('click', doCopy); $('sbdone').addEventListener('click', doDone);
      // 작업완료 버튼이 다 보이지 않으면(아래 바 자리 80px는 가린 것으로 침) 바를 띄움
      if ('IntersectionObserver' in window) new IntersectionObserver(es => { const e = es[es.length - 1]; document.body.classList.toggle('stepoff', !(e.isIntersecting && e.intersectionRatio > 0.99)); },
        { threshold: [0, 1], rootMargin: '0px 0px -80px 0px' }).observe($('stepdone'));
    }
    $('stepundo').addEventListener('click', () => { if (!done) return; done--; save(); render(); msg(`${done + 1}번 완료 취소`); });
    $('stepmap').addEventListener('click', () => { const st = steps[done]; if (st) { goTo(st.x, st.y); shown = st; } });
    $('stepl').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) { const st = steps[+b.dataset.k]; goTo(st.x, st.y); } });
    $('stepbox').hidden = false;
    render();
  }

  // ---------- 복사 ----------
  function copyText() {
    const chg = D.changes || [];
    const rows = (list, num) => { const out = []; for (let i = 0; i < list.length; i += 5) out.push(list.slice(i, i + 5).map(f => `${num ? `${f.no}) ` : ''}${f.x},${f.y}`).join('  ')); return out; };
    let L;
    if (PLAN) {
      const add = flags.filter(f => !f.fixed && !f.keep);
      L = [`[KOR 깃발 재배치안] 서버 2382 · 곰덫2에서 적 최근접 ${PLAN.r1}칸 → ${PLAN.r}칸`, `평원 본부 이전 ${PLAN.hq1.x},${PLAN.hq1.y} → ${HQ.x},${HQ.y}`,
        `새로 세울 곳 ${add.length}개:`, ...rows(add, false), `철거할 곳 ${removed.length}개:`, ...rows(removed, false),
        ...(extras.length ? [`여분 깃발 ${extras.length}개(깃발이 더 늘면, ${PLAN.r}칸 → ${PLAN.rx}칸):`, ...rows(extras, false)] : [])];
    } else {
      L = [`[KOR 깃발 좌표] 서버 2382 · ${D.updated} 스크린샷 기준${chg.length ? '(이후 변경 반영)' : ''} · ${flags.length}개`, `평원 본부 ${HQ.x},${HQ.y}`, ...rows(flags, true)];
    }
    L.push(`지도: ${location.origin}${location.pathname}`);
    return L.join('\n');
  }
  $('copy').addEventListener('click', () => {
    const text = copyText();
    const fallback = () => { const t = $('copytext'); t.value = text; t.hidden = false; t.focus(); t.select(); $('copy').textContent = '아래 텍스트를 선택해 복사하세요'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => { $('copy').textContent = '복사했습니다'; setTimeout(() => { $('copy').textContent = COPY_LABEL; }, 1800); }, fallback);
    else fallback();
  });

  const themeChanged = () => { readColors(); terrImg = null; draw(); };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
  new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  new ResizeObserver(() => draw()).observe(cv);
  load();
})();
