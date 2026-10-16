/* /v2 신규 자리 안내 — 원본: USB "code/x2/template.html" 스크립트.
 * 데이터는 게시본에서 매번 계산합니다: 신규 배치 /api/v2/layout, 이전 자리 /api/layout(기존 배치도).
 * 좌표는 게임 좌표(건물의 최소 X·Y 칸). 줄·거리·기준 곰덫 계산은 v2/plan.js(KSPlan)와 같습니다.
 * /v2: 연맹원 자리는 모두 닉네임, 빈자리는 자리 번호 (명단에도 번호로 나옴).
 *   기존 배치도(v1)에 있는데 신규 배치에 자리가 없는 연맹원은 왼쪽 "미배치 인원"에 기존 곰덫·줄별로 표시.
 *   layouts/v2-excluded.json 의 배치 제외 인원은 미배치 인원에서 빼고 "배치 제외 인원"에 따로 표시.
 * /v2/map (<html data-mode="share">): 공유용 — 자리 배치와 지도 위치만. 도시 자리는 이름 대신 번호(빈자리 포함),
 *   이름(기존 배치도)·지금 깃발·작업 순서 데이터는 불러오지 않음. ?s=자리번호 · ?at=X,Y 로 그 위치를 열고, 누른 위치가 주소에 남음. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const KP = window.KSPlan, K = window.KSCore, G = 1200;
  const cv = $('cv'), gx = cv.getContext('2d'), tip = $('tip');
  const xy = o => `X:${o.x} Y:${o.y}`;
  const f1 = v => v.toFixed(1);
  const trapName = g => g === 1 ? '곰덫1' : '곰덫2';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const norm = s => String(s || '').replace(/ /g, ' ').trim().toLowerCase();
  const BLOCKS = KP.BLOCKS_DEFAULT;
  const SHARE = document.documentElement.dataset.mode === 'share';
  const QHINT = $('qhint') ? $('qhint').textContent : '';
  // 목록·지도에 보이는 이름: /v2 연맹원 자리는 닉네임, 빈자리와 /v2/map은 자리 번호
  const seatName = m => SHARE || !m.named ? `자리 ${m.no}` : m.n;
  const [F0, F1] = K.FERTILE;

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

  let T2, T1, HQ, members, spare, res, banners, migrated, CX, CY, CW, CH, kind;
  let real = [], survey = null;   // 게임에 지금 설치된 연맹 깃발 (layouts/flags.json, /flags 와 같은 데이터)
  let curList = null, toTake = new Set();   // v2 배치 원본 · 철거할 지금 깃발 (x,y)
  let unplaced = [];   // 기존 배치도(v1)에는 있는데 신규 배치에 자리가 없는 연맹원
  let exNames = [], excluded = [];   // 배치 제외 인원 (layouts/v2-excluded.json) · 그중 신규 배치에 없는 사람
  async function load() {
    let cur, old = null, map;
    try { cur = await getJSON('/api/v2/layout', '/layouts/v2.json'); } catch (_) { fail('신규 배치도를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.'); return; }
    if (!SHARE) try { old = await getJSON('/api/layout', '/layouts/current.json'); } catch (_) { /* 이전 자리 없이 표시 */ }
    if (!SHARE) try {
      const r = await fetch('/layouts/flags.json', { cache: 'no-cache' });
      if (r.ok) { survey = await r.json(); real = survey.flags.map((f, i) => ({ x: f.x, y: f.y, n: f.name, area: f.area || '', src: f.src || '', id: 'f' + i, kind: 'real' })); }
    } catch (_) { /* 현재 깃발 없이 표시 */ }
    if (!SHARE) try {
      const r = await fetch('/layouts/v2-excluded.json', { cache: 'no-cache' });
      if (r.ok) exNames = (await r.json()).names || [];
    } catch (_) { /* 제외 명단 없이 표시 */ }
    try { map = await KP.loadMap(); } catch (_) { fail('지도 데이터를 풀지 못했습니다. 최신 Chrome·Edge·Safari·Firefox에서 열어 주세요.'); return; }
    curList = cur.list;
    const V = KP.readLayout(cur.list);
    if (!V.t1 || !V.t2) { fail('신규 배치도에 곰덫 2개(사냥 함정 1·2)가 없습니다.'); return; }
    T2 = V.t2; T1 = V.t1; HQ = V.hq || KP.HQ_DEFAULT;
    // 기존 배치도의 곰덫이 이미 새 자리에 있으면(배치 이전 완료) 이전 자리 비교는 하지 않음
    const O = old ? KP.readLayout(old.list) : null;
    migrated = !O || !O.t1 || !O.t2 || (O.t2.x === T2.x && O.t2.y === T2.y && O.t1.x === T1.x && O.t1.y === T1.y);
    const oldBy = new Map(migrated ? [] : O.members.map(m => [norm(m.n), m]));
    // 미배치: 기존 배치도의 닉네임 중 신규 배치 연맹원에 없는 사람 (괄호 = 기존 배치도에서 가까웠던 곰덫·줄)
    // 배치 제외 인원은 미배치에서 빼고 따로 표시 (신규 배치에 다시 넣으면 제외 표시도 사라짐)
    const placed = new Set(V.members.map(m => norm(m.n)));
    const exSet = new Set(exNames.map(norm));
    excluded = exNames.filter(n => !placed.has(norm(n)));
    unplaced = !O ? [] : O.members.filter(m => !placed.has(norm(m.n)) && !exSet.has(norm(m.n))).map(m => {
      const ref = O.t1 && O.t2 ? KP.refOf(m, O.t1, O.t2) : 0;
      return { n: m.n, x: m.x, y: m.y, ref, l: ref ? KP.lineOf(m, ref === 1 ? O.t1 : O.t2) : 0 };
    });
    // 참여 곰덫 (색·명단·번호): 곰덫2 1~3줄은 모두 곰덫2, 그 밖은 새 자리에서 더 가까운 곰덫
    const partOf = p => KP.lineOf(p, T2) <= 3 ? 2 : KP.refOf(p, T1, T2);
    members = V.members.map((m, i) => {
      const o = oldBy.get(norm(m.n));
      // 이전 자리 비교는 기존 배치에서 가까웠던 곰덫(ref) 기준 (assign과 같음)
      const ref = o ? KP.refOf(o, O.t1, O.t2) : KP.refOf(m, T1, T2);
      const rt = ref === 1 ? T1 : T2, ot = o && (ref === 1 ? O.t1 : O.t2);
      const g = partOf(m), t = g === 1 ? T1 : T2, l = KP.lineOf(m, t);
      return {
        n: m.n, x: m.x, y: m.y, g, ref, l, d2: KP.dist(m, T2), d1: KP.dist(m, T1), id: 'm' + i, kind: 'city',
        old: o ? { x: o.x, y: o.y, l: KP.lineOf(o, ot) } : null, same: !!o && m.x - rt.x === o.x - ot.x && m.y - rt.y === o.y - ot.y,
        named: !SHARE,
      };
    });
    spare = V.spare.map((s, i) => ({ x: s.x, y: s.y, l: KP.lineOf(s, T2), n: s.n && s.n !== 'Player' ? s.n : `빈자리 ${i + 1}`, id: 's' + i, kind: 'spare' }));
    res = V.res.map((r, i) => ({ x: r.x, y: r.y, n: r.n, id: 'r' + i, kind: 'res' }));
    banners = V.banners.map((b, i) => ({ x: b.x, y: b.y, n: `깃발 ${i + 1}번`, id: 'b' + i, kind: 'banner' }));
    // 자리 번호 (빈자리 포함, /v2·/v2/map 같은 번호): ① 곰덫2 1~3줄 → ② 곰덫1 1~2줄 → ③ 나머지. 같은 단계에서는 줄 → 곰덫에 가까운 순
    // 거리까지 같으면 배치 목록에 적힌 순서 (연맹원·빈자리 구분 없이 → 빈자리에 연맹원을 넣어도 번호 그대로)
    const ord = new Map(cur.list.map((o, i) => [o, i]));
    const at = new Map(V.members.concat(V.spare).map(p => [`${p.x},${p.y}`, ord.get(p.o)]));
    // 빈자리도 참여 곰덫 기준 줄·거리로 표시
    const seats = members.concat(spare).map(s => {
      const g = partOf(s), t = g === 1 ? T1 : T2;
      return { s, g, l: KP.lineOf(s, t), sd: KP.dist(s, t), tier: KP.lineOf(s, T2) <= 3 ? 0 : KP.lineOf(s, T1) <= 2 ? 1 : 2, oi: at.get(`${s.x},${s.y}`) };
    });
    seats.sort((a, b) => a.tier - b.tier || b.g - a.g || a.l - b.l || a.sd - b.sd || a.oi - b.oi).forEach((e, i) => {
      e.s.no = i + 1;
      Object.assign(e.s, { g: e.g, l: e.l, sd: e.sd, d2: KP.dist(e.s, T2), d1: KP.dist(e.s, T1), tier: e.tier });
    });

    // 지형 잘라내기 (본부·곰덫·자리·본부 근처 현재 깃발 주변) — kind 0 땅 1 산 2 호수 3 자원지 4 구조물
    real = real.filter(f => Math.max(Math.abs(f.x - HQ.x), Math.abs(f.y - HQ.y)) <= 90);
    const pts = [HQ, T1, T2, ...members, ...spare, ...res, ...banners, ...real];
    const x0 = Math.max(0, Math.min(...pts.map(p => p.x)) - 32), x1 = Math.min(G - 1, Math.max(...pts.map(p => p.x)) + 34);
    const y0 = Math.max(0, Math.min(...pts.map(p => p.y)) - 32), y1 = Math.min(G - 1, Math.max(...pts.map(p => p.y)) + 34);
    CX = x0; CY = y0; CW = x1 - x0 + 1; CH = y1 - y0 + 1;
    kind = new Uint8Array(CW * CH);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = map.kind[y * G + x];
      kind[(y - y0) * CW + x - x0] = k === 1 ? 1 : k === 2 ? 2 : k >= 3 && k <= 6 ? 3 : k >= 7 ? 4 : 0;
    }
    if (cur.stamp && $('stamp')) $('stamp').textContent =`마지막 게시 ${new Date(cur.stamp).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}`;
    $('notice').hidden = true;
    $('main').hidden = false;
    start();
  }

  const kindAt = (x, y) => (x < CX || y < CY || x >= CX + CW || y >= CY + CH) ? 0 : kind[(y - CY) * CW + x - CX];
  const inForeign = (x, y) => BLOCKS.some(b => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2);
  const inFertile = (x, y) => x >= F0 && x <= F1 && y >= F0 && y <= F1;
  const objAt = new Map();
  const put = (o, s) => { for (let y = o.y; y < o.y + s; y++) for (let x = o.x; x < o.x + s; x++) objAt.set(y * G + x, { o, s }); };

  let groups = [], byId = new Map();
  function start() {
    put({ ...HQ, n: '본부', kind: 'hq' }, 3); put({ ...T2, n: '곰덫2 (사냥 함정 2)', kind: 'trap' }, 3); put({ ...T1, n: '곰덫1 (사냥 함정 1)', kind: 'trap' }, 3);
    banners.forEach(b => put(b, 1)); members.forEach(m => put(m, 2)); spare.forEach(s => put(s, 2)); res.forEach(r => put(r, 2));

    // ---------- 요약 ----------
    const known = members.filter(m => m.old), same = known.filter(m => m.same).length;
    $('facts').innerHTML = [
      ['--c-t2', '곰덫2', xy(T2)], ['--c-t1', '곰덫1', xy(T1)], ['--c-banner', '깃발', banners.length + '개'],
      SHARE ? ['--c-city2', '도시 자리', `${members.length + spare.length} · 빈 ${spare.length}`] : ['--c-city2', '연맹원', `${members.length}명 · 빈자리 ${spare.length}`],
      ...(migrated ? [] : [[null, '이전과 같은 자리', `${same}/${known.length}명`]]),
    ].map(([c, k, v]) => `<div><dt>${c ? `<i style="background:var(${c})"></i>` : ''}${k}</dt><dd>${v}</dd></div>`).join('');

    // ---------- 명단 ----------
    if (SHARE) { // 번호 순으로 같은 곰덫·줄끼리 묶음, 빈자리도 같은 줄에
      for (const s of members.concat(spare).sort((a, b) => a.no - b.no)) {
        const title = `${trapName(s.g)} ${s.l}줄${s.tier === 2 ? ' (나머지)' : ''}`, last = groups[groups.length - 1];
        if (last && last.title === title) last.rows.push(s); else groups.push({ title, rows: [s] });
      }
    } else { // 연맹원(참여 곰덫·줄별) + 빈자리(번호 순)
      const shown = members;
      for (const g of [2, 1]) {
        const lines = [...new Set(shown.filter(m => m.g === g).map(m => m.l))].sort((a, b) => a - b);
        for (const l of lines) groups.push({ title: `${trapName(g)} 기준 ${l}줄`, rows: shown.filter(m => m.g === g && m.l === l).sort((a, b) => (g === 2 ? a.d2 - b.d2 : a.d1 - b.d1)) });
      }
      if (spare.length) groups.push({ title: '빈자리', rows: spare.slice().sort((a, b) => a.no - b.no) });
    }
    const oldCell = m => m.kind === 'spare' ? '' : m.old ? `X:${m.old.x} Y:${m.old.y}${m.same ? '' : ' <span class="mvd">조정</span>'}` : '<span class="nw">신규</span>';
    // data-no·data-xy = 자리 번호·좌표 검색, data-k = 닉네임 검색
    if (SHARE) $('list').innerHTML = '<thead><tr><th>자리</th><th>좌표</th><th></th></tr></thead>' + groups.map((gr, gi) =>
      `<tbody data-g="${gi}"><tr class="grp"><td colspan="3">${esc(gr.title)} · ${gr.rows.length}</td></tr>` +
      gr.rows.map(m => `<tr class="row" data-id="${m.id}" data-no="${m.no}" data-xy="${m.x},${m.y}" data-k=""><td class="nm mono"><span class="tag" style="background:var(${m.kind === 'spare' ? '--c-spare' : m.g === 1 ? '--c-city1' : '--c-city2'})"></span>${m.no}</td><td class="mono">${xy(m)}</td><td>${m.kind === 'spare' ? '<span class="nw">빈자리</span>' : ''}</td></tr>`).join('') + '</tbody>').join('');
    else $('list').innerHTML = `<thead><tr><th>닉네임</th><th>신규 좌표</th>${migrated ? '' : '<th>이전 좌표</th>'}</tr></thead>` + groups.map((gr, gi) =>
      `<tbody data-g="${gi}"><tr class="grp"><td colspan="3">${esc(gr.title)} · ${gr.rows.length}</td></tr>` +
      gr.rows.map(m => `<tr class="row" data-id="${m.id}" data-no="${m.no}" data-xy="${m.x},${m.y}" data-k="${m.named ? esc(norm(m.n)) : ''}"><td class="nm"><span class="tag" style="background:var(${m.kind === 'spare' ? '--c-spare' : m.g === 1 ? '--c-city1' : '--c-city2'})"></span>${esc(seatName(m))}</td><td class="mono">${xy(m)}</td>${migrated ? '' : `<td class="mono">${oldCell(m)}</td>`}</tr>`).join('') + '</tbody>').join('');
    if ($('bn')) $('bn').innerHTML = banners.map(b => `<li>${b.x},${b.y}</li>`).join('');

    // ---------- 미배치 인원 (기존 배치도 기준) ----------
    if ($('unplaced') && unplaced.length) {
      const rows = unplaced.slice().sort((a, b) => b.ref - a.ref || a.l - b.l || a.n.localeCompare(b.n, 'ko'));
      let html = '', last = null;
      for (const u of rows) {
        const title = u.ref ? `기존 ${trapName(u.ref)} ${u.l}줄` : '기존 배치도';
        if (title !== last) { last = title; html += `<li class="grp">${esc(title)} · ${rows.filter(r => (r.ref ? `기존 ${trapName(r.ref)} ${r.l}줄` : '기존 배치도') === title).length}</li>`; }
        html += `<li>${esc(u.n)} <span class="mono sumx">${u.x},${u.y}</span></li>`;
      }
      $('unsum').textContent = `${unplaced.length}명`;
      $('unlist').innerHTML = html;
      $('unplaced').hidden = false;
    }
    if ($('excluded') && excluded.length) {
      $('exsum').textContent = `${excluded.length}명`;
      $('exlist').innerHTML = excluded.map(n => `<li>${esc(n)}</li>`).join('');
      $('excluded').hidden = false;
    }
    byId = new Map(members.concat(spare).map(m => [m.id, m]));

    // ---------- 현재 설치된 깃발 (게임) ----------
    real.forEach(f => realAt.set(f.y * G + f.x, f));
    if (real.length) {
      const same = real.filter(f => banners.some(b => b.x === f.x && b.y === f.y)).length;
      const areas = [...new Set(real.map(f => f.area))];
      $('realsum').textContent = `${real.length}개 · 신규 배치 깃발 ${banners.length}개 중 같은 자리 ${same}개` + (survey && survey.updated ? ` · 조사 ${survey.updated}` : '');
      $('reallist').innerHTML = areas.map(a => `<li class="grp">${esc(a || '기타')}</li>` +
        real.filter(f => f.area === a).map(f => `<li><button type="button" class="lnk" data-f="${f.id}">${esc(f.n)}</button> <span class="mono">${f.x},${f.y}</span></li>`).join('')).join('');
      $('realnote').textContent = survey && survey.survey ? survey.survey.scope || '' : '';
      $('real').hidden = false; $('todolegend').hidden = false; $('terrname').textContent = '연맹 영토 (지금 깃발 + 설치할 깃발)';
    }
    // 신규 배치 깃발 중 게임에 이미 서 있는 것 (지금 깃발 데이터가 없으면 모두 서 있는 것으로 그림)
    banners.forEach(b => { b.built = !real.length || realAt.has(b.y * G + b.x); });

    // ---------- 깃발 작업 순서: 지금 깃발 → 이 배치의 깃발 ----------
    const FP = window.KSFlagPlan;
    if (FP && survey && banners.length) {
      const target = banners.map(b => ({ x: b.x, y: b.y }));
      // 계획 깃발이 변 접촉으로도 이어지면 엄격한 쪽, 아니면 게임에서 확인한 꼭짓점 접촉 규칙으로
      const rule = FP.reach(HQ, target, 'edge').length === target.length ? 'edge' : 'corner';
      const plan = FP.schedule(curList, survey.flags, target, { rule });
      const num = new Map(banners.map((b, i) => [`${b.x},${b.y}`, i + 1]));
      const ex = new Set(survey.flags.map(f => `${f.x},${f.y}`));
      const keep = target.filter(f => ex.has(`${f.x},${f.y}`)).length;
      // 철거는 꼭 필요한 것만 (새 자리 위에 선 깃발). 쓰지 않는 다른 깃발은 그대로 둬도 됨
      toTake = new Set(plan.steps.filter(s => s.op === 'remove').map(s => `${s.f.x},${s.f.y}`).concat(plan.left.remove.map(f => `${f.x},${f.y}`)));
      $('ordersum').textContent = `유지 ${keep} · 설치 ${target.length - keep} · 꼭 철거 ${toTake.size}`;
      const PH = { 1: '1단계 · 새 깃발 설치', 2: '2단계 · 새 자리 비우기 (그 자리 연맹원이 옮기기 전에)' };
      let ph = 0, html = '';
      for (const s of plan.steps) {
        if (s.phase !== ph) { ph = s.phase; html += `<li class="grp">${PH[ph]}</li>`; }
        const what = s.op === 'build' ? `<b class="bd">설치</b> 깃발 ${num.get(`${s.f.x},${s.f.y}`)}번` : `<b class="rm">철거</b> ${esc(s.f.name || '')}`;
        const on = objAt.get(s.f.y * G + s.f.x), numbered = on && on.o.no && (SHARE || !on.o.named);
        const why = s.op === 'remove' && numbered ? `새 자리 ${on.o.no} 위에 있음` : s.why;
        html += `<li><button type="button" class="lnk" data-x="${s.f.x}" data-y="${s.f.y}">${what}</button> <span class="mono">${s.f.x},${s.f.y}</span> <span class="why">${esc(why)}</span></li>`;
      }
      if (plan.stuck) html += '<li class="grp">일부 작업은 지금 깃발과 이어지지 않아 순서를 정하지 못했습니다</li>';
      if (plan.optional.length) html += `<li class="grp">v2에 쓰지 않는 지금 깃발 ${plan.optional.length}개는 자리와 겹치지 않아 그대로 둬도 됩니다</li>`;
      $('orderlist').innerHTML = html;
      $('order').hidden = false;
      $('takelegend').hidden = !toTake.size;
    }

    readColors(); fit();
    // ?q=닉네임 으로 열면 바로 그 자리
    const q0 = new URLSearchParams(location.search).get('q');
    if (q0 && $('q')) { $('q').value = q0; search(true); }
    if (SHARE) openFromURL();
  }

  // ---------- 색 ----------
  let C = {};
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['m-void', 'm-ground', 'm-fertile', 'm-mount', 'm-lake', 'm-node', 'm-struct', 'm-foreign', 'm-grid', 'm-edge', 'c-hq', 'c-t2', 'c-t1', 'c-banner', 'c-city2', 'c-city1', 'c-res', 'c-spare', 'c-terr', 'c-pick', 'on-obj', 'bad'])
      C[k] = cs.getPropertyValue('--' + k).trim();
  };
  const rgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const n = m ? parseInt(m[1], 16) : 0x808080; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  let terrImg = null, ovImg = null, edges = null;
  function buildImages() {
    const mk = () => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; return c; };
    const a = mk(), ga = a.getContext('2d'), ia = ga.createImageData(CW, CH), da = ia.data;
    const col = [rgb(C['m-ground']), rgb(C['m-mount']), rgb(C['m-lake']), rgb(C['m-node']), rgb(C['m-struct'])], fo = rgb(C['m-foreign']), fe = rgb(C['m-fertile']);
    for (let r = 0; r < CH; r++) for (let x = 0; x < CW; x++) {
      const k = kind[r * CW + x], wx = CX + x, wy = CY + r;
      const c3 = k ? col[k] : inForeign(wx, wy) ? fo : inFertile(wx, wy) ? fe : col[0], p = 4 * (r * CW + x);
      da[p] = c3[0]; da[p + 1] = c3[1]; da[p + 2] = c3[2]; da[p + 3] = 255;
    }
    ga.putImageData(ia, 0, 0); terrImg = a;
    // 연맹 영토 (본부 15×15, 깃발 7×7): 게임에 지금 서 있는 깃발 + 신규 배치 깃발(아직 안 지은 것 포함)을 같은 영토로
    const set = new Uint8Array(CW * CH);
    const cov = (x, y, s, c) => { for (let yy = y - c; yy < y + s + c; yy++) for (let xx = x - c; xx < x + s + c; xx++) { const lx = xx - CX, ly = yy - CY; if (lx >= 0 && ly >= 0 && lx < CW && ly < CH) set[ly * CW + lx] = 1; } };
    cov(HQ.x, HQ.y, 3, K.HQ_COV); real.concat(banners).forEach(b => cov(b.x, b.y, 1, K.BN_COV));
    const b = mk(), gb = b.getContext('2d'), ib = gb.createImageData(CW, CH), db = ib.data, t = rgb(C['c-terr']);
    edges = new Path2D();
    for (let r = 0; r < CH; r++) for (let x = 0; x < CW; x++) {
      if (!set[r * CW + x]) continue;
      const p = 4 * (r * CW + x); db[p] = t[0]; db[p + 1] = t[1]; db[p + 2] = t[2]; db[p + 3] = 255;
      const wx = CX + x, wy = CY + r;
      if (x === 0 || !set[r * CW + x - 1]) { edges.moveTo(wx, wy); edges.lineTo(wx, wy + 1); }
      if (x === CW - 1 || !set[r * CW + x + 1]) { edges.moveTo(wx + 1, wy); edges.lineTo(wx + 1, wy + 1); }
      if (r === 0 || !set[(r - 1) * CW + x]) { edges.moveTo(wx, wy); edges.lineTo(wx + 1, wy); }
      if (r === CH - 1 || !set[(r + 1) * CW + x]) { edges.moveTo(wx, wy + 1); edges.lineTo(wx + 1, wy + 1); }
    }
    gb.putImageData(ib, 0, 0); ovImg = b;
  }

  // ---------- 보기 ----------
  const view = { cx: 0, cy: 0, s: 14, rot: true, names: true, terr: true, pick: null, cur: null, flag: null };
  const realAt = new Map();
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
    const pts = members.concat(spare, res).map(m => [m.x, m.y, 2]).concat([[T2.x, T2.y, 3], [T1.x, T1.y, 3]]);
    const x0 = Math.min(...pts.map(p => p[0])) - 2, y0 = Math.min(...pts.map(p => p[1])) - 2;
    const x1 = Math.max(...pts.map(p => p[0] + p[2])) + 2, y1 = Math.max(...pts.map(p => p[1] + p[2])) + 2;
    const w = cv.clientWidth, h = cv.clientHeight, bw = x1 - x0, bh = y1 - y0;
    view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
    view.s = Math.max(3, Math.min(60, view.rot ? Math.min(w, h) / ((bw + bh) * SQ) : Math.min(w / bw, h / bh)));
    draw();
  }
  const lineRect = (t, k) => { // 격자 방향: 도시 격자 홀짝에 따라 한쪽은 곰덫에 붙고 반대쪽은 1칸 틈
    const c0 = members[0] || spare[0], side = (v, p) => ((v - 2 - p) & 1) === 0 ? [v - 2 * k, v + 3 + 2 * k + 1] : [v - 2 * k - 1, v + 3 + 2 * k];
    const [x0, x1] = side(t.x, c0 ? c0.x & 1 : 0), [y0, y1] = side(t.y, c0 ? c0.y & 1 : 0); return { x0, x1, y0, y1 };
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
    if (view.terr) { gx.globalAlpha = 0.22; gx.drawImage(ovImg, CX, CY, CW, CH); gx.globalAlpha = 1; gx.strokeStyle = C['c-terr']; gx.lineWidth = 1.5 / s; gx.stroke(edges); }
    if (s >= 7) {
      gx.beginPath();
      for (let x = CX; x <= CX + CW; x++) { gx.moveTo(x, CY); gx.lineTo(x, CY + CH); }
      for (let y = CY; y <= CY + CH; y++) { gx.moveTo(CX, y); gx.lineTo(CX + CW, y); }
      gx.strokeStyle = C['m-grid']; gx.lineWidth = 1 / s; gx.stroke();
    }
    // 줄 경계
    gx.setLineDash([4 / s, 4 / s]);
    for (const [t, k, c] of [[T2, 1, 'c-t2'], [T2, 2, 'c-t2'], [T2, 3, 'c-t2'], [T1, 1, 'c-t1']]) {
      const r = lineRect(t, k); gx.strokeStyle = C[c]; gx.lineWidth = (k === 3 ? 2 : 1.1) / s; gx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    }
    gx.setLineDash([]);
    const box = (o, sz, fill, inset) => { gx.fillStyle = fill; gx.fillRect(o.x + inset, o.y + inset, sz - 2 * inset, sz - 2 * inset); };
    members.forEach(mm => box(mm, 2, mm.g === 1 ? C['c-city1'] : C['c-city2'], 0.08));
    spare.forEach(sp => { gx.strokeStyle = C['c-spare']; gx.lineWidth = 1.6 / s; gx.setLineDash([3 / s, 2.5 / s]); gx.strokeRect(sp.x + 0.15, sp.y + 0.15, 1.7, 1.7); gx.setLineDash([]); });
    res.forEach(r => box(r, 2, C['c-res'], 0.08));
    // 깃발: 게임에 서 있는 깃발은 채운 칸, 신규 배치에서 아직 안 지은 깃발은 빈 칸 (번호 = 설치 순서)
    real.forEach(f => box(f, 1, C['c-banner'], 0.06));
    banners.forEach(b => {
      if (b.built) box(b, 1, C['c-banner'], 0.06);
      else { gx.strokeStyle = C['c-banner']; gx.lineWidth = 2.2 / s; gx.strokeRect(b.x + 0.12, b.y + 0.12, 0.76, 0.76); }
    });
    box(HQ, 3, C['c-hq'], 0.05); box(T2, 3, C['c-t2'], 0.05); box(T1, 3, C['c-t1'], 0.05);
    if (toTake.size) { // 작업 순서에서 꼭 철거할 지금 깃발 (빨간 X)
      gx.strokeStyle = C['bad']; gx.lineWidth = 3 / s; gx.beginPath();
      for (const f of real) {
        if (!toTake.has(`${f.x},${f.y}`)) continue;
        gx.moveTo(f.x - 0.5, f.y - 0.5); gx.lineTo(f.x + 1.5, f.y + 1.5); gx.moveTo(f.x + 1.5, f.y - 0.5); gx.lineTo(f.x - 0.5, f.y + 1.5);
      }
      gx.stroke();
    }
    if (view.flag) { // 마우스가 올라간 깃발의 영토
      const f = view.flag, c = C['c-banner'], r = K.BN_COV;
      gx.fillStyle = c; gx.globalAlpha = 0.22; gx.fillRect(f.x - r, f.y - r, 2 * r + 1, 2 * r + 1); gx.globalAlpha = 1;
      gx.strokeStyle = c; gx.lineWidth = 3 / s; gx.strokeRect(f.x - r, f.y - r, 2 * r + 1, 2 * r + 1);
      gx.lineWidth = 2.5 / s; gx.strokeRect(f.x - 0.25, f.y - 0.25, 1.5, 1.5);
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
    if (view.names && s >= 13) {
      const px = Math.min(12, Math.max(8, s * 0.42));
      members.forEach(mm => label(mm, 2, mm.named ? mm.n : String(mm.no), px, C['on-obj'], cellW));
      spare.forEach(sp => label(sp, 2, String(sp.no), px, C['c-spare']));
    }
    if (s >= 10 && !SHARE) banners.forEach((b, i) => label(b, 1, String(i + 1), Math.min(11, s * 0.55), b.built ? C['on-obj'] : C['c-banner']));
    const big = Math.min(15, Math.max(10, s * 0.75));
    label(T2, 3, '덫2', big, C['on-obj']); label(T1, 3, '덫1', big, C['on-obj']); label(HQ, 3, '본부', big, C['on-obj']);
  }

  // ---------- 선택 ----------
  function select(m, center) {
    view.pick = m;
    document.querySelectorAll('tr.row.on').forEach(r => r.classList.remove('on'));
    const row = document.querySelector(`tr.row[data-id="${m.id}"]`);
    if (row) { row.classList.add('on'); const box = $('list').parentElement, top = row.offsetTop - box.clientHeight / 2; box.scrollTo({ top: Math.max(0, top) }); }
    const card = $('card');
    if (SHARE || m.kind === 'spare') card.innerHTML = `<span class="nm">자리 ${m.no}${m.kind === 'spare' ? ' <span class="badge new">빈자리</span>' : ''}</span><span class="co">${xy(m)}</span>
        <span class="meta">${trapName(m.g)} 기준 ${m.l}줄 · 곰덫2까지 ${f1(m.d2)}칸 · 곰덫1까지 ${f1(m.d1)}칸</span>`;
    else {
      const prev = migrated ? '' : m.old
        ? `<span class="meta">이전 자리 X:${m.old.x} Y:${m.old.y} (${trapName(m.ref)} 기준 ${m.old.l}줄) <span class="badge ${m.same ? 'same' : 'mv'}">${m.same ? '이전과 같은 위치 관계' : '조금 조정됨'}</span></span>`
        : '<span class="meta"><span class="badge new">기존 배치도에 없던 닉네임</span></span>';
      card.innerHTML = `<span class="nm">${esc(m.n)} · 자리 ${m.no}</span><span class="co">${xy(m)}</span>
        <span class="meta">${trapName(m.g)} 기준 ${m.l}줄 · 곰덫2까지 ${f1(m.d2)}칸 · 곰덫1까지 ${f1(m.d1)}칸</span>${prev}`;
    }
    card.hidden = false;
    view.mark = null; setURL('s', m.no);
    if (center) { view.cx = m.x + 1; view.cy = m.y + 1; view.s = Math.max(view.s, 22); }
    draw();
  }
  $('list').addEventListener('click', e => {
    const tr = e.target.closest('tr.row');
    if (!tr) return;
    select(byId.get(tr.dataset.id), true);
    // 휴대폰에서는 명단이 지도 아래에 있으므로 카드·지도가 보이게 올림
    if (matchMedia('(max-width: 900px)').matches) $('card').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  function search(pickFirst) {
    // "12"·"자리 12" = 자리 번호, "520 723"·"X:520 Y:723" = 좌표 (그런 닉네임이 있으면 닉네임 우선)
    let q = norm($('q').value), hit, byNick = false;
    // 명단에 있는 자리(연맹원·빈자리)에서 찾음
    const d = q.replace(/^자리\s*/, ''), nick = members.some(m => m.named && norm(m.n) === q);
    if (!nick && /^\d+$/.test(d)) { q = d; hit = r => r.dataset.no === q; }
    else if (!nick && /^(x\s*:?\s*)?\d+[\s,]+(y\s*:?\s*)?\d+$/.test(d)) { q = d.replace(/[^\d]+/g, ' ').trim().replace(/ /g, ','); hit = r => r.dataset.xy === q; }
    else { hit = r => !q || r.dataset.k.includes(q); byNick = true; }
    const hits = [];
    document.querySelectorAll('#list tbody').forEach(tb => {
      let any = false;
      tb.querySelectorAll('tr.row').forEach(r => { const on = hit(r); r.hidden = !on; if (on) { any = true; hits.push(r); } });
      tb.hidden = !any;
    });
    // 정확히 같은 닉네임이 있으면 그 자리, 결과가 하나뿐이어도 그 자리
    const exact = q && hits.find(r => r.dataset.k === q);
    // 자리가 없을 때 미배치·배치 제외 인원이면 그렇다고 알려 줌
    const un = q && !hits.length && byNick ? unplaced.find(u => norm(u.n) === q) || unplaced.find(u => norm(u.n).includes(q)) : null;
    const ex = q && !hits.length && byNick && !un ? excluded.find(n => norm(n) === q) || excluded.find(n => norm(n).includes(q)) : null;
    if ($('qhint')) $('qhint').textContent = un ? `${un.n} 님은 신규 배치에 아직 자리가 없습니다 (미배치).` : ex ? `${ex} 님은 배치 제외 인원입니다.` : q && !hits.length ? '찾는 자리가 없습니다.' : QHINT;
    const pick = exact || (q && (hits.length === 1 || pickFirst) ? hits[0] : null);
    if (pick) select(byId.get(pick.dataset.id), true);
  }
  $('q')?.addEventListener('input', () => search(false));
  $('q')?.addEventListener('keydown', e => { if (e.key === 'Enter') search(true); });

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
        if (o && (o.kind === 'city' || o.kind === 'spare')) select(o, false);
        else if (SHARE) { const w = toWorld(e.offsetX, e.offsetY); markAt(Math.floor(w.x), Math.floor(w.y), o); }
      }
    }
    downAt = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !ptrs.size) { tip.hidden = true; view.cur = null; view.flag = null; draw(); } });
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  function zoomAt(sx, sy, f) { const a = toWorld(sx, sy); view.s = Math.max(3, Math.min(60, view.s * f)); const b = toWorld(sx, sy); view.cx += a.x - b.x; view.cy += a.y - b.y; draw(); }
  function hover(sx, sy) {
    const wp = toWorld(sx, sy), x = Math.floor(wp.x), y = Math.floor(wp.y);
    const k = kindAt(x, y), hit = objAt.get(y * G + x), o = hit && hit.o;
    const kn = ['', '산', '호수', '자원지', '구조물'][k] || '';
    let info = [inForeign(x, y) ? '다른 연맹 영토' : '', kn].filter(Boolean).join(' · ');
    if (o) {
      const extra = o.kind === 'city' || o.kind === 'spare' ? ` ${xy(o)} · ${trapName(o.g)} ${o.l}줄${o.kind === 'spare' ? ' · 빈자리' : ''}` : ` ${xy(o)}`;
      info = (o.kind === 'city' || o.kind === 'spare' ? seatName(o) : SHARE && o.kind === 'banner' ? '깃발' : o.n) + extra + (info ? ' · ' + info : '');
    }
    const rf = realAt.get(y * G + x);
    if (rf) info = `현재 깃발 ${rf.n} (게임에 설치됨)` + (info ? ' · ' + info : '');
    // 깃발 칸 위: 그 깃발의 영토(7×7)를 지도에 강조
    const fl = o && o.kind === 'banner' ? { x: o.x, y: o.y, real: false } : rf ? { x: rf.x, y: rf.y, real: true } : null;
    if (fl) info += ` · 영토 X ${fl.x - K.BN_COV}~${fl.x + K.BN_COV} · Y ${fl.y - K.BN_COV}~${fl.y + K.BN_COV}`;
    if ((fl && fl.x) !== (view.flag && view.flag.x) || (fl && fl.y) !== (view.flag && view.flag.y)) { view.flag = fl; draw(); }
    $('readout').textContent = `칸 X:${x} Y:${y}${info ? ' · ' + info : ''}`;
    const b = document.createElement('b'); b.textContent = `X:${x}  Y:${y}`;
    tip.replaceChildren(b, document.createTextNode(info || (inFertile(x, y) ? '옥토' : '빈 땅')));
    tip.hidden = false;
    const W = cv.clientWidth, H = cv.clientHeight, tw = tip.offsetWidth, th = tip.offsetHeight;
    let lx = sx + 16, ly = sy + 18; if (lx + tw > W - 6) lx = sx - tw - 12; if (ly + th > H - 6) ly = sy - th - 12;
    tip.style.transform = `translate(${Math.max(6, lx)}px, ${Math.max(6, ly)}px)`;
    if (!view.cur || view.cur.x !== x || view.cur.y !== y) { view.cur = { x, y }; draw(); }
    return o;
  }
  const toggle = (id, key, after) => $(id)?.addEventListener('click', () => { view[key] = !view[key]; $(id).setAttribute('aria-pressed', String(view[key])); after ? after() : draw(); });
  toggle('rot', 'rot', fit); toggle('lbl', 'names'); toggle('ter', 'terr');
  $('orderlist')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-x]');
    if (!btn) return;
    const x = +btn.dataset.x, y = +btn.dataset.y;
    view.cx = x + 0.5; view.cy = y + 0.5; view.s = Math.max(view.s, 16); view.cur = { x, y };
    if (SHARE) markAt(x, y, objAt.get(y * G + x) && objAt.get(y * G + x).o, true);
    $('readout').textContent = `${btn.textContent.trim()} · X:${x} Y:${y}`;
    if (matchMedia('(max-width: 900px)').matches) cv.scrollIntoView({ block: 'center', behavior: 'smooth' });
    draw();
  });
  $('reallist')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-f]');
    const f = btn && real.find(r => r.id === btn.dataset.f);
    if (!f) return;
    view.cx = f.x + 0.5; view.cy = f.y + 0.5; view.s = Math.max(view.s, 16); view.cur = { x: f.x, y: f.y };
    $('readout').textContent = `현재 깃발 ${f.n} · X:${f.x} Y:${f.y}${f.src ? ' · ' + f.src : ''}`;
    if (matchMedia('(max-width: 900px)').matches) cv.scrollIntoView({ block: 'center', behavior: 'smooth' });
    draw();
  });
  $('fit').addEventListener('click', fit);
  $('zin').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.35));
  $('zout').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.35));

  // ---------- 공유 주소 (/v2/map): ?s=자리번호 · ?f=깃발번호 · ?at=X,Y ----------
  function setURL(k, v) {
    if (!SHARE) return;
    const u = new URL(location.href);
    for (const p of ['s', 'f', 'at', 'q']) u.searchParams.delete(p);
    // 값은 숫자·쉼표뿐이라 그대로 붙임 (?at=520,723 처럼 읽기 쉬운 주소)
    const qs = [u.searchParams.toString(), k ? `${k}=${v}` : ''].filter(Boolean).join('&');
    history.replaceState(null, '', u.pathname + (qs ? `?${qs}` : ''));
  }
  // 자리가 아닌 칸: ?at=X,Y (keepText: 안내 줄을 바꾸지 않음)
  function markAt(x, y, o, keepText) {
    view.pick = null; view.mark = { x, y };
    document.querySelectorAll('tr.row.on').forEach(r => r.classList.remove('on')); $('card').hidden = true;
    setURL('at', `${x},${y}`);
    if (!keepText) $('readout').textContent = `X:${x} Y:${y} · 이 위치 주소가 만들어졌습니다 (링크 복사)`;
    draw();
  }
  // 주소로 열기
  function openFromURL() {
    const q = new URLSearchParams(location.search);
    const s = +q.get('s'), at = /^(\d+),(\d+)$/.exec(q.get('at') || '');
    if (s) { const m = members.concat(spare).find(o => o.no === s); if (m) { select(m, true); return; } }
    if (at) { const x = +at[1], y = +at[2]; view.cx = x + 0.5; view.cy = y + 0.5; view.s = Math.max(view.s, 18); const h = objAt.get(y * G + x); markAt(x, y, h && h.o); }
  }
  if (SHARE) $('link').addEventListener('click', () => {
    const text = location.href, b = $('link');
    const done = () => { b.textContent = '복사했습니다'; setTimeout(() => { b.textContent = '링크 복사'; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => prompt('아래 주소를 복사하세요', text));
    else prompt('아래 주소를 복사하세요', text);
  });

  // ---------- 복사 ----------
  function copyText() {
    const L = ['[신규 자리 배치] 서버 2382 KOR', `곰덫2(사냥 함정 2) ${xy(T2)} / 곰덫1(사냥 함정 1) ${xy(T1)}`, `깃발 ${banners.length}개 (순서대로): ` + banners.map((b, i) => `${i + 1})${b.x},${b.y}`).join(' ')];
    for (const gr of groups) { if (!gr.rows.length || gr.rows[0].kind === 'spare') continue; L.push(`■ ${gr.title}`); L.push(gr.rows.map(m => `${seatName(m)} ${m.x},${m.y}`).join(' / ')); }
    L.push(`내 자리 찾기: ${location.origin}/v2/`);
    return L.join('\n');
  }
  $('copy')?.addEventListener('click', () => {
    const text = copyText();
    const fallback = () => { const t = $('copytext'); t.value = text; t.hidden = false; t.focus(); t.select(); $('copy').textContent = '아래 텍스트를 선택해 복사하세요'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => { $('copy').textContent = '복사했습니다'; setTimeout(() => { $('copy').textContent = '연맹 채팅용 텍스트 복사'; }, 1800); }, fallback);
    else fallback();
  });

  const themeChanged = () => { readColors(); terrImg = null; draw(); };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
  new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  new ResizeObserver(() => draw()).observe(cv);
  load();
})();
