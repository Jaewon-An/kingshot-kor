(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const canvas = byId('map');
  const ctx = canvas.getContext('2d');
  const snapshots = new Map();
  const camera = { x: 0, y: 0, scale: 1 };
  const groups = {
    all: ['전체 좌표'], changed: ['v3와 다른 좌표'], retained: ['유지 확인', 'ok'], unrecorded: ['v3 미기록', 'c-fflag'],
    absent: ['기존 위치에 KOR 깃발 없음', 'bad'], unchecked: ['재확인 전', 'muted']
  };
  let active, entries = [], visible = [], selected = null, terrain = null, kinds;
  let comparison = false, group = 'all';
  let drag = null, autoFit = true;
  const G = window.KSCore.G;
  const coord = f => `X:${f.x} Y:${f.y}`;
  const positionKey = f => f.y * G + f.x;
  const gamePoint = f => ({
    x: (f.x - f.y) * Math.SQRT1_2,
    y: -(f.x + f.y + 1) * Math.SQRT1_2
  });

  async function read(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  function normalize(record) {
    const seen = new Set();
    for (const flag of [...record.flags, ...(record.checkedAbsent || [])]) {
      if (![flag.x, flag.y].every(v => Number.isInteger(v) && v >= 0 && v < G)) throw new Error('좌표 범위 오류');
      const key = positionKey(flag);
      if (seen.has(key)) throw new Error('중복 좌표');
      seen.add(key);
    }
    if (record.total != null && (!Number.isInteger(record.total) || record.total < record.flags.length || (record.complete && record.total !== record.flags.length))) {
      throw new Error('깃발 총계 오류');
    }
    return record;
  }

  function compare(current, past) {
    const previous = new Set(past.flags.map(positionKey));
    const present = new Set(current.flags.map(positionKey));
    const absent = new Set((current.checkedAbsent || []).map(positionKey));
    const result = current.flags.map(flag => ({
      ...flag, state: previous.has(positionKey(flag)) ? 'retained' : 'unrecorded'
    }));
    for (const flag of past.flags) {
      const key = positionKey(flag);
      if (!present.has(key)) {
        result.push({ ...flag, state: current.complete || absent.has(key) ? 'absent' : 'unchecked' });
      }
    }
    return result;
  }

  function updateLink() {
    const url = new URL(location.href);
    url.searchParams.set('view', byId('survey').value);
    if (comparison && group !== 'all') url.searchParams.set('group', group);
    else url.searchParams.delete('group');
    history.replaceState(null, '', url);
  }

  function inGroup(flag, key) {
    if (key === 'changed') return flag.state === 'unrecorded' || flag.state === 'absent';
    return key === 'all' || flag.state === key;
  }

  function showGroups() {
    const buttons = Object.entries(groups).map(([key, [label]]) => {
      const button = document.createElement('button');
      button.className = 'btn';
      button.type = 'button';
      button.dataset.group = key;
      button.setAttribute('aria-pressed', String(group === key));
      const count = entries.filter(f => inGroup(f, key)).length;
      button.textContent = `${label} ${count}개`;
      if (groups[key][1]) {
        const mark = document.createElement('i');
        mark.className = 'swatch ' + key;
        mark.setAttribute('aria-hidden', 'true');
        button.prepend(mark);
      }
      return button;
    });
    byId('groups').replaceChildren(...buttons);
  }

  function observedTime(value) {
    if (!value) return '';
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) || !Number.isFinite(Date.parse(value))) return value;
    const parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(new Date(value));
    return parts + ' (한국 시간)';
  }

  function showEvidence(currentView) {
    const link = byId('count-evidence');
    link.hidden = !currentView || !active.countEvidence || active.total == null;
    const time = observedTime(active.countObservedAt);
    link.textContent = time ? `완공 ${active.total}개 · ${time}` : '완공 총계 화면';
    if (active.countEvidence) link.href = active.countEvidence;
    const earlier = active.earlierCount;
    const initialLink = byId('earlier-count');
    initialLink.hidden = !currentView || !earlier;
    if (earlier) {
      initialLink.href = earlier.evidence;
      initialLink.textContent = `완공 ${earlier.total}개 · ${observedTime(earlier.observedAt)}`;
    }
    const buildings = active.construction || [];
    const completed = active.completedDuringSurvey || [];
    byId('construction').hidden = !currentView || !(buildings.length + completed.length);
    byId('construction-title').textContent = completed.length ? '조사 중 확인한 건설' : '건설 중인 깃발';
    byId('construction-list').replaceChildren(...buildings.map(f => {
      const li = document.createElement('li');
      li.textContent = [coord(f), f.status, observedTime(f.observedAt)].filter(Boolean).join(' · ');
      if (f.source?.startsWith('/banner/v4/evidence/')) {
        const proof = document.createElement('a');
        proof.href = f.source;
        proof.textContent = '확인 화면';
        li.append(' · ', proof);
      }
      return li;
    }), ...completed.map(f => {
      const li = document.createElement('li');
      const building = document.createElement('a');
      building.href = f.buildingEvidence;
      building.textContent = `건설 중 · ${observedTime(f.buildingAt)}`;
      const complete = document.createElement('a');
      complete.href = f.completeEvidence;
      complete.textContent = `완공 · ${observedTime(f.completeAt)}`;
      li.append(coord(f), '　', building, ' → ', complete);
      return li;
    }));
  }

  async function load() {
    const [current, previous] = await Promise.allSettled([
      read('/banner/v4/data.json').then(normalize),
      read('/banner/v4/baseline.json').then(d => normalize({
        kingdom: 2382, alliance: 'KOR', surveyedAt: d.surveyedAt, total: d.total,
        flags: d.flags.map(([x, y]) => ({ x, y })), complete: false,
        sourceCommit: d.sourceCommit,
        source: `v3 조사 기록 ${d.sourceCommit.slice(0, 7)}에 저장된 당시 게임 총계와 깃발 좌표입니다.`
      }))
    ]);
    const select = byId('survey');
    if (current.status === 'fulfilled' && previous.status === 'fulfilled') {
      select.add(new Option('v3 기준 변경 내역', 'compare'));
    }
    if (current.status === 'fulfilled') {
      snapshots.set('current', current.value);
      select.add(new Option(`${current.value.surveyedAt} · 최근 조사`, 'current'));
    }
    if (previous.status === 'fulfilled') {
      snapshots.set('previous', previous.value);
      select.add(new Option(`${previous.value.surveyedAt} · 이전 기록`, 'previous'));
    }
    if (!snapshots.size) {
      byId('notice').textContent = '조사 기록을 불러오지 못했습니다. 새로고침해 주세요.';
      byId('notice').classList.add('err');
      return;
    }
    const params = new URLSearchParams(location.search);
    if ([...select.options].some(option => option.value === params.get('view'))) select.value = params.get('view');
    if (select.value === 'compare' && Object.hasOwn(groups, params.get('group'))) group = params.get('group');
    select.addEventListener('change', () => { group = 'all'; showSurvey(); updateLink(); });
    byId('history').hidden = false;
    showSurvey();
    try {
      kinds = (await window.KSPlan.loadMap()).kind;
      buildTerrain();
      draw();
    } catch {
      byId('terrain-note').textContent = '지형을 불러오지 못해 깃발 위치만 표시합니다.';
    }
  }

  function showSurvey() {
    const key = byId('survey').value;
    comparison = key === 'compare';
    const latest = snapshots.get('current');
    const previous = snapshots.get('previous');
    active = comparison ? latest : snapshots.get(key);
    entries = comparison ? compare(latest, previous) : active.flags;
    const missing = active.total == null ? null : active.total - active.flags.length;
    byId('date').textContent = comparison ? `v3 ${previous.surveyedAt} → v4 ${latest.surveyedAt}` : `${active.surveyedAt} 기준`;
    byId('kingdom').textContent = `KINGSHOT · ${active.kingdom} ${active.alliance}`;
    byId('facts').hidden = false;
    byId('total').textContent = active.total == null ? '미확인' : `${active.total}개`;
    byId('located').textContent = `${active.flags.length}개`;
    byId('missing-fact').hidden = missing == null;
    byId('missing').textContent = missing == null ? '' : `${missing}개`;
    const hasDelta = comparison && latest.total != null && previous.total != null;
    byId('delta-fact').hidden = !hasDelta;
    if (hasDelta) {
      const diff = latest.total - previous.total;
      const change = diff > 0 ? `+${diff}` : String(diff);
      byId('delta').textContent = `${previous.total} → ${latest.total} (${change}개)`;
    }
    byId('groups').hidden = !comparison;
    byId('state-title').hidden = !comparison;
    byId('marker-key').hidden = comparison;
    let status;
    if (comparison) {
      const pastMissing = previous.total - previous.flags.length;
      status = `비교 기준은 ${previous.surveyedAt}의 v3 조사 기록(${previous.sourceCommit.slice(0, 7)})입니다. 당시 깃발 ${previous.total}개 중 ${previous.flags.length}개의 좌표를 기록했습니다.`;
      if (pastMissing) status += ` 당시 미확인 좌표가 ${pastMissing}개여서 ‘v3 미기록’ 깃발의 설치 시점은 알 수 없습니다.`;
      if (!active.complete) status += ' ‘재확인 전’은 현재 조사에서 아직 확인하지 못한 이전 좌표입니다.';
      showGroups();
    } else if (key === 'previous') {
      status = `${active.surveyedAt} 기준의 보관 기록입니다.`;
      if (!latest) status += ' 최근 조사 자료를 불러오지 못했습니다.';
      else if (!latest.flags.length) status += ` ${latest.surveyedAt} 조사에 등록된 완공 깃발 좌표는 0개입니다.`;
    } else if (active.complete && (missing == null || missing === 0)) {
      status = '게임에서 집계한 전체 깃발의 좌표를 확인했습니다.';
    } else {
      status = active.flags.length ? '일부 완공 깃발의 좌표를 확인했습니다.' : '이번 조사에서 확인한 개별 완공 깃발 좌표가 없습니다.';
      if (!snapshots.has('previous')) status += ' 이전 기록을 불러오지 못했습니다.';
    }
    byId('notice').textContent = status;
    byId('source').textContent = active.source || '';
    showEvidence(key !== 'previous');
    byId('query').value = '';
    byId('results').hidden = !entries.length;
    byId('number-title').hidden = !entries.some(f => f.number != null);
    filter();
  }

  function matches(flag, query) {
    if (!query) return true;
    const numbers = query.match(/\d+/g) || [];
    if (/^#|번호/.test(query)) return numbers.length === 1 && flag.number === Number(numbers[0]);
    if (numbers.length === 2) return flag.x === Number(numbers[0]) && flag.y === Number(numbers[1]);
    if (numbers.length !== 1) return false;
    const n = Number(numbers[0]);
    if (/^x/i.test(query)) return flag.x === n;
    if (/^y/i.test(query)) return flag.y === n;
    return flag.x === n || flag.y === n || flag.number === n;
  }

  function filter() {
    const query = byId('query').value.trim();
    visible = entries.filter(f => (!comparison || inGroup(f, group)) && matches(f, query));
    byId('matches').textContent = query || (comparison && group !== 'all') ? `표시 좌표 ${visible.length}개 / 전체 ${entries.length}개` : `좌표 ${entries.length}개`;
    const fragment = document.createDocumentFragment();
    for (const [index, f] of visible.entries()) {
      const row = document.createElement('tr');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'coord';
      button.textContent = coord(f);
      button.dataset.index = index;
      button.setAttribute('aria-pressed', 'false');
      row.insertCell().append(button);
      if (comparison) {
        const cell = row.insertCell();
        cell.className = 'state';
        cell.textContent = groups[f.state][0];
      }
      if (!byId('number-title').hidden) row.insertCell().textContent = f.number ?? '—';
      fragment.append(row);
    }
    byId('rows').replaceChildren(fragment);
    selected = null;
    byId('selection').textContent = '';
    fit();
  }

  function pick(index, center) {
    const f = visible[index];
    if (!f) return;
    const rows = byId('rows').rows;
    if (selected != null) {
      rows[selected].classList.remove('selected');
      rows[selected].querySelector('button').setAttribute('aria-pressed', 'false');
    }
    selected = index;
    rows[index].classList.add('selected');
    rows[index].querySelector('button').setAttribute('aria-pressed', 'true');
    const label = comparison ? groups[f.state][0] : f.number != null ? `깃발 ${f.number}번` : 'KOR 깃발';
    byId('selection').textContent = `${label} · ${coord(f)}`;
    if (center) {
      Object.assign(camera, gamePoint(f));
      camera.scale = Math.max(camera.scale, 6);
      autoFit = false;
    }
    draw();
  }

  function fit() {
    autoFit = true;
    if (visible.length && canvas.clientWidth && canvas.clientHeight) {
      const points = visible.map(gamePoint);
      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      camera.x = (x0 + x1) / 2;
      camera.y = (y0 + y1) / 2;
      camera.scale = Math.min(18, (canvas.clientWidth - 32) / (x1 - x0 + 12), (canvas.clientHeight - 32) / (y1 - y0 + 12));
    }
    draw();
  }

  const color = name => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
  function buildTerrain() {
    if (!kinds) return;
    terrain = document.createElement('canvas');
    terrain.width = terrain.height = G;
    const g = terrain.getContext('2d'), im = g.createImageData(G, G);
    const colors = ['m-ground', 'm-mount', 'm-lake', 'm-node', 'm-node', 'm-node', 'm-node', 'm-struct', 'm-struct', 'm-fertile']
      .map(name => parseInt(color(name).slice(1), 16));
    const [lo, hi] = window.KSCore.FERTILE;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const i = y * G + x;
      const value = colors[kinds[i] || (x >= lo && x <= hi && y >= lo && y <= hi ? 9 : 0)];
      im.data[i * 4] = value >> 16;
      im.data[i * 4 + 1] = (value >> 8) & 255;
      im.data[i * 4 + 2] = value & 255;
      im.data[i * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }

  function screen(point) {
    return { x: canvas.clientWidth / 2 + (point.x - camera.x) * camera.scale,
      y: canvas.clientHeight / 2 + (point.y - camera.y) * camera.scale };
  }

  function draw() {
    if (!ctx || !canvas.clientWidth) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const k = camera.scale * Math.SQRT1_2;
    ctx.save();
    ctx.transform(k, -k, -k, -k, w / 2 - camera.x * camera.scale, h / 2 - camera.y * camera.scale);
    ctx.imageSmoothingEnabled = false;
    if (terrain) ctx.drawImage(terrain, 0, 0);
    ctx.fillStyle = color('c-terr');
    ctx.globalAlpha = .22;
    for (const f of visible) {
      if (f.state !== 'unchecked' && f.state !== 'absent') ctx.fillRect(f.x - 3, f.y - 3, 7, 7);
    }
    ctx.restore();
    const colors = Object.fromEntries(Object.entries(groups).filter(([, value]) => value[1]).map(([key, value]) => [key, color(value[1])]));
    const normal = color('c-banner');
    const radius = Math.min(5, Math.max(2.5, camera.scale * .65));
    for (const f of visible) {
      const p = screen(gamePoint(f));
      ctx.fillStyle = ctx.strokeStyle = colors[f.state] || normal;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (f.state === 'absent') {
        ctx.moveTo(p.x - radius, p.y - radius);
        ctx.lineTo(p.x + radius, p.y + radius);
        ctx.moveTo(p.x + radius, p.y - radius);
        ctx.lineTo(p.x - radius, p.y + radius);
        ctx.stroke();
      } else {
        ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI);
        if (f.state === 'unchecked') ctx.stroke();
        else ctx.fill();
      }
    }
    if (selected != null) {
      const p = screen(gamePoint(visible[selected]));
      ctx.strokeStyle = color('c-pick');
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  function zoom(factor) {
    camera.scale = Math.min(30, Math.max(.1, camera.scale * factor));
    autoFit = false;
    draw();
  }
  byId('groups').addEventListener('click', event => {
    const button = event.target.closest('button[data-group]');
    if (!button) return;
    group = button.dataset.group;
    for (const option of byId('groups').children) option.setAttribute('aria-pressed', String(group === option.dataset.group));
    filter();
    updateLink();
  });
  byId('query').addEventListener('input', filter);
  byId('rows').addEventListener('click', event => {
    const button = event.target.closest('.coord');
    if (button) pick(Number(button.dataset.index), true);
  });
  byId('zin').addEventListener('click', () => zoom(1.5));
  byId('zout').addEventListener('click', () => zoom(1 / 1.5));
  byId('fit').addEventListener('click', fit);
  canvas.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y, moved: false };
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || !e.isPrimary) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) < 4 && !drag.moved) return;
    drag.moved = true;
    autoFit = false;
    canvas.classList.add('drag');
    camera.x = drag.cx - dx / camera.scale;
    camera.y = drag.cy - dy / camera.scale;
    draw();
  });
  canvas.addEventListener('pointerup', e => {
    if (!drag || !e.isPrimary || drag.moved) return;
    const rect = canvas.getBoundingClientRect();
    let nearest, distance = 14;
    visible.forEach((f, i) => {
      const p = screen(gamePoint(f));
      const d = Math.hypot(e.clientX - rect.left - p.x, e.clientY - rect.top - p.y);
      if (d <= distance) { nearest = i; distance = d; }
    });
    if (nearest != null) pick(nearest, false);
  });
  canvas.addEventListener('lostpointercapture', () => {
    drag = null;
    canvas.classList.remove('drag');
  });
  new ResizeObserver(() => autoFit ? fit() : draw()).observe(canvas);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { buildTerrain(); draw(); });
  load();
})();
