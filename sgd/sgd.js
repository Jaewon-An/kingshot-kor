/* /sgd SGD 자리 배치도 — 곰덫 1개(사냥 함정 1) 배치. 화면 구성·지도 조작은 v2/guide.js와 같습니다.
 * 데이터: 배치 /api/sgd/layout (첫 게시 전에는 layouts/sgd.json), 본부·다른 연맹 영토·지금 깃발 layouts/sgd-area.json.
 * 배치는 node tools/make-sgd-layout.mjs 로 만듭니다. 좌표는 게임 좌표(건물의 최소 X·Y 칸), 줄·거리 계산은 v2/plan.js(KSPlan)와 같습니다.
 * 자리 번호: 곰덫1 기준 줄 → 곰덫까지 거리 → 배치 목록 순서. 닉네임이 "빈자리 N"이거나 비어 있으면 빈자리, 그 밖은 연맹원.
 * 깃발 번호는 설치 순서: 번호대로 지으면 매번 본부와 이어지고 곰덫 → 앞 번호 자리 순으로 영토가 됩니다.
 * 자원 깃발(layouts/sgd-resource.json, tools/plan-sgd-resources.mjs): 연맹 자원지를 영토에 넣는 깃발 경로 (빵·나무 균형). 짓는 중 깃발이 1번부터, 이미 세운 자원 깃발(built)은 번호 없이 표시.
 *   rates(연맹 창고 생산량)가 있으면 깃발마다 그 깃발까지 세웠을 때 예상 생산량(rate). "자원 깃발" 버튼으로 켜고 끔. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const KP = window.KSPlan, K = window.KSCore, G = 1200;
  const cv = $('cv'), gx = cv.getContext('2d'), tip = $('tip');
  const xy = o => `X:${o.x} Y:${o.y}`;
  const f1 = v => v.toFixed(1);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const norm = s => String(s || '').replace(/ /g, ' ').trim().toLowerCase();
  const PHONE = matchMedia('(max-width: 900px)');
  if (PHONE.matches) for (const id of ['legend']) if ($(id)) $(id).open = false;
  // 휴대폰에서는 요약을 머리말 대신 지도 아래에 (검색·지도가 먼저 보이게)
  const factsHome = $('facts').parentNode;
  const placeFacts = () => (PHONE.matches ? $('legend').before($('facts')) : factsHome.append($('facts')));
  PHONE.addEventListener('change', placeFacts); placeFacts();
  const seatName = m => m.named ? m.n : `자리 ${m.no}`;

  // ---------- 불러오기 ----------
  const getJSON = async (api, file) => {
    for (const url of [api, file]) {
      try {
        const r = await fetch(url, { cache: 'no-cache' });
        if (r.ok) return { list: await r.json(), stamp: r.headers.get('X-Layout-Updated') };
      } catch (_) { /* 다음 경로 */ }
    }
    throw new Error(`불러오기 실패: ${api}`);
  };
  function fail(msg) { const n = $('notice'); n.textContent = msg; n.className = 'notice err'; n.hidden = false; }

  let HQ, T, seats, banners, area, blocks, oldFlags, CX, CY, CW, CH, kind, terrStep;
  let rplan = null, rflags = [], rBuilt = [], rTerr = new Set(), rNodes = new Map();   // 자원 깃발 경로 (layouts/sgd-resource.json) · 세운 자원 깃발 · 그 영토 · 연맹 자원이 되는 자원지
  const NODE_NAMES = ['빵', '나무', '석재', '철'];
  const rateText = f => f.rate ? `빵 ${f.rate[0]}K · 나무 ${f.rate[1]}K/h` : `나무 ${f.wood} · 자원 ${f.total}`;   // 그 자원 깃발까지 세웠을 때
  async function load() {
    let cur, map;
    try { cur = await getJSON('/api/sgd/layout', '/layouts/sgd.json'); } catch (_) { fail('SGD 배치도를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.'); return; }
    try { const r = await fetch('/layouts/sgd-area.json', { cache: 'no-cache' }); if (r.ok) area = await r.json(); } catch (_) { /* 영토 정보 없이 표시 */ }
    try { const r = await fetch('/layouts/sgd-resource.json', { cache: 'no-cache' }); if (r.ok) rplan = await r.json(); } catch (_) { /* 자원 깃발 없이 표시 */ }
    try { map = await KP.loadMap(); } catch (_) { fail('지도 데이터를 풀지 못했습니다. 최신 Chrome·Edge·Safari·Firefox에서 열어 주세요.'); return; }
    const list = cur.list;
    const trapO = list.find(o => o.name === '곰덫' && o.nickname === '사냥 함정 1') || list.find(o => o.name === '곰덫');
    if (!trapO) { fail('배치도에 곰덫1(사냥 함정 1)이 없습니다.'); return; }
    const hqo = list.find(o => o.name === '본부 1');
    T = KP.toGame(trapO);
    HQ = hqo ? KP.toGame(hqo) : area ? { x: area.hq.x, y: area.hq.y } : null;
    if (!HQ) { fail('배치도에 본부가 없습니다.'); return; }
    const num = o => { const m = /\d+/.exec(String(o.nickname)); return m ? +m[0] : Infinity; };
    banners = list.filter(o => o.name === '깃발 1').map((o, i) => ({ o, i, k: num(o) })).sort((a, b) => a.k - b.k || a.i - b.i)
      .map(({ o }, i) => ({ ...KP.toGame(o), n: `깃발 ${i + 1}번`, no: i + 1, id: 'b' + i, kind: 'banner' }));
    // 자리 (연맹원·빈자리·연맹 건물): 줄 → 곰덫까지 거리 → 목록 순서로 번호
    seats = list.map((o, oi) => ({ o, oi })).filter(({ o }) => o.name === 'Player' || o.name === '연맹자원').map(({ o, oi }) => {
      const p = KP.toGame(o), res = o.name === '연맹자원', spare = !res && KP.isSpare(o.nickname);
      return { x: p.x, y: p.y, n: o.nickname || '', named: !spare, res, kind: res ? 'res' : spare ? 'spare' : 'city', l: KP.lineOf(p, T), d: KP.dist(p, T), oi };
    }).sort((a, b) => a.l - b.l || a.d - b.d || a.oi - b.oi);
    seats.forEach((s, i) => { s.no = i + 1; s.id = 's' + i; });
    // 몇 번 깃발까지 지으면 영토 안인지 (0 = 본부 영토만으로 충분)
    const own = new Map();   // 칸 → 처음 영토가 되는 단계
    const cov = (x, y, s, c, step) => { for (let yy = y - c; yy < y + s + c; yy++) for (let xx = x - c; xx < x + s + c; xx++) if (!own.has(yy * G + xx)) own.set(yy * G + xx, step); };
    cov(HQ.x, HQ.y, 3, K.HQ_COV, 0); banners.forEach(b => cov(b.x, b.y, 1, K.BN_COV, b.no));
    const needOf = (o, s) => { let v = 0; for (let y = o.y; y < o.y + s; y++) for (let x = o.x; x < o.x + s; x++) { const k = own.get(y * G + x); if (k == null) return Infinity; v = Math.max(v, k); } return v; };
    T.need = needOf(T, 3);
    seats.forEach(s => { s.need = needOf(s, 2); });
    banners.forEach(b => { b.adds = seats.filter(s => s.need === b.no).length; b.trap = T.need === b.no; });
    terrStep = own;
    blocks = area ? area.blocks : [];
    // 지금 서 있는 SGD 깃발: 새 배치 깃발과 같은 칸이면 그대로 사용, 자리·곰덫 위면 철거
    oldFlags = (area && area.flags || []).map((f, i) => {
      const reuse = banners.find(b => b.x === f.x && b.y === f.y);
      const on = seats.find(s => f.x >= s.x && f.x < s.x + 2 && f.y >= s.y && f.y < s.y + 2) || (f.x >= T.x && f.x < T.x + 3 && f.y >= T.y && f.y < T.y + 3 ? { trap: true } : null);
      return { x: f.x, y: f.y, id: 'f' + i, kind: 'old', reuse, on, n: '지금 SGD 깃발' };
    });
    // 자원 깃발: 번호 = 설치 순서. 그 깃발로 새로 연맹 자원이 되는 자원지(4칸 중 3칸 이상 영토)는 rNodes에 (몇 번 깃발로 얻는지)
    if (rplan) {
      rflags = rplan.flags.map((f, i) => ({ ...f, n: `자원 깃발 ${f.no}번${f.building ? ' (짓는 중)' : ''}`, id: 'r' + i, kind: 'rflag' }));
      rBuilt = (rplan.built || []).map(([x, y], i) => ({ x, y, n: '세운 자원 깃발', id: 'rb' + i, kind: 'rbuilt' }));
      for (const n of rplan.base || []) rNodes.set(`${n[0]},${n[1]}`, { x: n[0], y: n[1], t: n[2], by: 0 });
      for (const f of rflags) for (const n of f.nodes) rNodes.set(`${n[0]},${n[1]}`, { x: n[0], y: n[1], t: n[2], by: f.no });
      for (const f of [...rBuilt, ...rflags]) for (let y = f.y - K.BN_COV; y <= f.y + K.BN_COV; y++) for (let x = f.x - K.BN_COV; x <= f.x + K.BN_COV; x++) if (!terrStep.has(y * G + x)) rTerr.add(y * G + x);
    }

    // 지형 잘라내기 — kind 0 땅 1 산 2 호수 3~6 자원지(빵·나무·석재·철) 7 구조물
    const pts = [HQ, T, ...seats, ...banners, ...oldFlags, ...rBuilt, ...rflags];
    const x0 = Math.max(0, Math.min(...pts.map(p => p.x)) - 30), x1 = Math.min(G - 1, Math.max(...pts.map(p => p.x)) + 32);
    const y0 = Math.max(0, Math.min(...pts.map(p => p.y)) - 30), y1 = Math.min(G - 1, Math.max(...pts.map(p => p.y)) + 32);
    CX = x0; CY = y0; CW = x1 - x0 + 1; CH = y1 - y0 + 1;
    kind = new Uint8Array(CW * CH);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = map.kind[y * G + x];
      kind[(y - y0) * CW + x - x0] = k <= 6 ? k : 7;
    }
    if (cur.stamp && $('stamp')) $('stamp').textContent = `마지막 게시 ${new Date(cur.stamp).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}`;
    $('notice').hidden = true;
    $('main').hidden = false;
    start();
  }

  const kindAt = (x, y) => (x < CX || y < CY || x >= CX + CW || y >= CY + CH) ? 0 : kind[(y - CY) * CW + x - CX];
  const foreignAt = (x, y) => blocks.find(b => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2);
  const objAt = new Map();
  const put = (o, s) => { for (let y = o.y; y < o.y + s; y++) for (let x = o.x; x < o.x + s; x++) objAt.set(y * G + x, { o, s }); };
  const needText = n => n === 0 ? '본부 영토 안' : Number.isFinite(n) ? `깃발 ${n}번까지 설치하면 영토 안` : '영토 밖';

  let groups = [], byId = new Map();
  function start() {
    oldFlags.forEach(f => put(f, 1));
    put({ ...HQ, n: area && area.hq.name ? `본부 (${area.hq.name})` : '본부', kind: 'hq' }, 3); put({ ...T, n: '곰덫1 (사냥 함정 1)', kind: 'trap' }, 3);
    banners.forEach(b => put(b, 1)); seats.forEach(s => put(s, 2)); rBuilt.forEach(f => put(f, 1)); rflags.forEach(f => put(f, 1));
    const members = seats.filter(s => s.kind === 'city'), spare = seats.filter(s => s.kind === 'spare');
    const rLast = rflags[rflags.length - 1], R = rplan && rplan.rates;

    // ---------- 요약 ----------
    $('facts').innerHTML = [
      ['--c-hq', '본부', xy(HQ)], ['--c-t1', '곰덫1', xy(T)], ['--c-banner', '깃발', banners.length + '개'],
      ['--c-city2', '자리', members.length ? `${seats.length} · 연맹원 ${members.length}` : `${seats.length}`],
      ...(rflags.length ? [['--c-rflag', '자원 깃발', `${rflags.length}개 → ${rateText(rLast)}`]] : []),
    ].map(([c, k, v]) => `<div><dt><i style="background:var(${c})"></i>${k}</dt><dd>${v}</dd></div>`).join('');

    // ---------- 명단: 곰덫1 줄별 (번호 순) ----------
    for (const s of seats) {
      const title = `곰덫1 ${s.l}줄`, last = groups[groups.length - 1];
      if (last && last.title === title) last.rows.push(s); else groups.push({ title, rows: [s] });
    }
    const tagOf = m => m.kind === 'res' ? '--c-res' : m.kind === 'spare' ? '--c-spare' : '--c-city2';
    $('list').innerHTML = '<thead><tr><th>자리</th><th>좌표</th><th>영토</th></tr></thead>' + groups.map((gr, gi) =>
      `<tbody data-g="${gi}"><tr class="grp"><td colspan="3">${esc(gr.title)} · ${gr.rows.length}</td></tr>` +
      gr.rows.map(m => `<tr class="row" data-id="${m.id}" data-no="${m.no}" data-xy="${m.x},${m.y}" data-k="${m.named ? esc(norm(m.n)) : ''}"><td class="nm"><span class="tag" style="background:var(${tagOf(m)})"></span>${m.named ? `${esc(m.n)} <span class="sumx mono">${m.no}</span>` : `<span class="mono">${m.no}</span>`}</td><td class="mono">${xy(m)}</td><td class="mono sumx">${m.need === 0 ? '본부' : Number.isFinite(m.need) ? `깃발 ${m.need}` : '밖'}</td></tr>`).join('') + '</tbody>').join('');
    byId = new Map(seats.map(m => [m.id, m]));

    // ---------- 깃발 설치 순서 ----------
    // k번 깃발까지 지었을 때: 1번 자리부터 이어서 영토인 자리 수 (연맹원이 앞 번호부터 채우면 이만큼 들어감) · 영토 안 자리 전체
    const upTo = k => { const i = seats.findIndex(s => s.need > k); return i < 0 ? seats.length : i; };
    const inTerr = k => seats.filter(s => s.need <= k).length;
    $('bnsum').textContent = `${banners.length}개 · 본부만으로 자리 ${inTerr(0)}개`;
    $('bn').innerHTML = banners.map(b => `<li><button type="button" class="lnk" data-b="${b.id}">깃발 ${b.no}번</button> <span class="mono">${b.x},${b.y}</span> <span class="why">${b.trap ? '곰덫1 영토 · ' : ''}${upTo(b.no) ? `1~${upTo(b.no)}번 자리 · ` : ''}영토 안 자리 ${inTerr(b.no)}</span></li>`).join('');
    const tn = $('trapneed');
    if (tn) tn.textContent = T.need === 0 ? '곰덫1 자리는 본부 영토 안이라 바로 설치할 수 있습니다.' : Number.isFinite(T.need) ? `곰덫1은 깃발 ${T.need}번까지 설치한 뒤 세울 수 있습니다 (곰덫은 영토 안에만).` : '곰덫1 자리가 영토 밖입니다 — 배치를 다시 계산하세요.';

    // ---------- 다른 연맹 영토·지금 깃발 ----------
    if (blocks.length) {
      const who = [...new Set(blocks.map(b => b.who || '기타'))];
      $('forsum').textContent = `${blocks.length}곳` + (area.updated ? ` · ${area.updated} 기준` : '');
      $('forlist').innerHTML = who.map(w => `<li class="grp">${esc(w)} 연맹</li>` + blocks.filter(b => (b.who || '기타') === w)
        .map(b => `<li><button type="button" class="lnk" data-x="${(b.x1 + b.x2) >> 1}" data-y="${(b.y1 + b.y2) >> 1}">X ${b.x1}~${b.x2} · Y ${b.y1}~${b.y2}</button>${b.note ? ` <span class="why">${esc(b.note)}</span>` : ''}</li>`).join('')).join('') +
        oldFlags.map(f => `<li class="grp">지금 SGD 깃발</li><li><button type="button" class="lnk" data-x="${f.x}" data-y="${f.y}">${f.x},${f.y}</button> <span class="why">${f.reuse ? `새 배치 깃발 ${f.reuse.no}번으로 그대로 사용` : f.on ? `철거 필요 (${f.on.trap ? '곰덫1' : `자리 ${f.on.no}`} 위)` : '새 배치와 겹치지 않음 · 두어도 됨'}</span></li>`).join('');
      if (area.source) $('forsrc').textContent = area.source + (area.margin ? ` · 계산할 때는 둘레 ${area.margin}칸을 더 비웠습니다.` : '');
      $('foreign').hidden = false;
    }

    // ---------- 자원 깃발 경로 (빵·나무 균형) ----------
    if (rflags.length) {
      const nb = rflags.filter(f => f.building).length, kindsOf = f => f.nodes.length ? f.nodes.map(n => NODE_NAMES[n[2]]).join(' ') : '연결';
      const gain = t => rflags.reduce((a, f) => a + f.nodes.filter(n => n[2] === t).length, 0);
      $('ressum').textContent = `${rflags.length}개 · 빵 +${gain(0)} · 나무 +${gain(1)}곳`;
      const first = rflags.find(f => f.needs && f.needs.length);
      $('reshint').textContent = (R ? `지금 생산 (${R.at} 연맹 창고): 빵 ${R['빵']}K · 나무 ${R['나무']}K · 석재 ${R['석재']}K · 철 ${R['철']}K/h, 자원지 1곳 = ${R.perNode}K/h. ` : '') +
        (rBuilt.length ? `이미 세운 자원 깃발 ${rBuilt.length}개는 번호 없이 표시했습니다. ` : '') +
        (nb ? `${nb > 1 ? `1~${nb}번` : '1번'}은 지금 짓는 중인 깃발입니다. ` : '') +
        (first ? `자원 깃발 ${first.no}번은 배치 ${first.link}번에 붙으니 배치 깃발 ${first.needs.map(n => n.replace('깃발 ', '') + '번').join(' → ')}을 먼저 세우세요. ` : '') +
        (rLast.rate ? `${rLast.no}번까지 세우면 빵 ${rLast.rate[0]}K · 나무 ${rLast.rate[1]}K/h입니다.` : '');
      $('reslist').innerHTML = rflags.map(f => {
        const cls = f.nodes.some(n => n[2] === 0) ? 'bread' : f.nodes.some(n => n[2] === 1) ? 'wood' : '';
        return `<li${cls ? ` class="${cls}"` : ''}><button type="button" class="lnk" data-r="${f.id}">자원 ${f.no}번</button> <span class="mono">${f.x},${f.y}</span>${f.building ? ' <span class="tagb">짓는 중</span>' : ''} <span class="why">← ${esc(f.link)} · +${kindsOf(f)} · ${rateText(f)}</span></li>`;
      }).join('');
      $('resplan').hidden = false; $('res').hidden = false;
      for (const id of ['rflaglegend', 'rterrlegend']) if ($(id)) $(id).hidden = false;
    }

    readColors(); home();
    const q0 = new URLSearchParams(location.search);
    if (q0.get('q') && $('q')) { $('q').value = q0.get('q'); search(true); } else openFromURL();
  }

  // ---------- 색 ----------
  let C = {};
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['m-void', 'm-ground', 'm-mount', 'm-lake', 'm-node', 'm-struct', 'm-foreign', 'm-grid', 'm-edge', 'c-hq', 'c-t1', 'c-banner', 'c-city2', 'c-res', 'c-spare', 'c-terr', 'c-real', 'c-pick', 'on-obj', 'bad',
      'n-bread', 'n-wood', 'n-stone', 'n-iron', 'c-rflag', 'c-rterr'])
      C[k] = cs.getPropertyValue('--' + k).trim();
  };
  const rgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const n = m ? parseInt(m[1], 16) : 0x808080; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  let terrImg = null, ovImg = null, edges = null, foreignEdges = null, rovImg = null, redges = null;
  function buildImages() {
    const mk = () => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; return c; };
    const a = mk(), ga = a.getContext('2d'), ia = ga.createImageData(CW, CH), da = ia.data;
    const col = [rgb(C['m-ground']), rgb(C['m-mount']), rgb(C['m-lake']), rgb(C['n-bread']), rgb(C['n-wood']), rgb(C['n-stone']), rgb(C['n-iron']), rgb(C['m-struct'])], fo = rgb(C['m-foreign']);
    for (let r = 0; r < CH; r++) for (let x = 0; x < CW; x++) {
      const k = kind[r * CW + x], c3 = k ? col[k] : foreignAt(CX + x, CY + r) ? fo : col[0], p = 4 * (r * CW + x);
      da[p] = c3[0]; da[p + 1] = c3[1]; da[p + 2] = c3[2]; da[p + 3] = 255;
    }
    ga.putImageData(ia, 0, 0); terrImg = a;
    foreignEdges = new Path2D();
    for (const b of blocks) foreignEdges.rect(b.x1, b.y1, b.x2 - b.x1 + 1, b.y2 - b.y1 + 1);
    // SGD 영토 (본부 15×15 + 배치 깃발 7×7)
    const b = mk(), gb = b.getContext('2d'), ib = gb.createImageData(CW, CH), db = ib.data, t = rgb(C['c-terr']);
    const inT = (lx, ly) => lx >= 0 && ly >= 0 && lx < CW && ly < CH && terrStep.has((ly + CY) * G + lx + CX);
    edges = new Path2D();
    for (let r = 0; r < CH; r++) for (let x = 0; x < CW; x++) {
      if (!inT(x, r)) continue;
      const p = 4 * (r * CW + x); db[p] = t[0]; db[p + 1] = t[1]; db[p + 2] = t[2]; db[p + 3] = 255;
      const wx = CX + x, wy = CY + r;
      if (!inT(x - 1, r)) { edges.moveTo(wx, wy); edges.lineTo(wx, wy + 1); }
      if (!inT(x + 1, r)) { edges.moveTo(wx + 1, wy); edges.lineTo(wx + 1, wy + 1); }
      if (!inT(x, r - 1)) { edges.moveTo(wx, wy); edges.lineTo(wx + 1, wy); }
      if (!inT(x, r + 1)) { edges.moveTo(wx, wy + 1); edges.lineTo(wx + 1, wy + 1); }
    }
    gb.putImageData(ib, 0, 0); ovImg = b;
    // 자원 깃발로 늘어나는 영토 (배치 영토와 맞닿은 변은 선을 긋지 않음)
    const rc = mk(), gr = rc.getContext('2d'), ir = gr.createImageData(CW, CH), dr = ir.data, rt = rgb(C['c-rterr']);
    const inRT = (lx, ly) => lx >= 0 && ly >= 0 && lx < CW && ly < CH && rTerr.has((ly + CY) * G + lx + CX);
    const out = (lx, ly) => !inRT(lx, ly) && !inT(lx, ly);
    redges = new Path2D();
    for (let r = 0; r < CH; r++) for (let x = 0; x < CW; x++) {
      if (!inRT(x, r)) continue;
      const p = 4 * (r * CW + x); dr[p] = rt[0]; dr[p + 1] = rt[1]; dr[p + 2] = rt[2]; dr[p + 3] = 255;
      const wx = CX + x, wy = CY + r;
      if (out(x - 1, r)) { redges.moveTo(wx, wy); redges.lineTo(wx, wy + 1); }
      if (out(x + 1, r)) { redges.moveTo(wx + 1, wy); redges.lineTo(wx + 1, wy + 1); }
      if (out(x, r - 1)) { redges.moveTo(wx, wy); redges.lineTo(wx + 1, wy); }
      if (out(x, r + 1)) { redges.moveTo(wx, wy + 1); redges.lineTo(wx + 1, wy + 1); }
    }
    gr.putImageData(ir, 0, 0); rovImg = rc;
  }

  // ---------- 보기 ----------
  const view = { cx: 0, cy: 0, s: 14, rot: true, names: true, terr: true, res: true, pick: null, cur: null, flag: null, mark: null };
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
  function fit(all) { // all: 자원 깃발까지 (전체 버튼), 아니면 자리 배치만 (처음 보기)
    const pts = seats.map(m => [m.x, m.y, 2]).concat([[T.x, T.y, 3], [HQ.x, HQ.y, 3]], all && view.res ? [...rBuilt, ...rflags].map(f => [f.x, f.y, 1]) : []);
    const x0 = Math.min(...pts.map(p => p[0])) - 2, y0 = Math.min(...pts.map(p => p[1])) - 2;
    const x1 = Math.max(...pts.map(p => p[0] + p[2])) + 2, y1 = Math.max(...pts.map(p => p[1] + p[2])) + 2;
    const w = cv.clientWidth, h = cv.clientHeight, bw = x1 - x0, bh = y1 - y0;
    view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
    view.s = Math.max(3, Math.min(60, view.rot ? Math.min(w, h) / ((bw + bh) * SQ) : Math.min(w / bw, h / bh)));
    draw();
  }
  // 처음 보기: 전체 보기에서 이름이 안 읽히면(휴대폰) 곰덫1을 가운데에 두고 번호가 보이는 배율로
  const LABEL_S = 13, HOME_S = 20;
  function home() {
    fit();
    if (view.s >= LABEL_S) return;
    view.cx = T.x + 1.5; view.cy = T.y + 1.5; view.s = HOME_S;
  }
  const lineRect = k => { // 격자 방향: 도시 격자 홀짝에 따라 한쪽은 곰덫에 붙고 반대쪽은 1칸 틈
    const c0 = seats[0], side = (v, p) => ((v - 2 - p) & 1) === 0 ? [v - 2 * k, v + 3 + 2 * k + 1] : [v - 2 * k - 1, v + 3 + 2 * k];
    const [x0, x1] = side(T.x, c0 ? c0.x & 1 : 0), [y0, y1] = side(T.y, c0 ? c0.y & 1 : 0); return { x0, x1, y0, y1 };
  };

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
    gx.strokeStyle = C['bad']; gx.lineWidth = 1.2 / s; gx.setLineDash([3 / s, 3 / s]); gx.stroke(foreignEdges); gx.setLineDash([]);
    if (view.terr) { gx.globalAlpha = 0.22; gx.drawImage(ovImg, CX, CY, CW, CH); gx.globalAlpha = 1; gx.strokeStyle = C['c-terr']; gx.lineWidth = 1.5 / s; gx.stroke(edges); }
    if (view.res && rflags.length) {
      gx.globalAlpha = 0.2; gx.drawImage(rovImg, CX, CY, CW, CH); gx.globalAlpha = 1;
      gx.strokeStyle = C['c-rterr']; gx.lineWidth = 1.5 / s; gx.setLineDash([5 / s, 3 / s]); gx.stroke(redges); gx.setLineDash([]);
      // 연맹 자원이 되는 자원지 (빵·나무는 굵게)
      for (const n of rNodes.values()) { gx.strokeStyle = n.t === 1 ? C['n-wood'] : n.t === 0 ? C['n-bread'] : C['m-edge']; gx.lineWidth = (n.t <= 1 ? 3.2 : 1.4) / s; gx.strokeRect(n.x - 0.15, n.y - 0.15, 2.3, 2.3); }
    }
    if (s >= 7) {
      gx.beginPath();
      for (let x = CX; x <= CX + CW; x++) { gx.moveTo(x, CY); gx.lineTo(x, CY + CH); }
      for (let y = CY; y <= CY + CH; y++) { gx.moveTo(CX, y); gx.lineTo(CX + CW, y); }
      gx.strokeStyle = C['m-grid']; gx.lineWidth = 1 / s; gx.stroke();
    }
    // 줄 경계 (곰덫1 1~3줄)
    gx.setLineDash([4 / s, 4 / s]);
    for (const k of [1, 2, 3]) { const r = lineRect(k); gx.strokeStyle = C['c-t1']; gx.lineWidth = (k === 3 ? 2 : 1.1) / s; gx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); }
    gx.setLineDash([]);
    const box = (o, sz, fill, inset) => { gx.fillStyle = fill; gx.fillRect(o.x + inset, o.y + inset, sz - 2 * inset, sz - 2 * inset); };
    seats.forEach(st => {
      if (st.kind === 'spare') { gx.strokeStyle = C['c-spare']; gx.lineWidth = 1.6 / s; gx.setLineDash([3 / s, 2.5 / s]); gx.strokeRect(st.x + 0.15, st.y + 0.15, 1.7, 1.7); gx.setLineDash([]); }
      else box(st, 2, st.kind === 'res' ? C['c-res'] : C['c-city2'], 0.08);
    });
    banners.forEach(b => box(b, 1, C['c-banner'], 0.06));
    if (view.res) {
      rBuilt.forEach(f => box(f, 1, C['c-rflag'], 0.06));
      rflags.forEach(f => { if (f.building) gx.globalAlpha = 0.5; box(f, 1, C['c-rflag'], 0.06); gx.globalAlpha = 1; if (f.building) { gx.strokeStyle = C['c-rflag']; gx.lineWidth = 2 / s; gx.setLineDash([2 / s, 2 / s]); gx.strokeRect(f.x - 0.1, f.y - 0.1, 1.2, 1.2); gx.setLineDash([]); } });
    }
    oldFlags.forEach(f => { if (!f.reuse) { gx.strokeStyle = f.on ? C['bad'] : C['c-real']; gx.lineWidth = 2.2 / s; gx.strokeRect(f.x + 0.12, f.y + 0.12, 0.76, 0.76); } });
    box(HQ, 3, C['c-hq'], 0.05); box(T, 3, C['c-t1'], 0.05);
    if (view.flag) { // 마우스가 올라간 깃발의 영토
      const f = view.flag, c = f.res ? C['c-rflag'] : C['c-banner'], r = K.BN_COV;
      gx.fillStyle = c; gx.globalAlpha = 0.22; gx.fillRect(f.x - r, f.y - r, 2 * r + 1, 2 * r + 1); gx.globalAlpha = 1;
      gx.strokeStyle = c; gx.lineWidth = 3 / s; gx.strokeRect(f.x - r, f.y - r, 2 * r + 1, 2 * r + 1);
    }
    if (view.cur) { gx.strokeStyle = C['m-edge']; gx.lineWidth = 2 / s; gx.strokeRect(view.cur.x, view.cur.y, 1, 1); }
    if (view.pick) { const p = view.pick; gx.strokeStyle = C['c-pick']; gx.lineWidth = 4 / s; gx.strokeRect(p.x - 0.2, p.y - 0.2, 2.4, 2.4); }
    if (view.mark) { const p = view.mark; gx.strokeStyle = C['c-pick']; gx.lineWidth = 4 / s; gx.beginPath(); gx.arc(p.x + 0.5, p.y + 0.5, 1.6, 0, Math.PI * 2); gx.stroke(); gx.strokeRect(p.x, p.y, 1, 1); }
    // 글자
    gx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gx.textAlign = 'center'; gx.textBaseline = 'middle';
    const label = (o, sz, text, px, color, maxW) => {
      const p = toScreen(o.x + sz / 2, o.y + sz / 2);
      if (p.x < -60 || p.y < -20 || p.x > w + 60 || p.y > h + 20) return;
      gx.font = `600 ${px}px "IBM Plex Sans KR", "Malgun Gothic", sans-serif`;
      let t = text;
      if (maxW) while (t.length > 1 && gx.measureText(t).width > maxW) t = t.slice(0, -1);
      if (t !== text) t = t.slice(0, -1) + '…';
      gx.fillStyle = color; gx.fillText(t, p.x, p.y + 0.5);
    };
    const cellW = 2 * s * (view.rot ? 1.25 : 0.95);
    if (view.names && s >= LABEL_S) {
      const px = Math.min(12, Math.max(8, s * 0.42));
      seats.forEach(st => label(st, 2, st.named ? st.n : String(st.no), px, st.named ? C['on-obj'] : C['c-spare'], cellW));
    }
    if (s >= 10) banners.forEach(b => label(b, 1, String(b.no), Math.min(11, s * 0.55), C['on-obj']));
    if (s >= 10 && view.res) rflags.forEach(f => label(f, 1, String(f.no), Math.min(11, s * 0.55), C['on-obj']));
    const big = Math.min(15, Math.max(10, s * 0.75));
    label(T, 3, '덫1', big, C['on-obj']); label(HQ, 3, '본부', big, C['on-obj']);
  }

  // ---------- 선택 ----------
  function select(m, center) {
    view.pick = m; view.mark = null;
    document.querySelectorAll('tr.row.on').forEach(r => r.classList.remove('on'));
    const row = document.querySelector(`tr.row[data-id="${m.id}"]`);
    if (row) { row.classList.add('on'); const box = $('list').parentElement, top = row.offsetTop - box.clientHeight / 2; box.scrollTo({ top: Math.max(0, top) }); }
    $('card').innerHTML = `<span class="nm">${m.named ? `${esc(m.n)} · ` : ''}자리 ${m.no}${m.kind === 'spare' ? ' <span class="badge new">빈자리</span>' : m.kind === 'res' ? ' <span class="badge new">연맹 건물</span>' : ''}</span><span class="co">${xy(m)}</span>
      <span class="meta">곰덫1 기준 ${m.l}줄 · 곰덫1까지 ${f1(m.d)}칸 · 본부까지 ${f1(Math.hypot(m.x + 1 - HQ.x - 1.5, m.y + 1 - HQ.y - 1.5))}칸</span>
      <span class="meta">${needText(m.need)}</span>`;
    $('card').hidden = false;
    setURL('s', m.no);
    if (center) { view.cx = m.x + 1; view.cy = m.y + 1; view.s = Math.max(view.s, 22); }
    draw();
  }
  $('list').addEventListener('click', e => {
    const tr = e.target.closest('tr.row');
    if (!tr) return;
    select(byId.get(tr.dataset.id), true);
    if (PHONE.matches) $('card').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  function search(pickFirst) {
    // "12"·"자리 12" = 자리 번호, "600 905"·"X:600 Y:905" = 좌표 (그런 닉네임이 있으면 닉네임 우선)
    let q = norm($('q').value), hit;
    const d = q.replace(/^자리\s*/, ''), nick = seats.some(m => m.named && norm(m.n) === q);
    if (!nick && /^\d+$/.test(d)) { q = d; hit = r => r.dataset.no === q; }
    else if (!nick && /^(x\s*:?\s*)?\d+[\s,]+(y\s*:?\s*)?\d+$/.test(d)) { q = d.replace(/[^\d]+/g, ' ').trim().replace(/ /g, ','); hit = r => r.dataset.xy === q; }
    else hit = r => !q || r.dataset.k.includes(q);
    const hits = [];
    document.querySelectorAll('#list tbody').forEach(tb => {
      let any = false;
      tb.querySelectorAll('tr.row').forEach(r => { const on = hit(r); r.hidden = !on; if (on) { any = true; hits.push(r); } });
      tb.hidden = !any;
    });
    const exact = q && hits.find(r => r.dataset.k === q);
    $('qhint').textContent = q && !hits.length ? '찾는 자리가 없습니다. 자리 번호나 좌표로 찾아 보세요.' : '';
    const pick = exact || (q && (hits.length === 1 || pickFirst) ? hits[0] : null);
    if (pick) select(byId.get(pick.dataset.id), true);
  }
  $('q').addEventListener('input', () => search(false));
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter') search(true); });

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
        const o = hover(e.offsetX, e.offsetY);
        if (e.pointerType !== 'mouse') tip.hidden = true;
        if (o && byId.has(o.id)) select(o, false);
        else { const w = toWorld(e.offsetX, e.offsetY); markAt(Math.floor(w.x), Math.floor(w.y)); }
      }
    }
    downAt = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !ptrs.size) { tip.hidden = true; view.cur = null; view.flag = null; if (!view.mark) $('readout').textContent = ''; draw(); } });
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  function zoomAt(sx, sy, f) { const a = toWorld(sx, sy); view.s = Math.max(3, Math.min(60, view.s * f)); const b = toWorld(sx, sy); view.cx += a.x - b.x; view.cy += a.y - b.y; draw(); }
  function hover(sx, sy) {
    const wp = toWorld(sx, sy), x = Math.floor(wp.x), y = Math.floor(wp.y);
    const k = kindAt(x, y), hit = objAt.get(y * G + x), o = hit && hit.o, fb = foreignAt(x, y);
    // 자원지: 종류 + 연맹 자원이 되는 깃발 (자원지 2×2의 어느 칸이든)
    const rn = k >= 3 && k <= 6 ? [rNodes.get(`${x},${y}`), rNodes.get(`${x - 1},${y}`), rNodes.get(`${x},${y - 1}`), rNodes.get(`${x - 1},${y - 1}`)].find(n => n && x - n.x < 2 && y - n.y < 2) : null;
    const kn = k >= 3 && k <= 6 ? `${NODE_NAMES[k - 3]} 자원지${rn ? (rn.by ? ` · 자원 깃발 ${rn.by}번으로 연맹 자원` : ' · 지금 영토(배치·세운 깃발)로 연맹 자원') : ''}` : ['', '산', '호수'][k] || (k === 7 ? '구조물' : '');
    let info = [fb ? `다른 연맹 영토 (${fb.who || ''})` : '', kn].filter(Boolean).join(' · ');
    if (o) {
      const extra = byId.has(o.id) ? ` ${xy(o)} · 곰덫1 ${o.l}줄${o.kind === 'spare' ? ' · 빈자리' : ''} · ${needText(o.need)}` : o.kind === 'banner' ? ` ${xy(o)} · 설치 순서 ${o.no}번`
        : o.kind === 'rflag' ? ` ${xy(o)} · ${o.link}에 붙음 · +${o.nodes.map(n => NODE_NAMES[n[2]]).join(' ') || '연결'}${o.rate ? ` · 여기까지 ${rateText(o)}` : ''}` : ` ${xy(o)}`;
      info = (byId.has(o.id) ? seatName(o) : o.n) + extra + (info ? ' · ' + info : '');
    }
    const fl = o && (o.kind === 'banner' || o.kind === 'old' || o.kind === 'rflag' || o.kind === 'rbuilt') ? { x: o.x, y: o.y, res: o.kind === 'rflag' || o.kind === 'rbuilt' } : null;
    if (fl) info += ` · 영토 X ${fl.x - K.BN_COV}~${fl.x + K.BN_COV} · Y ${fl.y - K.BN_COV}~${fl.y + K.BN_COV}`;
    if ((fl && fl.x) !== (view.flag && view.flag.x) || (fl && fl.y) !== (view.flag && view.flag.y)) { view.flag = fl; draw(); }
    $('readout').textContent = `칸 X:${x} Y:${y}${info ? ' · ' + info : ''}`;
    const b = document.createElement('b'); b.textContent = `X:${x}  Y:${y}`;
    tip.replaceChildren(b, document.createTextNode(info || (terrStep.has(y * G + x) ? 'SGD 영토' : '빈 땅')));
    tip.hidden = false;
    const W = cv.clientWidth, H = cv.clientHeight, tw = tip.offsetWidth, th = tip.offsetHeight;
    let lx = sx + 16, ly = sy + 18; if (lx + tw > W - 6) lx = sx - tw - 12; if (ly + th > H - 6) ly = sy - th - 12;
    tip.style.transform = `translate(${Math.max(6, lx)}px, ${Math.max(6, ly)}px)`;
    if (!view.cur || view.cur.x !== x || view.cur.y !== y) { view.cur = { x, y }; draw(); }
    return o;
  }
  const toggle = (id, key, after) => $(id).addEventListener('click', () => { view[key] = !view[key]; $(id).setAttribute('aria-pressed', String(view[key])); after ? after() : draw(); });
  toggle('rot', 'rot', home); toggle('lbl', 'names'); toggle('ter', 'terr'); toggle('res', 'res');
  const goTo = (x, y, text) => {
    view.cx = x + 0.5; view.cy = y + 0.5; view.s = Math.max(view.s, 16); view.cur = { x, y };
    markAt(x, y, true); $('readout').textContent = text;
    if (PHONE.matches) cv.scrollIntoView({ block: 'center', behavior: 'smooth' });
    draw();
  };
  $('bn').addEventListener('click', e => {
    const btn = e.target.closest('button[data-b]'), b = btn && banners.find(o => o.id === btn.dataset.b);
    if (b) goTo(b.x, b.y, `깃발 ${b.no}번 · X:${b.x} Y:${b.y} · ${b.trap ? '곰덫1 영토 · ' : ''}새로 영토가 되는 자리 ${b.adds}개`);
  });
  $('forlist').addEventListener('click', e => {
    const btn = e.target.closest('button[data-x]');
    if (btn) goTo(+btn.dataset.x, +btn.dataset.y, `${btn.textContent.trim()}`);
  });
  $('reslist').addEventListener('click', e => {
    const btn = e.target.closest('button[data-r]'), f = btn && rflags.find(o => o.id === btn.dataset.r);
    if (!f) return;
    if (!view.res) $('res').click();   // 자원 깃발이 꺼져 있으면 켜서 보여 줌
    goTo(f.x, f.y, `자원 깃발 ${f.no}번${f.building ? ' (짓는 중)' : ''} · X:${f.x} Y:${f.y} · ${f.link}에 붙음 · +${f.nodes.map(n => NODE_NAMES[n[2]]).join(' ') || '연결'} · 여기까지 ${rateText(f)}`);
  });
  $('fit').addEventListener('click', () => fit(true));
  $('zin').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.35));
  $('zout').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.35));

  // ---------- 주소: ?s=자리번호 · ?at=X,Y · ?q=닉네임 ----------
  function setURL(k, v) {
    const u = new URL(location.href);
    for (const p of ['s', 'at', 'q']) u.searchParams.delete(p);
    const qs = [u.searchParams.toString(), k ? `${k}=${v}` : ''].filter(Boolean).join('&');
    history.replaceState(null, '', u.pathname + (qs ? `?${qs}` : ''));
  }
  function markAt(x, y, keepText) {
    view.pick = null; view.mark = { x, y };
    document.querySelectorAll('tr.row.on').forEach(r => r.classList.remove('on')); $('card').hidden = true;
    setURL('at', `${x},${y}`);
    if (!keepText) $('readout').textContent = `X:${x} Y:${y} · 링크 복사로 이 위치 공유`;
    draw();
  }
  function openFromURL() {
    const q = new URLSearchParams(location.search);
    const s = +q.get('s'), at = /^(\d+),(\d+)$/.exec(q.get('at') || '');
    if (s) { const m = seats.find(o => o.no === s); if (m) { select(m, true); return; } }
    if (at) { const x = +at[1], y = +at[2]; view.cx = x + 0.5; view.cy = y + 0.5; view.s = Math.max(view.s, 18); markAt(x, y); }
  }
  const copyTo = (btn, text, idle) => {
    const done = () => { btn.textContent = '복사했습니다'; setTimeout(() => { btn.textContent = idle; }, 1600); };
    const fallback = () => { const t = $('copytext'); t.value = text; t.hidden = false; t.focus(); t.select(); btn.textContent = '아래 텍스트를 선택해 복사하세요'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  };
  $('link').addEventListener('click', () => copyTo($('link'), location.href, '링크 복사'));

  // ---------- 연맹 채팅용 텍스트 ----------
  function copyText() {
    const L = ['[SGD 자리 배치] 서버 2382 SGD', `본부 ${xy(HQ)} / 곰덫1(사냥 함정 1) ${xy(T)}`,
      `깃발 ${banners.length}개 (설치 순서): ` + banners.map(b => `${b.no})${b.x},${b.y}`).join(' ')];
    for (const gr of groups) {
      const named = gr.rows.filter(m => m.named);
      if (named.length) { L.push(`■ ${gr.title}`); L.push(named.map(m => `${m.n} ${m.x},${m.y}`).join(' / ')); }
    }
    if (rflags.length) L.push(`자원 깃발 ${rflags.length}개 (빵·나무 균형, 설치 순서): ` + rflags.map(f => `${f.no})${f.x},${f.y}${f.building ? '(짓는 중)' : ''}`).join(' '));
    L.push(`자리 번호·좌표 보기: ${location.origin}/sgd/`);
    return L.join('\n');
  }
  $('copy').addEventListener('click', () => copyTo($('copy'), copyText(), '연맹 채팅용 텍스트 복사'));

  const themeChanged = () => { readColors(); terrImg = null; draw(); };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
  new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  new ResizeObserver(() => draw()).observe(cv);
  load();
})();
