/* /banner/v3/final/ — 추천안을 다 마친 뒤의 KOR 깃발 전체 모습 (/banner/v3/data.json을 같이 씀).
 * 기본 화면은 주변 거점까지 다 이은 모습, '주변 거점까지'를 끄면 추천안(점령 거점)만. 11-13: FUN과 무기 창고 교환 가정(data.assume.swap).
 * 최종 깃발 = 평원 쪽 v2 깃발(위쪽 중 안 쓰는 것 up.unused 뺌) + v2 여분(v2extra: built 지음 / 아니면 점선) + 거점 연결 경로(main.flags, 위쪽 재사용 포함)
 *   + '주변 거점까지'를 켜면 주변 거점 연결 깃발(cands[].flags, 더 이을 수 있는 것만).
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const KP = window.KSPlan, G = 1200;
  const cv = $('cv'), gx = cv.getContext('2d');
  const PHONE = matchMedia('(max-width: 900px)');
  if (PHONE.matches) for (const id of ['legend', 'g2box']) if ($(id)) $(id).open = false;
  const xy = (x, y) => `X:${x} Y:${y}`, key = (x, y) => y * G + x;
  let D, kind, VX, VY, VW, VH, base = [], conn = [], cand = [], exPlan = [], exDrop = [], resf = [];
  const C = {};
  const readColors = () => { const cs = getComputedStyle(document.documentElement); for (const k of ['m-void', 'm-ground', 'm-mount', 'm-lake', 'm-node', 'm-struct', 'c-hq', 'c-t2', 'c-banner', 'c-terr', 'c-pick', 'c-new', 'c-wild', 'c-cand', 'c-oth', 'bg', 'ok']) C[k] = cs.getPropertyValue('--' + k).trim(); };
  const rgb = c => { const t = document.createElement('canvas').getContext('2d'); t.fillStyle = c; const h = t.fillStyle; return h.startsWith('#') ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : (h.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number); };
  function fail(msg) { const n = $('notice'); n.textContent = msg; n.className = 'notice err'; n.hidden = false; }

  async function load() {
    let map;
    try { const r = await fetch('/banner/v3/data.json', { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); D = await r.json(); } catch (_) { fail('데이터(data.json)를 불러오지 못했습니다. 새로고침해 주세요.'); return; }
    try { map = await KP.loadMap(); } catch (_) { fail('지도 데이터를 풀지 못했습니다. 최신 브라우저에서 열어 주세요.'); return; }
    VX = D.view.x0; VY = D.view.y0; VW = D.view.x1 - VX + 1; VH = D.view.y1 - VY + 1;
    kind = new Uint8Array(VW * VH);
    for (let y = VY; y < VY + VH; y++) for (let x = VX; x < VX + VW; x++) { const k = map.kind[y * G + x]; kind[(y - VY) * VW + x - VX] = k === 1 ? 1 : k === 2 ? 2 : k >= 3 && k <= 6 ? 3 : k >= 7 ? 4 : 0; }
    // 최종 깃발 묶음
    const drop = new Set(D.up.unused.map(f => key(...f)));
    const connSet = new Set([...D.main.flags, ...D.cands.flatMap(c => c.flags), ...((D.resfill || {}).groups || []).flatMap(g => g.flags)].map(f => key(...f)));   // 다른 묶음이 다시 쓰는 v2 위쪽 깃발은 그 묶음에만
    const had = new Set([...D.v2, ...D.now].map(f => key(...f)));   // 지금 있는 깃발(v2·화면 추정)
    conn = D.main.flags.map(f => ({ x: f[0], y: f[1], reuse: had.has(key(...f)) }));
    base = D.v2.filter(f => !drop.has(key(...f)) && !connSet.has(key(...f))).map(f => ({ x: f[0], y: f[1] }))
      .concat((D.v2extra || []).filter(e => e.built).map(e => ({ x: e.x, y: e.y, ex: true })));
    exPlan = (D.v2extra || []).filter(e => !e.built);
    const spare = (D.resfill || {}).useSpare;   // 11-12 사용자: 여유분 남기지 말고 모두 사용 → 안 지은 v2 여분 몫도 자원지 보강에 씀
    if (spare) { exDrop = exPlan; exPlan = []; }
    cand = D.cands.filter(c => c.rank).sort((a, b) => a.rank - b.rank).flatMap(c => c.flags.map(f => ({ x: f[0], y: f[1], to: c.name })));
    resf = ((D.resfill || {}).groups || []).flatMap(g => g.flags.map(f => ({ x: f[0], y: f[1], got: g.got })));   // 자원지 보강(빵·나무 우선, 11-12)
    readColors(); setup(); $('notice').hidden = true; $('main').hidden = false; fit();
  }

  const view = { cx: 0, cy: 0, s: 4, rot: true, cand: true, res: true, each: true, oth: false, mark: null };   // 기본: 연구소 Lv.3까지 다 이은 모습(11-11 사용자) — 11-12 EoB 영토를 피해 꼭짓점 연결 길로
  let terrImg = null, maskKey = '';
  function setup() {
    const w = D.main.w;
    $('stamp').textContent = `${D.updated} 추천안 + 주변 거점 다 이은 뒤 · 황야 본부 ${xy(...w)}${(D.assume || {}).swap ? ' · 무기 창고 교환 가정' : ''}`;
    const list = (el, arr, tag) => { $(el).innerHTML = arr.map(f => `<li><button class="lnk" data-x="${f.x}" data-y="${f.y}">${xy(f.x, f.y)}</button>${tag ? tag(f) : ''}</li>`).join(''); };
    list('g1', conn, f => (f.reuse ? ' <small>지금 있는 깃발</small>' : ''));
    list('g2', base, f => (f.ex ? ' <small>여분</small>' : ''));
    $('g2sum').textContent = `${base.length}개${exPlan.length ? ` + 여분 남은 ${exPlan.length}` : ''}`;
    $('g1sum').textContent = `${conn.length}개`;
    const cs = D.cands.filter(c => c.rank).sort((a, b) => a.rank - b.rank);
    $('g3').innerHTML = cs.map(c => `<li class="grp" style="list-style:none;margin-left:-2.8em;font-weight:600">${c.name} +${c.add}</li>` + c.flags.map(f => `<li><button class="lnk" data-x="${f[0]}" data-y="${f[1]}">${xy(f[0], f[1])}</button></li>`).join('')).join('');
    $('g3sum').textContent = `${cand.length}개`;
    const NT = ['빵', '나무', '돌', '철'], gotTxt = g => g.map((v, i) => (v ? `${NT[i]} ${v}` : '')).filter(Boolean).join('·');
    $('g4').innerHTML = ((D.resfill || {}).groups || []).map((g, i) => `<li class="grp" style="list-style:none;margin-left:-2.8em;font-weight:600">${i + 1}. ${gotTxt(g.got) || '연결용'} (+${g.flags.length})${g.early === false ? ' <small>주변 거점 길에서</small>' : ''}</li>` + g.flags.map(f => `<li><button class="lnk" data-x="${f[0]}" data-y="${f[1]}">${xy(f[0], f[1])}</button></li>`).join('')).join('');
    $('g4sum').textContent = `${resf.length}개`;
    for (const id of ['g1', 'g2', 'g3', 'g4']) $(id).addEventListener('click', e => { const b = e.target.closest('button[data-x]'); if (b) goTo(+b.dataset.x, +b.dataset.y); });
    render();
  }
  function render() {
    const useRes = view.cand && view.res && resf.length;
    const total = base.length + conn.length + (view.cand ? cand.length : 0) + (useRes ? resf.length : 0);
    const RC = (D.resfill || {}).count || {}, rc = RC[!view.cand ? 'main' : useRes ? 'res' : 'cand'] || [0, 0, 0, 0], per = (D.resfill || {}).per || 3600, now = (D.resfill || {}).now || [0, 0, 0, 0];
    const k = v => `${Math.round(v / 100) / 10}K`;
    const held = D.held.length, extra = view.cand ? D.cands.filter(c => c.rank).length : 0;
    $('facts').innerHTML = [
      ['--c-terr', '최종 KOR 깃발', `${total}개 / ${D.count.cap}`], ['--c-banner', '평원 본부 쪽', `${base.length}개`],
      ['--c-new', '거점 연결', `${conn.length}개${view.cand ? ` + ${cand.length}` : ''}`], ['--c-t2', '이어진 거점', `${held + extra}곳`],
      ['--ok', '빵·나무 자원지', `${rc[0]}·${rc[1]}곳`], ['--ok', '시간당 빵·나무', `${k(rc[0] * per)}·${k(rc[1] * per)}`],
      ['--c-wild', '황야 본부', xy(...D.main.w)],
    ].map(([c, k, v]) => `<div><dt><i style="background:var(${c})"></i>${k}</dt><dd>${v}</dd></div>`).join('');
    const cs = D.cands.filter(c => c.rank).sort((a, b) => a.rank - b.rank);
    const sw = (D.assume || {}).swap, cl = (D.corners || []).filter(c => c.grp === 'main' || (view.cand && c.grp === 'cand') || (useRes && c.grp === 'res'));
    const arm = sw ? D.held.find(h => h.x === sw.take[0] && h.y === sw.take[1]) : null, RV = D.review || {};
    $('sum').innerHTML = [
      sw ? `<b>가정:</b> ${sw.with}과 Lv.2 무기 창고 교환이 성사된 것으로 계산했습니다 — 우리 무기 창고(${xy(...sw.give)})를 넘기고 ${sw.with} 무기 창고(${xy(...sw.take)})를 받음. 받는 무기 창고는 지금 있는 KOR 깃발 ${xy(...sw.kept)}(북쪽 변에 닿아 있음)을 그대로 써서 잇습니다. 깃발 작업은 교환을 끝낸 뒤 시작하는 편이 안전합니다(그 전에 시작해도 그 깃발이 본부와 끊기지 않게 순서를 잡았습니다).` : '',
      `깃발 ${total}개 (상한 ${D.count.cap}, 빈 칸 ${D.count.cap - total}): 평원 본부 쪽 ${base.length}개(곰덫 주변 v2 깃발${base.some(f => f.ex) ? `·지은 여분 ${base.filter(f => f.ex).length}개` : ''}) + 거점 연결 ${conn.length}개${view.cand ? ` + 주변 거점 연결 ${cand.length}개` : ''}${useRes ? ` + 자원지 보강 ${resf.length}개` : ''}.`,
      `연맹 자원지(2×2 네 칸이 모두 영토 안, 하나당 시간당 ${per.toLocaleString('ko-KR')}): 빵 ${rc[0]}·나무 ${rc[1]}·돌 ${rc[2]}·철 ${rc[3]} = ${rc.reduce((a, b) => a + b, 0)}곳, 시간당 빵 ${(rc[0] * per).toLocaleString('ko-KR')}·나무 ${(rc[1] * per).toLocaleString('ko-KR')}·돌 ${(rc[2] * per).toLocaleString('ko-KR')}·철 ${(rc[3] * per).toLocaleString('ko-KR')} (지금 게임: 빵 ${now[0]}·나무 ${now[1]}·돌 ${now[2]}·철 ${now[3]}곳).`,
      resf.length ? (useRes ? `자원지 보강 깃발 ${resf.length}개(초록): 깃발 작업에 많이 드는 빵·나무 자원지를 우선(돌 0.3·철 0.2배로 셈)하되 빵·나무가 고르게 늘도록(깃발 하나에 같은 양이 들어 적은 쪽이 병목${RV.resSumOnly ? ` — 합계만 최대로 하면 빵 ${RV.resSumOnly[0]}·나무 ${RV.resSumOnly[1]}곳` : ''}), 연결망에서 이어 1개당 새로 넣는 값이 큰 자리부터 상한 ${D.count.cap}개까지 모두 채움${exDrop.length ? ` — 안 지은 v2 여분 ${exDrop.length}개(${exDrop.map(e => xy(e.x, e.y)).join(', ')}) 몫도 여기에 씀` : ''}. '자원지 보강'을 끄면 빼고 봄.` : `'자원지 보강'을 켜면 빵·나무 우선 보강 깃발 ${resf.length}개를 더한 모습(빵 ${(RC.res || [])[0]}·나무 ${(RC.res || [])[1]}곳)을 봅니다.`) : '',
      cl.length ? `깃발이 꼭짓점으로만 이어지는 자리 ${cl.length}곳(빨간 원): ${cl.map(c => `${xy(...c.a)} ↔ ${xy(...c.b)}`).join(', ')}. 이 자리가 끊기면 그 뒤 깃발이 본부와 떨어집니다.${RV.noCornerFlags ? ` 꼭짓점 연결을 전혀 안 쓰면 거점 연결 깃발이 ${conn.length}개 → ${RV.noCornerFlags}개로 늘어납니다.` : ''}` : '꼭짓점으로만 이어지는 자리는 없습니다.',
      `이어진 점령 거점 ${held}곳: ${D.held.map(h => h.name + ((D.retake || []).some(r => r.x === h.x && r.y === h.y) ? ' (되찾을 거점)' : '')).join(', ')}.`,
      D.must ? `<b>반드시 포함할 거점 ${D.must.length}곳(11-13)${D.must.every(m => m.ok) ? '이 모두 이어집니다' : ' 중 ' + D.must.filter(m => !m.ok).map(m => m.name).join('·') + '은(는) 아직 못 이었습니다'}:</b> ${D.must.map(m => `${m.name.replace(/ \(.*\)/, '')} ${xy(m.x, m.y)}${m.status === 'held' ? '' : m.status === 'swap' ? ' (교환으로 받음)' : m.status === 'retake' ? ' (FUN에서 되찾기)' : ` (NYX 소유 · 깃발 +${m.add})`}`).join(', ')}.` : '',
      ...(D.retake || []).map(o => `<b>${o.name}(${xy(o.x, o.y)})는 지금 ${o.from} 소유입니다</b>(11-11에는 KOR, 11-13 화면에서 ${o.from} 표시) — 되찾을 거점이라 연결 대상에 그대로 두었습니다.`),
      ...cl.filter(c => c.pass).map(c => `${xy(...c.a)} ↔ ${xy(...c.b)}는 ${c.pass.with.join('·') || '다른 연맹'} 깃발 둘이 꼭짓점으로만 닿은 틈을 지나는 자리입니다(11-13 규칙: 그런 곳은 지나갈 수 있음)${c.pass.sure ? ' — 양옆 두 깃발 자리의 네 귀퉁이를 게임에서 눌러 모두 빈 땅임을 확인했습니다.' : ' — 짓기 전에 두 자리의 귀퉁이를 눌러 확인하세요.'}`),
      ...(D.notes || []),
      view.cand ? `주변 거점 ${cs.length}곳도 이어짐: ${cs.map(c => `${c.name} +${c.add}${c.must ? ' 필수' : ''}`).join(', ')} (지금은 다른 연맹 소유 — 영토가 닿아야 공격해 점령할 수 있음). '주변 거점까지'를 끄면 점령 거점 ${held}곳만 이은 추천안 모습.` : `'주변 거점까지'를 켜면 ${cs.map(c => `${c.name} +${c.add}`).join(', ')}까지 다 이은 모습을 봅니다.`,
      `깃발 영역 겹침(곰덫 주변 v2 깃발끼리 빼고): 거점 연결 깃발끼리·평원 쪽 영토·황야 본부 영역과 ${D.main.overlap ? D.main.overlap[1] : 0}칸, 주변 거점·자원지 보강까지 합쳐 ${(D.overlapAll != null ? D.overlapAll : '-')}칸. 자원지를 지키는 것이 겹침 줄이기보다 먼저입니다(11-12 규칙).`,
      `황야 본부: 지금 ${xy(...D.hq.wild)} → ${xy(...D.main.w)}${D.main.direct && D.main.direct.length ? `(${D.main.direct.join('·')}에 변으로 바로 닿음)` : ''}. 평원 본부 ${xy(...D.hq.plain)} 그대로.`,
      '깃발 영역은 거점·성채 금지 구역·다른 연맹 영토와 겹치지 않게 놓았습니다(다른 연맹 영토에 바로 붙는 것은 허용 — 11-12). 깃발끼리는 되도록 변으로 맞닿게 하되, 꼭짓점 연결도 이어지므로 깃발 수나 자원지에 이득이면 씁니다. 거점과는 금지 구역 밖에서 변으로 맞닿습니다. 다른 연맹 깃발끼리 꼭짓점으로만 닿은 곳·얇게 이어진 곳은 지나갈 수 있습니다(11-13 규칙) — 이번 경로는 꼭짓점 틈만 지납니다.',
      `거점 금지 구역과 맞닿는 길이(최종 영토 기준 · 13칸 이상이 목표): ${Object.entries(D.main.contact || {}).map(([k, v]) => `${k} ${v}칸`).join(', ')}${view.cand ? ', ' + D.cands.filter(c => c.rank).map(c => `${c.name.replace(/ \(.*\)/, '')} ${c.contact}칸`).join(', ') : ''}.${arm && (D.main.contact || {})[arm.name] < 13 ? ` 받는 Lv.2 무기 창고는 둘레가 FUN·FN5·CMS 땅이라 더 넓힐 자리가 없습니다.` : ''}`,
      `v2 위쪽 깃발 중 ${D.up.unused.length}개는 철거, ${D.up.used.length}개는 그대로 씀.${exPlan.length ? ` v2 여분 ${exPlan.length}개(${exPlan.map(e => xy(e.x, e.y)).join(', ')})는 아직 안 지어 점선으로 표시.` : ''}`,
      '거점 아이콘·이름표에 가린 둘레와 다른 연맹 영토에 바로 붙는 자리는 화면 판독이 1칸쯤 틀릴 수 있습니다. 짓기 전에 그 자리를 눌러 소속 연맹을 확인하세요.' + (D.verify ? ` 새로 짓는 ${D.verify.builds}개 중 ${D.verify.any}개가 그런 자리입니다(작업 순서 페이지에 ⚠ 표시).` : ''),
    ].filter(Boolean).map(s => `<li>${s}</li>`).join('');
    $('g3box').hidden = !view.cand; $('g4box').hidden = !useRes;
    draw();
  }

  // ---------- 지도 ----------
  const SQ = Math.SQRT1_2;
  function mat(w, h) { const s = view.s, cx = view.cx, cy = view.cy; if (!view.rot) return [s, 0, 0, -s, w / 2 - cx * s, h / 2 + cy * s]; const k = s * SQ; return [k, -k, -k, -k, w / 2 - k * (cx - cy), h / 2 + k * (cx + cy)]; }
  function toWorld(sx, sy) { const w = cv.clientWidth, h = cv.clientHeight; if (!view.rot) return { x: view.cx + (sx - w / 2) / view.s, y: view.cy - (sy - h / 2) / view.s }; const k = view.s * SQ, p = (sx - w / 2) / k, q = -(sy - h / 2) / k; return { x: view.cx + (p + q) / 2, y: view.cy + (q - p) / 2 }; }
  function fit() {
    const pts = [D.hq.plain, D.main.w, ...D.held.filter(h => h.x !== 867).map(h => [h.x, h.y]), ...conn.map(f => [f.x, f.y]), ...base.map(f => [f.x, f.y]), ...(view.cand ? cand.map(f => [f.x, f.y]) : []), ...(view.cand && view.res ? resf.map(f => [f.x, f.y]) : [])];
    const x0 = Math.min(...pts.map(p => p[0])) - 10, y0 = Math.min(...pts.map(p => p[1])) - 10, x1 = Math.max(...pts.map(p => p[0])) + 12, y1 = Math.max(...pts.map(p => p[1])) + 12;
    const w = cv.clientWidth, h = cv.clientHeight, bw = x1 - x0, bh = y1 - y0;
    view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
    view.s = Math.max(0.8, Math.min(40, view.rot ? Math.min(w, h) / ((bw + bh) * SQ) : Math.min(w / bw, h / bh))); draw();
  }
  function img(fn) { const c = document.createElement('canvas'); c.width = VW; c.height = VH; const g = c.getContext('2d'), im = g.createImageData(VW, VH), d = im.data; for (let i = 0; i < VW * VH; i++) { const v = fn(i); if (v) d.set(v, 4 * i); } g.putImageData(im, 0, 0); return c; }
  let othImg = null, unkImg = null, korImg = null;
  function buildBase() {
    const col = [rgb(C['m-ground']), rgb(C['m-mount']), rgb(C['m-lake']), rgb(C['m-node']), rgb(C['m-struct'])];
    terrImg = img(i => [...col[kind[i]], 255]);
    const rows = list => { const m = new Uint8Array(VW * VH); for (const [y, a, b] of list) for (let x = a; x <= b; x++) m[(y - VY) * VW + x - VX] = 1; return m; };
    const known = rows(D.known), oth = rows(D.others); const o = rgb(C['c-oth']), v = rgb(C['m-void']);
    othImg = img(i => (oth[i] ? [...o, 255] : null)); unkImg = img(i => (known[i] ? null : [...v, 160]));
  }
  function buildKor() {   // 최종 영토: 본부 15×15 + 깃발 7×7 (다른 연맹 칸 제외)
    const oth = new Uint8Array(VW * VH); for (const [y, a, b] of D.others) for (let x = a; x <= b; x++) oth[(y - VY) * VW + x - VX] = 1;
    const m = new Uint8Array(VW * VH), put = (x0, y0, x1, y1) => { for (let y = Math.max(VY, y0); y <= Math.min(VY + VH - 1, y1); y++) for (let x = Math.max(VX, x0); x <= Math.min(VX + VW - 1, x1); x++) m[(y - VY) * VW + x - VX] = 1; };
    const hq = h => put(h[0] - 6, h[1] - 6, h[0] + 8, h[1] + 8);
    hq(D.hq.plain); hq(D.main.w);
    for (const f of base.concat(conn, view.cand ? cand : [], view.cand && view.res ? resf : [])) put(f.x - 3, f.y - 3, f.x + 3, f.y + 3);
    const t = rgb(C['c-terr']); korImg = img(i => (m[i] && !oth[i] ? [...t, 255] : null));
  }
  let pending = false;
  function draw() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; paint(); }); } }
  function paint() {
    if (!kind) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    gx.setTransform(dpr, 0, 0, dpr, 0, 0); gx.fillStyle = C['m-void']; gx.fillRect(0, 0, w, h);
    if (!terrImg) buildBase();
    const mk = `${view.cand}${view.res}`; if (!korImg || maskKey !== mk) { buildKor(); maskKey = mk; }
    const m = mat(w, h), s = view.s;
    gx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr); gx.imageSmoothingEnabled = false;
    const put = (im, a = 1) => { gx.globalAlpha = a; gx.drawImage(im, VX, VY, VW, VH); gx.globalAlpha = 1; };
    put(terrImg); if (view.oth) put(othImg, 0.3); put(korImg, 0.32); put(unkImg);
    const sq = (x, y, r, col, lw, dash) => { gx.strokeStyle = col; gx.lineWidth = lw / s; gx.setLineDash(dash ? dash.map(v => v / s) : []); gx.strokeRect(x - r, y - r, 1 + 2 * r, 1 + 2 * r); gx.setLineDash([]); };
    const dot = (x, y, col, z = 1) => { gx.fillStyle = col; gx.fillRect(x + (1 - z) / 2, y + (1 - z) / 2, z, z); };
    for (const f of base) { if (view.each) sq(f.x, f.y, 3, C['c-banner'], 0.8); dot(f.x, f.y, C['c-banner']); }
    for (const e of exPlan) { sq(e.x, e.y, 3, C['c-banner'], 1.4, [4, 3]); }
    if (view.cand) for (const f of cand) { sq(f.x, f.y, 3, C['c-cand'], 1.8, [5, 3]); dot(f.x, f.y, C['c-cand']); }
    for (const c of (D.corners || []).filter(c => c.grp === 'main' || (view.cand && c.grp === 'cand') || (view.cand && view.res && c.grp === 'res'))) { gx.strokeStyle = '#d93025'; gx.lineWidth = 2.4 / s; gx.beginPath(); gx.arc((c.a[0] + c.b[0] + 1) / 2, (c.a[1] + c.b[1] + 1) / 2, 2.6, 0, 2 * Math.PI); gx.stroke(); }   // 꼭짓점으로만 이어지는 자리(11-12, 11-13 전체 묶음)
    if (view.cand && view.res) for (const f of resf) { sq(f.x, f.y, 3, C.ok, 1.8); dot(f.x, f.y, C.ok); }
    for (const f of conn) { sq(f.x, f.y, 3, C['c-new'], view.each ? 2 : 0.01); dot(f.x, f.y, C['c-new']); }
    for (const hq of D.held) { sq(hq.x + 1, hq.y + 1, 7, C['c-t2'], 2.4); gx.fillStyle = C['c-t2']; gx.fillRect(hq.x, hq.y, 3, 3); }
    if (view.cand) for (const c of D.cands.filter(c => c.rank)) { sq(c.x + 1, c.y + 1, 7, C['c-cand'], 2.4); gx.fillStyle = C['c-cand']; gx.fillRect(c.x, c.y, 3, 3); }
    gx.fillStyle = C['c-hq']; gx.fillRect(D.hq.plain[0], D.hq.plain[1], 3, 3); sq(D.hq.plain[0] + 1, D.hq.plain[1] + 1, 7, C['c-hq'], 2);
    gx.fillStyle = C['c-wild']; gx.fillRect(D.main.w[0], D.main.w[1], 3, 3); sq(D.main.w[0] + 1, D.main.w[1] + 1, 7, C['c-wild'], 3);
    if (view.mark) { gx.strokeStyle = C['c-pick']; gx.lineWidth = 3 / s; gx.strokeRect(view.mark.x, view.mark.y, 1, 1); gx.beginPath(); gx.arc(view.mark.x + 0.5, view.mark.y + 0.5, 3, 0, Math.PI * 2); gx.stroke(); }
    gx.setTransform(dpr, 0, 0, dpr, 0, 0); gx.textAlign = 'center'; gx.textBaseline = 'middle';
    const label = (x, y, t, col) => { const p = { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; gx.font = '600 12px "IBM Plex Sans KR", sans-serif'; const tw = gx.measureText(t).width + 8; gx.fillStyle = C.bg; gx.globalAlpha = 0.85; gx.fillRect(p.x - tw / 2, p.y - 9, tw, 18); gx.globalAlpha = 1; gx.fillStyle = col; gx.fillText(t, p.x, p.y); };
    for (const hq of D.held) label(hq.x + 1.5, hq.y + 10, hq.name + (hq.x === 867 && hq.y === 1068 ? ' (연결 없음)' : '') + ((D.retake || []).some(r => r.x === hq.x && r.y === hq.y) ? ' (되찾기)' : ''), C['c-t2']);
    if (view.cand) for (const c of D.cands.filter(c => c.rank)) label(c.x + 1.5, c.y + 10, c.name, C['c-cand']);
    label(D.hq.plain[0] + 1.5, D.hq.plain[1] - 8, '평원 본부', C['c-hq']); label(D.main.w[0] + 1.5, D.main.w[1] - 8, '황야 본부', C['c-wild']);
  }
  function info(x, y) {
    const parts = [xy(x, y)], at = arr => arr.find(f => f.x === x && f.y === y), inSq = arr => arr.some(f => Math.abs(f.x - x) <= 3 && Math.abs(f.y - y) <= 3);
    const c = at(conn), b = at(base), d = view.cand && at(cand), r_ = view.cand && view.res && at(resf);
    if (c) parts.push(`거점 연결 깃발${c.reuse ? ' (지금 있는 깃발)' : ''}`); else if (b) parts.push(b.ex ? 'v2 여분 깃발' : '평원 본부 쪽 v2 깃발'); else if (d) parts.push(`주변 거점 연결 깃발 (${d.to})`); else if (r_) parts.push('자원지 보강 깃발');
    else if (inSq(conn) || inSq(base) || (view.cand && inSq(cand)) || (view.cand && view.res && inSq(resf))) parts.push('KOR 영토');
    if (x >= VX && y >= VY && x < VX + VW && y < VY + VH) { const kk = ['', '산', '호수', '연맹 자원지', '구조물'][kind[(y - VY) * VW + x - VX]]; if (kk) parts.push(kk); }
    return parts.join(' · ');
  }
  function goTo(x, y) { view.cx = x + 0.5; view.cy = y + 0.5; view.s = Math.max(view.s, 14); view.mark = { x, y }; $('readout').textContent = info(x, y); if (PHONE.matches) cv.scrollIntoView({ block: 'center', behavior: 'smooth' }); draw(); }
  const ptrs = new Map(); let pinch = null, downAt = null;
  cv.addEventListener('pointerdown', e => { try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ } ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); downAt = { x: e.offsetX, y: e.offsetY }; });
  cv.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return; const cur = { x: e.offsetX, y: e.offsetY };
    if (downAt && Math.hypot(cur.x - downAt.x, cur.y - downAt.y) > 5) downAt = null;
    if (ptrs.size === 1) { const a = toWorld(prev.x, prev.y), b = toWorld(cur.x, cur.y); view.cx += a.x - b.x; view.cy += a.y - b.y; draw(); }
    else if (ptrs.size === 2) { const pts = [...ptrs.entries()].map(([id, p]) => (id === e.pointerId ? cur : p)), d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); if (pinch) zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, d / pinch); pinch = d; }
    ptrs.set(e.pointerId, cur);
  });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size && downAt && kind) { const w = toWorld(e.offsetX, e.offsetY), x = Math.floor(w.x), y = Math.floor(w.y); view.mark = { x, y }; $('readout').textContent = info(x, y); draw(); } downAt = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  function zoomAt(sx, sy, f) { const a = toWorld(sx, sy); view.s = Math.max(0.8, Math.min(40, view.s * f)); const b = toWorld(sx, sy); view.cx += a.x - b.x; view.cy += a.y - b.y; draw(); }
  const toggle = (id, k, after) => $(id).addEventListener('click', () => { view[k] = !view[k]; $(id).setAttribute('aria-pressed', String(view[k])); after ? after() : draw(); });
  toggle('rot', 'rot', fit); toggle('candb', 'cand', () => { render(); fit(); }); toggle('resb', 'res', () => { render(); fit(); }); toggle('eachb', 'each'); toggle('othb', 'oth');
  $('fit').addEventListener('click', fit);
  $('zin').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.35));
  $('zout').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.35));
  window.addEventListener('resize', draw);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); terrImg = null; korImg = null; draw(); });
  load();
})();
