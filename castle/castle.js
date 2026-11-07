/* /castle(배치도 1) · /castle2(배치도 2) 킹스 캐슬 둘레 도시 배치도. 두 주소는 같은 페이지이고 배치 데이터만 따로 저장함.
 * /castle/map?p=1|2 = 공유용 지도 한 장 (같은 페이지를 지도만 화면 가득, 보기 전용) — /castle/kor가 두 장을 나란히 띄움.
 * 지도: 캐슬 배치 플래너 스크린샷(2026-11-07)의 격자를 그대로 그림. 격자 한 칸 = 도시 하나, 캐슬 = 한 변 6칸 마름모, 둘레 6열까지.
 *   칸 (i, j): 캐슬은 i, j = 0~5. i가 작을수록 북서쪽, 클수록 남동쪽 · j가 작을수록 북동쪽, 클수록 남서쪽. 열 = 캐슬에서 몇 번째 둘레인지(1~6).
 *   그림 좌표: x = (i - j)·A, y = (i + j - 5)·A (원점 = 캐슬 가운데, A = 칸 반너비). 처음에는 3열까지 보이게 확대해 둠.
 * 데이터: /api/castle/layout · /api/castle2/layout (첫 게시 전에는 layouts/castle.json · castle2.json)
 *   { memo?, members: [{ n: 닉네임, i?, j?: 칸 (없으면 미배치), ext?: 다른 연맹 }] }
 * 편집: 캐슬 편집 계정(castle/admin.txt, 서버 비밀값 CASTLE_HASH) 또는 기존 관리자 계정으로 로그인 → 끌어 놓을 때마다 바로 저장(PUT /api/castle/layout · /api/castle2/layout). 저장 직전에 서버 최신본을 받아 그 위에 같은 수정을 다시 적용함.
 * 주소: ?q=닉네임 ?edit */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const low = s => clean(s).toLowerCase();
  const r1 = v => Math.round(v * 10) / 10;
  const PHONE = matchMedia('(max-width: 900px)');
  // /castle = 배치도 1, /castle2 = 배치도 2 (같은 페이지·같은 계정, 배치만 따로 저장 — 빌드가 castle/index.html을 castle2/index.html로 복사)
  // /castle/map?p=1|2 = 공유용 지도 한 장: 지도와 확대·축소만 화면 가득, 보기 전용 (빌드가 castle/map.html로 복사).
  //   다른 사람에게 보내는 /castle/kor(castle/kor.html)가 이것을 배치도 1·2 두 장으로 나란히 띄움
  const SHARE = /^\/castle\/map(\.html)?\/?$/.test(location.pathname);
  const SLOT = (SHARE ? new URLSearchParams(location.search).get('p') === '2' : /^\/castle2(\/|$)/.test(location.pathname)) ? 'castle2' : 'castle', NO = SLOT === 'castle2' ? 2 : 1;
  const API = `/api/${SLOT}/layout`, FILE = `/layouts/${SLOT}.json`, HOME = `/${SLOT}/`;
  document.title = `캐슬 도시 배치도 ${NO}`;
  for (const a of document.querySelectorAll('#slots [data-slot]')) if (a.dataset.slot === SLOT) a.setAttribute('aria-current', 'page');
  const TOKEN_KEY = 'ks-castle-token', ADMIN_KEY = 'ks-admin-token';   // 캐슬 계정 토큰은 따로 (다른 배치도에선 안 됨) · 같은 탭에서 /v1/admin에 로그인했으면 그 토큰도 씀
  const FONT = '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  const SYS_FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';   // 이미지 저장용 SVG는 웹 글꼴을 못 씀
  if (PHONE.matches) $('legend').open = false;

  // ---------- 격자 ----------
  const A = 20;                            // 칸 반너비 (그림 단위)
  const SIDE = 6, RINGS = 6, SHOW = 3;     // 캐슬 한 변 칸 수 · 그리는 둘레 열 수 · 처음 보이는 열 수
  const LO = -RINGS, HI = SIDE - 1 + RINGS;
  const halfOf = r => (SIDE + 2 * r) * A + 8;   // r열까지 들어가는 반너비 (+ 여백)
  const VB = { x: -halfOf(RINGS), y: -halfOf(RINGS), w: 2 * halfOf(RINGS), h: 2 * halfOf(RINGS) };
  const Z0 = halfOf(RINGS) / halfOf(SHOW), ZMAX = 8;   // 1배 = 6열까지 전부
  const dOut = v => (v < 0 ? -v : v > SIDE - 1 ? v - (SIDE - 1) : 0);
  const ring = (i, j) => Math.max(dOut(i), dOut(j));   // 0 = 캐슬 안
  const posX = (i, j) => (i - j) * A, posY = (i, j) => (i + j - (SIDE - 1)) * A;
  const cellAt = (x, y) => ({ i: Math.round((x + y) / (2 * A) + (SIDE - 1) / 2), j: Math.round((y - x) / (2 * A) + (SIDE - 1) / 2) });
  const SIDES = { 'N–E': ['북동쪽', 'N'], 'E–S': ['남동쪽', 'E'], 'S–W': ['남서쪽', 'S'], 'W–N': ['북서쪽', 'W'] };   // 변 = 시계 방향으로 앞 꼭짓점에서부터 셈
  const CORNERS = { N: '북쪽', E: '동쪽', S: '남쪽', W: '서쪽' };
  function where(i, j) {   // 캐슬의 어느 변(몇 번째 칸) 또는 어느 꼭짓점 바깥인지
    const W = SIDE - 1, ni = i < 0 ? -1 : i > W ? 1 : 0, nj = j < 0 ? -1 : j > W ? 1 : 0;
    if (ni && nj) return { corner: ni < 0 ? (nj < 0 ? 'N' : 'W') : (nj < 0 ? 'E' : 'S') };
    if (nj < 0) return { side: 'N–E', k: i + 1 };
    if (ni > 0) return { side: 'E–S', k: j + 1 };
    if (nj > 0) return { side: 'S–W', k: W - i + 1 };
    return { side: 'W–N', k: W - j + 1 };
  }
  function placeShort(i, j) {
    const w = where(i, j);
    return w.corner ? `${w.corner} 꼭짓점 바깥 (${CORNERS[w.corner]})` : `${SIDES[w.side][0]}(${w.side}) ${SIDES[w.side][1]}에서 ${w.k}번째`;
  }
  const placeText = (i, j) => `${ring(i, j)}열 · ${placeShort(i, j)}`;

  // ---------- 상태 ----------
  let pub = null, pubNorm = '', stamp = '';   // 서버 게시본 · 비교용 문자열 · 게시 시각
  let data = null, sel = '', found = '', editing = false, showNames = true, k = 1;
  let roster = [], rosterMap = new Map();     // /v2 배치도 연맹원 (소문자 → 원래 이름)
  let token = null;
  try { token = sessionStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(ADMIN_KEY); } catch (_) { /* no session storage */ }
  const placed = m => !!m && Number.isInteger(m.i);
  const findIn = (d, n) => d.members.find(m => low(m.n) === low(n));
  const occupant = (d, i, j) => d.members.find(m => m.i === i && m.j === j);
  const angle = m => { const a = Math.atan2(posX(m.i, m.j), -posY(m.i, m.j)); return a < 0 ? a + 2 * Math.PI : a; };   // N에서 시계 방향
  const byPlace = (a, b) => (placed(b) - placed(a)) || (placed(a) ? ring(a.i, a.j) - ring(b.i, b.j) || angle(a) - angle(b) : 0);

  function normalize(d) {   // 이상한 값 버리고 키 순서를 맞춤 (게시본 비교·저장 형식). 같은 칸에 둘이면 뒤 사람은 미배치
    const src = d && Array.isArray(d.members) ? d.members : [], seen = new Set(), cells = new Set(), members = [];
    for (const m of src) {
      const n = clean(m && m.n).slice(0, 40);
      if (!n || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      const o = { n };
      if (Number.isInteger(m.i) && Number.isInteger(m.j) && ring(m.i, m.j) >= 1 && ring(m.i, m.j) <= RINGS && !cells.has(m.i + ',' + m.j)) {
        o.i = m.i; o.j = m.j; cells.add(m.i + ',' + m.j);
      }
      if (m.ext === true) o.ext = true;
      members.push(o);
    }
    const out = {};
    if (d && typeof d.memo === 'string' && d.memo.trim()) out.memo = d.memo.slice(0, 1000);
    out.members = members;
    return out;
  }
  const clone = d => JSON.parse(JSON.stringify(d));

  // 수정 = 서버 최신본에도 다시 적용할 수 있는 함수 (이름으로 찾음)
  const OPS = {
    place: (n, i, j) => d => {   // n을 (i, j)로. 그 칸 도시는 n이 있던 칸으로 (n이 미배치였으면 그 도시는 미배치로)
      const m = findIn(d, n);
      if (!m) return;
      const o = d.members.find(x => x !== m && x.i === i && x.j === j);
      if (o) { if (placed(m)) { o.i = m.i; o.j = m.j; } else { delete o.i; delete o.j; } }
      m.i = i; m.j = j;
    },
    unplace: n => d => { const m = findIn(d, n); if (m) { delete m.i; delete m.j; } },
    add: (n, ext) => d => { if (!findIn(d, n)) d.members.push(ext ? { n, ext: true } : { n }); },
    remove: n => d => { d.members = d.members.filter(m => low(m.n) !== low(n)); },
    ext: (n, on) => d => { const m = findIn(d, n); if (m) { if (on) m.ext = true; else delete m.ext; } },
    memo: t => d => { d.memo = t; },
  };

  // ---------- 불러오기 ----------
  function fail(msg) { const n = $('notice'); n.textContent = msg; n.className = 'notice err'; n.hidden = false; }
  async function fetchPlan(apiOnly) {
    for (const url of apiOnly ? [API] : [API, FILE]) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (r.ok) return { d: await r.json(), stamp: r.headers.get('X-Layout-Updated') || '' };
      } catch (_) { /* 다음 경로 */ }
    }
    throw new Error('불러오기 실패');
  }
  async function loadRoster() {   // 닉네임 넣기 자동 완성: /v2 배치도 게시본 (빈자리·개척자 제외)
    for (const url of ['/api/v2/layout', '/layouts/v2.json']) {
      try {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) continue;
        const list = await r.json();
        const names = list.filter(o => o.name === 'Player').map(o => clean(o.nickname))
          .filter(n => n && n !== 'Player' && !/^빈자리/.test(n) && n !== '개척자');
        roster = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ko'));
        rosterMap = new Map(roster.map(n => [n.toLowerCase(), n]));
        $('roster').innerHTML = roster.map(n => `<option value="${esc(n)}">`).join('');
        return;
      } catch (_) { /* 다음 경로 */ }
    }
  }
  async function load() {
    let got;
    try { got = await fetchPlan(); } catch (_) { fail('배치도를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.'); return; }
    pub = normalize(got.d); pubNorm = JSON.stringify(pub); stamp = got.stamp;
    data = clone(pub);
    if (SHARE) {   // 지도만 화면 가득 (머리말·패널·범례 숨김) + 왼쪽 위에 몇 번 배치도인지
      document.body.classList.add('share', 'csfull'); wrapEl.classList.add('full');
      $('sharelabel').textContent = `배치도 ${NO}`; $('sharelabel').hidden = false;
    }
    $('notice').hidden = true; $('main').hidden = false;
    setView(0, 0, Z0, true);
    if (!SHARE) loadRoster();
    const qs = new URLSearchParams(location.search);
    if (qs.get('q') && !SHARE) { $('q').value = qs.get('q'); search(); const m = found && findIn(data, found); if (placed(m)) centerOn(m); }
    renderAll();
    if (qs.has('edit') && !SHARE) startEdit();
    setInterval(poll, 30000);
  }
  async function poll() {   // 다른 사람이 고친 배치를 30초마다 받아 옴 (저장·끌기 중에는 쉼)
    if (document.hidden || busy || pending.length || drag) return;
    try {
      const g = await fetchPlan(true), n = normalize(g.d);
      if (busy || pending.length || drag || JSON.stringify(n) === pubNorm) return;
      pub = n; pubNorm = JSON.stringify(pub); stamp = g.stamp || stamp; data = clone(pub);
      renderAll();
    } catch (_) { /* 다음에 */ }
  }

  // ---------- 지도 (SVG) ----------
  const PAL = ['bg', 'tile', 'near', 'castle', 'castleink', 'edge', 'mark', 'ours', 'ext', 'cityink', 'sel', 'ok', 'bad', 'ringtxt'];
  let P = {};
  function palette() { const cs = getComputedStyle(document.documentElement), o = {}; for (const n of PAL) o[n] = cs.getPropertyValue('--cs-' + n).trim(); return o; }
  function mix(a, b, t) {   // #rrggbb 두 색을 t만큼 섞음
    const pa = /^#([0-9a-f]{6})$/i.exec(a), pb = /^#([0-9a-f]{6})$/i.exec(b);
    if (!pa || !pb) return a;
    const va = parseInt(pa[1], 16), vb = parseInt(pb[1], 16);
    return '#' + [16, 8, 0].map(s => Math.round(((va >> s) & 255) * (1 - t) + ((vb >> s) & 255) * t).toString(16).padStart(2, '0')).join('');
  }
  const mctx = document.createElement('canvas').getContext('2d');
  const tw = (s, px, wt, font) => { mctx.font = `${wt} ${px}px ${font}`; return mctx.measureText(s).width; };
  const dia = (x, y, w) => `${r1(x - w)},${r1(y)} ${r1(x)},${r1(y - w)} ${r1(x + w)},${r1(y)} ${r1(x)},${r1(y + w)}`;

  /* 지도 SVG 내용. o = { k: 화면 1px당 지도 단위, P: 색, font, d: 배치, sel, names: 이름 표시, drag: 끌고 있는 이름 }
   * 칸·캐슬은 지도 단위 크기라 확대하면 커지고, 도시 이름 글자는 화면 px 기준(k를 곱함)이라 칸이 클 때만 보입니다. */
  function mapSVG(o) {
    const { k: kk, P: C, font, d } = o, px = v => r1(v * kk);
    const T = (x, y, s, size, a = {}) => `<text x="${r1(x)}" y="${r1(y)}" font-size="${px(size)}" font-weight="${a.wt || 600}" fill="${a.fill}" text-anchor="middle" dominant-baseline="central"` +
      (a.halo ? ` stroke="${a.halo}" stroke-width="${px(a.hw || 2.6)}" stroke-linejoin="round" paint-order="stroke"` : '') + `>${s}</text>`;
    const out = [`<rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="${C.bg}"/>`];
    const tileW = 2 * A / kk;   // 칸 너비 (화면 px)

    // 칸: 열마다 한 묶음, 캐슬에 가까울수록 진하게 (둥근 마름모 = 같은 색 테두리)
    const rows = {};
    for (let i = LO; i <= HI; i++) for (let j = LO; j <= HI; j++) { const r = ring(i, j); if (r) (rows[r] = rows[r] || []).push(`<polygon points="${dia(posX(i, j), posY(i, j), A * 0.84)}"/>`); }
    for (let r = 1; r <= RINGS; r++) {
      const c = mix(C.near, C.tile, (r - 1) / (RINGS - 1));
      out.push(`<g fill="${c}" stroke="${c}" stroke-width="${A * 0.12}" stroke-linejoin="round">${rows[r].join('')}</g>`);
    }
    // 열 번호: 네 꼭짓점 쪽 대각선 칸에 (빈칸일 때만)
    if (tileW >= 16) {
      for (let r = 1; r <= RINGS; r++) {
        for (const [i, j] of [[-r, -r], [SIDE - 1 + r, -r], [SIDE - 1 + r, SIDE - 1 + r], [-r, SIDE - 1 + r]]) {
          if (!occupant(d, i, j)) out.push(T(posX(i, j), posY(i, j), r, Math.min(13, tileW * 0.3), { fill: C.ringtxt, wt: 600 }));
        }
      }
    }

    // 캐슬: 마름모 + 이름 + 꼭짓점 한 칸 안쪽의 N · E · S · W
    out.push(`<polygon points="${dia(0, 0, SIDE * A)}" fill="${C.castle}" stroke="${C.edge}" stroke-width="${A * 0.16}" stroke-linejoin="round"/>`);
    out.push(`<text x="0" y="0" font-size="${A * 0.8}" font-weight="700" fill="${C.castleink}" text-anchor="middle" dominant-baseline="central" letter-spacing="${A * 0.22}">KING'S CASTLE</text>`);
    for (const [lab, mx, my] of [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]]) {
      const x = mx * (SIDE - 1) * A, y = my * (SIDE - 1) * A;
      out.push(`<polygon points="${dia(x, y, A * 0.72)}" fill="${C.mark}" stroke="${mix(C.mark, '#ffffff', 0.35)}" stroke-width="${A * 0.07}" stroke-linejoin="round"/>` +
        `<text x="${x}" y="${y}" font-size="${A * 0.62}" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${lab}</text>`);
    }

    // 도시: 뒤(위) 칸부터 그리고, 이름은 칸 밖으로 넘칠 수 있어 칸을 다 그린 뒤에
    const cities = d.members.filter(placed).sort((a, b) => posY(a.i, a.j) - posY(b.i, b.j) || posX(a.i, a.j) - posX(b.i, b.j));
    const names = [];
    const size = Math.max(8, Math.min(12.5, tileW * 0.26)), maxW = tileW * 1.9;
    for (const m of cities) {
      const x = posX(m.i, m.j), y = posY(m.i, m.j), c = m.ext ? C.ext : C.ours, on = o.sel && low(o.sel) === low(m.n), fade = o.drag && low(o.drag) === low(m.n);
      out.push(`<g data-n="${esc(m.n)}"${fade ? ' opacity=".3"' : ''}><title>${esc(m.n)} · ${esc(placeText(m.i, m.j))}</title>` +
        `<polygon points="${dia(x, y, A * 0.84)}" fill="${c}" stroke="${on ? C.sel : c}" stroke-width="${on ? px(3) : A * 0.12}" stroke-linejoin="round"/></g>`);
      if (o.names && tileW >= 22) {   // 칸 폭의 두 배쯤까지만, 길면 … (전체 이름은 목록·정보 상자에)
        let txt = m.n, s = size;
        if (tw(txt, s, 600, font) > maxW) s = Math.max(7.5, s * maxW / tw(txt, s, 600, font));
        if (tw(txt, s, 600, font) > maxW) { while (txt.length > 1 && tw(txt + '…', s, 600, font) > maxW) txt = txt.slice(0, -1); txt += '…'; }
        names.push(`<g data-n="${esc(m.n)}"${fade ? ' opacity=".3"' : ''}>` + T(x, y, esc(txt), s, { fill: C.cityink, halo: mix(c, '#000000', 0.45), hw: 2.4 }) + '</g>');
      }
    }
    return out.join('') + names.join('');
  }

  const svg = $('map'), wrapEl = $('cwrap');
  // 지금 보이는 지도 범위 (viewBox = svg 칸과 같은 비율, 1배 = 6열까지 전부). 확대·이동은 이것만 바꾸고, 손을 뗀 뒤 다시 그려 글자 크기를 맞춤
  let view = { ...VB, z: 1 }, gesture = false, rtimer = 0;
  const isFull = () => wrapEl.classList.contains('full');
  function sizeAt(z) {   // z배일 때 보이는 범위 크기 (지도 단위)
    const r = svg.getBoundingClientRect(), cw = r.width || VB.w, ch = r.height || VB.h, sc = Math.min(cw / VB.w, ch / VB.h) * z;
    return { w: cw / sc, h: ch / sc };
  }
  function drawnRect() {   // svg 안에서 지도가 실제로 그려진 범위 (preserveAspectRatio meet)
    const r = svg.getBoundingClientRect(), s = Math.min(r.width / view.w, r.height / view.h) || 1;
    return { left: r.left + (r.width - view.w * s) / 2, top: r.top + (r.height - view.h * s) / 2, width: view.w * s, height: view.h * s };
  }
  const toMap = (cx, cy) => { const r = drawnRect(); return { x: view.x + (cx - r.left) / r.width * view.w, y: view.y + (cy - r.top) / r.height * view.h, fx: (cx - r.left) / r.width, fy: (cy - r.top) / r.height }; };
  function renderMap() {
    clearTimeout(rtimer);
    const r = drawnRect();
    k = r.width ? view.w / r.width : 1;
    P = palette();
    svg.classList.toggle('editing', editing);
    svg.innerHTML = mapSVG({ k, P, font: FONT, d: data, sel, names: showNames, drag: drag && drag.on ? drag.n : '' }) + '<g id="hl"></g>';
    if (drag && drag.on) drawHL(drag.t);
  }
  // (cx, cy) = 가운데 둘 지도 좌표, quick = viewBox만 바꾸고 다시 그리기는 나중에 (끌어서 움직이는 중)
  function setView(cx, cy, z, quick) {
    z = Math.min(ZMAX, Math.max(1, z));
    const { w, h } = sizeAt(z);
    const fit = (c, size, lo, span) => (size >= span ? lo + (span - size) / 2 : Math.min(lo + span - size, Math.max(lo, c - size / 2)));
    view = { x: fit(cx, w, VB.x, VB.w), y: fit(cy, h, VB.y, VB.h), w, h, z };
    svg.setAttribute('viewBox', `${r1(view.x)} ${r1(view.y)} ${r1(w)} ${r1(h)}`);
    if (!quick) { if (data) renderMap(); } else if (!gesture) { clearTimeout(rtimer); rtimer = setTimeout(() => data && renderMap(), 150); }
  }
  function zoomTo(px, py, z, quick) {   // 화면 점 (px, py)의 지도 자리를 그대로 두고 z배로
    const p = toMap(px, py);
    z = Math.min(ZMAX, Math.max(1, z));
    const { w, h } = sizeAt(z);
    setView(p.x - p.fx * w + w / 2, p.y - p.fy * h + h / 2, z, quick);
  }
  const center = () => { const r = drawnRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const centerOn = m => setView(posX(m.i, m.j), posY(m.i, m.j), Math.max(view.z, Z0));
  $('zin').onclick = () => zoomTo(...center(), view.z * 1.4);
  $('zout').onclick = () => zoomTo(...center(), view.z / 1.4);
  $('z3').onclick = () => setView(0, 0, Z0);
  $('z6').onclick = () => setView(0, 0, 1);
  function setFull(on, fromPop) {
    if (SHARE || on === isFull()) return;   // 공유용은 늘 화면 가득
    wrapEl.classList.toggle('full', on); document.body.classList.toggle('csfull', on);
    $('full').textContent = on ? '닫기' : '크게'; $('full').setAttribute('aria-pressed', on);
    if (on) history.pushState({ ...(history.state || {}), csfull: 1 }, '');
    else if (!fromPop && history.state && history.state.csfull) history.back();
  }
  $('full').onclick = () => setFull(!isFull());
  window.addEventListener('popstate', () => { if (isFull()) setFull(false, true); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isFull()) setFull(false); });
  new ResizeObserver(() => { if (data) setView(view.x + view.w / 2, view.y + view.h / 2, view.z); }).observe(svg);   // 칸 크기·비율이 바뀌면 (크게·화면 회전) 다시 맞춤
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => data && renderMap());
  if (document.fonts) document.fonts.ready.then(() => data && renderMap());

  // 데스크톱: Ctrl+휠(터치패드 두 손가락 벌리기 포함)로 확대
  svg.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomTo(e.clientX, e.clientY, view.z * Math.exp(-e.deltaY * 0.004), true);
  }, { passive: false });

  // 지도 끌기(이동) · 두 손가락 확대 · 누르기. 편집 중에 도시를 누르면 그 도시 끌기
  const ptrs = new Map();
  let pan = null, pinch = null;
  svg.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { svg.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      cancelDrag(); pan = null;
      const [a, b] = [...ptrs.values()];
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: view.z, p: toMap((a.x + b.x) / 2, (a.y + b.y) / 2) };
      gesture = true;
      return;
    }
    if (ptrs.size > 2) return;
    const g = e.target.closest('[data-n]');
    if (editing && g) { press(e, g.dataset.n, 'map'); return; }
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: view.x + view.w / 2, cy: view.y + view.h / 2, moved: false, n: g ? g.dataset.n : '' };
  });
  svg.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const z = Math.min(ZMAX, Math.max(1, pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0));
      const r = drawnRect(), fx = ((a.x + b.x) / 2 - r.left) / r.width, fy = ((a.y + b.y) / 2 - r.top) / r.height;
      const { w, h } = sizeAt(z);
      setView(pinch.p.x - fx * w + w / 2, pinch.p.y - fy * h + h / 2, z, true);
      return;
    }
    if (pan && e.pointerId === pan.id) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) < 5) return;
      pan.moved = gesture = true; svg.classList.add('drag');
      const s = view.w / drawnRect().width;
      setView(pan.cx - dx * s, pan.cy - dy * s, view.z, true);
      return;
    }
    if (!drag && e.pointerType === 'mouse' && !e.buttons) hover(e.clientX, e.clientY);
  });
  function pointerEnd(e) {
    ptrs.delete(e.pointerId);
    if (pinch) {
      if (ptrs.size < 2) {
        pinch = null;
        const rest = [...ptrs.entries()][0];   // 한 손가락만 떼면 이어서 이동
        if (rest) pan = { id: rest[0], x: rest[1].x, y: rest[1].y, cx: view.x + view.w / 2, cy: view.y + view.h / 2, moved: true, n: '' };
        else { gesture = false; renderMap(); }
      }
      return;
    }
    if (!pan || e.pointerId !== pan.id) return;
    const was = pan;
    pan = null; svg.classList.remove('drag');
    if (was.moved) { gesture = false; renderMap(); return; }
    if (e.type === 'pointerup') tap(e.clientX, e.clientY, was.n);
  }
  svg.addEventListener('pointerup', pointerEnd);
  svg.addEventListener('pointercancel', pointerEnd);
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !drag) $('readout').textContent = ''; });

  function hover(cx, cy) {   // 마우스를 올린 칸 안내
    const p = toMap(cx, cy), c = cellAt(p.x, p.y), r = ring(c.i, c.j);
    if (r < 1 || r > RINGS) { $('readout').textContent = r ? '' : '킹스 캐슬'; return; }
    const o = occupant(data, c.i, c.j);
    $('readout').textContent = `${placeText(c.i, c.j)} · ${o ? o.n : '빈칸'}`;
  }
  function tap(cx, cy, n) {   // 도시를 누르면 선택, 편집 중에 고른 사람이 있으면 누른 빈칸으로 옮김
    if (n) { select(low(n) === low(sel) ? '' : n); return; }
    const p = toMap(cx, cy), c = cellAt(p.x, p.y), r = ring(c.i, c.j);
    const m = sel && findIn(data, sel);
    if (editing && m && r >= 1 && r <= RINGS && !occupant(data, c.i, c.j)) { edit(OPS.place(m.n, c.i, c.j), `${m.n} → ${placeText(c.i, c.j)}`); return; }
    if (editing && m && r === 0) { toast('캐슬 안에는 도시를 놓을 수 없습니다', true); return; }
    select('');
  }
  function select(n) { sel = n; renderAll(); }

  // ---------- 끌어 놓기 (미배치 이름 · 지도 위 도시) ----------
  let drag = null, suppressClick = 0;   // { n, id, x0, y0, on, from: 'map' | 'tray', t: 놓을 곳 }
  const ghost = $('ghost'), tray = $('tray');
  function press(e, n, from) { drag = { n, id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, from, t: null }; }
  function targetAt(x, y) {   // 화면 점 (x, y)에 놓으면: 미배치 칸 · 지도 칸 (빈칸 / 다른 도시 / 못 놓는 곳) · 바깥(null)
    const tr = tray.getBoundingClientRect();
    if (!tray.hidden && x >= tr.left && x <= tr.right && y >= tr.top && y <= tr.bottom) return { tray: true };
    const sr = svg.getBoundingClientRect();
    if (x < sr.left || x > sr.right || y < sr.top || y > sr.bottom) return null;
    const p = toMap(x, y), c = cellAt(p.x, p.y), r = ring(c.i, c.j);
    if (r === 0) return { ...c, bad: '캐슬 안에는 도시를 놓을 수 없습니다' };
    if (r > RINGS) return { ...c, bad: `${RINGS}열 바깥에는 놓을 수 없습니다` };
    const o = occupant(data, c.i, c.j);
    return { ...c, o: o && low(o.n) !== low(drag.n) ? o.n : '', same: !!o && low(o.n) === low(drag.n) };
  }
  function drawHL(t) {
    tray.classList.toggle('over', !!(t && t.tray));
    const g = svg.querySelector('#hl');
    if (!g) return;
    if (!t || t.tray || t.bad || t.same) { g.innerHTML = ''; return; }
    const c = t.o ? P.sel : P.ok;
    g.innerHTML = `<polygon points="${dia(posX(t.i, t.j), posY(t.i, t.j), A * 0.92)}" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="${r1(2.5 * k)}" stroke-linejoin="round" pointer-events="none"/>`;
  }
  function targetText(t) {
    if (!t) return '';
    if (t.tray) return '여기에 놓으면 미배치로';
    if (t.bad) return t.bad;
    const m = findIn(data, drag.n);
    if (t.o) return `${placeText(t.i, t.j)} · ${t.o}${placed(m) ? '와(과) 자리 바꿈' : ' → 미배치'}`;
    return placeText(t.i, t.j);
  }
  window.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      drag.on = true;
      const m = findIn(data, drag.n);
      ghost.textContent = drag.n; ghost.className = 'ghost' + (m && m.ext ? ' ext' : ''); ghost.hidden = false;
      renderMap();   // 끌고 있는 도시를 흐리게
    }
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    drag.t = targetAt(e.clientX, e.clientY);
    drawHL(drag.t);
    $('readout').textContent = targetText(drag.t);
  });
  window.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    endDrag();
    if (!d.on) { if (d.from === 'map') select(low(d.n) === low(sel) ? '' : d.n); return; }   // 끌지 않고 누르기만 = 선택 (미배치 이름은 click에서)
    suppressClick = Date.now();
    drop(d);
  });
  window.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) endDrag(); });
  function cancelDrag() { if (drag) endDrag(); }
  function endDrag() {
    const was = drag && drag.on;
    drag = null; ghost.hidden = true; tray.classList.remove('over'); $('readout').textContent = '';
    if (was) renderAll();
  }
  function drop(d) {
    const t = d.t, m = findIn(data, d.n);
    if (!t || !m) return;
    if (t.tray) { if (placed(m)) edit(OPS.unplace(m.n), `${m.n} → 미배치`); return; }
    if (t.bad) { toast(t.bad, true); return; }
    if (t.same) return;
    const msg = t.o ? (placed(m) ? `${m.n} ↔ ${t.o} 자리 바꿈` : `${m.n} → ${placeText(t.i, t.j)} · ${t.o} → 미배치`) : `${m.n} → ${placeText(t.i, t.j)}`;
    sel = m.n;
    edit(OPS.place(m.n, t.i, t.j), msg);
  }
  tray.addEventListener('pointerdown', e => {
    const c = e.target.closest('[data-chip]');
    if (!c || !editing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try { c.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
    press(e, c.dataset.chip, 'tray');
  });
  tray.addEventListener('click', e => {
    const c = e.target.closest('[data-chip]');
    if (!c || Date.now() - suppressClick < 400) return;
    select(low(c.dataset.chip) === low(sel) ? '' : c.dataset.chip);
  });

  let toastTimer = 0;
  function toast(msg, err) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- 서버 저장 (끌어 놓을 때마다) ----------
  let pending = [], busy = false;
  function edit(op, msg) {
    if (!editing) return;
    op(data); data = normalize(data);
    pending.push(op);
    if (msg) toast(msg);
    renderAll();
    flush();
  }
  function saveState(msg, cls) {
    const s = $('savest');
    s.textContent = msg; s.className = 'savest' + (cls ? ' ' + cls : '');
    $('retry').hidden = cls !== 'err';
  }
  async function flush() {
    if (busy || !pending.length) return;
    if (!tokenValid() && !(await login())) { saveState('저장 안 됨 — 로그인이 필요합니다', 'err'); return; }
    busy = true;
    saveState('저장 중…');
    const ops = pending.slice();
    let base = pub;
    try { base = normalize((await fetchPlan(true)).d); } catch (_) { /* 못 받으면 마지막 게시본 위에 */ }
    const next = clone(base);
    for (const op of ops) op(next);
    const body = normalize(next);
    let r = null;
    try { r = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body, null, 1) }); } catch (_) { /* 아래에서 */ }
    busy = false;
    if (r && r.ok) {
      pub = body; pubNorm = JSON.stringify(pub); stamp = new Date().toISOString();
      pending = pending.slice(ops.length);
      data = clone(pub);   // 그사이 다른 사람이 고친 것까지 반영 + 아직 안 보낸 수정
      for (const op of pending) op(data);
      data = normalize(data);
      saveState(`서버에 저장됨 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`, 'ok');
      if (!drag || !drag.on) renderAll();
      flush();
      return;
    }
    if (r && r.status === 401) {
      token = null;
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) { /* 없음 */ }
      saveState('다시 로그인하세요', 'err');
      if (await login()) flush();
      return;
    }
    const j = r ? await r.json().catch(() => ({})) : {};
    saveState(`저장 못 함${j.error ? ': ' + j.error : r ? ` (${r.status})` : ' (연결 안 됨)'}`, 'err');
  }
  $('retry').onclick = flush;
  window.addEventListener('beforeunload', e => { if (pending.length) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- 로그인 · 편집 ----------
  const tokenValid = () => { const m = /^(\d+)\.[0-9a-f]{64}$/.exec(token || ''); return !!m && +m[1] > Date.now() + 60000; };
  let loginDone = null;
  function login() {
    return new Promise(resolve => {
      loginDone = resolve;
      $('loginerr').textContent = '';
      $('login').showModal();
      $('lid').focus();
    });
  }
  $('login').addEventListener('close', () => { if (loginDone) { const r = loginDone; loginDone = null; r(tokenValid()); } });
  $('logincancel').onclick = () => $('login').close();
  $('loginform').addEventListener('submit', async ev => {
    ev.preventDefault();
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: $('lid').value.trim(), pw: $('lpw').value, scope: 'castle' }) });   // 캐슬 계정 → 관리자 계정 순으로 확인
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) { $('loginerr').textContent = j.error || '로그인하지 못했습니다'; return; }
      token = j.token;
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (_) { /* 메모리에만 */ }
      $('lpw').value = '';
      $('login').close();
    } catch (_) { $('loginerr').textContent = '서버에 연결하지 못했습니다'; }
  });
  async function startEdit() {
    if (SHARE || (!tokenValid() && !(await login()))) return;
    editing = true;
    $('adminhint').textContent = '';
    renderAll();
  }
  function stopEdit() { editing = false; cancelDrag(); renderAll(); }
  $('editbtn').onclick = () => (editing ? stopEdit() : startEdit());
  $('edit2').onclick = () => (editing ? stopEdit() : startEdit());
  $('exitedit').onclick = stopEdit;

  function splitNames(text) { return String(text).split(/[,\n，、]/).map(clean).filter(Boolean).map(n => rosterMap.get(n.toLowerCase()) || n); }
  $('addbtn').onclick = () => {
    const names = splitNames($('addname').value), ext = $('addkind').value === 'ext';
    if (!names.length) return;
    const have = names.filter(n => findIn(data, n)), add = names.filter(n => !findIn(data, n));
    for (const n of add) edit(OPS.add(n, ext));
    toast(`${add.length ? add.join(', ') + ' → 미배치로 넣음' : ''}${have.length ? (add.length ? ' · ' : '') + have.join(', ') + '은(는) 이미 있음' : ''}`);
    $('addname').value = '';
  };
  $('addname').addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); $('addbtn').click(); } });
  $('memoin').addEventListener('change', () => {
    if (clean($('memoin').value) !== clean(data.memo)) edit(OPS.memo($('memoin').value), '메모를 저장합니다');
  });
  $('info').addEventListener('click', ev => {
    const b = ev.target.closest('[data-act]'), m = sel && findIn(data, sel);
    if (ev.target.closest('#infox')) { select(''); return; }
    if (!b || !m || !editing) return;
    if (b.dataset.act === 'unplace') edit(OPS.unplace(m.n), `${m.n} → 미배치`);
    else if (b.dataset.act === 'ext') edit(OPS.ext(m.n, !m.ext), `${m.n} → ${m.ext ? '우리 인원' : '다른 연맹'}`);
    else if (b.dataset.act === 'remove' && confirm(`${m.n}을(를) 명단에서 지울까요?`)) { sel = ''; edit(OPS.remove(m.n), `${m.n}을(를) 지웠습니다`); }
  });

  // ---------- 패널 ----------
  function renderFacts() {
    const ours = data.members.filter(m => !m.ext), ext = data.members.filter(m => m.ext);
    const near = (SIDE + 2 * SHOW) ** 2 - SIDE ** 2, used = data.members.filter(m => placed(m) && ring(m.i, m.j) <= SHOW).length;
    $('facts').innerHTML = `<div><dt><i style="background:var(--cs-ours)"></i>우리 인원</dt><dd>${ours.filter(placed).length} / ${ours.length}</dd></div>` +
      `<div><dt><i style="background:var(--cs-ext)"></i>다른 연맹</dt><dd>${ext.filter(placed).length}</dd></div>` +
      `<div><dt>1~${SHOW}열 빈칸</dt><dd>${near - used}</dd></div>`;
    const t = stamp ? new Date(stamp) : null;
    $('stamp').textContent = t && !isNaN(t) ? `저장 ${t.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '';
  }
  function renderList() {
    const row = m => `<tr class="row${low(m.n) === low(sel) ? ' on' : ''}" data-n="${esc(m.n)}" tabindex="0"><td class="nm"><span class="tag" style="background:var(--cs-${m.ext ? 'ext' : 'ours'})"></span>${esc(m.n)}</td>` +
      `<td class="mono">${placed(m) ? ring(m.i, m.j) + '열' : '—'}</td><td class="wh">${placed(m) ? esc(placeShort(m.i, m.j)) : '<span class="hint">미배치</span>'}</td></tr>`;
    const ours = data.members.filter(m => !m.ext).sort(byPlace), ext = data.members.filter(m => m.ext).sort(byPlace);
    $('list').innerHTML = '<thead><tr><th>닉네임</th><th>열</th><th>위치</th></tr></thead><tbody>' +
      `<tr class="grp"><td colspan="3">우리 인원 ${ours.filter(placed).length} / ${ours.length}</td></tr>` + ours.map(row).join('') +
      (ext.length ? `<tr class="grp"><td colspan="3">다른 연맹 ${ext.length}</td></tr>` + ext.map(row).join('') : '') + '</tbody>';
  }
  function pickRow(ev) {
    const r = ev.target.closest('tr[data-n]');
    if (!r) return;
    sel = r.dataset.n;
    const m = findIn(data, sel);
    if (placed(m)) centerOn(m);
    renderAll();
  }
  $('list').addEventListener('click', pickRow);
  $('list').addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickRow(ev); } });
  function renderTray() {
    tray.hidden = !editing;
    if (!editing || (drag && drag.on)) return;   // 끄는 중에는 이름 칸을 다시 그리지 않음 (터치가 끊김)
    const none = data.members.filter(m => !placed(m)).sort((a, b) => !!a.ext - !!b.ext);
    $('traysum').textContent = none.length ? `미배치 ${none.length}명 — 끌어서 지도 칸에 놓으세요 (이름을 누른 뒤 빈칸을 눌러도 됨)` : '미배치 없음 — 지도 위 도시를 여기로 끌어오면 미배치로 뺍니다';
    $('traychips').innerHTML = none.map(m => `<button class="chip${low(m.n) === low(sel) ? ' on' : ''}" type="button" data-chip="${esc(m.n)}"><i style="background:var(--cs-${m.ext ? 'ext' : 'ours'})"></i>${esc(m.n)}</button>`).join('');
  }
  function renderInfo() {
    const box = $('info'), m = sel && findIn(data, sel);
    if (!m) { box.hidden = true; return; }
    box.innerHTML = `<button class="btn x" type="button" id="infox" aria-label="닫기">✕</button>` +
      `<h3>${esc(m.n)} <small>${m.ext ? '다른 연맹' : '우리 인원'}</small></h3>` +
      `<p>${placed(m) ? esc(placeText(m.i, m.j)) : '미배치'}</p>` +
      (editing ? `<p class="hint">${placed(m) ? '빈칸을 누르면 그 칸으로 옮깁니다.' : '빈칸을 누르면 그 칸에 놓습니다.'}</p><div class="acts">` +
        (placed(m) ? '<button class="btn" type="button" data-act="unplace">미배치로 빼기</button>' : '') +
        `<button class="btn" type="button" data-act="ext">${m.ext ? '우리 인원으로' : '다른 연맹으로'}</button>` +
        '<button class="btn" type="button" data-act="remove">명단에서 지우기</button></div>' : '');
    box.classList.toggle('left', placed(m) && posX(m.i, m.j) > 0);   // 고른 도시 반대쪽에 띄움
    box.hidden = false;
  }
  function renderMemo() { $('memo').hidden = !data.memo; $('memo').textContent = data.memo || ''; }
  function renderEditor() {
    $('editor').hidden = !editing;
    $('editbtn').textContent = editing ? '편집 끝내기' : '배치 편집 (로그인)';
    $('edit2').setAttribute('aria-pressed', editing);
    if (!editing) return;
    $('edstate').textContent = '끌어 놓으면 바로 저장';
    if (document.activeElement !== $('memoin')) $('memoin').value = data.memo || '';
  }

  // ---------- 내 자리 찾기 ----------
  function search() {
    const q = low($('q').value), hint = $('qhint');
    found = ''; hint.textContent = '';
    if (!q) return;
    let hits = data.members.filter(m => low(m.n) === q);
    if (!hits.length) hits = data.members.filter(m => low(m.n).includes(q));
    if (hits.length === 1) { found = hits[0].n; sel = found; }
    else if (hits.length > 1) hint.innerHTML = `${hits.length}명: ` + hits.slice(0, 12).map(h => `<button class="lnk" type="button" data-pick="${esc(h.n)}">${esc(h.n)}</button>`).join(' · ');
    else hint.textContent = '배치에 없는 닉네임입니다.';
  }
  function renderCard() {
    const card = $('card'), m = found && findIn(data, found);
    if (!m) { card.hidden = true; return; }
    card.innerHTML = `<div class="nm">${esc(m.n)}${m.ext ? ' <span class="badge mv">다른 연맹</span>' : ''}</div>` +
      `<div class="co">${placed(m) ? `캐슬 ${ring(m.i, m.j)}열` : '미배치'}</div>` +
      (placed(m) ? `<div class="meta">${esc(placeShort(m.i, m.j))} · 지도에서 노란 테두리 칸</div>` : '<div class="meta">아직 자리가 정해지지 않았습니다.</div>');
    card.hidden = false;
  }
  function onFind() { search(); const m = found && findIn(data, found); if (placed(m)) centerOn(m); renderAll(); }
  $('q').addEventListener('input', onFind);
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) $('q').blur(); });
  $('qhint').addEventListener('click', ev => { const b = ev.target.closest('[data-pick]'); if (b) { $('q').value = b.dataset.pick; onFind(); } });

  // ---------- 연맹 채팅용 텍스트 · 링크 · 이미지 ----------
  function planText() {
    const ours = data.members.filter(m => !m.ext).sort(byPlace), out = [`[킹스 캐슬 도시 배치도 ${NO}] 우리 인원 ${ours.filter(placed).length}/${ours.length}`];
    if (data.memo) out.push(data.memo.trim());
    let r0 = 0;
    for (const m of ours.filter(placed)) {
      const r = ring(m.i, m.j);
      if (r !== r0) { out.push('', `■ ${r}열`); r0 = r; }
      out.push(`${m.n} — ${placeShort(m.i, m.j)}`);
    }
    const none = ours.filter(m => !placed(m));
    if (none.length) out.push('', `■ 미배치: ${none.map(m => m.n).join(', ')}`);
    out.push('', location.origin + HOME);
    return out.join('\n');
  }
  async function copyText(text, btn, done) {
    const ta = $('copytext');
    try { await navigator.clipboard.writeText(text); ta.hidden = true; flash(btn, done); } catch (_) {
      ta.value = text; ta.hidden = false; ta.focus(); ta.select(); flash(btn, '아래 글을 길게 눌러 복사하세요');
    }
  }
  function flash(btn, msg) { const t = btn.dataset.t || btn.textContent; btn.dataset.t = t; btn.textContent = msg; setTimeout(() => { btn.textContent = t; }, 1600); }
  $('copy').onclick = () => copyText(planText(), $('copy'), '복사했습니다');
  $('link').onclick = () => copyText(location.origin + HOME, $('link'), '링크 복사됨');

  async function savePNG() {   // 놓인 도시가 다 들어가는 열까지(최소 3열) 지도 + 우리 인원 명단
    const btn = $('png'), C = palette(), W = 1200;
    flash(btn, '만드는 중…');
    const R = Math.max(SHOW, ...data.members.filter(placed).map(m => ring(m.i, m.j))), h = halfOf(R);
    const inner = mapSVG({ k: (2 * h / W) * 1.25, P: C, font: SYS_FONT, d: data, sel: '', names: true });
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="${-h} ${-h} ${2 * h} ${2 * h}" font-family='${SYS_FONT}'>${inner}</svg>`;
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    try { await img.decode(); } catch (_) { flash(btn, '이미지를 만들지 못했습니다'); return; }
    const ours = data.members.filter(m => !m.ext).sort(byPlace);
    const lines = ours.map(m => `${m.n} — ${placed(m) ? placeText(m.i, m.j) : '미배치'}`);
    const PAD = 28, HEAD = 74, LH = 26, per = Math.ceil(lines.length / 2);
    const cv = document.createElement('canvas'), x = cv.getContext('2d');
    const H = HEAD + W + PAD + per * LH + 40;
    cv.width = W; cv.height = H;
    const F = (size, wt) => `${wt} ${size}px ${FONT}`;
    x.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff'; x.fillRect(0, 0, W, H);
    const ink = getComputedStyle(document.body).color || '#1b231e';
    x.fillStyle = ink; x.font = F(26, 600); x.fillText(`킹스 캐슬 도시 배치도 ${NO}`, PAD, 38);
    x.font = F(16, 400); x.globalAlpha = 0.7;
    x.fillText(`우리 인원 ${ours.filter(placed).length}/${ours.length} · 한 칸 = 도시 하나 · 숫자 = 캐슬에서 몇 열`, PAD, 62);
    x.globalAlpha = 1;
    x.drawImage(img, 0, HEAD, W, W);
    x.font = F(17, 400);
    lines.forEach((ln, i) => { x.fillText(ln, PAD + (i >= per ? (W - PAD) / 2 : 0), HEAD + W + PAD + LH * (i % per) + 18); });
    x.globalAlpha = 0.6; x.font = F(14, 400); x.fillText(`${location.host}${HOME} · ${new Date().toLocaleDateString('ko-KR')}`, PAD, H - 16); x.globalAlpha = 1;
    cv.toBlob(async blob => {
      if (!blob) { flash(btn, '이미지를 만들지 못했습니다'); return; }
      const name = `캐슬_도시배치${NO}.png`, file = new File([blob], name, { type: 'image/png' });
      if (PHONE.matches && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); flash(btn, '공유했습니다'); return; } catch (_) { /* 취소하면 내려받기 */ }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      flash(btn, '저장했습니다');
    }, 'image/png');
  }
  $('png').onclick = savePNG;
  $('nm').onclick = () => { showNames = !showNames; renderAll(); };

  $('maphint').textContent = matchMedia('(pointer: coarse)').matches
    ? '두 손가락으로 벌리거나 오므려 확대·축소 (최대 6열까지) · 한 손가락으로 지도 이동 · ‘크게’는 화면 가득'
    : 'Ctrl + 휠(터치패드는 두 손가락 벌리기)이나 ＋ 버튼으로 확대·축소 (최대 6열까지) · 끌어서 지도 이동';

  // ---------- 전체 그리기 ----------
  function syncURL() {
    const u = new URL(location.href), sp = u.searchParams, q = clean($('q').value);
    if (q) sp.set('q', q); else sp.delete('q');
    if (editing) sp.set('edit', ''); else sp.delete('edit');
    if (SHARE) sp.set('p', String(NO)); else sp.delete('p');   // 공유용: 몇 번 배치도
    history.replaceState(history.state, '', u.pathname + (sp.toString() ? '?' + sp.toString().replace(/edit=(&|$)/, 'edit$1') : ''));
  }
  PHONE.addEventListener('change', () => data && renderAll());
  function renderAll() {
    if (!data) return;
    if (sel && !findIn(data, sel)) sel = '';
    $('nm').setAttribute('aria-pressed', showNames);
    renderFacts(); renderMemo(); renderCard(); renderList(); renderTray(); renderMap(); renderInfo(); renderEditor(); syncURL();
  }
  load();
})();
