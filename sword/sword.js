/* /sword 성검 쟁탈(Swordland Showdown) 인원 배치도.
 * 전장: 실제 게임 화면(sword/battlefield.webp, kingshotmastery.com 스크린샷 800×665)을 배경으로 깔고, 건물 위치·크기를 그 사진에 맞춤.
 *   좌표 = 사진 픽셀, 원점은 성검 제단 바닥 가운데(사진 410, 350). "지도 사진" 버튼을 끄면 같은 좌표로 그린 지도(마름모 칸 비율 0.7375).
 *   도시 하나 = 격자 한 칸. 배치 인원은 그 건물에서 가까운 빈칸부터 도시로 놓음(배치도처럼). 게임 좌표는 아님.
 * 데이터: /api/sword/layout (첫 게시 전에는 layouts/sword.json)
 *   { legions: [{ name, side: 'blue'|'red', memo?, notes?: { 자리 id: 자리 메모 }, members: [{ n: 닉네임, at: 시작 자리, then?: 15분 후 자리, lead?: 집결장 }] }] }
 *   자리 = 건물 id(POSTS) 또는 역할 id(GROUPS), '' = 미배치. 닉네임은 /v2 배치도의 연맹원 이름에 맞춤(대소문자·띄어쓰기만 다르면 고쳐 넣음).
 * 편집: 관리자 로그인(/v1/admin과 같은 계정) → 고친 내용은 이 브라우저에 임시 저장 → 게시하기(PUT /api/sword/layout).
 * 주소: ?l=군단 번호 ?p=2(15분 후) ?b=자리 id ?q=닉네임 ?edit */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const low = s => clean(s).toLowerCase();
  const num = v => v.toLocaleString('ko-KR');
  const r1 = v => Math.round(v * 10) / 10;
  const PHONE = matchMedia('(max-width: 900px)');
  const API = '/api/sword/layout', FILE = '/layouts/sword.json';
  const TOKEN_KEY = 'ks-admin-token', DRAFT_KEY = 'ks-sword-draft';   // 토큰은 /v1/admin과 같은 sessionStorage 키
  const FONT = '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  const SYS_FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';   // 이미지 저장용 SVG는 웹 글꼴을 못 씀
  if (PHONE.matches) $('legend').open = false;

  // ---------- 전장 ----------
  const ISO = 0.7375;                                  // 마름모 높이 ÷ 너비 (게임 지도와 같음)
  const BG = { href: '/sword/battlefield.webp', x: -410, y: -350, w: 800, h: 665 };   // 배경 사진 (원점 = 성검 제단)
  const VB = { x: BG.x, y: BG.y, w: BG.w, h: BG.h };
  const FIELD = { x: -20, w: 550, h: 405 };            // 전장 마름모 (가운데 x · 반너비 · 반높이) — 사진의 절벽 선에 맞춤, 꼭짓점은 사진 밖
  const CELL = 18;                                     // 격자 칸 반너비 (도시 하나 = 한 칸)
  const KIND = {   // 그림: w = 바닥 마름모 반너비, e = 높이, gh = 지붕 장식 높이 · 사진: img = [반너비, 위, 아래] (바닥 가운데 기준 사진 속 건물 범위)
    shrine: { w: 53, e: 15, gh: 49, c: 'shrine', img: [85, -93, 50] },
    sanctum: { w: 32, e: 11, gh: 21, c: 'sanctum', img: [52, -63, 28] },
    abbey: { w: 27, e: 10, gh: 28, c: 'abbey', img: [42, -55, 26] },
    tower: { w: 14, e: 32, gh: 15, c: 'buff', img: [35, -68, 17] },
    stable: { w: 27, e: 9, gh: 13, c: 'buff', img: [45, -45, 21] },
    camp: { w: 25, e: 10, gh: 24, c: 'buff', img: [48, -50, 23] },
    hall: { w: 28, e: 9, gh: 11, c: 'buff', img: [41, -32, 17] },
    cellar: { w: 11, e: 5, gh: 0, c: 'cellar', img: [30, -25, 12] },   // 숨겨진 땅굴 채집지 하나 (자리 하나 = 두 곳)
  };
  const PTS = { shrine: [9000, 4500, 1800, 900], sanctum: [6000, 3000, 1200, 600], abbey: [3000, 1500, 600, 300], buff: [1200, 600, 240, 120] };   // 첫 점령 연맹·개인, 분당 연맹·개인
  const POSTS = [
    { id: 'sanctumL', nm: '1호 성소', tag: '1호 성소', en: 'Sanctum', k: 'sanctum', x: -195, y: -57, pts: PTS.sanctum, fx: '성소 두 곳을 모두 잡으면 분당 점수가 성검 제단보다 많음' },
    { id: 'sanctumR', nm: '2호 성소', tag: '2호 성소', en: 'Sanctum', k: 'sanctum', x: 202, y: 67, pts: PTS.sanctum, fx: '성소 두 곳을 모두 잡으면 분당 점수가 성검 제단보다 많음' },
    { id: 'abbeyL', nm: '1호 수도원', tag: '1호 수도원', en: 'Abbey', k: 'abbey', x: -238, y: 42, pts: PTS.abbey },
    { id: 'abbeyB', nm: '2호 수도원', tag: '2호 수도원', en: 'Abbey', k: 'abbey', x: -113, y: 237, pts: PTS.abbey },
    { id: 'abbeyT', nm: '4호 수도원', tag: '4호 수도원', en: 'Abbey', k: 'abbey', x: 94, y: -232, pts: PTS.abbey },
    { id: 'abbeyR', nm: '3호 수도원', tag: '3호 수도원', en: 'Abbey', k: 'abbey', x: 235, y: -35, pts: PTS.abbey },
    { id: 'bell', nm: '시계탑', tag: '시계탑', en: 'Bell Tower', k: 'tower', x: -115, y: -235, pts: PTS.buff, fx: '우리 연맹의 건물 점령 시간 50% 감소' },
    { id: 'stables', nm: '마구간', tag: '마구간', en: 'Royal Stables', k: 'stable', x: 105, y: 232, pts: PTS.buff, fx: '무료 순간이동 대기 시간 50% 감소 (10분 → 5분)' },
    { id: 'shrine', nm: '성검 제단', tag: '성검 제단', en: 'Swordshrine', k: 'shrine', x: 0, y: 0, open: 15, pts: PTS.shrine, fx: '건물 하나로는 분당 점수가 가장 많음' },
    { id: 'merc', nm: '용병 주둔지', tag: '용병 주둔지', en: 'Mercenary Camp', k: 'camp', x: -10, y: -160, open: 15, pts: PTS.buff, fx: '적이 점령한 건물에 용병을 보내 적 주둔군의 공격·방어를 약화' },
    { id: 'reform', nm: '교화의 홀', tag: '교화의 홀', en: 'Hall of Reformation', k: 'hall', x: -2, y: 150, open: 15, pts: PTS.buff, fx: '우리 부대가 주는 피해 15% 증가 · 받는 피해 15% 감소' },
    // 숨겨진 땅굴: 성검 제단 둘레에 두 곳씩 네 자리, 시계 방향으로 부름 (x, y = 두 곳 가운데)
    ...[['cellar11', '11시', [[-160, -165], [-100, -113]]], ['cellar1', '1시', [[138, -165], [202, -113]]], ['cellar5', '5시', [[108, 99], [165, 150]]], ['cellar7', '7시', [[-178, 97], [-110, 147]]]]
      .map(([id, at, nodes]) => ({ id, nm: `${at} 숨겨진 땅굴`, tag: `${at} 땅굴`, en: 'Undercellars', k: 'cellar', nodes, x: (nodes[0][0] + nodes[1][0]) / 2, y: (nodes[0][1] + nodes[1][1]) / 2, open: 15,
        fx: '15분·20분에 두 번 나타나는 채집지 (미니맵 돋보기로 위치 확인), 채집하면 연맹·개인 점수' })),
  ];
  const GROUPS = [
    { id: 'attack', nm: '게릴라', en: 'Guerrilla', fx: '흩어져 다니며 적 주둔군·도시를 치고 빈 건물을 먼저 잡음 → 잡은 건물은 수비 인원에게 넘김', corner: 'tl' },
    { id: 'sub', nm: '후보', en: 'Substitutes', fx: '교체 인원 (최대 10명)', corner: 'bl' },
  ];
  const CELL_IMG = [30, -25, 12];                      // 사진 속 숨겨진 땅굴 범위 [반너비, 위, 아래]
  const SPAWNS = [{ side: 'blue', x: -351, y: 4, nm: '파랑 안전지대' }, { side: 'red', x: 342, y: 4, nm: '빨강 안전지대' }];
  const SPAWN_W = 62;
  const DECOR = [[35, -290], [-90, 35], [40, 270]];    // 사진 속 작은 장식물 (도시 칸을 놓지 않음)
  const BY = new Map([...POSTS, ...GROUPS].map(p => [p.id, p]));
  const ORDER = ['sanctumL', 'sanctumR', 'abbeyL', 'abbeyB', 'abbeyR', 'abbeyT', 'bell', 'stables', 'shrine', 'merc', 'reform', 'cellar11', 'cellar1', 'cellar5', 'cellar7', 'attack', 'sub'];
  const SECTIONS = [['시작부터 열린 건물', 0, 8], ['15분 뒤 열리는 곳', 8, 15], ['역할', 15, 17]];
  const ALIASES = { 마굿간: 'stables', 마구간: 'stables', 시계탑: 'bell', 종탑: 'bell', 용병: 'merc', 용병주둔지: 'merc', 교화: 'reform', '교화의홀': 'reform', 개혁: 'reform', 제단: 'shrine', 성검: 'shrine',
    '1호성소': 'sanctumL', '2호성소': 'sanctumR', '1호수도원': 'abbeyL', '2호수도원': 'abbeyB', '3호수도원': 'abbeyR', '4호수도원': 'abbeyT',
    '왼쪽 성소': 'sanctumL', '오른쪽 성소': 'sanctumR', '왼쪽 수도원': 'abbeyL', '아래 수도원': 'abbeyB', '오른쪽 수도원': 'abbeyR', '위 수도원': 'abbeyT', '왕실 마구간': 'stables', '용병 캠프': 'merc', '개혁의 전당': 'reform',   // 예전 이름
    ...Object.fromEntries(['11', '1', '5', '7'].flatMap(h => [`${h}시 숨겨진땅굴`, `${h}시 땅굴`, `${h}시땅굴`, `${h}시 지하저장고`, `${h}시 저장고`, `${h}시저장고`].map(a => [a, 'cellar' + h]))), 게릴라: 'attack', 공격: 'attack', 공격조: 'attack', 후보: 'sub' };
  const LIMIT = { main: 30, sub: 10 };
  const postName = id => (BY.get(id) || { nm: '미배치' }).nm;

  // ---------- 상태 ----------
  let pub = null, pubNorm = '', baseNorm = '', stamp = '';   // 게시본 · 비교용 문자열 · 편집을 시작한 게시본 · 게시 시각
  let data = null, li = 0, phase = 1, sel = '', editing = false, showNames = true, k = 1;
  let photo = true;   // 배경: 실제 지도 사진(기본) / 그림 — 보는 사람 브라우저에 기억
  try { photo = localStorage.getItem('ks-sword-photo') !== '0'; } catch (_) { /* 기본값 */ }
  let roster = [], rosterMap = new Map();   // /v2 배치도 연맹원 (소문자 → 원래 이름)
  let token = null;
  try { token = sessionStorage.getItem(TOKEN_KEY); } catch (_) { /* no session storage */ }
  const cur = () => data.legions[li];
  const postOf = (m, ph) => (ph === 2 ? m.then || m.at : m.at);
  const leadFirst = list => [...list.filter(m => m.lead), ...list.filter(m => !m.lead)];
  const membersAt = (L, id, ph) => leadFirst(L.members.filter(m => postOf(m, ph) === id));
  const findIn = (L, name) => L.members.find(m => low(m.n) === low(name));
  const inRoster = n => !roster.length || rosterMap.has(low(n));
  const noteOf = (L, id) => (L.notes && L.notes[id]) || '';

  function normalize(d) {   // 이상한 값 버리고 키 순서를 맞춤 (게시본 비교·저장 형식)
    const src = d && Array.isArray(d.legions) ? d.legions : [];
    const legions = [];
    for (let i = 0; i < Math.max(2, Math.min(src.length, 4)); i++) {
      const l = src[i] || {}, seen = new Set(), members = [];
      for (const m of Array.isArray(l.members) ? l.members : []) {
        const n = clean(m && m.n).slice(0, 40);
        if (!n || seen.has(n.toLowerCase())) continue;
        seen.add(n.toLowerCase());
        const o = { n, at: BY.has(m.at) ? m.at : '' };
        if (BY.has(m.then) && m.then !== o.at) o.then = m.then;
        if (m.lead === true) o.lead = true;
        members.push(o);
      }
      const o = { name: clean(l.name).slice(0, 30) || `군단 ${i + 1}`, side: l.side === 'red' ? 'red' : 'blue' };
      if (typeof l.memo === 'string' && l.memo.trim()) o.memo = l.memo.slice(0, 1000);
      const notes = {};
      if (l.notes && typeof l.notes === 'object') for (const id of ORDER) { const t = clean(l.notes[id]).slice(0, 100); if (t) notes[id] = t; }
      if (Object.keys(notes).length) o.notes = notes;
      o.members = members;
      legions.push(o);
    }
    return { legions };
  }
  const canon = d => JSON.stringify(normalize(d));
  const clone = d => JSON.parse(JSON.stringify(d));

  // ---------- 불러오기 ----------
  function fail(msg) { const n = $('notice'); n.textContent = msg; n.className = 'notice err'; n.hidden = false; }
  async function fetchPlan() {
    for (const url of [API, FILE]) {
      try {
        const r = await fetch(url, { cache: 'no-cache' });
        if (r.ok) return { d: await r.json(), stamp: r.headers.get('X-Layout-Updated') || '' };
      } catch (_) { /* 다음 경로 */ }
    }
    throw new Error('불러오기 실패');
  }
  async function loadRoster() {   // 연맹원 이름 기준: /v2 배치도 게시본 (빈자리·개척자 제외)
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
    const qs = new URLSearchParams(location.search);
    li = Math.min(Math.max((+qs.get('l') || 1) - 1, 0), data.legions.length - 1);
    phase = qs.get('p') === '2' ? 2 : 1;
    sel = BY.has(qs.get('b')) ? qs.get('b') : '';
    $('notice').hidden = true; $('main').hidden = false;
    await loadRoster();
    if (qs.get('q')) { $('q').value = qs.get('q'); search(); }
    renderAll();
    if (qs.has('edit')) startEdit();
  }

  // ---------- 지도 (SVG) ----------
  const PAL = ['cliff', 'sand', 'edge', 'grid', 'blue', 'red', 'shrine', 'sanctum', 'abbey', 'buff', 'cellar', 'tagbg', 'tagline', 'ink', 'muted', 'sel', 'lock', 'lead', 'bg'];
  function palette() { const cs = getComputedStyle(document.documentElement), P = {}; for (const n of PAL) P[n] = cs.getPropertyValue('--sw-' + n).trim(); return P; }
  function shade(hex, f) {   // f < 0 어둡게, f > 0 밝게
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const v = parseInt(m[1], 16), t = f < 0 ? 0 : 255, a = Math.abs(f);
    return '#' + [16, 8, 0].map(s => Math.round(((v >> s) & 255) * (1 - a) + t * a).toString(16).padStart(2, '0')).join('');
  }
  const mctx = document.createElement('canvas').getContext('2d');
  const tw = (s, px, wt, font) => { mctx.font = `${wt} ${px}px ${font}`; return mctx.measureText(s).width; };
  const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const VBR = [VB.x, VB.y, VB.x + VB.w, VB.y + VB.h];
  const diamond = (x, y, w) => `${r1(x - w)},${r1(y)} ${r1(x)},${r1(y - w * ISO)} ${r1(x + w)},${r1(y)} ${r1(x)},${r1(y + w * ISO)}`;
  function box(x, y, w, e, c) {   // 바닥 (x, y) 위에 선 마름모 상자
    const h = w * ISO, t = y - e;
    const P = a => a.map(v => r1(v)).join(',');
    return `<polygon points="${P([x - w, t])} ${P([x, t + h])} ${P([x, y + h])} ${P([x - w, y])}" fill="${shade(c, -0.22)}"/>` +
      `<polygon points="${P([x, t + h])} ${P([x + w, t])} ${P([x + w, y])} ${P([x, y + h])}" fill="${shade(c, -0.4)}"/>` +
      `<polygon points="${diamond(x, t, w)}" fill="${c}"/>`;
  }
  function glyph(kind, x, y, c, P) {   // 지붕 장식 (y = 지붕면 가운데)
    const L = shade(c, 0.45), D = shade(c, -0.5);
    switch (kind) {
      case 'shrine': return `<polygon points="${x - 3},${y - 3} ${x + 3},${y - 3} ${x + 3},${y - 30} ${x - 3},${y - 30}" fill="#ece7da" stroke="${D}" stroke-width="1"/>` +
        `<rect x="${x - 12}" y="${y - 34}" width="24" height="5" rx="2" fill="${D}"/><rect x="${x - 2.5}" y="${y - 42}" width="5" height="9" fill="${D}"/><circle cx="${x}" cy="${y - 44}" r="3.5" fill="${L}" stroke="${D}" stroke-width="1"/>`;
      case 'sanctum': return `<path d="M${x - 13},${y} A13 13 0 0 1 ${x + 13},${y} Z" fill="${L}"/><line x1="${x}" y1="${y - 13}" x2="${x}" y2="${y - 20}" stroke="${D}" stroke-width="2"/>`;
      case 'abbey': return `<polygon points="${x - 8},${y - 1} ${x + 8},${y - 1} ${x},${y - 26}" fill="${L}"/><polygon points="${x + 6},${y + 2} ${x + 15},${y + 2} ${x + 10.5},${y - 12}" fill="${L}" opacity=".8"/>`;
      case 'tower': return `<polygon points="${x - 14},${y} ${x + 14},${y} ${x},${y - 14}" fill="${P.lock}"/>`;
      case 'stable': return `<path d="M${x - 9},${y + 1} A9 9 0 1 1 ${x + 9},${y + 1}" fill="none" stroke="${L}" stroke-width="3.5" stroke-linecap="round"/>`;
      case 'camp': return `<polygon points="${x - 12},${y + 2} ${x + 12},${y + 2} ${x},${y - 15}" fill="${L}"/><line x1="${x}" y1="${y - 15}" x2="${x}" y2="${y - 23}" stroke="${D}" stroke-width="1.5"/><polygon points="${x},${y - 23} ${x + 8},${y - 20.5} ${x},${y - 18}" fill="${P.lock}"/>`;
      case 'hall': return `<ellipse cx="${x}" cy="${y}" rx="15" ry="${r1(15 * ISO)}" fill="none" stroke="${L}" stroke-width="3.5"/>`;
      default: return '';
    }
  }

  /* 지도 SVG 내용. o = { k: 화면 1px당 지도 단위, P: 색, font, L: 군단, ph: 1|2, sel, names: 이름 표시, photo: 배경 사진 주소(없으면 그림), view: 보이는 범위(없으면 전체) }
   * 글자 크기는 화면 px 기준(k를 곱함)이라 지도를 키우거나 줄여도 같은 크기로 보입니다.
   * 배치 인원은 도시(격자 한 칸)로, 그 건물에서 가까운 빈칸부터 한쪽에 모아 놓습니다(사람 많은 건물부터). 자리가 화면 크기와 상관없이 같도록
   * 건물·그 아래 이름표 자리(고정 크기)·안전지대·숨겨진 땅굴·장식물만 피해서 정합니다. */
  function mapSVG(o) {
    const { k: kk, P, L, ph, font } = o, photo = !!o.photo;
    const f = v => r1(v), px = v => r1(v * kk);
    const T = (x, y, s, size, a = {}) => `<text x="${f(x)}" y="${f(y)}" font-size="${px(size)}" font-weight="${a.wt || 600}" fill="${a.fill || P.ink}" text-anchor="${a.anchor || 'middle'}" dominant-baseline="central"` +
      (a.halo ? ` stroke="${a.halo}" stroke-width="${px(a.hw || 3)}" stroke-linejoin="round" paint-order="stroke"` : '') + `>${s}</text>`;
    const rect = (r, attrs) => `<rect x="${f(r[0])}" y="${f(r[1])}" width="${f(r[2] - r[0])}" height="${f(r[3] - r[1])}" ${attrs}/>`;
    const dash = w => `fill="none" stroke="${P.sel}" stroke-width="${px(w)}" stroke-dasharray="${px(7)} ${px(4)}"`;
    const ground = [], over = [], obst = [], block = [];   // obst = 글자가 피할 곳 [x1, y1, x2, y2, 무게] · block = 도시 칸이 피할 곳 (화면 크기와 무관)
    const A = CELL, B = CELL * ISO, N = 40;
    const roomy = o.names && A * 2 / kk >= 24;   // 도시에 이름이 들어갈 만큼 크게 보일 때만 도시 이름
    const roomyNote = o.names && kk < 1.3;          // 지도 위 자리 메모·모서리 상자 이름 줄 (휴대폰 1배는 확대하면 보임)
    const fieldPts = `${FIELD.x - FIELD.w},0 ${FIELD.x},${-FIELD.h} ${FIELD.x + FIELD.w},0 ${FIELD.x},${FIELD.h}`;

    // 바탕: 실제 지도 사진 또는 그림, 그 위에 도시 한 칸 크기 격자 (전장 안만)
    if (photo) ground.push(`<image href="${o.photo}" x="${BG.x}" y="${BG.y}" width="${BG.w}" height="${BG.h}" preserveAspectRatio="none"/>`);
    else ground.push(rect([VB.x, VB.y, VB.x + VB.w, VB.y + VB.h], `fill="${P.cliff}"`) + `<polygon points="${fieldPts}" fill="${P.sand}" stroke="${P.edge}" stroke-width="${px(3)}" stroke-linejoin="round"/>`);
    const g = [];
    for (let t = -N; t <= N; t++) {   // 칸 가운데 = ((i - j)·A, (i + j)·B), 선은 칸 경계 (i 또는 j = 정수 + ½)
      const u = t + 0.5;
      g.push(`M${f((u + N) * A)},${f((u - N) * B)}L${f((u - N) * A)},${f((u + N) * B)}`, `M${f((-N - u) * A)},${f((u - N) * B)}L${f((N - u) * A)},${f((N + u) * B)}`);
    }
    ground.push(`<clipPath id="swclip"><polygon points="${fieldPts}"/></clipPath><path d="${g.join('')}" clip-path="url(#swclip)" fill="none" stroke="${photo ? 'rgba(255,244,225,.3)' : P.grid}" stroke-width="${px(photo ? 0.8 : 1)}"/>`);

    for (const sp of SPAWNS) {   // 진영 (안전지대)
      const ours = L.side === sp.side, c = P[sp.side], w = SPAWN_W, h = w * ISO;
      if (!photo) ground.push(`<polygon points="${diamond(sp.x, sp.y, w)}" fill="${c}" fill-opacity="${ours ? 0.34 : 0.2}" stroke="${c}" stroke-width="${px(ours ? 3 : 2)}"/>`);
      else if (ours) ground.push(`<polygon points="${diamond(sp.x, sp.y, w + 4)}" fill="none" stroke="${P.tagbg}" stroke-width="${px(2)}" stroke-dasharray="${px(6)} ${px(4)}"/>`);
      over.push(T(sp.x, sp.y - px(8), ours ? '우리 진영' : '적 진영', 12.5, { fill: c, wt: 700, halo: P.tagbg }) + T(sp.x, sp.y + px(9), sp.nm, 11, { fill: c, wt: 500, halo: P.tagbg }));
      const r = [sp.x - w, sp.y - h, sp.x + w, sp.y + h];
      obst.push([...r, 1]); block.push(r);
    }
    for (const [x, y] of DECOR) block.push([x - 22, y - 18, x + 22, y + 12]);

    const cellOn = ph === 2, CPOSTS = POSTS.filter(p => p.k === 'cellar');   // 숨겨진 땅굴는 15분부터
    for (const cp of CPOSTS) for (const [x, y] of cp.nodes) {
      const r = photo ? [x - CELL_IMG[0], y + CELL_IMG[1], x + CELL_IMG[0], y + CELL_IMG[2]] : [x - 12, y - 14, x + 12, y + 9], on = o.sel === cp.id;
      ground.push(`<g data-post="${cp.id}"${!photo && !cellOn ? ' opacity=".4"' : ''}>` + (photo
        ? rect(r, 'fill="transparent"') + (on ? rect([r[0] - 3, r[1] - 3, r[2] + 3, r[3] + 3], `rx="${px(5)}" ${dash(2.5)}`) : '')
        : (on ? `<polygon points="${diamond(x, y, 19)}" fill="none" stroke="${P.sel}" stroke-width="${px(2.5)}"/>` : '') + `<polygon points="${diamond(x, y, 18)}" fill="transparent"/>${box(x, y, 11, 5, P.cellar)}`) + '</g>');
      obst.push([...r, 0.15]); block.push(r);
    }

    const labels = [], badges = [];   // 이름표·메모 범위 (배지 자리 고를 때) · 나중에 놓을 인원 수 배지
    for (const p of POSTS) {
      if (p.k === 'cellar') continue;   // 숨겨진 땅굴는 아래에서 이름표만
      const K = KIND[p.k], c = P[K.c], h = K.w * ISO, locked = ph === 1 && p.open, on = o.sel === p.id;
      const mem = membersAt(L, p.id, ph), note = noteOf(L, p.id);
      const bb = photo ? [p.x - K.img[0], p.y + K.img[1], p.x + K.img[0], p.y + K.img[2]] : [p.x - K.w, p.y - K.e - Math.max(h, K.gh), p.x + K.w, p.y + h];
      ground.push(`<g data-post="${p.id}" tabindex="0" role="button" aria-label="${esc(p.nm)} ${mem.length}명"${locked && !photo ? ' opacity=".5"' : ''}>` + (photo
        ? rect(bb, 'fill="transparent"') + (on ? rect([bb[0] - 3, bb[1] - 3, bb[2] + 3, bb[3] + 3], `rx="${px(6)}" ${dash(3)}`) : '')
        : `<polygon points="${diamond(p.x, p.y, K.w + 12)}" fill="transparent"/>` + (on ? `<polygon points="${diamond(p.x, p.y, K.w + 9)}" ${dash(3)}/>` : '') + box(p.x, p.y, K.w, K.e, c) + glyph(p.k, p.x, p.y - K.e, c, P)) + '</g>');
      obst.push([...bb, 1]);
      // 도시 칸이 피할 곳: 건물 + 그 아래 이름표 자리 (+ 자리 메모 줄)
      const zw = Math.max(bb[2] - p.x, 36);
      block.push(bb, [p.x - zw, bb[3], p.x + zw, bb[3] + 22]);
      if (note) { const nz = Math.max(zw, note.length * 4.6 + 12); block.push([p.x - nz, bb[3] + 20, p.x + nz, bb[3] + 38]); }
      // 이름표 (+ 15분) · 자리 메모 · 인원 수
      const th = px(19), tagW = tw(p.tag, 13, 600, font) * kk + px(12);
      const lockW = locked ? tw('15분', 10, 600, font) * kk + px(10) : 0;
      const allW = tagW + (locked ? lockW + px(3) : 0), tx = p.x - allW / 2, ty = bb[3] + px(photo ? 2 : 4);
      let s = `<g data-post="${p.id}">` + rect([tx, ty, tx + tagW, ty + th], `rx="${px(4)}" fill="${P.tagbg}" stroke="${on ? P.sel : P.tagline}" stroke-width="${px(on ? 2 : 1)}"`) + T(tx + tagW / 2, ty + th / 2, esc(p.tag), 13);
      if (locked) s += rect([tx + tagW + px(3), ty + px(2), tx + tagW + px(3) + lockW, ty + th - px(2)], `rx="${f((th - px(4)) / 2)}" fill="${P.lock}"`) + T(tx + tagW + px(3) + lockW / 2, ty + th / 2, '15분', 10, { fill: '#ffffff' });
      obst.push([tx, ty, tx + allW, ty + th, 1]); labels.push([tx, ty, tx + allW, ty + th]);
      if (note && roomyNote) {
        const ns = '※ ' + note, nw = tw(ns, 11, 500, font) * kk + px(10), nh = px(16), ny = ty + th + px(2);
        s += rect([p.x - nw / 2, ny, p.x + nw / 2, ny + nh], `rx="${px(3)}" fill="${P.tagbg}" fill-opacity=".93"`) + T(p.x, ny + nh / 2, esc(ns), 11, { wt: 500, fill: P.lead });
        obst.push([p.x - nw / 2, ny, p.x + nw / 2, ny + nh, 1]); labels.push([p.x - nw / 2, ny, p.x + nw / 2, ny + nh]);
      }
      if (mem.length) badges.push({ p, K, bb, n: mem.length });
      over.push(s + '</g>');
    }
    for (const { p, K, bb, n } of badges) {   // 오른쪽 위 → 왼쪽 위 → 오른쪽 → 왼쪽 중 다른 이름표와 안 겹치는 곳
      const br = px(n > 9 ? 11 : 9.5), hw = photo ? K.img[0] : K.w, top = bb[1] + px(photo ? 6 : 4);
      const cands = [[p.x + hw * 0.7, top], [p.x - hw * 0.7, top], [p.x + hw + br, (bb[1] + bb[3]) / 2], [p.x - hw - br, (bb[1] + bb[3]) / 2]];
      let bx = cands[0][0], by = cands[0][1], best = Infinity;
      cands.forEach(([x, y], j) => { const r = [x - br, y - br, x + br, y + br]; const sc = labels.reduce((t, b) => t + overlap(r, b), 0) + (4 * br * br - overlap(r, VBR)) * 3 + j * 1e-3; if (sc < best) { best = sc; bx = x; by = y; } });
      over.push(`<g data-post="${p.id}"><circle cx="${f(bx)}" cy="${f(by)}" r="${f(br)}" fill="${P.ink}" stroke="${P.tagbg}" stroke-width="${px(1.5)}"/>` + T(bx, by, n, 11, { fill: P.tagbg, wt: 700 }) + '</g>');
      obst.push([bx - br, by - br, bx + br, by + br, 1]); labels.push([bx - br, by - br, bx + br, by + br]);
    }

    // 숨겨진 땅굴 이름표: 공략 그림처럼 두 곳씩 짝지은 가운데에 하나씩 + 인원 수 (그림 지도는 시작 ~ 15분에 흐리게).
    // 지도가 작아 다른 이름표와 겹치면 옆(바깥·안쪽)이나 위·아래 상자 쪽으로 비킴
    const fits = r => obst.reduce((t, b) => t + overlap(r, b) * b[4], 0) + ((r[2] - r[0]) * (r[3] - r[1]) - overlap(r, VBR)) * 3;
    for (const cp of CPOSTS) {
      const [a, b] = cp.nodes[0][1] < cp.nodes[1][1] ? cp.nodes : [cp.nodes[1], cp.nodes[0]];
      const mx = cp.x, my = cp.y, out = Math.sign(mx), on = o.sel === cp.id, n = membersAt(L, cp.id, ph).length;
      const th = px(17), w = tw(cp.tag, 11.5, 600, font) * kk + px(10) + (n ? px(20) : 0);
      const cands = [[mx, my], [mx + out * w * 0.35, my], [mx - out * w * 0.35, my], [mx + out * w * 0.7, my], [mx - out * w * 0.7, my],
        [a[0], a[1] + (photo ? CELL_IMG[1] : -14) - px(4) - th / 2], [b[0], b[1] + (photo ? CELL_IMG[2] : 9) + px(4) + th / 2]];
      let cx = mx, cy = my, best = Infinity;
      cands.forEach(([x, y], j) => { const sc = fits([x - w / 2, y - th / 2, x + w / 2, y + th / 2]) + j * 1e-3; if (sc < best) { best = sc; cx = x; cy = y; } });
      over.push(`<g data-post="${cp.id}"${cellOn || photo || n ? '' : ' opacity=".6"'}>` + rect([cx - w / 2, cy - th / 2, cx + w / 2, cy + th / 2], `rx="${px(4)}" fill="${P.tagbg}" stroke="${on ? P.sel : P.cellar}" stroke-width="${px(on ? 2 : 1)}"`) +
        T(cx - (n ? px(10) : 0), cy, esc(cp.tag), 11.5) + (n ? `<circle cx="${f(cx + w / 2 - px(10))}" cy="${f(cy)}" r="${px(7)}" fill="${P.ink}"/>` + T(cx + w / 2 - px(10), cy, n, 10, { fill: P.tagbg, wt: 700 }) : '') + '</g>');
      obst.push([cx - w / 2, cy - th / 2, cx + w / 2, cy + th / 2, 1]);
      block.push([mx - 36, my - 9, mx + 36, my + 9]);
    }

    // 역할(게릴라·후보)은 지도 모서리 상자 (자리 메모 + 이름) — 오른쪽 위는 확대 버튼 자리
    const boxes = [], zoomedIn = o.view && o.view.w < VB.w - 1;   // 확대 중에는 모서리 상자가 도시를 가려서 숨김 (명단은 지도 아래 목록)
    for (const gr of zoomedIn ? [] : GROUPS) {
      const mem = membersAt(L, gr.id, ph), on = o.sel === gr.id, note = noteOf(L, gr.id);
      const title = `${gr.nm} ${mem.length}`, titleW = tw(title, 13, 600, font) * kk;
      const lockW = gr.open && ph === 1 ? tw('15분', 10, 600, font) * kk + px(10) : 0;   // 숨겨진 땅굴: 15분부터
      const lines = [...(note ? [{ s: '※ ' + note, note: true }] : []), ...(roomyNote && mem.length ? wrap(mem.map(m => (m.lead ? '★' : '') + m.n), 12.5, 170, font).map(t => ({ s: t })) : [])];
      const lh = px(16), pad = px(6);
      const bw = Math.max(px(13) + titleW + (lockW ? px(4) + lockW : 0), ...lines.map(l => tw(l.s, 12.5, l.note ? 500 : 400, font) * kk)) + pad * 2;
      const bh = px(19) + lines.length * lh + pad * (lines.length ? 1.4 : 0.6);
      const V = o.view || VB;   // 확대해도 보이는 범위의 모서리에
      const x = gr.corner[1] === 'r' ? V.x + V.w - px(8) - bw : V.x + px(8);
      const y = gr.corner[0] === 'b' ? V.y + V.h - px(8) - bh : V.y + px(8);
      let s = `<g data-post="${gr.id}" tabindex="0" role="button" aria-label="${esc(gr.nm)} ${mem.length}명">` + rect([x, y, x + bw, y + bh], `rx="${px(5)}" fill="${P.tagbg}" fill-opacity=".94" stroke="${on ? P.sel : P.tagline}" stroke-width="${px(on ? 2.5 : 1)}"`);
      s += rect([x + pad, y + pad + px(3.5), x + pad + px(9), y + pad + px(12.5)], `rx="${px(2)}" fill="${gr.id === 'attack' ? P.red : P.muted}"`);
      s += T(x + pad + px(13), y + pad + px(8.5), esc(title), 13, { anchor: 'start' });
      if (lockW) {
        const lx = x + pad + px(17) + titleW;
        s += rect([lx, y + pad + px(1.5), lx + lockW, y + pad + px(15.5)], `rx="${px(7)}" fill="${P.lock}"`) + T(lx + lockW / 2, y + pad + px(8.5), '15분', 10, { fill: '#ffffff' });
      }
      lines.forEach((l, i) => { s += T(x + pad, y + pad + px(19) + lh * (i + 0.5) + px(2), esc(l.s), 12.5, { anchor: 'start', wt: l.note ? 500 : 400, fill: l.note ? P.lead : P.ink }); });
      boxes.push(s + '</g>');
      obst.push([x, y, x + bw, y + bh, 1]);
    }

    // 배치 인원 = 도시(격자 한 칸): 건물 바닥 가운데에서 가까운 빈칸부터 (마름모 거리)
    const cells = [], cw = A * 0.85, ch = B * 0.85;
    for (let i = -N; i <= N; i++) {
      for (let j = -N; j <= N; j++) {
        const x = (i - j) * A, y = (i + j) * B;
        if (Math.abs(x - FIELD.x) / (FIELD.w - A) + Math.abs(y) / (FIELD.h - B) > 1) continue;
        if (x - A < VB.x || x + A > VB.x + VB.w || y - B - 4 < VB.y || y + B > VB.y + VB.h) continue;
        if (block.some(r => x - cw < r[2] && x + cw > r[0] && y - ch - 4 < r[3] && y + ch > r[1])) continue;
        cells.push({ x, y });
      }
    }
    const taken = new Set(), cities = [];
    const groups = POSTS.map(p => ({ p, mem: membersAt(L, p.id, ph) })).filter(e => e.mem.length).sort((a, b) => b.mem.length - a.mem.length);
    const dist = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) / ISO);
    for (const { p, mem } of groups) {
      const near = cells.map((c, i) => ({ i, d: dist(c, p) })).filter(e => !taken.has(e.i)).sort((a, b) => a.d - b.d).slice(0, mem.length * 12 + 20);
      const mine = [];
      for (const m of mem) {
        const cen = mine.length ? { x: mine.reduce((t, c) => t + c.x, 0) / mine.length, y: mine.reduce((t, c) => t + c.y, 0) / mine.length } : null;
        let pick = null, best = Infinity;
        for (const e of near) { if (taken.has(e.i)) continue; const sc = e.d + (cen ? 0.8 * dist(cells[e.i], cen) : 0); if (sc < best) { best = sc; pick = e.i; } }
        if (pick === null) break;
        taken.add(pick); mine.push(cells[pick]); cities.push({ m, p, ...cells[pick] });
      }
    }
    cities.sort((a, b) => a.y - b.y || a.x - b.x);   // 뒤(위) 칸부터 그려 앞 칸이 덮게
    const town = cities.map(({ m, p, x, y }) => {
      const w = A * 0.93, e = 4, c = P[L.side];
      let s = `<g data-post="${p.id}"><title>${esc(m.n)} · ${esc(p.nm)}</title>` + box(x, y, w, e, c) +
        `<polygon points="${diamond(x, y - e, w)}" fill="none" stroke="${m.lead ? P.lead : photo ? 'rgba(255,255,255,.85)' : shade(c, 0.4)}" stroke-width="${px(m.lead ? 2 : 0.8)}"/>`;
      if (roomy) {   // 칸 폭에 맞게 글자를 줄이고, 그래도 길면 … (전체 이름은 목록·정보 상자에)
        const full = (m.lead ? '★' : '') + m.n, maxW = A * 2;
        let size = 12, txt = full;
        const wd = tw(full, size, 600, font) * kk;
        if (wd > maxW) size = Math.max(8, size * maxW / wd);
        if (tw(txt, size, 600, font) * kk > maxW) { while (txt.length > 1 && tw(txt + '…', size, 600, font) * kk > maxW) txt = txt.slice(0, -1); txt += '…'; }
        s += T(x, y - e, esc(txt), size, { halo: P.tagbg, hw: 2.6 });
      }
      return s + '</g>';
    });
    return ground.join('') + town.join('') + over.join('') + boxes.join('');
  }
  function wrap(items, size, maxPx, font) {   // 'a · b · c'를 maxPx 폭으로 줄 나눔
    const lines = [];
    let line = '';
    for (const it of items) {
      const t = line ? `${line} · ${it}` : it;
      if (line && tw(t, size, 400, font) > maxPx) { lines.push(line); line = it; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  const svg = $('map');
  // 지금 보이는 지도 범위 (viewBox = svg 칸과 같은 비율, 1배 = 지도 전체가 들어가는 크기). 확대·이동은 이것만 바꾸고, 손을 뗀 뒤 다시 그려 글자·도시 이름 크기를 맞춤
  const ZMAX = 4, wrapEl = svg.closest('.swwrap');
  let view = { ...VB, z: 1 }, suppressClick = 0, gesture = false, rtimer = 0;
  const zoomOf = () => view.z;
  const isFull = () => wrapEl.classList.contains('full');
  function sizeAt(z) {   // z배일 때 보이는 범위 크기 (지도 단위)
    const r = svg.getBoundingClientRect(), cw = r.width || VB.w, ch = r.height || VB.h, sc = Math.min(cw / VB.w, ch / VB.h) * z;
    return { w: cw / sc, h: ch / sc };
  }
  function drawnRect() {   // svg 안에서 지도가 실제로 그려진 범위 (preserveAspectRatio meet)
    const r = svg.getBoundingClientRect(), s = Math.min(r.width / view.w, r.height / view.h) || 1;
    return { left: r.left + (r.width - view.w * s) / 2, top: r.top + (r.height - view.h * s) / 2, width: view.w * s, height: view.h * s };
  }
  function measureK() { const r = drawnRect(); return r.width ? view.w / r.width : 1; }
  const toMap = (cx, cy) => { const r = drawnRect(); return { x: view.x + (cx - r.left) / r.width * view.w, y: view.y + (cy - r.top) / r.height * view.h, fx: (cx - r.left) / r.width, fy: (cy - r.top) / r.height }; };
  function renderMap() {
    clearTimeout(rtimer);
    k = measureK();
    // 지도가 아주 작게 그려지면(휴대폰 1배) 글자를 조금 줄여 건물을 덜 가리게
    svg.innerHTML = mapSVG({ k: k > 1.6 ? k * 0.82 : k, P: palette(), font: FONT, L: cur(), ph: phase, sel, names: showNames, photo: photo && BG.href, view });
  }
  // (cx, cy) = 가운데 둘 지도 좌표, quick = viewBox만 바꾸고 다시 그리기는 나중에 (손가락으로 움직이는 중)
  function setView(cx, cy, z, quick) {
    z = Math.min(ZMAX, Math.max(1, z));
    const { w, h } = sizeAt(z);
    const fit = (c, size, lo, span) => (size >= span ? lo + (span - size) / 2 : Math.min(lo + span - size, Math.max(lo, c - size / 2)));   // 지도보다 넓으면 가운데, 아니면 지도 안에서만
    view = { x: fit(cx, w, VB.x, VB.w), y: fit(cy, h, VB.y, VB.h), w, h, z };
    svg.setAttribute('viewBox', `${r1(view.x)} ${r1(view.y)} ${r1(w)} ${r1(h)}`);
    svg.style.touchAction = z > 1.01 || isFull() ? 'none' : 'pan-y';   // 1배에서는 한 손가락으로 페이지를 넘길 수 있게
    svg.classList.toggle('zoomed', z > 1.01);
    if (!quick) { if (data) renderMap(); } else if (!gesture) { clearTimeout(rtimer); rtimer = setTimeout(() => data && renderMap(), 150); }
  }
  // 화면 점 (px, py)의 지도 자리를 그대로 두고 z배로
  function zoomTo(px, py, z, quick) {
    const p = toMap(px, py);
    z = Math.min(ZMAX, Math.max(1, z));
    const { w, h } = sizeAt(z);
    setView(p.x - p.fx * w + w / 2, p.y - p.fy * h + h / 2, z, quick);
  }
  const center = () => { const r = drawnRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  $('zin').onclick = () => zoomTo(...center(), zoomOf() * 1.6);
  $('zout').onclick = () => zoomTo(...center(), zoomOf() / 1.6);
  $('fit').onclick = () => setView(0, 0, 1);
  function setFull(on, fromPop) {
    if (on === isFull()) return;
    wrapEl.classList.toggle('full', on); document.body.classList.toggle('swfull', on);
    $('full').textContent = on ? '닫기' : '크게'; $('full').setAttribute('aria-pressed', on);
    if (on) history.pushState({ ...(history.state || {}), swfull: 1 }, '');
    if (on && view.z < 2) setView(view.x + view.w / 2, view.y + view.h / 2, 2);   // 세로 화면이 비지 않고 도시 이름이 보이게 2배로 열기
    else if (!fromPop && history.state && history.state.swfull) history.back();
  }
  $('full').onclick = () => setFull(!isFull());
  window.addEventListener('popstate', () => { if (isFull()) setFull(false, true); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isFull()) setFull(false); });
  new ResizeObserver(() => { if (data) setView(view.x + view.w / 2, view.y + view.h / 2, view.z); }).observe(svg);   // 칸 크기·비율이 바뀌면 (크게·화면 회전) 다시 맞춤
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => data && renderMap());
  if (document.fonts) document.fonts.ready.then(() => data && renderMap());

  // 데스크톱: Ctrl+휠(터치패드 확대 포함)로 확대, 확대 중 끌어서 이동
  svg.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomTo(e.clientX, e.clientY, zoomOf() * Math.exp(-e.deltaY * 0.004), true);
  }, { passive: false });
  let mdrag = null;
  svg.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || zoomOf() <= 1.01) return;
    mdrag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: view.x + view.w / 2, cy: view.y + view.h / 2, moved: false };
  });
  window.addEventListener('pointermove', e => {
    if (!mdrag || e.pointerId !== mdrag.id) return;
    const dx = e.clientX - mdrag.x, dy = e.clientY - mdrag.y;
    if (!mdrag.moved && Math.hypot(dx, dy) < 4) return;
    mdrag.moved = gesture = true; svg.classList.add('drag');
    const s = view.w / drawnRect().width;
    setView(mdrag.cx - dx * s, mdrag.cy - dy * s, zoomOf(), true);
  });
  window.addEventListener('pointerup', e => {
    if (!mdrag || e.pointerId !== mdrag.id) return;
    if (mdrag.moved) { suppressClick = Date.now(); gesture = false; renderMap(); }
    svg.classList.remove('drag'); mdrag = null;
  });

  // 휴대폰: 두 손가락 벌리기·오므리기, 두 번 눌러 확대(최대면 전체로), 확대 중 한 손가락으로 이동.
  // 움직이는 동안은 viewBox만 바꾸고 손을 떼면 다시 그림 (그리는 중에 손가락 아래 요소가 바뀌면 터치가 끊김)
  let tch = null, lastTap = null;
  const tdist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  function startPan(t) { tch = { mode: 'pan', x: t.clientX, y: t.clientY, cx: view.x + view.w / 2, cy: view.y + view.h / 2, moved: false }; }
  svg.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      tch = { mode: 'pinch', d0: tdist(a, b) || 1, z0: zoomOf(), p: toMap((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2), moved: true };
      gesture = true;
    } else if (e.touches.length === 1) startPan(e.touches[0]);
  }, { passive: false });
  svg.addEventListener('touchmove', e => {
    if (!tch) return;
    if (tch.mode === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches, z = Math.min(ZMAX, Math.max(1, tch.z0 * tdist(a, b) / tch.d0));
      const r = drawnRect(), fx = ((a.clientX + b.clientX) / 2 - r.left) / r.width, fy = ((a.clientY + b.clientY) / 2 - r.top) / r.height;
      const { w, h } = sizeAt(z);
      setView(tch.p.x - fx * w + w / 2, tch.p.y - fy * h + h / 2, z, true);
    } else if (tch.mode === 'pan' && e.touches.length === 1 && zoomOf() > 1.01) {
      const t = e.touches[0], dx = t.clientX - tch.x, dy = t.clientY - tch.y;
      if (!tch.moved && Math.hypot(dx, dy) < 6) return;
      e.preventDefault();
      tch.moved = gesture = true;
      const s = view.w / drawnRect().width;
      setView(tch.cx - dx * s, tch.cy - dy * s, zoomOf(), true);
    } else if (tch.mode === 'pan') {
      const t = e.touches[0];
      if (t && Math.hypot(t.clientX - tch.x, t.clientY - tch.y) >= 6) tch.moved = true;   // 1배에서 페이지 넘기는 중
    }
  }, { passive: false });
  svg.addEventListener('touchend', e => {
    if (!tch) return;
    if (e.touches.length === 1 && tch.mode === 'pinch') { startPan(e.touches[0]); tch.moved = true; return; }   // 한 손가락만 떼면 이어서 이동
    if (e.touches.length) return;
    const was = tch;
    tch = null;
    if (was.moved) { suppressClick = Date.now(); if (gesture) { gesture = false; renderMap(); } return; }
    // 두 번 누르기: 300ms 안에 같은 자리 근처를 다시 누르면 2배 (최대면 전체)
    const t = e.changedTouches[0], now = Date.now();
    if (lastTap && now - lastTap.t < 300 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 30) {
      e.preventDefault();
      suppressClick = now; lastTap = null;
      if (zoomOf() >= ZMAX - 0.01) setView(0, 0, 1); else zoomTo(t.clientX, t.clientY, zoomOf() * 2);
    } else lastTap = { t: now, x: t.clientX, y: t.clientY };
  });
  svg.addEventListener('touchcancel', () => { tch = null; if (gesture) { gesture = false; renderMap(); } });
  // 내 배치 찾기(휴대폰): 찾은 건물로 확대
  function focusPost(id) {
    const p = POSTS.find(q => q.id === id);
    if (p && PHONE.matches) setView(p.x, p.y, 2.6);
  }
  $('maphint').textContent = matchMedia('(pointer: coarse)').matches
    ? '두 손가락으로 벌리거나 두 번 누르면 확대 (확대하면 도시 이름이 보임) · 확대 중엔 한 손가락으로 이동 · ‘크게’는 화면 가득'
    : 'Ctrl + 휠(터치패드는 두 손가락 벌리기)이나 ＋ 버튼으로 확대 · 확대 중엔 끌어서 이동';
  setView(0, 0, 1, true);

  svg.addEventListener('click', ev => {
    if (Date.now() - suppressClick < 400) return;   // 끌기·두 번 누르기 뒤에 오는 클릭은 무시
    const g = ev.target.closest('[data-post]');
    if (g) select(g.dataset.post); else if (!editing) select('');
  });
  svg.addEventListener('keydown', ev => {
    const g = ev.target.closest('[data-post]');
    if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); select(g.dataset.post); }
  });
  function select(id) { sel = id; renderAll(); }

  // ---------- 패널 ----------
  function renderTabs() {
    $('tabs').innerHTML = data.legions.map((L, i) => `<button class="btn" type="button" data-li="${i}" aria-pressed="${i === li}">${esc(L.name)}<span class="n">${L.members.filter(m => m.at || m.then).length}</span></button>`).join('');
  }
  $('tabs').addEventListener('click', ev => { const b = ev.target.closest('[data-li]'); if (b) { li = +b.dataset.li; renderAll(); } });

  function counts(L) {
    let main = 0, sub = 0, none = 0;
    for (const m of L.members) { if (m.at === 'sub') sub++; else if (m.at || m.then) main++; else none++; }
    return { main, sub, none };
  }
  function renderFacts() {
    const L = cur(), c = counts(L);
    const warn = (v, max) => (v > max ? ' style="color:var(--bad)"' : '');
    $('facts').innerHTML = `<div><dt>전투원</dt><dd${warn(c.main, LIMIT.main)}>${c.main} / ${LIMIT.main}</dd></div>` +
      `<div><dt>후보</dt><dd${warn(c.sub, LIMIT.sub)}>${c.sub} / ${LIMIT.sub}</dd></div>` +
      (c.none ? `<div><dt>미배치</dt><dd>${c.none}</dd></div>` : '') +
      `<div><dt><i style="background:var(--sw-${L.side})"></i>우리 진영</dt><dd>${L.side === 'red' ? '빨강 (오른쪽)' : '파랑 (왼쪽)'}</dd></div>`;
    const t = stamp ? new Date(stamp) : null;
    $('stamp').textContent = t && !isNaN(t) ? `게시 ${t.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '';
  }
  function whoHTML(mem, ph) {
    return mem.map(m => {
      const moved = ph === 2 && m.then && m.at !== m.then ? ` <span class="from">←${esc(m.at ? postName(m.at) : '미배치')}</span>` : '';
      const later = ph === 1 && m.then ? ` <span class="from">→${esc(postName(m.then))}</span>` : '';
      return `<span${editing && !inRoster(m.n) ? ' class="warnn" title="배치도에 없는 닉네임"' : ''}>${m.lead ? '<b class="lead">★</b>' : ''}${esc(m.n)}</span>${moved}${later}`;
    }).join(' · ');
  }
  function renderPosts() {
    const L = cur(), out = [], empties = [], compact = PHONE.matches && !editing;   // 휴대폰 보기: 배치 없는 곳은 맨 아래 한 줄로
    for (const [title, a, b] of SECTIONS) {
      const ids = ORDER.slice(a, b).filter(id => !compact || membersAt(L, id, phase).length || noteOf(L, id) || !empties.push(id));
      if (!ids.length) continue;
      out.push(`<div class="gh">${title}</div>`);
      for (const id of ids) {
        const p = BY.get(id), mem = membersAt(L, id, phase);
        const color = p.k ? `var(--sw-${KIND[p.k].c})` : id === 'attack' ? 'var(--sw-red)' : 'var(--sw-muted)';
        out.push(`<div class="post${sel === id ? ' on' : ''}${mem.length || noteOf(L, id) ? '' : ' empty'}" data-post="${id}" role="button" tabindex="0">` +
          `<span class="pn"><i class="kd" style="background:${color}"></i>${esc(p.nm)}${p.open && phase === 1 ? ' <span class="pill15">15분</span>' : ''}</span>` +
          `<span class="ct${mem.length ? '' : ' zero'}">${mem.length}</span>` +
          (noteOf(L, id) ? `<span class="note">※ ${esc(noteOf(L, id))}</span>` : '') +
          (mem.length ? `<span class="who">${whoHTML(mem, phase)}</span>` : '') + '</div>');
      }
    }
    if (empties.length) out.push(`<div class="emptyline"><span class="sumx">배치 없음</span> ${empties.map(id => `<button class="lnk" type="button" data-post="${id}">${esc(postName(id))}</button>`).join(' · ')}</div>`);
    const none = L.members.filter(m => !postOf(m, phase));
    if (none.length) {
      out.push(`<div class="gh">미배치 (${phase === 1 ? '시작' : '15분 후'})</div>`);
      out.push(`<div class="post" data-post="" role="button" tabindex="0"><span class="pn">미배치</span><span class="ct">${none.length}</span><span class="who">${whoHTML(none, phase)}</span></div>`);
    }
    $('posts').innerHTML = out.join('');
  }
  $('posts').addEventListener('click', ev => { const r = ev.target.closest('[data-post]'); if (r && r.dataset.post) select(r.dataset.post); });
  $('posts').addEventListener('keydown', ev => { const r = ev.target.closest('[data-post]'); if (r && r.dataset.post && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); select(r.dataset.post); } });

  function sideOf(p) {   // 우리 진영에 가까운 쪽인지
    if (!p.k || Math.abs(p.x) < 40) return '';
    return (p.x < 0) === (cur().side === 'blue') ? '우리 진영 쪽' : '적 진영 쪽';
  }
  function renderInfo() {
    const box = $('info');
    if (!sel || !BY.has(sel)) { box.hidden = true; return; }
    const p = BY.get(sel), mem = membersAt(cur(), sel, phase);
    const when = p.open ? (p.k === 'cellar' ? '15분·20분 등장' : '15분 뒤 열림') : p.k ? '시작부터' : '';
    const meta = [when, sideOf(p), p.pts ? `첫 점령 ${num(p.pts[0])} / ${num(p.pts[1])} · 점령 중 분당 +${num(p.pts[2])} / +${num(p.pts[3])} (연맹 / 개인)` : ''].filter(Boolean).join(' · ');
    box.innerHTML = `<button class="btn x" type="button" id="infox" aria-label="닫기">✕</button>` +
      `<h3>${esc(p.nm)} <small>${esc(p.en)}</small></h3>` + (meta ? `<p class="meta">${meta}</p>` : '') + (p.fx ? `<p>${esc(p.fx)}</p>` : '') +
      (noteOf(cur(), sel) ? `<p class="note">※ ${esc(noteOf(cur(), sel))}</p>` : '') +
      `<p><b>${phase === 1 ? '시작 ~ 15분' : '15분 후'} ${mem.length}명</b>${mem.length ? ' · ' + whoHTML(mem, phase) : ''}</p>`;
    box.classList.toggle('left', (p.x || 0) > 0 || p.corner === 'br');   // 고른 곳 반대쪽에 띄움
    box.hidden = false;
    $('infox').onclick = () => select('');
  }
  function renderMemo() { const m = cur().memo; $('memo').hidden = !m; $('memo').textContent = m || ''; }

  // ---------- 내 배치 찾기 ----------
  let found = null;   // { li, n }
  function search() {
    const q = low($('q').value), card = $('card'), hint = $('qhint');
    found = null; card.hidden = true; hint.textContent = '';
    if (!q) return;
    const all = data.legions.flatMap((L, i) => L.members.map(m => ({ m, i })));
    let hits = all.filter(h => low(h.m.n) === q);
    if (!hits.length) hits = all.filter(h => low(h.m.n).includes(q));
    if (hits.length === 1) {
      const { m, i } = hits[0];
      found = { li: i, n: m.n };
      if (li !== i) li = i;
      sel = postOf(m, phase) || '';
    } else if (hits.length > 1) {
      hint.innerHTML = `${hits.length}명: ` + hits.slice(0, 12).map(h => `<button class="lnk" type="button" data-pick="${esc(h.m.n)}">${esc(h.m.n)}</button>`).join(' · ');
    } else {
      hint.textContent = rosterMap.has(q) || roster.some(n => n.toLowerCase().includes(q)) ? '아직 성검 쟁탈 배치에 없는 연맹원입니다.' : '배치에 없는 닉네임입니다.';
    }
  }
  function renderCard() {
    const card = $('card');
    if (!found) { card.hidden = true; return; }
    const L = data.legions[found.li], m = findIn(L, found.n);
    if (!m) { card.hidden = true; return; }
    const at = m.at ? postName(m.at) : '미배치';
    card.innerHTML = `<div class="nm">${m.lead ? '<span class="lead">★</span> ' : ''}${esc(m.n)}${m.lead ? ' <span class="badge mv">집결장</span>' : ''}</div>` +
      `<div class="co">${esc(at)}</div>` +
      (noteOf(L, m.at) ? `<div class="note">※ ${esc(noteOf(L, m.at))}</div>` : '') +
      `<div class="meta">${esc(L.name)} · 시작 ~ 15분${m.then ? ` → 15분 후 <b>${esc(postName(m.then))}</b>로 이동${noteOf(L, m.then) ? ` (※ ${esc(noteOf(L, m.then))})` : ''}` : m.at && m.at !== 'sub' ? ' · 15분 후에도 그대로' : ''}</div>`;
    card.hidden = false;
  }
  $('q').addEventListener('input', () => { search(); renderAll(); if (found) focusPost(sel); });   // 휴대폰은 찾은 건물로 확대
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) $('q').blur(); });
  $('q').addEventListener('change', () => { if (found && PHONE.matches && POSTS.some(p => p.id === sel)) wrapEl.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  $('qhint').addEventListener('click', ev => { const b = ev.target.closest('[data-pick]'); if (b) { $('q').value = b.dataset.pick; search(); renderAll(); if (found) focusPost(sel); } });

  // ---------- 연맹 채팅용 텍스트 · 링크 · 이미지 ----------
  function planText() {
    const L = cur(), c = counts(L), out = [];
    out.push(`[성검 쟁탈 ${L.name} 배치] 우리 진영: ${L.side === 'red' ? '빨강(오른쪽)' : '파랑(왼쪽)'} · 전투원 ${c.main}/${LIMIT.main} · 후보 ${c.sub}/${LIMIT.sub}`);
    if (L.memo) out.push(L.memo.trim());
    const line = (id, ph) => {
      const mem = membersAt(L, id, ph), note = noteOf(L, id);
      if (!mem.length) return note ? `${postName(id)}: ${note}` : null;
      return `${postName(id)}: ${mem.map(m => (m.lead ? '★' : '') + m.n).join(', ')}${note ? ` (${note})` : ''}`;
    };
    out.push('', '■ 시작 ~ 15분');
    for (const id of ORDER) if (id !== 'sub') { const s = line(id, 1); if (s) out.push(s); }
    const moves = L.members.filter(m => m.then);
    if (moves.length) {
      out.push('', '■ 15분 후 이동');
      for (const m of moves) out.push(`${m.n}: ${m.at ? postName(m.at) : '미배치'} → ${postName(m.then)}`);
    }
    const subs = line('sub', 1);
    if (subs) out.push('', subs);
    out.push('', '★ = 집결장', `${location.origin}/sword/${li ? '?l=' + (li + 1) : ''}`);
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
  $('link').onclick = () => copyText(location.href.replace(/[?&]edit\b[^&]*/, ''), $('link'), '링크 복사됨');

  async function savePNG() {
    const btn = $('png'), L = cur(), P = palette(), W = 1200, MH = Math.round(W * VB.h / VB.w);
    flash(btn, '만드는 중…');
    const bgHref = photo ? await bgDataURL().catch(() => null) : null;   // 이미지로 그리는 SVG는 바깥 파일을 못 읽어 사진을 넣어 줌
    const inner = mapSVG({ k: (VB.w / W) * 1.3, P, font: SYS_FONT, L, ph: phase, sel: '', names: true, photo: bgHref });
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${MH}" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" font-family='${SYS_FONT}'>${inner}</svg>`;
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    try { await img.decode(); } catch (_) { flash(btn, '이미지를 만들지 못했습니다'); return; }
    // 지도 아래 명단 (두 줄 칸)
    const cv = document.createElement('canvas'), x = cv.getContext('2d');
    const F = (size, wt) => `${wt} ${size}px ${FONT}`;
    const PAD = 28, HEAD = 74, colW = (W - PAD * 3) / 2, LH = 24;
    x.font = F(17, 400);
    const blocks = [];
    for (const id of ORDER) {
      const mem = membersAt(L, id, phase), note = noteOf(L, id);
      if (!mem.length && !note) continue;
      const items = mem.map(m => (m.lead ? '★' : '') + m.n);
      const lines = [];
      let line = '';
      for (const it of items) { const t = line ? `${line} · ${it}` : it; if (line && x.measureText(t).width > colW) { lines.push(line); line = it; } else line = t; }
      if (line) lines.push(line);
      blocks.push({ title: `${postName(id)} ${mem.length}명`, note: note ? `※ ${note}` : '', lines });
    }
    const moves = L.members.filter(m => m.then);
    if (moves.length) blocks.push({ title: '15분 후 이동', lines: moves.map(m => `${m.n}: ${m.at ? postName(m.at) : '미배치'} → ${postName(m.then)}`) });
    const cols = [[], []], hgt = [0, 0];
    const bh = b => 30 + ((b.note ? 1 : 0) + b.lines.length) * LH + 12;
    for (const b of blocks) { const c = hgt[0] <= hgt[1] ? 0 : 1; cols[c].push(b); hgt[c] += bh(b); }
    const H = HEAD + MH + PAD + Math.max(...hgt) + 44;
    cv.width = W; cv.height = H;
    x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
    x.fillStyle = P.ink; x.textBaseline = 'alphabetic';
    x.font = F(26, 600); x.fillText(`성검 쟁탈 ${L.name} 배치도`, PAD, 38);
    const c = counts(L);
    x.font = F(16, 400); x.fillStyle = P.muted;
    x.fillText(`${phase === 1 ? '시작 ~ 15분' : '15분 후'} · 우리 진영 ${L.side === 'red' ? '빨강(오른쪽)' : '파랑(왼쪽)'} · 전투원 ${c.main}/${LIMIT.main} · 후보 ${c.sub}/${LIMIT.sub} · ★ 집결장`, PAD, 62);
    x.drawImage(img, 0, HEAD, W, MH);
    cols.forEach((col, ci) => {
      let y = HEAD + MH + PAD;
      for (const b of col) {
        const bx = PAD + ci * (colW + PAD);
        x.fillStyle = P.ink; x.font = F(18, 600); x.fillText(b.title, bx, y + 20);
        const lines = b.note ? [b.note, ...b.lines] : b.lines;
        lines.forEach((ln, i) => { x.font = F(17, b.note && !i ? 500 : 400); x.fillStyle = b.note && !i ? P.lead : P.ink; x.fillText(ln, bx, y + 30 + LH * (i + 0.8)); });
        y += bh(b);
      }
    });
    x.fillStyle = P.muted; x.font = F(14, 400);
    x.fillText(`${location.host}/sword/ · ${new Date().toLocaleDateString('ko-KR')}`, PAD, H - 18);
    cv.toBlob(async blob => {
      if (!blob) { flash(btn, '이미지를 만들지 못했습니다'); return; }
      const name = `성검쟁탈_${L.name.replace(/\s+/g, '')}_${phase === 1 ? '시작' : '15분후'}.png`;
      const file = new File([blob], name, { type: 'image/png' });
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
  let bgData = null;
  async function bgDataURL() {
    if (bgData) return bgData;
    const b = await (await fetch(BG.href)).blob();
    bgData = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
    return bgData;
  }

  // ---------- 시간·이름 버튼 ----------
  function setPhase(p) { phase = p; if (found) { const m = findIn(data.legions[found.li], found.n); if (m) sel = postOf(m, phase) || sel; } renderAll(); }
  $('ph1').onclick = () => setPhase(1);
  $('ph2').onclick = () => setPhase(2);
  $('fullph').onclick = () => setPhase(phase === 1 ? 2 : 1);   // 크게 화면 안의 시간 버튼
  $('nm').onclick = () => { showNames = !showNames; renderAll(); };
  $('bgbtn').onclick = () => { photo = !photo; try { localStorage.setItem('ks-sword-photo', photo ? '1' : '0'); } catch (_) { /* 저장 못 함 */ } renderAll(); };

  // ---------- 편집 ----------
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
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: $('lid').value.trim(), pw: $('lpw').value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) { $('loginerr').textContent = j.error || '로그인하지 못했습니다'; return; }
      token = j.token;
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (_) { /* 메모리에만 */ }
      $('lpw').value = '';
      $('login').close();
    } catch (_) { $('loginerr').textContent = '서버에 연결하지 못했습니다'; }
  });

  let edNote = '';
  async function startEdit() {
    if (!tokenValid() && !(await login())) return;
    editing = true;
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) { /* 저장본 없음 */ }
    if (draft && draft.data && canon(draft.data) !== pubNorm) {
      data = normalize(draft.data); baseNorm = draft.base || pubNorm;
      edNote = baseNorm !== pubNorm ? '이 브라우저에 저장해 둔 수정본을 불러왔습니다. 그사이 게시본이 바뀌었으니 확인하고 게시하세요 (게시본으로 되돌리기 가능).' : '이 브라우저에 저장해 둔 수정본을 불러왔습니다.';
    } else { data = clone(pub); baseNorm = pubNorm; edNote = ''; }
    $('adminhint').textContent = '';
    renderAll();
  }
  function stopEdit() {
    const dirty = canon(data) !== pubNorm;
    editing = false; data = clone(pub);
    li = Math.min(li, data.legions.length - 1);
    $('adminhint').textContent = dirty ? '게시하지 않은 수정본은 이 브라우저에 남아 있습니다 (다시 편집하면 불러옴).' : '';
    renderAll();
  }
  function saveDraft() {
    try {
      if (canon(data) === pubNorm) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: baseNorm, data }));
    } catch (_) { /* 저장 공간 없음 */ }
  }
  function commit(msg) {
    data = normalize(data);
    saveDraft();
    if (msg !== undefined) setAddHint(msg);
    renderAll();
  }
  const setAddHint = msg => { $('addhint').innerHTML = msg || ''; };
  const edMsg = (msg, err) => { const e = $('edmsg'); e.textContent = msg; e.className = 'edmsg' + (err ? ' err' : ''); };

  // 이름 나누기: 쉼표·줄바꿈으로 나누고, 띄어쓰기가 든 조각은 배치도 이름으로 가장 길게 맞춰 나눔 ("tang tang ZERO" → tang tang, ZERO)
  function splitNames(text) {
    const out = [];
    for (const piece of String(text).split(/[,\n，、]/).map(clean).filter(Boolean)) {
      if (rosterMap.has(piece.toLowerCase()) || !piece.includes(' ')) { out.push(rosterMap.get(piece.toLowerCase()) || piece); continue; }
      const toks = piece.split(' '), got = [];
      let i = 0, hit = false;
      while (i < toks.length) {
        let j = toks.length;
        for (; j > i; j--) if (rosterMap.has(toks.slice(i, j).join(' ').toLowerCase())) break;
        if (j > i) { got.push(rosterMap.get(toks.slice(i, j).join(' ').toLowerCase())); i = j; hit = true; } else { got.push(toks[i]); i++; }
      }
      if (hit) out.push(...got); else out.push(piece);   // 배치도에 하나도 없으면 띄어쓰기 포함 한 이름으로
    }
    return out;
  }
  function place(name, post) {   // 지금 보는 시간의 자리 post에 넣기 (없는 사람은 새로)
    const L = cur();
    let m = findIn(L, name);
    const from = m ? postOf(m, phase) : null;
    if (!m) { m = { n: name, at: '' }; L.members.push(m); }
    if (phase === 1) m.at = post;
    else if (m.at === post) delete m.then;
    else m.then = post;
    return from;
  }
  function addNames(text, target = sel) {   // target = 넣을 자리 ('' = 미배치)
    const names = splitNames(text);
    if (!names.length) return;
    const L = cur(), other = data.legions.filter((_, i) => i !== li), notes = [], strange = [];
    for (const n of names) {
      if (!inRoster(n)) strange.push(n);
      const dup = other.find(o => findIn(o, n));
      if (dup) notes.push(`${esc(n)}: ${esc(dup.name)}에도 있음`);
      if (target) {
        const from = place(n, target);
        if (from && from !== target) notes.push(`${esc(n)}: ${esc(postName(from))} → ${esc(postName(target))}`);
      } else if (!findIn(L, n)) L.members.push({ n, at: '' });
    }
    let msg = `${names.map(esc).join(', ')} → ${esc(target ? postName(target) + '에' : '미배치로')} 넣었습니다.`;
    if (notes.length) msg += ' ' + notes.join(' · ');
    if (strange.length) msg += ` <span style="color:var(--bad)">배치도에 없는 이름: ${strange.map(esc).join(', ')}</span>`;
    commit(msg);
  }
  // 입력칸 앞에 자리 이름을 쓰면 그곳에: "마구간 tang ZERO 아이쿵 배치" → 마구간에 tang, ZERO, 아이쿵
  const TARGETS = [...[...BY.values()].map(p => [p.nm, p.id]), ...Object.entries(ALIASES)].sort((a, b) => b[0].length - a[0].length);
  function parseTarget(text) {
    const t = clean(text);
    for (const [label, id] of TARGETS) {
      if (t.startsWith(label + ' ') && !rosterMap.has(label.toLowerCase())) return { id, rest: t.slice(label.length + 1).replace(/ 배치$/, '') };
    }
    return { id: null, rest: text };
  }
  $('addbtn').onclick = () => {
    const { id, rest } = parseTarget($('addname').value);
    if (id) sel = id;
    addNames(rest);
    $('addname').value = '';
    renderRosterChips();
  };
  $('addname').addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); $('addbtn').click(); } });
  $('addname').addEventListener('input', renderRosterChips);
  $('bulkbtn').onclick = () => { addNames($('bulk').value.split('\n').join(','), ''); $('bulk').value = ''; };
  $('side').onchange = () => { cur().side = $('side').value; commit(); };
  $('notein').addEventListener('input', () => {   // 자리 메모 (예: 1분 지켜보고 진입)
    if (!sel) return;
    const L = cur();
    L.notes = { ...(L.notes || {}), [sel]: $('notein').value };
    data = normalize(data); saveDraft(); renderPosts(); renderMap(); renderInfo(); renderEdState();
  });
  $('memoin').addEventListener('input', () => { cur().memo = $('memoin').value; data = normalize(data); saveDraft(); renderMemo(); renderEdState(); });
  $('editbtn').onclick = () => (editing ? stopEdit() : startEdit());
  $('exitedit').onclick = stopEdit;
  $('revert').onclick = () => {
    if (canon(data) !== pubNorm && !confirm('이 브라우저에서 고친 내용을 버리고 게시본으로 되돌릴까요?')) return;
    data = clone(pub); baseNorm = pubNorm; edNote = '';
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* 없음 */ }
    edMsg('게시본으로 되돌렸습니다.');
    renderAll();
  };
  $('publish').onclick = async () => {
    if (!tokenValid() && !(await login())) return;
    edMsg('게시하는 중…');
    let live = null;
    try { const r = await fetch(API, { cache: 'no-store' }); if (r.ok) live = canon(await r.json()); } catch (_) { /* 확인 못 함 */ }
    if (live && live !== baseNorm && !confirm('편집을 시작한 뒤 다른 곳에서 새로 게시했습니다. 지금 수정본으로 덮어쓸까요?')) { edMsg('게시하지 않았습니다.'); return; }
    const body = JSON.stringify(normalize(data), null, 1);
    let r;
    try { r = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body }); } catch (_) { edMsg('서버에 연결하지 못했습니다.', true); return; }
    if (r.status === 401) {
      token = null;
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) { /* 없음 */ }
      edMsg('다시 로그인하세요.', true);
      if (await login()) $('publish').click();
      return;
    }
    if (!r.ok) { const j = await r.json().catch(() => ({})); edMsg(`게시하지 못했습니다: ${j.error || r.status}`, true); return; }
    pub = normalize(data); pubNorm = JSON.stringify(pub); baseNorm = pubNorm; edNote = '';
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* 없음 */ }
    try { const g = await fetchPlan(); stamp = g.stamp || new Date().toISOString(); } catch (_) { stamp = new Date().toISOString(); }
    edMsg('게시했습니다. 모든 사람의 /sword 화면에 반영됩니다 (Cloudflare는 다른 지역까지 최대 1분).');
    renderAll();
  };

  function renderEdState() {
    const dirty = canon(data) !== pubNorm;
    $('edstate').innerHTML = dirty ? '<span class="dirty">게시 안 된 수정 있음</span> · 이 브라우저에만 저장됨' : '게시본과 같음';
  }
  function thenSelect(m) {
    const opts = ['', ...ORDER].map(id => `<option value="${id}"${(m.then || '') === id ? ' selected' : ''}>${id ? '→ ' + esc(postName(id)) : '15분 후 그대로'}</option>`).join('');
    return `<select data-then="${esc(m.n)}" aria-label="${esc(m.n)} 15분 후 자리">${opts}</select>`;
  }
  function renderRosterChips() {
    if (!editing) return;
    const L = cur(), q = low($('addname').value);
    const free = roster.filter(n => !findIn(L, n));
    const shown = free.filter(n => !q || n.toLowerCase().includes(q));
    $('rossum').textContent = roster.length ? `${free.length}명` : '(배치도 명단을 못 불러옴)';
    $('roschips').innerHTML = shown.map(n => {
      const other = data.legions.find((o, i) => i !== li && findIn(o, n));
      return `<button class="chip${other ? ' other' : ''}" type="button" data-rpick="${esc(n)}"${other ? ` title="${esc(other.name)}에 있음"` : ''}>${esc(n)}${other ? ` (${esc(other.name)})` : ''}</button>`;
    }).join('');
  }
  function renderEditor() {
    $('editor').hidden = !editing;
    $('editbtn').textContent = editing ? '편집 끝내기' : '편집 (관리자)';
    if (!editing) return;
    const L = cur();
    renderEdState();
    $('ednote').textContent = edNote;
    $('side').value = L.side;
    if (document.activeElement !== $('memoin')) $('memoin').value = L.memo || '';
    const tname = phase === 1 ? '시작 ~ 15분' : '15분 후';
    $('noteline').hidden = !sel;
    if (sel && document.activeElement !== $('notein')) $('notein').value = noteOf(L, sel);
    if (sel) {
      const mem = membersAt(L, sel, phase);
      $('selpost').innerHTML = `선택: <b>${esc(postName(sel))}</b> · ${tname} ${mem.length}명 <span class="hint">— 아래 칸에 닉네임을 쓰거나 미배치·연맹원 이름을 누르면 여기에 들어갑니다.</span>`;
      $('erows').innerHTML = mem.map(m => `<div class="erow">` +
        `<button class="btn lead" type="button" data-lead="${esc(m.n)}" aria-pressed="${!!m.lead}" title="집결장(리더) 표시">★</button>` +
        `<span class="enm${inRoster(m.n) ? '' : ' warnn'}"${inRoster(m.n) ? '' : ' title="배치도에 없는 닉네임"'}>${esc(m.n)}</span>${thenSelect(m)}` +
        `<button class="btn" type="button" data-out="${esc(m.n)}" aria-label="${esc(m.n)} 빼기">✕</button></div>`).join('');
    } else {
      $('selpost').innerHTML = `<span class="hint">지도나 아래 목록에서 건물(또는 숨겨진 땅굴·게릴라·후보)을 누르면 그곳의 ${tname} 인원을 고칠 수 있습니다. 건물을 고르지 않고 넣으면 미배치로 들어갑니다.</span>`;
      $('erows').innerHTML = '';
    }
    const none = L.members.filter(m => !postOf(m, phase));
    $('unsum').textContent = none.length ? `미배치 ${none.length}명 (${tname}) — 이름을 누르면 선택한 곳에 넣고, ✕는 명단에서 지움` : '';
    $('unchips').innerHTML = none.map(m => `<button class="chip${inRoster(m.n) ? '' : ' warn'}" type="button" data-pick="${esc(m.n)}">${esc(m.n)}${m.then && phase === 1 ? ` <span class="from">→${esc(postName(m.then))}</span>` : ''}<span class="rm" data-del="${esc(m.n)}" role="button" aria-label="${esc(m.n)} 명단에서 지우기">✕</span></button>`).join('');
    renderRosterChips();
  }
  $('editor').addEventListener('click', ev => {
    const L = cur(), t = ev.target;
    const del = t.closest('[data-del]');
    if (del) { L.members = L.members.filter(m => low(m.n) !== low(del.dataset.del)); commit(`${esc(del.dataset.del)}을(를) 명단에서 지웠습니다.`); return; }
    const pick = t.closest('[data-pick]');
    if (pick) { if (!sel) { setAddHint('먼저 지도나 목록에서 넣을 곳을 고르세요.'); return; } addNames(pick.dataset.pick); return; }
    const rp = t.closest('[data-rpick]');
    if (rp) { addNames(rp.dataset.rpick); return; }
    const ld = t.closest('[data-lead]');
    if (ld) { const m = findIn(L, ld.dataset.lead); if (m) { m.lead = !m.lead; commit(); } return; }
    const out = t.closest('[data-out]');
    if (out) {
      const m = findIn(L, out.dataset.out);
      if (!m) return;
      if (phase === 1) m.at = '';
      else if (m.then) delete m.then;   // 15분 후 이동만 취소 (시작 자리로)
      else m.at = '';
      commit(`${esc(m.n)}을(를) ${esc(postName(sel))}에서 뺐습니다.`);
    }
  });
  $('editor').addEventListener('change', ev => {
    const s = ev.target.closest('[data-then]');
    if (!s) return;
    const m = findIn(cur(), s.dataset.then);
    if (!m) return;
    if (s.value) m.then = s.value; else delete m.then;
    commit();
  });

  // ---------- 전체 그리기 ----------
  function syncURL() {
    const u = new URL(location.href), sp = u.searchParams;
    const set = (key, v) => (v ? sp.set(key, v) : sp.delete(key));
    set('l', li ? String(li + 1) : ''); set('p', phase === 2 ? '2' : ''); set('b', sel); set('q', clean($('q').value));
    if (editing) sp.set('edit', ''); else sp.delete('edit');
    history.replaceState(history.state, '', u.pathname + (sp.toString() ? '?' + sp.toString().replace(/edit=(&|$)/, 'edit$1') : ''));
  }
  PHONE.addEventListener('change', () => data && renderAll());
  function renderAll() {
    if (!data) return;
    $('ph1').setAttribute('aria-pressed', phase === 1); $('ph2').setAttribute('aria-pressed', phase === 2); $('fullph').textContent = phase === 1 ? '시작' : '15분 후';
    $('nm').setAttribute('aria-pressed', showNames); $('bgbtn').setAttribute('aria-pressed', photo);
    renderTabs(); renderFacts(); renderMemo(); renderCard(); renderPosts(); renderMap(); renderInfo(); renderEditor(); syncURL();
  }
  load();
})();
