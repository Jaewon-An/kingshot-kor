/* /sword 성검 쟁탈(Swordland Showdown) 인원 배치도.
 * 전장: 게임 화면·공략 그림(kingshotguides.com Sgt Slayer, kingshotguide.org, kingshotmastery.com)을 보고 다시 그린 지도.
 *   가운데 성검 제단 기준 점대칭, 왼쪽 파랑 진영·오른쪽 빨강 진영. 좌표는 화면 단위(게임 좌표 아님)이고 마름모 칸 비율 0.7375는 게임 지도와 같음.
 * 데이터: /api/sword/layout (첫 게시 전에는 layouts/sword.json)
 *   { legions: [{ name, side: 'blue'|'red', memo?, members: [{ n: 닉네임, at: 시작 자리, then?: 15분 후 자리, lead?: 집결장 }] }] }
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
  const VB = { x: -400, y: -295, w: 800, h: 645 };     // 전장 꼭짓점 (±480, 0) · (0, ±354)은 게임 화면처럼 가장자리가 잘림
  const KIND = {   // w = 바닥 마름모 반너비, e = 높이, gh = 지붕 장식 높이, c = 색 이름
    shrine: { w: 50, e: 14, gh: 46, c: 'shrine' },
    sanctum: { w: 30, e: 10, gh: 20, c: 'sanctum' },
    abbey: { w: 25, e: 9, gh: 26, c: 'abbey' },
    tower: { w: 13, e: 30, gh: 14, c: 'buff' },
    stable: { w: 25, e: 8, gh: 12, c: 'buff' },
    camp: { w: 24, e: 9, gh: 23, c: 'buff' },
    hall: { w: 26, e: 8, gh: 10, c: 'buff' },
  };
  const PTS = { shrine: [9000, 4500, 1800, 900], sanctum: [6000, 3000, 1200, 600], abbey: [3000, 1500, 600, 300], buff: [1200, 600, 240, 120] };   // 첫 점령 연맹·개인, 분당 연맹·개인
  const POSTS = [
    { id: 'sanctumL', nm: '왼쪽 성소', tag: '성소', en: 'Sanctum', k: 'sanctum', x: -186, y: -59, pts: PTS.sanctum, fx: '성소 두 곳을 모두 잡으면 분당 점수가 성검 제단보다 많음' },
    { id: 'sanctumR', nm: '오른쪽 성소', tag: '성소', en: 'Sanctum', k: 'sanctum', x: 186, y: 59, pts: PTS.sanctum, fx: '성소 두 곳을 모두 잡으면 분당 점수가 성검 제단보다 많음' },
    { id: 'abbeyL', nm: '왼쪽 수도원', tag: '수도원', en: 'Abbey', k: 'abbey', x: -219, y: 39, pts: PTS.abbey },
    { id: 'abbeyB', nm: '아래 수도원', tag: '수도원', en: 'Abbey', k: 'abbey', x: -96, y: 224, pts: PTS.abbey },
    { id: 'abbeyT', nm: '위 수도원', tag: '수도원', en: 'Abbey', k: 'abbey', x: 96, y: -224, pts: PTS.abbey },
    { id: 'abbeyR', nm: '오른쪽 수도원', tag: '수도원', en: 'Abbey', k: 'abbey', x: 219, y: -39, pts: PTS.abbey },
    { id: 'bell', nm: '종탑', tag: '종탑', en: 'Bell Tower', k: 'tower', x: -103, y: -221, pts: PTS.buff, fx: '우리 연맹의 건물 점령 시간 50% 감소' },
    { id: 'stables', nm: '왕실 마구간', tag: '마구간', en: 'Royal Stables', k: 'stable', x: 103, y: 221, pts: PTS.buff, fx: '무료 순간이동 대기 시간 50% 감소 (10분 → 5분)' },
    { id: 'shrine', nm: '성검 제단', tag: '성검 제단', en: 'Swordshrine', k: 'shrine', x: 0, y: 0, open: 15, pts: PTS.shrine, fx: '건물 하나로는 분당 점수가 가장 많음' },
    { id: 'merc', nm: '용병 캠프', tag: '용병 캠프', en: 'Mercenary Camp', k: 'camp', x: 0, y: -149, open: 15, pts: PTS.buff, fx: '적이 점령한 건물에 용병을 보내 적 주둔군의 공격·방어를 약화' },
    { id: 'reform', nm: '개혁의 전당', tag: '개혁의 전당', en: 'Hall of Reformation', k: 'hall', x: 0, y: 149, open: 15, pts: PTS.buff, fx: '우리 부대가 주는 피해 15% 증가 · 받는 피해 15% 감소' },
  ];
  const GROUPS = [
    { id: 'attack', nm: '공격조', en: 'Attack team', fx: '집결로 먼저 점령하고 적 주둔군을 몰아냄 → 잡은 건물은 수비 인원에게 넘김', corner: 'tl' },
    { id: 'cellar', nm: '지하 저장고', en: 'Undercellars', open: 15, fx: '15분·20분에 두 번 나타나는 채집지 (미니맵 돋보기로 위치 확인)', corner: 'tr' },
    { id: 'sub', nm: '후보', en: 'Substitutes', fx: '교체 인원 (최대 10명)', corner: 'bl' },
  ];
  const CELLARS = [[-156, -149], [-99, -103], [115, -147], [177, -101], [-177, 101], [-115, 147], [99, 103], [156, 149]];
  const SPAWNS = [{ side: 'blue', x: -326, nm: '파랑' }, { side: 'red', x: 326, nm: '빨강' }];
  const BY = new Map([...POSTS, ...GROUPS].map(p => [p.id, p]));
  const ORDER = ['sanctumL', 'sanctumR', 'abbeyL', 'abbeyB', 'abbeyT', 'abbeyR', 'bell', 'stables', 'shrine', 'merc', 'reform', 'attack', 'cellar', 'sub'];
  const SECTIONS = [['시작부터 열린 건물', 0, 8], ['15분 뒤 열리는 건물', 8, 11], ['역할', 11, 14]];
  const ALIASES = { 마굿간: 'stables', 마구간: 'stables', 종탑: 'bell', 용병: 'merc', 개혁: 'reform', 제단: 'shrine', 성검: 'shrine', 지하: 'cellar', 저장고: 'cellar', 공격: 'attack', 후보: 'sub' };
  const LIMIT = { main: 30, sub: 10 };
  const postName = id => (BY.get(id) || { nm: '미배치' }).nm;
  const kindColor = (p, P) => P[p.k ? KIND[p.k].c : 'cellar'];

  // ---------- 상태 ----------
  let pub = null, pubNorm = '', baseNorm = '', stamp = '';   // 게시본 · 비교용 문자열 · 편집을 시작한 게시본 · 게시 시각
  let data = null, li = 0, phase = 1, sel = '', editing = false, showNames = !PHONE.matches, zi = 0, k = 1;
  let roster = [], rosterMap = new Map();   // /v2 배치도 연맹원 (소문자 → 원래 이름)
  let token = null;
  try { token = sessionStorage.getItem(TOKEN_KEY); } catch (_) { /* no session storage */ }
  const cur = () => data.legions[li];
  const postOf = (m, ph) => (ph === 2 ? m.then || m.at : m.at);
  const leadFirst = list => [...list.filter(m => m.lead), ...list.filter(m => !m.lead)];
  const membersAt = (L, id, ph) => leadFirst(L.members.filter(m => postOf(m, ph) === id));
  const findIn = (L, name) => L.members.find(m => low(m.n) === low(name));
  const inRoster = n => !roster.length || rosterMap.has(low(n));

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

  /* 지도 SVG 내용. o = { k: 화면 1px당 지도 단위, P: 색, font, L: 군단, ph: 1|2, sel, names: 이름 표시, max: 건물당 이름 줄 수 }
   * 글자 크기는 화면 px 기준(k를 곱함)이라 지도를 키우거나 줄여도 같은 크기로 보입니다. 이름 상자는 건물·글자·진영과 덜 겹치는 쪽에 놓습니다. */
  function mapSVG(o) {
    const { k: kk, P, L, ph, font } = o;
    const f = v => r1(v), px = v => r1(v * kk);
    const T = (x, y, s, size, a = {}) => `<text x="${f(x)}" y="${f(y)}" font-size="${px(size)}" font-weight="${a.wt || 600}" fill="${a.fill || P.ink}" text-anchor="${a.anchor || 'middle'}" dominant-baseline="central">${s}</text>`;
    const ground = [], over = [], obst = [];   // 바닥·건물 · 글자 · 이름 상자가 피할 곳 [x1, y1, x2, y2, 무게]

    ground.push(`<rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="${P.cliff}"/>`);
    ground.push(`<polygon points="-480,0 0,-354 480,0 0,354" fill="${P.sand}" stroke="${P.edge}" stroke-width="${px(3)}" stroke-linejoin="round"/>`);
    const g = [];
    for (let i = -7; i <= 7; i++) {   // 게임처럼 마름모 칸 격자 (u = t, v = t 선)
      const t = i / 8;
      g.push(`M${f((t + 1) * 240)},${f((1 - t) * 177)}L${f((t - 1) * 240)},${f(-(t + 1) * 177)}`);
      g.push(`M${f((-1 - t) * 240)},${f((1 - t) * 177)}L${f((1 - t) * 240)},${f(-(1 + t) * 177)}`);
    }
    ground.push(`<path d="${g.join('')}" stroke="${P.grid}" stroke-width="${px(1)}" fill="none"/>`);

    for (const sp of SPAWNS) {   // 진영 (안전지대)
      const ours = L.side === sp.side, c = P[sp.side], w = 58, h = w * ISO;
      ground.push(`<polygon points="${diamond(sp.x, 0, w)}" fill="${c}" fill-opacity="${ours ? 0.34 : 0.2}" stroke="${c}" stroke-width="${px(ours ? 3 : 2)}"/>`);
      over.push(T(sp.x, -px(8), ours ? '우리 진영' : '적 진영', 12.5, { fill: c, wt: 700 }), T(sp.x, px(9), sp.nm, 11, { fill: c, wt: 500 }));
      obst.push([sp.x - w, -h, sp.x + w, h, 1]);
    }

    const cellOn = ph === 2;   // 지하 저장고는 15분부터
    for (const [x, y] of CELLARS) {
      ground.push(`<g data-post="cellar"${cellOn ? '' : ' opacity=".4"'}>${o.sel === 'cellar' ? `<polygon points="${diamond(x, y, 19)}" fill="none" stroke="${P.sel}" stroke-width="${px(2.5)}"/>` : ''}` +
        `<polygon points="${diamond(x, y, 18)}" fill="transparent"/>${box(x, y, 11, 5, P.cellar)}</g>`);
      obst.push([x - 12, y - 14, x + 12, y + 9, 0.15]);
    }

    const tags = new Map();   // 건물별 [건물+글자 범위]
    for (const p of POSTS) {
      const K = KIND[p.k], c = P[K.c], h = K.w * ISO, locked = ph === 1 && p.open, on = o.sel === p.id;
      const mem = membersAt(L, p.id, ph);
      ground.push(`<g data-post="${p.id}" tabindex="0" role="button" aria-label="${esc(p.nm)} ${mem.length}명"${locked ? ' opacity=".5"' : ''}>` +
        `<polygon points="${diamond(p.x, p.y, K.w + 12)}" fill="transparent"/>` +
        (on ? `<polygon points="${diamond(p.x, p.y, K.w + 9)}" fill="none" stroke="${P.sel}" stroke-width="${px(3)}" stroke-dasharray="${px(7)} ${px(4)}"/>` : '') +
        box(p.x, p.y, K.w, K.e, c) + glyph(p.k, p.x, p.y - K.e, c, P) + '</g>');
      const bb = [p.x - K.w, p.y - K.e - Math.max(h, K.gh), p.x + K.w, p.y + h];
      obst.push([...bb, 1]);
      // 이름표 (+ 15분 표시) · 인원 수
      const th = px(19), tagW = tw(p.tag, 13, 600, font) * kk + px(12);
      const lockW = locked ? tw('15분', 10, 600, font) * kk + px(10) : 0;
      const allW = tagW + (locked ? lockW + px(3) : 0), tx = p.x - allW / 2, ty = bb[3] + px(4);
      let s = `<g data-post="${p.id}"><rect x="${f(tx)}" y="${f(ty)}" width="${f(tagW)}" height="${f(th)}" rx="${px(4)}" fill="${P.tagbg}" stroke="${on ? P.sel : P.tagline}" stroke-width="${px(on ? 2 : 1)}"/>` +
        T(tx + tagW / 2, ty + th / 2, esc(p.tag), 13);
      if (locked) s += `<rect x="${f(tx + tagW + px(3))}" y="${f(ty + px(2))}" width="${f(lockW)}" height="${f(th - px(4))}" rx="${f((th - px(4)) / 2)}" fill="${P.lock}"/>` + T(tx + tagW + px(3) + lockW / 2, ty + th / 2, '15분', 10, { fill: '#ffffff' });
      if (mem.length) {
        const bx = p.x + K.w * 0.8, by = bb[1] + px(4), br = px(mem.length > 9 ? 11 : 9.5);
        s += `<circle cx="${f(bx)}" cy="${f(by)}" r="${f(br)}" fill="${P.ink}" stroke="${P.tagbg}" stroke-width="${px(1.5)}"/>` + T(bx, by, mem.length, 11, { fill: P.tagbg, wt: 700 });
        obst.push([bx - br, by - br, bx + br, by + br, 1]);
      }
      over.push(s + '</g>');
      obst.push([tx, ty, tx + allW, ty + th, 1]);
      tags.set(p.id, [Math.min(bb[0], tx), bb[1], Math.max(bb[2], tx + allW), ty + th, ty]);
    }

    // 역할(공격조·지하 저장고·후보)은 지도 모서리 상자
    const boxes = [];
    for (const gr of GROUPS) {
      const mem = membersAt(L, gr.id, ph), on = o.sel === gr.id;
      const title = `${gr.nm} ${mem.length}`, titleW = tw(title, 13, 600, font) * kk;
      const lockW = gr.open && ph === 1 ? tw('15분', 10, 600, font) * kk + px(10) : 0;   // 지하 저장고: 15분부터
      const lines = o.names && mem.length ? wrap(mem.map(m => (m.lead ? '★' : '') + m.n), 12.5, 170, font) : [];
      const lh = px(16), pad = px(6);
      const bw = Math.max(px(13) + titleW + (lockW ? px(4) + lockW : 0), ...lines.map(s => tw(s, 12.5, 400, font) * kk)) + pad * 2;
      const bh = px(19) + lines.length * lh + pad * (lines.length ? 1.4 : 0.6);
      const x = gr.corner === 'tr' ? VB.x + VB.w - px(8) - bw : VB.x + px(8);
      const y = gr.corner === 'bl' ? VB.y + VB.h - px(8) - bh : VB.y + px(8);
      let s = `<g data-post="${gr.id}" tabindex="0" role="button" aria-label="${esc(gr.nm)} ${mem.length}명"><rect x="${f(x)}" y="${f(y)}" width="${f(bw)}" height="${f(bh)}" rx="${px(5)}" fill="${P.tagbg}" fill-opacity=".94" stroke="${on ? P.sel : P.tagline}" stroke-width="${px(on ? 2.5 : 1)}"/>`;
      s += `<rect x="${f(x + pad)}" y="${f(y + pad + px(3.5))}" width="${px(9)}" height="${px(9)}" rx="${px(2)}" fill="${gr.id === 'cellar' ? P.cellar : gr.id === 'attack' ? P.red : P.muted}"/>`;
      s += T(x + pad + px(13), y + pad + px(8.5), esc(title), 13, { anchor: 'start' });
      if (lockW) {
        const lx = x + pad + px(17) + titleW;
        s += `<rect x="${f(lx)}" y="${f(y + pad + px(1.5))}" width="${f(lockW)}" height="${px(14)}" rx="${px(7)}" fill="${P.lock}"/>` + T(lx + lockW / 2, y + pad + px(8.5), '15분', 10, { fill: '#ffffff' });
      }
      lines.forEach((ln, i) => { s += T(x + pad, y + pad + px(19) + lh * (i + 0.5) + px(2), esc(ln), 12.5, { anchor: 'start', wt: 400 }); });
      boxes.push(s + '</g>');
      obst.push([x, y, x + bw, y + bh, 1]);
    }

    // 건물 이름 상자: 사람이 많은 건물부터, 아래 → 오른쪽 → 왼쪽 → 위 중 덜 겹치는 곳
    const names = [];
    if (o.names) {
      const list = POSTS.map(p => ({ p, mem: membersAt(L, p.id, ph) })).filter(e => e.mem.length).sort((a, b) => b.mem.length - a.mem.length);
      for (const { p, mem } of list) {
        const max = o.max || 6;
        const rows = mem.length > max ? [...mem.slice(0, max - 1), { more: mem.length - max + 1 }] : mem;
        const lh = px(16), padx = px(5), pady = px(3);
        const texts = rows.map(m => (m.more ? `외 ${m.more}명` : (m.lead ? '★ ' : '') + m.n));
        const bw = Math.max(...texts.map((s, i) => tw(s, 12.5, rows[i].lead ? 600 : 400, font))) * kk + padx * 2;
        const bh = rows.length * lh + pady * 2;
        const [x1, y1, x2, y2, tagTop] = tags.get(p.id), gap = px(4);
        const cands = [[p.x - bw / 2, y2 + px(2)], [x2 + gap, y1], [x1 - gap - bw, y1], [p.x - bw / 2, y1 - gap - bh], [x2 + gap, tagTop], [x1 - gap - bw, tagTop]];
        let best = null, bestS = Infinity;
        cands.forEach(([x, y], i) => {
          const r = [x, y, x + bw, y + bh];
          const sc = obst.reduce((t, b) => t + overlap(r, b) * b[4], 0) + (bw * bh - overlap(r, VBR)) * 3 + i * 1e-3;
          if (sc < bestS) { bestS = sc; best = r; }
        });
        const [bx, by] = best;
        let s = `<g data-post="${p.id}"><rect x="${f(bx)}" y="${f(by)}" width="${f(bw)}" height="${f(bh)}" rx="${px(4)}" fill="${P.tagbg}" fill-opacity=".93" stroke="${o.sel === p.id ? P.sel : P.tagline}" stroke-width="${px(o.sel === p.id ? 1.8 : 0.8)}"/>`;
        rows.forEach((m, i) => {
          const y = by + pady + lh * (i + 0.5);
          const label = m.more ? `외 ${m.more}명` : (m.lead ? `<tspan fill="${P.lead}">★</tspan> ` : '') + esc(m.n);
          s += T(bx + padx, y, label, 12.5, { anchor: 'start', wt: m.lead ? 600 : 400, fill: m.more ? P.muted : P.ink });
        });
        names.push(s + '</g>');
        obst.push([...best, 1]);
      }
    }
    return ground.join('') + over.join('') + names.join('') + boxes.join('');
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

  const svg = $('map'), scroller = $('swscroll');
  function measureK() {
    const r = svg.getBoundingClientRect();
    return r.width && r.height ? Math.max(VB.w / r.width, VB.h / r.height) : 1;
  }
  function renderMap() {
    k = measureK();
    // 지도가 아주 작게 그려지면(휴대폰 1배) 글자를 조금 줄여 건물을 덜 가리게
    svg.innerHTML = mapSVG({ k: k > 1.6 ? k * 0.82 : k, P: palette(), font: FONT, L: cur(), ph: phase, sel, names: showNames, max: 6 });
  }
  new ResizeObserver(() => { if (data && Math.abs(measureK() - k) / k > 0.01) renderMap(); }).observe(svg);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => data && renderMap());
  if (document.fonts) document.fonts.ready.then(() => data && renderMap());

  // 확대: 화면에 맞춘 크기의 1배·1.6배·2.4배 (지도 칸 안에서 스크롤)
  const ZOOMS = [1, 1.6, 2.4];
  let fitW = 0;   // 1배일 때 지도가 그려진 폭(px)
  function setZoom(i) {
    i = Math.max(0, Math.min(ZOOMS.length - 1, i));
    if (i === zi) return;
    const cx = (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth, cy = (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight;
    if (zi === 0) fitW = VB.w / measureK();
    if (i === 0) { svg.style.width = ''; svg.classList.remove('z'); } else { svg.style.width = `${Math.round(fitW * ZOOMS[i])}px`; svg.classList.add('z'); }
    zi = i;
    requestAnimationFrame(() => {
      scroller.scrollLeft = cx * scroller.scrollWidth - scroller.clientWidth / 2;
      scroller.scrollTop = cy * scroller.scrollHeight - scroller.clientHeight / 2;
    });
  }
  $('zin').onclick = () => setZoom(zi + 1);
  $('zout').onclick = () => setZoom(zi - 1);
  $('fit').onclick = () => setZoom(0);

  svg.addEventListener('click', ev => {
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
    const L = cur(), out = [];
    for (const [title, a, b] of SECTIONS) {
      out.push(`<div class="gh">${title}</div>`);
      for (const id of ORDER.slice(a, b)) {
        const p = BY.get(id), mem = membersAt(L, id, phase);
        const color = p.k ? `var(--sw-${KIND[p.k].c})` : id === 'cellar' ? 'var(--sw-cellar)' : id === 'attack' ? 'var(--sw-red)' : 'var(--sw-muted)';
        out.push(`<div class="post${sel === id ? ' on' : ''}${mem.length ? '' : ' empty'}" data-post="${id}" role="button" tabindex="0">` +
          `<span class="pn"><i class="kd" style="background:${color}"></i>${esc(p.nm)}${p.open && phase === 1 ? ' <span class="pill15">15분</span>' : ''}</span>` +
          `<span class="ct${mem.length ? '' : ' zero'}">${mem.length}</span>` +
          (mem.length ? `<span class="who">${whoHTML(mem, phase)}</span>` : '') + '</div>');
      }
    }
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
    const when = p.open ? (p.k ? '15분 뒤 열림' : '15분·20분 등장') : p.k ? '시작부터' : '';
    const meta = [when, sideOf(p), p.pts ? `첫 점령 ${num(p.pts[0])} / ${num(p.pts[1])} · 점령 중 분당 +${num(p.pts[2])} / +${num(p.pts[3])} (연맹 / 개인)` : ''].filter(Boolean).join(' · ');
    box.innerHTML = `<button class="btn x" type="button" id="infox" aria-label="닫기">✕</button>` +
      `<h3>${esc(p.nm)} <small>${esc(p.en)}</small></h3>` + (meta ? `<p class="meta">${meta}</p>` : '') + (p.fx ? `<p>${esc(p.fx)}</p>` : '') +
      `<p><b>${phase === 1 ? '시작 ~ 15분' : '15분 후'} ${mem.length}명</b>${mem.length ? ' · ' + whoHTML(mem, phase) : ''}</p>`;
    box.classList.toggle('left', (p.x || 0) > 0 || p.corner === 'tr');   // 고른 곳 반대쪽에 띄움
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
      `<div class="meta">${esc(L.name)} · 시작 ~ 15분${m.then ? ` → 15분 후 <b>${esc(postName(m.then))}</b>로 이동` : m.at && m.at !== 'sub' ? ' · 15분 후에도 그대로' : ''}</div>`;
    card.hidden = false;
  }
  $('q').addEventListener('input', () => { search(); renderAll(); });
  $('qhint').addEventListener('click', ev => { const b = ev.target.closest('[data-pick]'); if (b) { $('q').value = b.dataset.pick; search(); renderAll(); } });

  // ---------- 연맹 채팅용 텍스트 · 링크 · 이미지 ----------
  function planText() {
    const L = cur(), c = counts(L), out = [];
    out.push(`[성검 쟁탈 ${L.name} 배치] 우리 진영: ${L.side === 'red' ? '빨강(오른쪽)' : '파랑(왼쪽)'} · 전투원 ${c.main}/${LIMIT.main} · 후보 ${c.sub}/${LIMIT.sub}`);
    if (L.memo) out.push(L.memo.trim());
    const line = (id, ph) => { const mem = membersAt(L, id, ph); return mem.length ? `${postName(id)}: ${mem.map(m => (m.lead ? '★' : '') + m.n).join(', ')}` : null; };
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
    const inner = mapSVG({ k: (VB.w / W) * 1.3, P, font: SYS_FONT, L, ph: phase, sel: '', names: true, max: 8 });
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
      const mem = membersAt(L, id, phase);
      if (!mem.length) continue;
      const items = mem.map(m => (m.lead ? '★' : '') + m.n);
      const lines = [];
      let line = '';
      for (const it of items) { const t = line ? `${line} · ${it}` : it; if (line && x.measureText(t).width > colW) { lines.push(line); line = it; } else line = t; }
      if (line) lines.push(line);
      blocks.push({ title: `${postName(id)} ${mem.length}명`, lines });
    }
    const moves = L.members.filter(m => m.then);
    if (moves.length) blocks.push({ title: '15분 후 이동', lines: moves.map(m => `${m.n}: ${m.at ? postName(m.at) : '미배치'} → ${postName(m.then)}`) });
    const cols = [[], []], hgt = [0, 0];
    for (const b of blocks) { const h = 30 + b.lines.length * LH + 12, c = hgt[0] <= hgt[1] ? 0 : 1; cols[c].push(b); hgt[c] += h; }
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
        x.font = F(17, 400);
        b.lines.forEach((ln, i) => x.fillText(ln, bx, y + 30 + LH * (i + 0.8)));
        y += 30 + b.lines.length * LH + 12;
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

  // ---------- 시간·이름 버튼 ----------
  function setPhase(p) { phase = p; if (found) { const m = findIn(data.legions[found.li], found.n); if (m) sel = postOf(m, phase) || sel; } renderAll(); }
  $('ph1').onclick = () => setPhase(1);
  $('ph2').onclick = () => setPhase(2);
  $('nm').onclick = () => { showNames = !showNames; renderAll(); };

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
  // 입력칸 앞에 자리 이름을 쓰면 그곳에: "마구간 tang ZERO 아이쿵 배치" → 왕실 마구간에 tang, ZERO, 아이쿵
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
    if (sel) {
      const mem = membersAt(L, sel, phase);
      $('selpost').innerHTML = `선택: <b>${esc(postName(sel))}</b> · ${tname} ${mem.length}명 <span class="hint">— 아래 칸에 닉네임을 쓰거나 미배치·연맹원 이름을 누르면 여기에 들어갑니다.</span>`;
      $('erows').innerHTML = mem.map(m => `<div class="erow">` +
        `<button class="btn lead" type="button" data-lead="${esc(m.n)}" aria-pressed="${!!m.lead}" title="집결장(리더) 표시">★</button>` +
        `<span class="enm${inRoster(m.n) ? '' : ' warnn'}"${inRoster(m.n) ? '' : ' title="배치도에 없는 닉네임"'}>${esc(m.n)}</span>${thenSelect(m)}` +
        `<button class="btn" type="button" data-out="${esc(m.n)}" aria-label="${esc(m.n)} 빼기">✕</button></div>`).join('');
    } else {
      $('selpost').innerHTML = `<span class="hint">지도나 아래 목록에서 건물(또는 공격조·지하 저장고·후보)을 누르면 그곳의 ${tname} 인원을 고칠 수 있습니다. 건물을 고르지 않고 넣으면 미배치로 들어갑니다.</span>`;
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
    history.replaceState(null, '', u.pathname + (sp.toString() ? '?' + sp.toString().replace(/edit=(&|$)/, 'edit$1') : ''));
  }
  function renderAll() {
    if (!data) return;
    $('ph1').setAttribute('aria-pressed', phase === 1); $('ph2').setAttribute('aria-pressed', phase === 2);
    $('nm').setAttribute('aria-pressed', showNames);
    renderTabs(); renderFacts(); renderMemo(); renderCard(); renderPosts(); renderMap(); renderInfo(); renderEditor(); syncURL();
  }
  load();
})();
