/* /banner/v3/ — KOR 점령 거점 연결 최적 경로 (data.json).
 * data: view{x0..y1}, hq{plain, wild(지금), wildNew}, held[{name,x,y}](점령 거점 3×3 모서리), cands[{name,x,y,add,rank,flags}](주변 미점령 거점, 더 잇는 데 드는 깃발),
 *   v2(평원 본부 쪽 깃발 — 그대로), now(지금 깃발: 화면에서 추정), main/alts/stay/all6(연결안: w 황야 본부, flags, cost, A 평원 쪽 거점, B 황야 쪽, direct 바로 닿음),
 *   res{now,new}(영토 안 연맹 자원지 [빵,나무,돌,철]), steps(작업 순서 — main 기준), others/known/kor([y,x0,x1] 줄).
 *   11-13: assume.swap(무기 창고 교환 가정), gave, corners[{a,b,grp}], resfill.groups[{flags,got,early}], steps phase ⑥~⑧·op sweep, review.
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
  const PLANS = () => {   // 11-11 사용자: 추천안만 남김 · 11-13: 무기 창고 교환 가정
    const had = new Set([...D.v2, ...D.now].map(f => f[0] * G + f[1])), keep = D.main.flags.filter(f => had.has(f[0] * G + f[1])).length, sw = (D.assume || {}).swap;
    return [['main', D.main, `추천: 황야 본부 → ${xy(...D.main.w)}`, `깃발 ${D.main.flags.length}개(새로 ${D.main.flags.length - keep} + 지금 있는 ${keep}개 그대로)로 점령 거점 ${D.held.length}곳 연결, v2 위쪽 ${D.up.unused.length}개 철거${sw ? ` — ${sw.with}과 무기 창고 교환(${xy(...sw.give)} ↔ ${xy(...sw.take)}) 성사 가정` : ''}`]];
  };
  function setPlan(k) { planKey = k; PLAN = PLANS().find(p => p[0] === k)[1]; renderFacts(); renderFlags(); $('stepbox').hidden = k !== 'main'; draw(); }

  function setup() {
    $('stamp').textContent = `${D.updated} 기준 · 점령 거점 ${D.held.length}곳${(D.assume || {}).swap ? ' (무기 창고 교환 가정)' : ''}`;
    $('plans').innerHTML = PLANS().map(([k, p, t, s]) => `<label><span><b>${t}</b><small>${s}</small></span></label>`).join('');
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
    const r = D.res, sum = a => a.reduce((s, v) => s + v, 0), rs = a => `빵 ${a[0]}·나무 ${a[1]}·돌 ${a[2]}·철 ${a[3]}`;
    const sw = (D.assume || {}).swap, RC = (D.resfill || {}).count || {}, RV = D.review || {}, cl = D.corners || [];
    const arm = sw ? D.held.find(h => h.x === sw.take[0] && h.y === sw.take[1]) : null;
    $('check').innerHTML = [
      sw ? `<b>가정:</b> ${sw.with}과 Lv.2 무기 창고 교환이 성사된 것으로 계산했습니다 — 우리 무기 창고(${xy(...sw.give)})를 넘기고 ${sw.with} 무기 창고(${xy(...sw.take)})를 받습니다. 받는 거점을 점령하기 전에 작업을 시작해도 ${xy(...sw.kept)} 깃발이 본부와 끊기지 않게 순서를 잡았습니다 — ① 황야 본부를 먼저 옮기고, 그 깃발에서 새 본부까지 이어지는 남쪽 옛 깃발(Y 1030 이상)은 ④에서 맨 나중에 철거합니다. 그래도 <b>교환을 먼저 끝내고 시작하는 편이 안전합니다.</b> 교환이 안 되면 다시 계산해야 합니다.` : '',
      `점령 거점 ${D.held.length}곳: ${D.held.map(h => `${h.name} ${xy(h.x, h.y)}${(D.retake || []).some(r => r.x === h.x && r.y === h.y) ? ' (되찾을 거점)' : ''}`).join(', ')}.`,
      D.must ? `<b>반드시 포함할 거점 ${D.must.length}곳(11-13)${D.must.every(m => m.ok) ? '이 모두 이어집니다' : ' 중 ' + D.must.filter(m => !m.ok).map(m => m.name).join('·') + '은(는) 아직 못 이었습니다'}:</b> ${D.must.map(m => `${m.name.replace(/ \(.*\)/, '')} ${xy(m.x, m.y)}${m.status === 'held' ? '' : m.status === 'swap' ? ' (교환으로 받음)' : m.status === 'retake' ? ' (FUN에서 되찾기)' : ` (NYX 소유 · 깃발 +${m.add})`}`).join(', ')}.` : '',
      ...(D.retake || []).map(o => `<b>${o.name}(${xy(o.x, o.y)})는 지금 ${o.from} 소유입니다</b>(11-11 화면에서는 KOR, 11-13 화면에서는 ${o.from} 표시). 되찾을 거점이라 연결 대상에 그대로 두었습니다 — 둘레가 ${o.from} 영토라 지금은 우리 영토가 금지 구역에 ${(D.main.contact || {})[o.name]}칸만 닿습니다.`),
      ...cl.filter(c => c.pass).map(c => `${xy(...c.a)} ↔ ${xy(...c.b)}는 ${c.pass.with.join('·') || '다른 연맹'} 깃발 둘이 꼭짓점으로만 닿은 틈을 지나는 자리입니다(11-13 규칙: 그런 곳은 지나갈 수 있음)${c.pass.sure ? ' — 양옆 두 깃발 자리의 네 귀퉁이를 게임에서 눌러 모두 빈 땅임을 확인했습니다.' : ' — 짓기 전에 두 자리의 귀퉁이를 눌러 확인하세요.'}`),
      ...(D.notes || []),
      sw && arm ? `받는 Lv.2 무기 창고(${xy(...sw.take)}): 지금 KOR 깃발 ${xy(...sw.kept)}이 북쪽 변에 닿아 있습니다(게임에서 확인). 이 깃발은 그대로 두고 여기까지 잇습니다. 남쪽·동쪽 둘레는 FN5(X:438 Y:1058)·CMS(X:445 Y:1058·X:450 Y:1064) 땅(게임에서 확인)이고 서쪽은 FUN 영토라, 맞닿는 길이는 ${(D.main.contact || {})[arm.name]}칸이 한계입니다.` : '',
      `v2 깃발은 곰덫 주변만 지키고, 본부 북쪽 위쪽 깃발 ${D.up.used.length + D.up.unused.length}개(예전 거점 연결용, 곰덫2 안전 반경 42칸 밖)는 새 계획에 쓰는 ${D.up.used.length}개만 남기고 ${D.up.unused.length}개는 ⑤에서 본부에서 먼 것부터 철거합니다. /banner/v1·v2는 이전 이력 확인용으로만 두고 고치지 않습니다.`,
      '두 본부 모두 영토의 뿌리입니다(지금 황야 본부 쪽 깃발 덩어리는 평원 본부와 끊겨 있는데도 유지됨). 그래서 거점마다 평원 본부 쪽이나 황야 본부 쪽 중 한 곳에 이어지면 되는 것으로 계산했습니다. 황야 본부 이전을 ①로 둔 까닭: 옮기자마자 건설소가 본부에 닿고, 남쪽 옛 깃발 띠가 새 본부 영토에 붙어 서쪽 무기 창고 깃발까지 계속 이어지기 때문입니다.',
      `황야 본부 자리: 황야(왕국 300~899 평원 고리 밖) 중 3×3이 비어 있고 영토 15×15에 다른 연맹·금지 구역이 없는 ${RV.wCount ? RV.wCount.toLocaleString('ko-KR') : '수만'}곳을 모두 계산해 골랐습니다${D.main.direct && D.main.direct.length ? ` — 새 자리는 본부 영토가 ${D.main.direct.join('·')} 금지 구역에 변으로 바로 닿아 깃발 없이 이어집니다` : ''}.${RV.plainOnly ? ` 평원 본부 하나로만 ${D.held.length}곳을 다 이으면 깃발 약 ${Math.round(RV.plainOnly)}개가 듭니다.` : ''}`,
      `거점과 맞닿는 길이(금지 구역 둘레 칸 중 우리 영토인 칸, 최종 영토 기준 · 13칸 이상이 목표): ${Object.entries(D.main.contact || {}).map(([k, v]) => `${k} ${v}칸`).join(', ')} (보강 깃발 ${(D.main.reinforce || []).length}개 포함). 13칸이 안 되는 곳은 둘레가 다른 연맹 땅이라 더 넓힐 자리가 없는 거점입니다.`,
      `깃발 영역 겹침: 깃발마다 ±3칸 옮겨 보며 줄였습니다 — 거점 연결 깃발끼리·평원 쪽 v2 영토·황야 본부 영역과 ${D.main.overlap ? D.main.overlap[1] : 0}칸, 주변 거점·자원지 보강까지 합쳐 ${D.overlapAll}칸. 다듬는 순서는 자원지(빵·나무 우선) → 꼭짓점 연결 수 → 겹침 → 맞닿는 변입니다(11-12 규칙).`,
      '연결 규칙: 깃발 영역 7×7은 변이 1칸 이상 맞닿으면 이어집니다. 꼭짓점만 닿아도 게임에서는 이어지므로 금지하지 않고, 깃발 0.6개 몫 감점만 줘서 깃발이 줄 때만 씁니다(11-12 규칙). 금지 구역(거점 15×15·성채 60) 안에는 영토가 안 생기므로 깃발 영역은 금지 구역과 한 칸도 겹치지 않게 놓고, 거점은 금지 구역 바로 바깥에 영토가 변으로 맞닿으면 연결입니다. 깃발은 산·호수·연맹 자원지·구조물·금지 구역에 못 세웁니다. 성채·유적으로는 잇지 않습니다. 다른 연맹 깃발끼리 꼭짓점으로만 닿은 곳이나 얇게 이어진 곳은 지나갈 수 있습니다(11-13 규칙) — 이번 경로는 꼭짓점 틈만 지나고, 얇게 이어진 곳을 넘는 자리는 없습니다.',
      `다른 연맹 영토는 11-13 낮 시간 PC 화면(110단계 축소 지도 19장, 동쪽 끝만 11-11)의 덧칠 색으로 다시 읽었고(게임의 밤 화면은 빈 땅까지 다른 연맹으로 잘못 읽혀 낮 화면만 씀 — 11-11 밤 화면 때문에 막혀 있던 빈 땅이 풀렸습니다), 새 깃발의 7×7 영역은 다른 연맹 칸과 겹치지 않게 잡았습니다(1칸 여유 없음 — 11-12 규칙). 게임에서 칸을 직접 눌러 소속을 확인한 ${D.facts || 150}곳(11-11·11-13)은 화면 판독보다 우선해 넣었습니다 — 그 과정에서 거점 아이콘에 가려 안 보이던 NYX·FUN·KoreaAcademy 땅을 찾아 경로를 고쳤습니다. <b>거점 아이콘·이름표에 가린 둘레와, 다른 연맹 영토에 바로 붙는 자리는 화면 판독이 1칸쯤 틀릴 수 있습니다. 짓기 전에 그 자리를 눌러 '소속 연맹'을 확인하세요.</b>${D.verify ? ` 새로 짓는 ${D.verify.builds}개 중 ${D.verify.any}개가 그런 자리입니다(다른 연맹에 바로 붙음 ${D.verify.adj}개, 가려진 둘레 ${D.verify.hid}개 — 작업 순서에 ⚠ 표시).` : ''} 다른 연맹은 계속 깃발을 늘립니다.`,
      D.real ? `지금 깃발 ${D.real.length}개는 11-13 게임 축소 지도의 깃발 표식을 하나씩 읽은 실제 좌표입니다(지도의 회색 점선 = 평원 쪽 v2를 뺀 ${D.now.length}개). 작업 순서는 이 실제 깃발로 한 단계씩 흉내 내어, 빈 칸이 있으면 새 깃발을 먼저 짓고 빈 칸이 없을 때만 '빼도 다른 깃발이 안 끊기는' 옛 깃발부터 철거하게 짰습니다. 어쩔 수 없이 끊기는 단계는 ✂ 로 표시했습니다.${(D.subs || []).length ? ` 계획 자리와 1~2칸 차이로 이미 서 있고 이웃 연결이 그대로인 실제 깃발 ${D.subs.length}개는 다시 짓지 않고 그대로 씁니다.` : ''}` : `지금 거점 연결 깃발은 게임 총 ${D.count.now}개에서 평원 쪽(v2 ${D.count.v2}개·여분 최대 ${D.count.extra}개)을 뺀 약 ${D.count.now - D.count.v2 - D.count.extra}~${D.count.now - D.count.v2}개입니다. 지도에 회색 점선으로 그린 ${D.now.length}개는 화면의 KOR 영토 모양을 7×7 최소 개수로 덮어 추정한 것이라(많이 겹친 깃발은 하나로 잡힘) 실제보다 적고 좌표도 1~3칸 다를 수 있습니다. 그래서 ④ 끝에 '남은 옛 깃발 정리' 단계를 넣었습니다 — 새 계획에 없는 거점 연결 깃발은 목록에 없어도 모두 철거합니다.`,
      `연맹 자원지(2×2 네 칸이 모두 영토 안이어야 셈, 하나당 시간당 3,600): 추천안까지 ${sum(RC.main || [])}곳 → 주변 거점까지 ${sum(RC.cand || [])}곳 → 자원지 보강까지 ${sum(RC.res || [])}곳(${rs(RC.res || [0, 0, 0, 0])}). 지금 게임은 111곳(빵 33·나무 29·돌 30·철 19). 자원지 보강은 빵·나무가 고르게 늘도록 골랐습니다 — 깃발 하나에 빵·나무가 같은 양 들어서 적은 쪽이 병목이기 때문입니다${RV.resSumOnly ? `(합계만 최대로 하면 빵 ${RV.resSumOnly[0]}·나무 ${RV.resSumOnly[1]}곳)` : ''}.`,
      `주변 거점 ${D.cands.filter(c => c.rank).length}곳은 한꺼번에 최소 깃발로 잇도록 계산했습니다(거점 묶음마다 가장 적게 드는 길, 묶음 나누기는 모두 비교). "혼자 붙이면"은 추천안에 그 거점 하나만 이을 때, "차례로 붙이면"은 앞 거점 길을 함께 쓸 때 그 거점 몫(맞닿는 면 보강 포함)입니다. 뺀 거점: THE 소유 3곳(점령 불가), FUN Lv.2 훈련 캠프(점령 중인 것과 종류·레벨 중복), 채집 제단·풍작 제단(보류 — 11-13).`,
      cl.length ? `깃발이 꼭짓점으로만 이어지는 자리 ${cl.length}곳: ${cl.map(c => `${xy(...c.a)} ↔ ${xy(...c.b)}`).join(', ')}. 이 자리가 끊기면 그 뒤 깃발이 본부와 떨어집니다.${RV.noCornerFlags ? ` 꼭짓점 연결을 전혀 안 쓰면 거점 연결 깃발이 ${D.main.flags.length}개 → ${RV.noCornerFlags}개로 늘어납니다.` : ''}` : '꼭짓점으로만 이어지는 자리는 없습니다.',
      '작업 순서 ⑥~⑧: 추천안(①~⑤)을 마친 뒤 ⑥ 추천안 영토에서 바로 이을 수 있는 자원지 보강 묶음(빵·나무 수입을 먼저 늘림, 값이 큰 묶음부터) → ⑦ 주변 거점 연결(영토가 닿아야 공격해 점령할 수 있음) → ⑧ 주변 거점 길에서 이어 가는 자원지 보강 묶음. ⑥~⑧의 깃발 수 표시는 ④에서 옛 깃발을 모두 철거했다고 보고 센 값입니다.',
      '깃발 1개 비용(276~285개 구간, 팬 사이트 표): 빵·나무 250,800, 돌 167,200, 철 91,200. 건설 약 33분.',
    ].filter(Boolean).map(s => `<li>${s}</li>`).join('');
    $('src').textContent = '지형·연맹 자원지·거점 위치: mapdata.js(ksmapper). 다른 연맹 영토: 2026-11-13 낮 PC 게임 화면. 지금 우리 깃발(추정): 11-11 화면.';
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
  }
  const where = st => (st.op === 'hq' ? `${xy(...st.from)} → ${xy(st.x, st.y)}` : st.op === 'sweep' ? `약 ${st.left}개 — 목록에 없어도 새 계획 밖 거점 연결 깃발은 모두 철거` : xy(st.x, st.y));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ keys: steps.slice(0, done).map(keyOf) })); } catch (_) { /* 저장소 못 씀 */ } };
  function copy(st, pre = '') {
    const t = `X:${st.x} Y:${st.y}`;
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => { $('stepmsg').textContent = `${pre}${t} 복사됨`; }, () => { $('stepmsg').textContent = `${pre}복사 안 됨: ${t}`; });
  }
  function renderStep() {
    const st = steps[done]; stepCur = st || null;
    $('stepsum').textContent = `${done}/${steps.length} 완료`;
    $('stepph').textContent = st ? `${done + 1}/${steps.length} · ${PHASE[st.phase]}` : '모든 작업을 마쳤습니다';
    $('stepop').innerHTML = st ? `<span class="opb op-${opc(st)}">${OP[st.op]}</span>${(st.phase >= 6 || D.phases) && st.why ? ` <small>${st.why}</small>` : ''}${st.cut ? ` <small>✂ 깃발 ${st.cut}개 끊김</small>` : ''}` : '';
    $('stepxy').textContent = st ? where(st) : '';
    if (st && st.chk) $('stepmsg').textContent = `⚠ 짓기 전에 이 자리를 눌러 소속 연맹을 확인하세요 (${st.chk.includes('adj') ? '다른 연맹 영토에 바로 붙는 자리' : '거점 아이콘·이름표에 가려 화면 판독이 불확실한 자리'}).`; else if ($('stepmsg').textContent.startsWith('⚠')) $('stepmsg').textContent = '';
    $('stepcard').className = `stepnow${st ? ` op-${opc(st)}` : ''}`;
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
    if (view.cand) for (const g of ((D.resfill || {}).groups || [])) for (const [x, y] of g.flags) sq(x, y, 3, C.ok, 1, [2, 2]);   // 자원지 보강 깃발(⑥·⑧)
    for (const c of (D.corners || [])) { gx.strokeStyle = C.bad; gx.lineWidth = 2 / s; gx.beginPath(); gx.arc((c.a[0] + c.b[0] + 1) / 2, (c.a[1] + c.b[1] + 1) / 2, 2.6, 0, 2 * Math.PI); gx.stroke(); }   // 꼭짓점으로만 이어지는 자리
    // 점령 거점
    for (const hq of D.held) { sq(hq.x + 1, hq.y + 1, 7, C['c-t2'], 2.4); gx.fillStyle = C['c-t2']; gx.fillRect(hq.x, hq.y, 3, 3); }
    // 본부
    sq(D.hq.plain[0] + 1, D.hq.plain[1] + 1, 7, C['c-hq'], 2); gx.fillStyle = C['c-hq']; gx.fillRect(D.hq.plain[0], D.hq.plain[1], 3, 3);
    sq(D.hq.wild[0] + 1, D.hq.wild[1] + 1, 7, C['c-wild'], 1.6, [5, 4]); gx.fillStyle = C['c-wild']; gx.globalAlpha = 0.5; gx.fillRect(D.hq.wild[0], D.hq.wild[1], 3, 3); gx.globalAlpha = 1;
    if (PLAN.w) { sq(PLAN.w[0] + 1, PLAN.w[1] + 1, 7, C['c-wild'], 3.2); gx.fillStyle = C['c-wild']; gx.fillRect(PLAN.w[0], PLAN.w[1], 3, 3); }
    // 새 경로
    for (const [x, y] of PLAN.flags) { sq(x, y, 3, C['c-new'], 2.2); dot(x, y, C['c-new']); }
    if (planKey === 'main' && stepCur) { const p = stepCur, sz = p.op === 'hq' ? 3 : 1; gx.strokeStyle = p.op === 'remove' || p.op === 'sweep' ? C.bad : p.op === 'build' ? C.ok : C['c-wild']; gx.lineWidth = 3 / s; gx.beginPath(); gx.arc(p.x + sz / 2, p.y + sz / 2, sz / 2 + 4, 0, Math.PI * 2); gx.stroke(); }
    if (view.mark) { gx.strokeStyle = C['c-pick']; gx.lineWidth = 3 / s; gx.strokeRect(view.mark.x, view.mark.y, 1, 1); gx.beginPath(); gx.arc(view.mark.x + 0.5, view.mark.y + 0.5, 3, 0, Math.PI * 2); gx.stroke(); }
    // 글자
    gx.setTransform(dpr, 0, 0, dpr, 0, 0); gx.textAlign = 'center'; gx.textBaseline = 'middle';
    const label = (x, y, t, col) => { const p = { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; gx.font = '600 12px "IBM Plex Sans KR", sans-serif'; const tw = gx.measureText(t).width + 8; gx.fillStyle = C.bg; gx.globalAlpha = 0.85; gx.fillRect(p.x - tw / 2, p.y - 9, tw, 18); gx.globalAlpha = 1; gx.fillStyle = col; gx.fillText(t, p.x, p.y); };
    for (const hq of D.held) label(hq.x + 1.5, hq.y + 10, hq.name + ((D.retake || []).some(r => r.x === hq.x && r.y === hq.y) ? ' (되찾기)' : ''), C['c-t2']);
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
