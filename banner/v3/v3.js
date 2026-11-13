/* /banner/v3/ — KOR 점령 거점 연결 최적 경로 (data.json).
 * data: view{x0..y1}, hq{plain, wild(지금), wildNew}, held[{name,x,y}](점령 거점 3×3 모서리), cands[{name,x,y,add,rank,flags}](주변 미점령 거점, 더 잇는 데 드는 깃발),
 *   v2(평원 본부 쪽 깃발 — 그대로), now(지금 깃발: 화면에서 추정), main/alts/stay/all6(연결안: w 황야 본부, flags, cost, A 평원 쪽 거점, B 황야 쪽, direct 바로 닿음),
 *   res{now,new}(영토 안 연맹 자원지 [빵,나무,돌,철]), steps(작업 순서 — main 기준), others/known/kor([y,x0,x1] 줄).
 * 지형·연맹 자원지는 mapdata.js(KSPlan.loadMap). 진행은 이 브라우저 localStorage.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const KP = window.KSPlan, G = 1200;
  const cv = $('cv'), gx = cv.getContext('2d');
  const PHONE = matchMedia('(max-width: 900px)');
  if (PHONE.matches) for (const id of ['legend', 'chkbox', 'flbox']) if ($(id)) $(id).open = false;
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
  const PLANS = () => [   // 11-11 사용자: 추천안만 남김
    ['main', D.main, `추천: 황야 본부 → ${xy(...D.main.w)}`, `깃발 ${D.main.flags.length}개(새로 ${D.main.flags.length - D.up.used.length} + v2 위쪽 ${D.up.used.length}개 그대로)로 점령 거점 5곳 연결, v2 위쪽 ${D.up.unused.length}개 철거 (Lv.2 무기 창고 X:867은 지금처럼 연결 없이 유지)`],
  ];
  function setPlan(k) { planKey = k; PLAN = PLANS().find(p => p[0] === k)[1]; renderFacts(); renderFlags(); $('stepbox').hidden = k !== 'main'; draw(); }

  function setup() {
    $('stamp').textContent = `${D.updated} 게임 화면 기준 · 점령 거점 6곳`;
    $('plans').innerHTML = PLANS().map(([k, p, t, s]) => `<label><span><b>${t}</b><small>${s}</small></span></label>`).join('');
    // 주변 거점
    const cs = D.cands.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99));
    let acc = D.main.flags.length;
    $('candsum').textContent = `${cs.filter(c => c.rank).length}곳 더 이을 수 있음`;
    $('cand').innerHTML = '<tr><th>거점</th><th>좌표</th><th class="n">혼자 붙이면</th><th class="n">차례로 붙이면</th><th class="n">누적</th></tr>' + cs.map(c => {
      if (!c.rank) return `<tr class="no"><td>${c.name}</td><td><button class="lnk" data-x="${c.x}" data-y="${c.y}">${xy(c.x, c.y)}</button></td><td class="n" colspan="3">지금은 못 이음</td></tr>`;
      acc += c.add; return `<tr><td>${c.rank}. ${c.name}</td><td><button class="lnk" data-x="${c.x}" data-y="${c.y}">${xy(c.x, c.y)}</button></td><td class="n">${c.alone != null ? `+${c.alone}` : '—'}</td><td class="n">+${c.add}</td><td class="n">${acc}</td></tr>`;
    }).join('');
    $('cand').addEventListener('click', e => { const b = e.target.closest('button[data-x]'); if (b) goTo(+b.dataset.x + 1, +b.dataset.y + 1); });
    // 거점 종류 요약: 추천안 + 이을 수 있는 주변 거점까지 모두 이은 뒤
    const TYPES = ['건설소', '방어구 창고', '연구소', '무기 창고', '훈련 캠프', '원정 캠프', '채집 제단', '풍작 제단'];
    const typeOf = n => TYPES.find(t => n.includes(t)) || '기타', lvOf = n => (n.match(/Lv\.\d/) || [''])[0];
    const ownOf = n => (n.match(/\((\w+)\)/) || [, ''])[1];
    const rows = TYPES.map(t => {
      const on = D.held.filter(h => typeOf(h.name) === t && D.main.flags.length && !(h.x === 867 && h.y === 1068)).map(h => lvOf(h.name));
      const heldOff = D.held.filter(h => typeOf(h.name) === t && h.x === 867 && h.y === 1068).map(h => `${lvOf(h.name)} (연결 없이 점령 유지)`);
      const add = D.cands.filter(c => typeOf(c.name) === t && c.rank).map(c => `${lvOf(c.name)} ${ownOf(c.name)} +${c.add}`);
      const no = D.cands.filter(c => typeOf(c.name) === t && !c.rank).map(c => `${lvOf(c.name)} ${ownOf(c.name)}`).concat((D.excluded || []).filter(c => typeOf(c.name) === t).map(c => `${lvOf(c.name)} ${ownOf(c.name)}(제외)`));
      const got = on.length + add.length > 0;
      return { t, got, html: `<tr class="${got ? '' : 'no'}"><td><b>${t}</b></td><td>${[...on.map(v => `${v} 점령`), ...heldOff, ...add.map(v => `${v} 더 이음`)].join('<br>') || '<b class="warn">없음</b>'}</td><td>${no.join('<br>') || '—'}</td></tr>` };
    });
    const miss = rows.filter(r => !r.got).map(r => r.t);
    $('typesum').textContent = miss.length ? `연결 안 되는 종류 ${miss.length}: ${miss.join('·')}` : '모든 종류 연결';
    $('types').innerHTML = '<tr><th>종류</th><th>연결됨 (추천안 + 더 잇기)</th><th>못 이음 (소유)</th></tr>' + rows.map(r => r.html).join('');
    $('fl').addEventListener('click', e => { const b = e.target.closest('button[data-x]'); if (b) goTo(+b.dataset.x, +b.dataset.y); });
    const r = D.res, sum = a => a.reduce((s, v) => s + v, 0), rs = a => `빵 ${a[0]}·나무 ${a[1]}·돌 ${a[2]}·철 ${a[3]}`;
    $('check').innerHTML = [
      `점령 거점 6곳(게임 '거점 쟁탈 → 점령 완료'에서 확인): ${D.held.map(h => `${h.name} ${xy(h.x, h.y)}`).join(', ')}.`,
      'Lv.2 무기 창고(X:867 Y:1068)는 바로 옆이 KR6 본부·영토라 지금도 KOR 영토와 이어져 있지 않은데 점령이 유지되고 있습니다. 그래서 추천안은 나머지 5곳만 잇고, 6곳 전부 잇는 안은 따로 보여 줍니다.',
      `v2 깃발은 곰덫 주변만 지키고, 본부 북쪽 위쪽 깃발 ${D.up.used.length + D.up.unused.length}개(예전 거점 연결용, 곰덫2 안전 반경 42칸 밖)는 새 경로에 쓰는 ${D.up.used.length}개만 남기고 ${D.up.unused.length}개는 ⑤에서 본부에서 먼 것부터 철거합니다(11-11 사용자: 필요하면 바깥쪽부터 철거 가능). /banner/v1·v2는 이전 이력 확인용으로만 두고 고치지 않습니다.`,
      '두 본부 모두 영토의 뿌리입니다(지금 황야 본부 쪽 깃발 덩어리는 평원 본부와 끊겨 있는데도 유지됨). 그래서 거점마다 평원 본부 쪽이나 황야 본부 쪽 중 한 곳에 깃발로 이어지면 되는 것으로 계산했습니다.',
      `거점과 맞닿는 면: 남는 깃발로 점령 거점마다 금지 구역과 맞닿는 길이를 깃발 두 개 폭(13칸 이상)으로 넓혔습니다 — ${Object.entries(D.main.contact || {}).map(([k, v]) => `${k} ${v}칸`).join(', ')} (보강 깃발 ${(D.main.reinforce || []).length}개 포함).`,
      `깃발 영역 겹침: 깃발 수와 연결은 그대로 두고 깃발마다 ±3칸 옮겨 보며 다른 깃발·평원 쪽 v2 영토·황야 본부 영역과 겹치는 칸을 줄였습니다 — 추천안 ${D.main.overlap ? `${D.main.overlap[0]}칸 → ${D.main.overlap[1]}칸` : '0칸'}(이미 있는 v2 위쪽 깃발은 고정). 주변 거점 연결 깃발도 같은 방법으로 0칸.`,
      '연결 규칙: 깃발 영역 7×7은 변이 1칸 이상 맞닿아야 이어진 것으로 봄(꼭짓점만 닿아도 게임에서는 이어지므로 금지하지 않고, 깃발 0.6개 몫 감점만 줘서 깃발이 줄 때만 씀 — 11-12 사용자 규칙). 금지 구역(거점 15×15·성채 60) 안에는 영토가 안 생기므로 깃발 영역은 금지 구역과 한 칸도 겹치지 않게 놓고, 깃발끼리·거점과는 금지 구역 밖에서 맞닿게 함(11-11 사용자 지적 반영). 거점은 금지 구역 바로 바깥에 영토가 맞닿으면 연결. 깃발은 산·호수·연맹 자원지·구조물·금지 구역(거점 15, 성채·성소 60)에 못 세움. 성채·유적으로는 잇지 않음.',
      '다른 연맹 영토는 PC 화면(11-11, 110단계 축소 지도 18장)의 덧칠 색으로 읽었고, 새 깃발의 7×7 영역은 다른 연맹 칸과 겹치지 않게 잡았습니다(11-12: 1칸 여유 조건 삭제 — 바로 붙는 자리 허용). 11-12 고침: 풀밭 위 EoB 노란 영토(색 H60·채도 0.64)를 절반쯤 땅으로 읽고 있어 노란색을 따로 잡도록 고쳤습니다 — 그 때문에 노란 영토를 지나던 Lv.3 연구소(NYX) 길을 돌아가는 길로 바꿨습니다(추천안 경로는 그대로). 다른 연맹은 계속 깃발을 늘리니 짓기 전에 그 자리가 비어 있는지 게임에서 확인하세요.',
      `지금 거점 연결 깃발은 게임 총 ${D.count.now}개에서 평원 쪽(v2 ${D.count.v2}개·여분 최대 ${D.count.extra}개)을 뺀 약 ${D.count.now - D.count.v2 - D.count.extra}~${D.count.now - D.count.v2}개입니다. 지도에 회색 점선으로 그린 ${D.now.length}개는 화면의 KOR 영토 모양을 7×7 최소 개수로 덮어 추정한 것이라(많이 겹친 깃발은 하나로 잡힘) 실제보다 적고 좌표도 1~3칸 다를 수 있습니다. ④ 철거는 "새 경로(주황)에 없는 거점 연결 깃발은 모두 철거"가 기준이고, 목록 좌표는 찾아가는 길잡이입니다.`,
      `황야 본부 자리는 황야(왕국 300~899 평원 고리 밖) 중 3×3이 비어 있고 영토 15×15에 다른 연맹이 없는 곳 ${'1.9만'}여 곳을 모두 계산해 골랐습니다. ${D.plainOnly ? `평원 본부 하나로만 5곳을 이으면 깃발 약 ${D.plainOnly}개가 듭니다.` : '황야 본부 없이 평원 본부 하나로는 5곳을 다 이을 수 없습니다(건설소·방어구 창고 둘레가 다른 연맹 영토·금지 구역에 막힘).'}${D.stay ? '' : ' 황야 본부를 지금 자리에 두면 5곳을 다 이을 수 없어 이전이 필요합니다.'}`,
      `연맹 자원지(깃발 범위 안에 있어야 깃발 추가·자원 생산): 새 경로 영토 안 ${sum(r.new)}곳(${rs(r.new)}) · 지금 ${sum(r.now)}곳(${rs(r.now)}). 같은 깃발 수라면 자원지를 더 많이 덮는 자리를 고르게 했습니다.`,
      '주변 거점 더 잇기: "혼자 붙이면"은 추천안에 그 거점 하나만 이을 때, "차례로 붙이면"은 가장 적게 드는 거점부터 하나씩 붙여 앞 거점 길을 함께 쓸 때 더 드는 깃발입니다동쪽 Lv.3 연구소(X:867 Y:867)는 THE 소유라 뺐습니다. FUN의 Lv.2 훈련 캠프(X:768 Y:1038)는 점령 중인 Lv.2 훈련 캠프와 종류·레벨이 같아(중복) 뺐습니다. "지금은 못 이음"은 다른 연맹 영토에 막혀 있거나 화면에서 확인하지 못한 곳입니다.',
      `Lv.2 무기 창고(FUN, X:438 Y:1068): 지금 KOR 깃발 X:440 Y:1080이 북쪽 변에 닿아 있습니다(게임에서 확인). 이 깃발을 그대로 쓰고 깃발 ${(D.cands.find(c => c.name.startsWith('Lv.2 무기 창고')) || {}).add}개로 잇습니다. 남쪽·동쪽 둘레는 FN5(X:438 Y:1058)·CMS(X:445 Y:1058·X:450 Y:1064) 땅이라 북쪽으로만 닿습니다.`,
      (() => { const cl = [...(D.main.corner || []), ...D.cands.filter(c => c.rank).flatMap(c => c.corner || [])]; return cl.length ? `깃발이 꼭짓점으로만 이어지는 자리 ${cl.length}곳: ${cl.map(([p, q]) => `${xy(...p)} ↔ ${xy(...q)}`).join(', ')}.` : '꼭짓점으로만 이어지는 자리는 없습니다.'; })(),
      '깃발 1개 비용(276~285개 구간, 팬 사이트 표): 빵·나무 250,800, 돌 167,200, 철 91,200. 건설 약 33분.',
    ].map(s => `<li>${s}</li>`).join('');
    $('src').textContent = '지형·연맹 자원지·거점 위치: mapdata.js(ksmapper). 영토·깃발: 2026-11-11 PC 게임 화면에서 읽음.';
    setupSteps(); setPlan('main');
  }
  function renderFacts() {
    const n = PLAN.flags.length, lo = D.count.now - D.count.v2 - D.count.extra, hi = D.count.now - D.count.v2;   // 게임 총 깃발 − 평원 쪽(v2·여분)
    const upN = D.up.used.length + D.up.unused.length;   // 지금 연결에 쓰는 v2 위쪽 깃발(새 안에서는 PLAN.flags에 포함된 것만 남음)
    $('facts').innerHTML = [
      ['--c-new', '새 경로 깃발', `${n}개`], ['--c-old', '지금 거점 연결 깃발', `약 ${lo + upN}~${hi + upN}개`], ['--ok', '줄어드는 깃발', `약 ${lo + upN - n}~${hi + upN - n}개`],
      ['--c-wild', '황야 본부', PLAN.w && (PLAN.w[0] !== D.hq.wild[0] || PLAN.w[1] !== D.hq.wild[1]) ? `${xy(...PLAN.w)}로 이전` : '그대로'],
    ].map(([c, k, v]) => `<div><dt><i style="background:var(${c})"></i>${k}</dt><dd>${v}</dd></div>`).join('');
  }
  function renderFlags() {
    $('flsum').textContent = `${PLAN.flags.length}개`;
    const nowSet = new Set(D.now.map(f => f[0] * G + f[1]));
    $('fl').innerHTML = PLAN.flags.map(f => `<li><button class="lnk" data-x="${f[0]}" data-y="${f[1]}">${xy(f[0], f[1])}</button>${nowSet.has(f[0] * G + f[1]) ? ' <small>(지금 있음)</small>' : ''}</li>`).join('');
  }

  // ---------- 작업 순서 ----------
  let steps, done = 0, stepCur = null;
  const OP = { build: '깃발 건설', remove: '깃발 철거', hq: '황야 본부 이전' };
  const PHASE = { 1: '① 평원 본부 쪽 새 경로 건설 (빈 칸 없으면 옛 깃발 먼저 철거)', 2: '② 황야 본부 이전', 3: '③ 새 황야 본부 쪽 경로 건설', 4: '④ 남은 옛 거점 연결 깃발 철거', 5: '⑤ v2 위쪽 깃발 정리 (곰덫 반경 밖 · 본부에서 먼 것부터)' };
  const KEY = 'banner-v3-steps', keyOf = st => `${st.op}${st.x},${st.y}`;
  function setupSteps() {
    steps = D.steps;
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.keys)) while (done < steps.length && v.keys[done] === keyOf(steps[done])) done++; } catch (_) { /* 저장소 못 씀 */ }
    let ph = 0;
    $('stepl').innerHTML = steps.map((st, i) => `${st.phase !== ph ? `<li class="grp">${PHASE[(ph = st.phase)]}</li>` : ''}<li value="${i + 1}" data-k="${i}"><button class="lnk" data-k="${i}"><b class="opw op-${st.op}">${OP[st.op].slice(-2)}</b> ${where(st)}</button></li>`).join('');
    $('stepl').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) { const st = steps[+b.dataset.k]; goTo(st.x, st.y); } });
    $('stepcopy').addEventListener('click', () => { if (steps[done]) copy(steps[done]); });
    $('stepdone').addEventListener('click', () => { if (done < steps.length) { done++; save(); renderStep(); if (steps[done]) copy(steps[done], `${done}번 완료 · `); } });
    $('stepundo').addEventListener('click', () => { if (done) { done--; save(); renderStep(); } });
    $('stepmap').addEventListener('click', () => { const st = steps[done]; if (st) goTo(st.x, st.y); });
    renderStep();
  }
  const where = st => (st.op === 'hq' ? `${xy(...st.from)} → ${xy(st.x, st.y)}` : xy(st.x, st.y));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ keys: steps.slice(0, done).map(keyOf) })); } catch (_) { /* 저장소 못 씀 */ } };
  function copy(st, pre = '') {
    const t = `X:${st.x} Y:${st.y}`;
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => { $('stepmsg').textContent = `${pre}${t} 복사됨`; }, () => { $('stepmsg').textContent = `${pre}복사 안 됨: ${t}`; });
  }
  function renderStep() {
    const st = steps[done]; stepCur = st || null;
    $('stepsum').textContent = `${done}/${steps.length} 완료`;
    $('stepph').textContent = st ? `${done + 1}/${steps.length} · ${PHASE[st.phase]}` : '모든 작업을 마쳤습니다';
    $('stepop').innerHTML = st ? `<span class="opb op-${st.op}">${OP[st.op]}</span>` : '';
    $('stepxy').textContent = st ? where(st) : '';
    $('stepcard').className = `stepnow${st ? ` op-${st.op}` : ''}`;
    for (const id of ['stepcopy', 'stepdone', 'stepmap']) $(id).disabled = !st;
    $('stepundo').disabled = !done;
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
    // 점령 거점
    for (const hq of D.held) { sq(hq.x + 1, hq.y + 1, 7, C['c-t2'], 2.4); gx.fillStyle = C['c-t2']; gx.fillRect(hq.x, hq.y, 3, 3); }
    // 본부
    sq(D.hq.plain[0] + 1, D.hq.plain[1] + 1, 7, C['c-hq'], 2); gx.fillStyle = C['c-hq']; gx.fillRect(D.hq.plain[0], D.hq.plain[1], 3, 3);
    sq(D.hq.wild[0] + 1, D.hq.wild[1] + 1, 7, C['c-wild'], 1.6, [5, 4]); gx.fillStyle = C['c-wild']; gx.globalAlpha = 0.5; gx.fillRect(D.hq.wild[0], D.hq.wild[1], 3, 3); gx.globalAlpha = 1;
    if (PLAN.w) { sq(PLAN.w[0] + 1, PLAN.w[1] + 1, 7, C['c-wild'], 3.2); gx.fillStyle = C['c-wild']; gx.fillRect(PLAN.w[0], PLAN.w[1], 3, 3); }
    // 새 경로
    for (const [x, y] of PLAN.flags) { sq(x, y, 3, C['c-new'], 2.2); dot(x, y, C['c-new']); }
    if (planKey === 'main' && stepCur) { const p = stepCur, sz = p.op === 'hq' ? 3 : 1; gx.strokeStyle = p.op === 'remove' ? C.bad : p.op === 'build' ? C.ok : C['c-wild']; gx.lineWidth = 3 / s; gx.beginPath(); gx.arc(p.x + sz / 2, p.y + sz / 2, sz / 2 + 4, 0, Math.PI * 2); gx.stroke(); }
    if (view.mark) { gx.strokeStyle = C['c-pick']; gx.lineWidth = 3 / s; gx.strokeRect(view.mark.x, view.mark.y, 1, 1); gx.beginPath(); gx.arc(view.mark.x + 0.5, view.mark.y + 0.5, 3, 0, Math.PI * 2); gx.stroke(); }
    // 글자
    gx.setTransform(dpr, 0, 0, dpr, 0, 0); gx.textAlign = 'center'; gx.textBaseline = 'middle';
    const label = (x, y, t, col) => { const p = { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; gx.font = '600 12px "IBM Plex Sans KR", sans-serif'; const tw = gx.measureText(t).width + 8; gx.fillStyle = C.bg; gx.globalAlpha = 0.85; gx.fillRect(p.x - tw / 2, p.y - 9, tw, 18); gx.globalAlpha = 1; gx.fillStyle = col; gx.fillText(t, p.x, p.y); };
    for (const hq of D.held) label(hq.x + 1.5, hq.y + 10, hq.name, C['c-t2']);
    if (view.cand) for (const c of D.cands) label(c.x + 1.5, c.y + 10, c.name, C['c-cand']);
    label(D.hq.plain[0] + 1.5, D.hq.plain[1] - 8, '평원 본부', C['c-hq']);
    label(D.hq.wild[0] + 1.5, D.hq.wild[1] - 8, '황야 본부(지금)', C['c-wild']);
    if (PLAN.w && (PLAN.w[0] !== D.hq.wild[0] || PLAN.w[1] !== D.hq.wild[1])) label(PLAN.w[0] + 1.5, PLAN.w[1] - 8, '황야 본부(새 자리)', C['c-wild']);
  }
  // 이미지 행 순서: putImageData는 위→아래로 행 0..VH-1 = Y VY..VY+VH-1, 지도 변환이 y를 위로 뒤집으므로 그대로 맞음

  function info(x, y) {
    const parts = [xy(x, y)];
    const inSq = (f, r) => Math.abs(f[0] - x) <= r && Math.abs(f[1] - y) <= r;
    const pf = PLAN.flags.find(f => f[0] === x && f[1] === y); if (pf) parts.push('새 경로 깃발 자리');
    else if (PLAN.flags.some(f => inSq(f, 3))) parts.push('새 경로 영토');
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
