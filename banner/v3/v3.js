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
  const KEY = 'banner-v3-steps', keyOf = st => st.k || `${st.op}${st.x},${st.y}`;
  // 깃발 옮기기(11-14 밤): 아직 안 지은 건설 깃발을 지도에서 끌어 옮김. moves = { '계획 x,y': [지금 x, y] } — 진행 키(st.k)는 계획 좌표 그대로라 진행 기록과 안 어긋남. 서버 진행 기록에 함께 저장(모든 기기 공유).
  // 깃발 추가(11-14 밤): '깃발 추가'를 켜고 지도 칸을 누르면 그 자리에 건설 단계를 지금 순서(다음 할 일) 자리에 끼워 넣음. adds = [[x, y, 끼운 자리]] — 서버에 함께 저장.
  // ahead = 서버 진행 기록에 이 화면이 모르는 단계가 있음(작업 순서가 바뀐 뒤 새로 고치지 않은 화면) → 진행 기록은 올리지 않고 새로 고침.
  // 깃발 철거(11-14 밤): '깃발 철거'를 켜고 서 있는 깃발(파랑)을 누르면 철거 단계를 다음 할 일 자리에 끼워 넣음 — adds의 넷째 값 1.
  let moves = {}, adds = [], BASE = [], mvOn = false, addOn = false, rmOn = false, drag = null, ahead = false; const mvUndo = [];
  function buildSteps() {   // 계획 단계 + 추가한 깃발, 끝낸 단계 수는 키 기준으로 유지
    const dk = steps ? steps.slice(0, done).map(keyOf) : null, s = BASE.slice();
    for (const [x, y, pos, r] of adds) { const at = Math.min(pos, s.length); const op = r ? 'remove' : 'build'; s.splice(at, 0, { op, x, y, ox: x, oy: y, k: `${op}${x},${y}`, phase: (s[at] || s[at - 1] || { phase: 12 }).phase, why: r ? '추가한 철거' : '추가한 깃발', added: true }); }
    steps = s; applyMoves(); if (dk) done = prefix(dk);
  }
  const sameAdds = a => JSON.stringify(a || []) === JSON.stringify(adds);
  const mk = st => st.ox + ',' + st.oy;
  function applyMoves() { for (const st of steps) { const v = st.op === 'build' ? moves[mk(st)] : null; st.x = v ? v[0] : st.ox; st.y = v ? v[1] : st.oy; } }
  function setMoves(m, a) { moves = m && typeof m === 'object' ? m : {}; if (a !== undefined) adds = Array.isArray(a) ? a : []; buildSteps(); renderList(); renderStep(); mvButtons(); }
  const pendAdds = () => adds.filter(a => { const i = steps.findIndex(st => st.added && st.ox === a[0] && st.oy === a[1]); return i >= done; });
  function mvButtons() { const n = Object.keys(moves).length, na = pendAdds().length; $('mvundo').disabled = !mvUndo.length; $('mvreset').hidden = !(n + na); $('mvreset').textContent = `옮긴 ${n}개 · 추가한 건설 · 철거 ${na}개 모두 되돌리기`; }
  function addRemove(wx, wy) {   // 누른 곳 가까이 서 있는 깃발을 철거 단계로
    const tol = Math.max(1.5, 12 / view.s); let f = null, bd = 1e9;
    for (const v of haveFlags().values()) { const d = Math.max(Math.abs(v[0] + 0.5 - wx), Math.abs(v[1] + 0.5 - wy)); if (d <= tol && d < bd) { bd = d; f = v; } }
    if (!f) { $('readout').textContent = '서 있는 깃발(파랑)을 눌러 주세요'; return; }
    const i = steps.findIndex((st, k) => k >= done && st.op === 'remove' && st.x === f[0] && st.y === f[1]);
    if (i >= 0) { $('readout').textContent = `${xy(f[0], f[1])} — 이미 철거 순서에 있습니다 (${i + 1}번)`; return; }
    adds.push([f[0], f[1], done, 1]); mvUndo.push(['add', f[0], f[1]]); setMoves(moves, adds); save(); view.mark = { x: f[0], y: f[1] };
    $('readout').textContent = `${xy(f[0], f[1])} 깃발을 철거 순서 ${done + 1}번(다음 할 일)에 넣었습니다 — 끊기는 깃발이 있는지는 계산하지 않습니다 · '변경 취소'로 되돌릴 수 있습니다`; draw();
  }
  function addFlag(x, y) {
    const c = placeCheck(null, x, y);
    if (c.bad) { $('readout').textContent = `${xy(x, y)} — 추가 못 하는 자리: ${c.bad}`; return; }
    adds.push([x, y, done]); mvUndo.push(['add', x, y]); setMoves(moves, adds); save();
    $('readout').textContent = `${xy(x, y)}에 깃발을 추가했습니다 — 작업 순서 ${done + 1}번(다음 할 일)${c.warn ? ` · ⚠ ${c.warn}` : ''} · '변경 취소'로 되돌릴 수 있습니다`;
  }
  function delFlag(have, st) { if (!st.added) return have.delete(mk(st)); for (const [k, v] of have) if (v[0] === st.x && v[1] === st.y) return have.delete(k); return false; }   // 추가한 철거는 실제 자리로 찾음
  function haveFlags() {   // 지금 서 있는 깃발 = 조사한 실제 깃발 + 끝낸 건설 − 끝낸 철거 (실제 지은 자리는 built)
    const have = new Map((D.real || []).map(f => [f[0] + ',' + f[1], f]));
    for (const st of steps.slice(0, done)) { if (st.op === 'build') have.set(mk(st), [st.x, st.y]); else if (st.op === 'remove' && !st.added) have.delete(mk(st)); }
    for (const [a, b] of (D.built || [])) if (have.has(a[0] + ',' + a[1])) have.set(a[0] + ',' + a[1], b);
    for (const st of steps.slice(0, done)) if (st.op === 'remove' && st.added) delFlag(have, st);
    return have;
  }
  function placeCheck(st, x, y) {   // → { bad } 못 놓는 자리 | { warn } 놓되 알림 | {}
    if (x < VX || y < VY || x >= VX + VW || y >= VY + VH) return { bad: '지도 밖' };
    const kn = ['', '산', '호수', '연맹 자원지', '구조물'][kind[(y - VY) * VW + x - VX]]; if (kn) return { bad: kn + ' 칸' };
    const zone = (o, n) => (x >= o[0] - 6 && x <= o[0] + 8 && y >= o[1] - 6 && y <= o[1] + 8 ? n : null);
    for (const h of [...D.held, ...D.cands]) { const z = zone([h.x, h.y], h.name + ' 금지 구역'); if (z) return { bad: z }; }
    const hqz = zone(D.hq.plain, '평원 본부 자리') || zone(D.hq.wild, '황야 본부 자리'); if (hqz) return { bad: hqz };
    const all = [...haveFlags().values(), ...steps.slice(done).filter(t => t.op === 'build' && t !== st).map(t => [t.x, t.y]), ...steps.slice(done).filter(t => t.op === 'remove').map(t => [t.x, t.y])];
    if (all.some(f => f[0] === x && f[1] === y)) return { bad: '다른 깃발 자리' };
    const w = [];
    if (masks && masks.oth[(y - VY) * VW + x - VX]) w.push('다른 연맹 영토');
    const near = f => Math.abs(f[0] - x) <= 7 && Math.abs(f[1] - y) <= 7, hqNear = o => Math.abs(o[0] + 1 - x) <= 11 && Math.abs(o[1] + 1 - y) <= 11;
    if (!all.some(near) && !hqNear(D.hq.plain) && !hqNear(D.hq.wild)) w.push('이어지는 깃발이 없음');
    return w.length ? { warn: w.join(' · ') } : {};
  }
  function pickFlag(wx, wy) {   // 끌 수 있는 깃발 = 아직 안 지은 건설
    const tol = Math.max(1.5, 12 / view.s); let best = null, bd = 1e9;
    for (let i = done; i < steps.length; i++) { const st = steps[i]; if (st.op !== 'build') continue; const d = Math.max(Math.abs(st.x + 0.5 - wx), Math.abs(st.y + 0.5 - wy)); if (d <= tol && d < bd) { bd = d; best = st; } }
    return best;
  }
  function commitMove(st, x, y) {
    const k = mk(st), prev = moves[k] || null;
    if (x === st.ox && y === st.oy) delete moves[k]; else moves[k] = [x, y];
    mvUndo.push(['mv', k, prev]); setMoves(moves); save();
  }

  function setupSteps() {
    BASE = D.steps; for (const st of BASE) { st.ox = st.x; st.oy = st.y; st.k = `${st.op}${st.x},${st.y}`; } steps = BASE;
    if (D.phases) Object.assign(PHASE, D.phases);
    if (D.resFirst && D.resFirst.min) for (const id of ['typebox', 'flbox']) $(id).hidden = true;   // 11-14 밤: 주변 거점 연결 + 불필요한 깃발 철거만 남김 — 뺀 작업(동쪽 길 다시 짓기 등)의 목록은 숨김   // 11-13: 실제 깃발 기준으로 다시 짠 순서(끊김 최소)
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && v.moves && typeof v.moves === 'object') moves = v.moves; if (v && Array.isArray(v.adds)) adds = v.adds; buildSteps(); if (v && Array.isArray(v.keys)) while (done < steps.length && v.keys[done] === keyOf(steps[done])) done++; } catch (_) { /* 저장소 못 씀 */ }
    renderList();
    $('stepl').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) { const st = steps[+b.dataset.k]; goTo(st.x, st.y); } });
    $('stepcopy').addEventListener('click', () => { if (steps[done]) copy(steps[done]); });
    $('stepdone').addEventListener('click', () => { if (done < steps.length) { done++; save(); renderStep(); if (steps[done]) copy(steps[done], `${done}번 완료 · `); } });
    $('stepundo').addEventListener('click', () => { if (done) { done--; save(); renderStep(); } });
    $('stepmap').addEventListener('click', () => { const st = steps[done]; if (st) goTo(st.x, st.y); });
    $('rmb').addEventListener('click', () => { rmOn = !rmOn; if (rmOn && mvOn) $('mvb').click(); if (rmOn && addOn) $('addb').click(); $('rmb').setAttribute('aria-pressed', String(rmOn)); cv.style.cursor = rmOn ? 'not-allowed' : ''; $('readout').textContent = rmOn ? '철거 켬 — 철거할 깃발(파랑)을 누르세요. 다음 할 일 자리에 철거 단계로 들어갑니다. 다시 누르면 끕니다.' : ''; });
    $('addb').addEventListener('click', () => { addOn = !addOn; if (addOn && mvOn) $('mvb').click(); if (addOn && rmOn) $('rmb').click(); $('addb').setAttribute('aria-pressed', String(addOn)); cv.style.cursor = addOn ? 'copy' : ''; $('readout').textContent = addOn ? '추가 켬 — 깃발을 세울 칸을 누르세요. 다음 할 일 자리에 건설 단계로 들어갑니다. 다시 누르면 끕니다.' : ''; });
    $('mvb').addEventListener('click', () => { mvOn = !mvOn; if (mvOn && addOn) $('addb').click(); if (mvOn && rmOn) $('rmb').click(); $('mvb').setAttribute('aria-pressed', String(mvOn)); cv.style.cursor = mvOn ? 'move' : ''; $('readout').textContent = mvOn ? '옮기기 켬 — 노랑 번호 깃발(아직 안 지은 건설)을 끌어 새 자리에 놓으세요. 다시 누르면 끕니다.' : ''; });
    $('mvundo').addEventListener('click', () => { const u = mvUndo.pop(); if (!u) return; let msg = '옮긴 것 하나를 되돌렸습니다';
      if (u[0] === 'mv') { if (u[2]) moves[u[1]] = u[2]; else delete moves[u[1]]; }
      else if (u[0] === 'add') { const i = steps.findIndex(st => st.added && st.ox === u[1] && st.oy === u[2]); if (i >= 0 && i < done) { $('readout').textContent = '이미 완료로 표시한 단계라 되돌리지 않았습니다 (완료 취소를 먼저 하세요)'; mvUndo.push(u); mvButtons(); return; } adds = adds.filter(a => !(a[0] === u[1] && a[1] === u[2])); delete moves[u[1] + ',' + u[2]]; msg = '추가한 단계 하나를 뺐습니다'; }
      else if (u[0] === 'reset') { moves = u[1]; adds = u[2]; msg = '되돌리기 전 상태로 돌려놓았습니다'; }
      setMoves(moves, adds); save(); $('readout').textContent = msg; });
    $('mvreset').addEventListener('click', () => { if (!confirm('옮긴 깃발은 계획 자리로, 추가한 건설 · 철거(아직 안 한 것)는 빼서 모두 되돌릴까요?')) return; const pa = pendAdds(); mvUndo.push(['reset', { ...moves }, adds.slice()]); setMoves({}, adds.filter(a => !pa.includes(a))); save(); $('readout').textContent = '모두 되돌렸습니다 (변경 취소로 다시 살릴 수 있음)'; });
    mvButtons(); renderStep();
    pull(); setInterval(() => { if (!document.hidden) pull(); }, 20000); document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  }
  function renderList() {
    let ph = 0;
    $('stepl').innerHTML = steps.map((st, i) => `${st.phase !== ph ? `<li class="grp">${PHASE[(ph = st.phase)]}</li>` : ''}<li value="${i + 1}" data-k="${i}"><button class="lnk" data-k="${i}"><b class="opw op-${opc(st)}">${OP[st.op].slice(-2)}</b> ${where(st)}${st.added ? ' <small>추가</small>' : ''}${st.x !== st.ox || st.y !== st.oy ? ` <small>옮김 (계획 ${xy(st.ox, st.oy)})</small>` : ''}${st.chk ? ' <small title="짓기 전에 이 자리를 눌러 소속 연맹 확인">⚠</small>' : ''}${(st.phase >= 6 || D.phases) && st.why ? ` <small>${st.why}</small>` : ''}${st.join ? ` <small>끊긴 깃발 ${st.join}개 다시 이어짐</small>` : ''}${st.cut ? ` <small>✂ 이 단계에서 깃발 ${st.cut}개 끊김</small>` : ''}</button></li>`).join('');
  }
  const where = st => (st.op === 'hq' ? `${xy(...st.from)} → ${xy(st.x, st.y)}` : st.op === 'sweep' ? `약 ${st.left}개 — 목록에 없어도 새 계획 밖 거점 연결 깃발은 모두 철거` : xy(st.x, st.y));
  const saveLocal = () => { try { localStorage.setItem(KEY, JSON.stringify({ keys: steps.slice(0, done).map(keyOf), moves, adds })); } catch (_) { /* 저장소 못 씀 */ } };
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
      if (!drag && (JSON.stringify(j.moves || {}) !== JSON.stringify(moves) || !sameAdds(j.adds))) { mvUndo.length = 0; setMoves(j.moves || {}, j.adds || []); saveLocal(); }
      ahead = Array.isArray(j.keys) && prefix(j.keys) < j.keys.length;
      if (ahead) {   // 작업 순서가 바뀜 — 한 번 새로 고침(2분 안에 또 그러면 알림만)
        let last = 0; try { last = +sessionStorage.getItem('v3-reload') || 0; } catch (_) { /* 무시 */ }
        if (Date.now() - last > 120000) { try { sessionStorage.setItem('v3-reload', String(Date.now())); } catch (_) { /* 무시 */ } location.reload(); return; }
      }
      if (Array.isArray(j.keys)) { const n = prefix(j.keys); if (n !== done) { done = n; saveLocal(); renderStep(); } }
      syncMsg(j.updated_at, ahead ? '⚠ 작업 순서가 바뀌었습니다 — 새로 고침하세요' : '');
    } catch (_) { syncMsg(); }
  }
  async function push() {
    saveLocal();
    if (ver === null) { dirty = true; syncMsg(); return; }
    try {
      const r = await fetch(API, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base: ver, ...(ahead ? {} : { keys: steps.slice(0, done).map(keyOf) }), moves, adds }) });
      const j = await r.json();
      if (r.status === 409) { ver = j.ver; dirty = false; mvUndo.length = 0; setMoves(j.moves || {}, j.adds || []); done = prefix(j.keys || []); ahead = prefix(j.keys || []) < (j.keys || []).length; saveLocal(); renderStep(); syncMsg(j.updated_at, '다른 기기에서 먼저 바뀌어 그 기록을 따랐습니다'); }
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
  let imgs = null, masks = null;
  const resIcon = new Image(); resIcon.onload = () => draw(); resIcon.src = '../res-icons.png';   // 게임 자원 아이콘 4개(빵·나무·돌·철, 28px씩 한 줄)
  function buildImages() {
    const mk = () => { const c = document.createElement('canvas'); c.width = VW; c.height = VH; return c; };
    const paint = (fn) => { const c = mk(), g = c.getContext('2d'), im = g.createImageData(VW, VH), d = im.data; for (let i = 0; i < VW * VH; i++) { const v = fn(i); if (!v) continue; d.set(v, 4 * i); } g.putImageData(im, 0, 0); return c; };
    const rows = list => { const m = new Uint8Array(VW * VH); for (const [y, a, b] of list) for (let x = a; x <= b; x++) m[(y - VY) * VW + x - VX] = 1; return m; };
    const known = rows(D.known), oth = rows(D.others), kor = rows(D.kor); masks = { oth };
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
    put(imgs.terr);
    // 연맹 자원지를 종류별 색으로(11-14 밤): 빵 노랑 · 나무 초록 · 돌 회색 · 철 남색. '연맹 자원지 강조'를 켜면 한 칸씩 크게 + 테두리
    if (D.nodes) { const NC = ['#d9a400', '#2e8b3a', '#8a8f98', '#4a5a8c'], e = view.res ? 1 : 0; for (const [t, x, y] of D.nodes) { gx.fillStyle = NC[t]; gx.fillRect(x - e, y - e, 2 + 2 * e, 2 + 2 * e); if (e) { gx.strokeStyle = C.ink; gx.lineWidth = 1 / view.s; gx.strokeRect(x - e, y - e, 2 + 2 * e, 2 + 2 * e); } } }
    else if (view.res) put(imgs.nodeHi);
    if (view.oth) put(imgs.oth, 0.32);
    put(imgs.kor, view.now ? 0.28 : 0.12);
    put(imgs.unk);
    const sq = (x, y, r, col, lw, dash) => { gx.strokeStyle = col; gx.lineWidth = lw / s; gx.setLineDash(dash ? dash.map(v => v / s) : []); gx.strokeRect(x - r, y - r, 1 + 2 * r, 1 + 2 * r); gx.setLineDash([]); };
    const dot = (x, y, col, sz = 1) => { gx.fillStyle = col; gx.fillRect(x + (1 - sz) / 2, y + (1 - sz) / 2, sz, sz); };
    // 11-14 밤: 작업 순서가 있으면(slim) 지도에는 기존 깃발 파랑 · 철거 빨강 · 신규 노랑 번호만 — 옛 계획 표시(v2 점 · 철거 가능 점선 · 보류 깃발)는 그리지 않음
    const slim = planKey === 'main' && steps && D.real, RED = '#e5252a', BLUE = '#2f7bff', YEL = '#ffd400';
    // 평원 쪽 v2 깃발 (위쪽 중 새 경로에 안 쓰는 것은 빨간 점선 = 철거 가능)
    if (!slim) for (const [x, y] of D.v2) dot(x, y, C['c-banner']);
    if (!slim) for (const [x, y] of D.up.unused) { sq(x, y, 3, C.bad, 1.6, [3, 3]); dot(x, y, C.bad); }
    // 지금 깃발(추정)
    if (view.now && !slim) for (const [x, y] of D.now) { sq(x, y, 3, C['c-old'], 1.2, [4, 3]); dot(x, y, C['c-old']); }
    // 주변 거점
    if (view.cand) for (const c of D.cands) { sq(c.x + 1, c.y + 1, 7, C['c-cand'], 2, [6, 4]); dot(c.x, c.y, C['c-cand'], 3); if (planKey === 'main' && c.rank && !slim) for (const [x, y] of c.flags) sq(x, y, 3, C['c-cand'], 1.2, [2, 2]); }
    if (view.cand && !slim) for (const g of ((D.resfill || {}).groups || [])) for (const [x, y] of g.flags) sq(x, y, 3, C.ok, 1, [2, 2]);   // 자원지 보강 깃발(⑥·⑧)
    if (!slim) for (const c of (D.corners || [])) { gx.strokeStyle = C.bad; gx.lineWidth = 2 / s; gx.beginPath(); gx.arc((c.a[0] + c.b[0] + 1) / 2, (c.a[1] + c.b[1] + 1) / 2, 2.6, 0, 2 * Math.PI); gx.stroke(); }   // 꼭짓점으로만 이어지는 자리
    // 점령 거점
    for (const hq of D.held) { sq(hq.x + 1, hq.y + 1, 7, C['c-t2'], 2.4); gx.fillStyle = C['c-t2']; gx.fillRect(hq.x, hq.y, 3, 3); }
    // 본부
    sq(D.hq.plain[0] + 1, D.hq.plain[1] + 1, 7, C['c-hq'], 2); gx.fillStyle = C['c-hq']; gx.fillRect(D.hq.plain[0], D.hq.plain[1], 3, 3);
    if (slim) { const [hx, hy] = D.hq.wild; gx.fillStyle = C['c-wild']; gx.globalAlpha = 0.22; gx.fillRect(hx - 6, hy - 6, 15, 15); gx.globalAlpha = 1; sq(hx + 1, hy + 1, 7, '#3a2a00', 6); sq(hx + 1, hy + 1, 7, C['c-wild'], 3.6); gx.fillRect(hx, hy, 3, 3); }   // 황야 본부 강조(11-14 밤): 영토 칠 + 굵은 실선
    else {
      sq(D.hq.wild[0] + 1, D.hq.wild[1] + 1, 7, C['c-wild'], 1.6, [5, 4]); gx.fillStyle = C['c-wild']; gx.globalAlpha = 0.5; gx.fillRect(D.hq.wild[0], D.hq.wild[1], 3, 3); gx.globalAlpha = 1;
    }
    if (PLAN.w && !slim) { sq(PLAN.w[0] + 1, PLAN.w[1] + 1, 7, C['c-wild'], 3.2); gx.fillStyle = C['c-wild']; gx.fillRect(PLAN.w[0], PLAN.w[1], 3, 3); }
    // 새 경로
    // 11-14: 남은 작업을 테두리 색으로 — 새로 지을 깃발 녹색, 철거할 깃발 주황, 이미 지은 새 경로 깃발은 회색 실선
    if (slim) {
      const have = haveFlags();
      for (let i = done; i < steps.length; i++) if (steps[i].op === 'remove') delFlag(have, steps[i]);
      for (const [x, y] of have.values()) { sq(x, y, 3, BLUE, 1.4); dot(x, y, BLUE); }
      for (let i = done; i < steps.length; i++) { const st = steps[i]; if (st.op === 'remove') { sq(st.x, st.y, 3, RED, 2.4); dot(st.x, st.y, RED); } }
      for (let i = done; i < steps.length; i++) { const st = steps[i]; if (st.op === 'build') { if (st.x !== st.ox || st.y !== st.oy) { sq(st.ox, st.oy, 3, YEL, 1.2, [3, 3]); gx.strokeStyle = YEL; gx.lineWidth = 1.2 / s; gx.beginPath(); gx.moveTo(st.ox + 0.5, st.oy + 0.5); gx.lineTo(st.x + 0.5, st.y + 0.5); gx.stroke(); }   // 옮긴 깃발: 계획 자리는 점선
        sq(st.x, st.y, 3, '#3a3000', 3.6); sq(st.x, st.y, 3, drag && drag.st === st && drag.bad ? RED : YEL, 2.2); dot(st.x, st.y, YEL); } }
    } else if (planKey === 'main' && steps) {
      for (const [x, y] of PLAN.flags) { sq(x, y, 3, C['c-old'], 1.6); dot(x, y, C['c-old']); }
    } else for (const [x, y] of PLAN.flags) { sq(x, y, 3, C['c-new'], 2.2); dot(x, y, C['c-new']); }
    if (planKey === 'main' && stepCur) { const p = stepCur, sz = p.op === 'hq' ? 3 : 1; gx.strokeStyle = p.op === 'remove' || p.op === 'sweep' ? RED : p.op === 'build' ? YEL : C['c-wild']; gx.lineWidth = 3 / s; gx.beginPath(); gx.arc(p.x + sz / 2, p.y + sz / 2, sz / 2 + 4, 0, Math.PI * 2); gx.stroke(); }
    if (view.mark) { gx.strokeStyle = C['c-pick']; gx.lineWidth = 3 / s; gx.strokeRect(view.mark.x, view.mark.y, 1, 1); gx.beginPath(); gx.arc(view.mark.x + 0.5, view.mark.y + 0.5, 3, 0, Math.PI * 2); gx.stroke(); }
    // 글자
    gx.setTransform(dpr, 0, 0, dpr, 0, 0); gx.textAlign = 'center'; gx.textBaseline = 'middle';
    // 연맹 자원지에 게임 아이콘(11-14 밤): 가까이 보면(아이콘 11px 이상) 자동, '연맹 자원지 강조'를 켜면 멀리서도 표시
    if (D.nodes && resIcon.naturalWidth) { const k0 = Math.min(30, s * 2.6), k = view.res ? Math.max(k0, 14) : k0;
      if (k >= 11) { gx.imageSmoothingEnabled = true; for (const [t, x, y] of D.nodes) { const px = m[0] * (x + 1) + m[2] * (y + 1) + m[4], py = m[1] * (x + 1) + m[3] * (y + 1) + m[5]; if (px < -20 || py < -20 || px > w + 20 || py > h + 20) continue; gx.drawImage(resIcon, t * 28, 0, 28, 28, px - k / 2, py - k / 2, k, k); gx.strokeStyle = ['#d9a400', '#2e8b3a', '#8a8f98', '#4a5a8c'][t]; gx.lineWidth = 2; gx.beginPath(); gx.arc(px, py, k / 2, 0, 2 * Math.PI); gx.stroke(); } } }
    const label = (x, y, t, col) => { const p = { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; gx.font = '600 12px "IBM Plex Sans KR", sans-serif'; const tw = gx.measureText(t).width + 8; gx.fillStyle = C.bg; gx.globalAlpha = 0.85; gx.fillRect(p.x - tw / 2, p.y - 9, tw, 18); gx.globalAlpha = 1; gx.fillStyle = col; gx.fillText(t, p.x, p.y); };
    for (const hq of D.held) label(hq.x + 1.5, hq.y + 10, hq.name + ((D.retake || []).some(r => r.x === hq.x && r.y === hq.y) ? ' (되찾기)' : ''), C['c-t2']);
    if (view.cand) for (const c of D.cands) label(c.x + 1.5, c.y + 10, c.name, C['c-cand']);
    label(D.hq.plain[0] + 1.5, D.hq.plain[1] - 8, '평원 본부', C['c-hq']);
    label(D.hq.wild[0] + 1.5, D.hq.wild[1] - 8, slim ? '★ 황야 본부' : '황야 본부(지금)', C['c-wild']);
    if (PLAN.w && !slim && (PLAN.w[0] !== D.hq.wild[0] || PLAN.w[1] !== D.hq.wild[1])) label(PLAN.w[0] + 1.5, PLAN.w[1] - 8, '황야 본부(새 자리)', C['c-wild']);
    // 작업 순서 번호(11-14): 남은 단계의 깃발 자리에 번호 — 건설 노랑, 철거 빨강. 멀리서 보면 다음 30단계만, 가까이 보면 모두.
    if (planKey === 'main' && steps) {
      const all = s >= 3.2, fs = Math.max(9, Math.min(15, s * 2.2));
      gx.font = `700 ${fs}px "IBM Plex Sans KR", sans-serif`; gx.lineJoin = 'round';
      for (let i = steps.length - 1; i >= done; i--) {
        const st = steps[i]; if (st.op !== 'build' && st.op !== 'remove') continue;
        if (!all && i >= done + 30) continue;
        const px = m[0] * (st.x + 0.5) + m[2] * (st.y + 0.5) + m[4], py = m[1] * (st.x + 0.5) + m[3] * (st.y + 0.5) + m[5];
        if (px < -20 || py < -20 || px > w + 20 || py > h + 20) continue;
        const nb = st.op === 'build';   // 신규 = 노랑 번호(어두운 테두리), 철거 = 빨강 번호
        gx.lineWidth = nb ? 4 : 3; gx.strokeStyle = nb ? '#241d00' : C.bg; gx.strokeText(i + 1, px, py);
        gx.fillStyle = nb ? '#ffd400' : '#e5252a'; gx.fillText(i + 1, px, py);
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
  cv.addEventListener('pointerdown', e => { try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ } ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); downAt = { x: e.offsetX, y: e.offsetY };
    if (mvOn && steps && ptrs.size === 1) { const w = toWorld(e.offsetX, e.offsetY), st = pickFlag(w.x, w.y); if (st) drag = { st, x0: st.x, y0: st.y, bad: null, id: e.pointerId }; } else if (drag) { drag.st.x = drag.x0; drag.st.y = drag.y0; drag = null; draw(); }   // 두 손가락이면 옮기기 그만
  });
  cv.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    const cur = { x: e.offsetX, y: e.offsetY };
    if (downAt && Math.hypot(cur.x - downAt.x, cur.y - downAt.y) > 5) downAt = null;
    if (drag && drag.id === e.pointerId) { const w = toWorld(cur.x, cur.y), x = Math.floor(w.x), y = Math.floor(w.y); if (x !== drag.st.x || y !== drag.st.y) { drag.st.x = x; drag.st.y = y; const c = placeCheck(drag.st, x, y); drag.bad = c.bad || null; $('readout').textContent = `${xy(x, y)}${c.bad ? ` — 못 놓는 자리: ${c.bad}` : c.warn ? ` — ⚠ ${c.warn}` : ''}`; draw(); } }
    else if (ptrs.size === 1) { const a = toWorld(prev.x, prev.y), b = toWorld(cur.x, cur.y); view.cx += a.x - b.x; view.cy += a.y - b.y; draw(); }
    else if (ptrs.size === 2) { const pts = [...ptrs.entries()].map(([id, p]) => (id === e.pointerId ? cur : p)), d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); if (pinch) zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, d / pinch); pinch = d; }
    ptrs.set(e.pointerId, cur);
  });
  const up = e => {
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (drag && drag.id === e.pointerId) { const d = drag, st = d.st, x = st.x, y = st.y; drag = null; st.x = d.x0; st.y = d.y0;
      if (e.type === 'pointerup' && !d.bad && (x !== d.x0 || y !== d.y0)) { const c = placeCheck(st, x, y); commitMove(st, x, y); $('readout').textContent = `${steps.indexOf(st) + 1}번 깃발을 ${xy(d.x0, d.y0)} → ${xy(x, y)}로 옮겼습니다${c.warn ? ` — ⚠ ${c.warn}` : ''} · '변경 취소'로 되돌릴 수 있습니다`; downAt = null; return; }
      if (d.bad) $('readout').textContent = `못 놓는 자리(${d.bad})라 옮기지 않았습니다`; draw(); if (x !== d.x0 || y !== d.y0) { downAt = null; return; } }
    if (!ptrs.size && downAt && kind && rmOn && steps && e.type === 'pointerup') { const w = toWorld(e.offsetX, e.offsetY); addRemove(w.x, w.y); downAt = null; return; }
    if (!ptrs.size && downAt && kind && addOn && steps && e.type === 'pointerup') { const w = toWorld(e.offsetX, e.offsetY), x = Math.floor(w.x), y = Math.floor(w.y); view.mark = { x, y }; addFlag(x, y); downAt = null; return; }
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
