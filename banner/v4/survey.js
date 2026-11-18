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
  let nodes = [], mapPromise, nodesPromise, sitesPromise, sites, simLoading, model;
  let priorSurvey = 'compare';
  let comparison = false, group = 'all';
  let drag = null, pinch = null, autoFit = true, frame = 0;
  let gesture = 0;
  const pointers = new Map();
  // 이보다 작은 배율에서는 깃발 한 칸이 3픽셀도 안 돼 끌어 놓는 자리가 부정확하고, 깃발이 빽빽해 지도를 옮길 틈이 없다.
  // 그래서 미리 고른 깃발만 끌고, 다른 깃발 위에서 끌면 지도를 옮긴다.
  const DRAG_SCALE = 3;
  const G = window.KSCore.G;
  const coord = f => `X:${f.x} Y:${f.y}`;
  const positionKey = f => f.y * G + f.x;
  const gamePoint = f => ({
    x: (f.x - f.y) * Math.SQRT1_2,
    y: -(f.x + f.y + 1) * Math.SQRT1_2
  });
  const clampScale = value => Math.min(30, Math.max(.1, value));
  const simulating = () => byId('survey').value === 'sim';
  const resources = window.KSResources.create(draw);
  const editor = window.KSBannerEditor.create({ onChange: draw, onLocate: focusPoint });
  const flagIcon = new Image();
  flagIcon.onload = draw;
  flagIcon.src = '/banner/v4/flag-icon.png';

  function prepareLayers() {
    if (!mapPromise) {
      mapPromise = window.KSPlan.loadMap().then(map => {
        kinds = map.kind;
        buildTerrain();
        draw();
        return map;
      }).catch(error => {
        mapPromise = null;
        byId('terrain-note').textContent = '지형을 불러오지 못했습니다.';
        throw error;
      });
    }
    if (!nodesPromise) {
      nodesPromise = window.KSResources.loadNodes().then(list => {
        nodes = list;
        byId('resource-legend').hidden = false;
        draw();
        return list;
      }).catch(error => {
        nodesPromise = null;
        byId('terrain-note').textContent = '자원지 위치를 불러오지 못했습니다.';
        throw error;
      });
    }
    return Promise.all([mapPromise, nodesPromise]);
  }

  // 본부·곰덫·거점과 조사된 다른 연맹 영토. 시뮬레이터 판정에 쓰고, 조사 지도에도 다른 연맹 영역을 그린다.
  function prepareSites() {
    if (!sitesPromise) {
      sitesPromise = read('/banner/v4/simulation-sites.json').then(data => {
        sites = data;
        byId('foreign-toggle').hidden = false;
        draw();
        return data;
      }).catch(error => {
        sitesPromise = null;
        throw error;
      });
    }
    return sitesPromise;
  }

  // 모든 기기가 같이 보는 모의 배치. 서버에 닿지 않으면 null이고, 편집기는 이 브라우저 저장분으로 시작한다.
  function readShared() {
    return fetch('/api/banner/v4/sim', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .catch(() => null);
  }

  function prepareSimulation() {
    if (model) return Promise.resolve();
    if (simLoading) return simLoading;
    const record = snapshots.get('current');
    simLoading = Promise.all([prepareLayers(), prepareSites(), readShared()])
      .then(([[map, nodes], sites, shared]) => {
        const ready = window.KSBannerSimulation.create({ flags: record.flags, capacity: record.capacity, nodes, map, sites });
        editor.init({ record, model: ready, shared });
        model = ready;
        if (simulating()) {
          if (autoFit && !drag) fit();
          else draw();
        }
      }).catch(() => editor.setError('시뮬레이션 자료를 불러오지 못했습니다. 새로고침해 주세요.'))
      .finally(() => { simLoading = null; });
    return simLoading;
  }

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
      if (current.value.complete) {
        select.add(new Option('깃발 재배치 시뮬레이터', 'sim'));
        byId('sim-enter').hidden = false;
      }
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
    priorSurvey = snapshots.has('current') && snapshots.has('previous') ? 'compare' : 'current';
    select.addEventListener('change', () => { group = 'all'; showSurvey(); updateLink(); });
    byId('sim-enter').addEventListener('click', () => {
      select.value = simulating() ? priorSurvey : 'sim';
      showSurvey();
      updateLink();
    });
    byId('history').hidden = false;
    showSurvey();
    await Promise.all([prepareLayers().catch(() => {}), prepareSites().catch(() => {})]);
  }

  function showSurvey() {
    byId('selection').classList.remove('err');
    const key = byId('survey').value;
    const simulation = simulating();
    comparison = key === 'compare';
    const latest = snapshots.get('current');
    const previous = snapshots.get('previous');
    active = comparison || simulation ? latest : snapshots.get(key);
    entries = comparison ? compare(latest, previous) : active.flags;
    byId('page-title').textContent = simulation ? '깃발 재배치 시뮬레이터' : 'KOR 연맹 깃발 조사';
    byId('sim-enter').textContent = simulation ? '조사 지도로 돌아가기' : '깃발 재배치 시뮬레이터';
    byId('sim-overview').hidden = byId('sim-panel').hidden = !simulation;
    byId('survey-panel').hidden = byId('survey-sources').hidden = simulation;
    byId('results').classList.toggle('sim-map', simulation);
    byId('sim-map-key').hidden = !simulation;
    byId('drag-hint').hidden = simulation || key === 'previous' || !latest?.complete;
    byId('area-key').textContent = simulation ? '모의 영토' : '조사 시점의 깃발 범위 7×7칸';
    if (!simulation) priorSurvey = key;
    const missing = active.total == null ? null : active.total - active.flags.length;
    byId('date').textContent = comparison ? `v3 ${previous.surveyedAt} → v4 ${latest.surveyedAt}` : `${active.surveyedAt} 기준`;
    byId('kingdom').textContent = `KINGSHOT · ${active.kingdom} ${active.alliance}`;
    byId('facts').hidden = simulation;
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
    let status;
    if (simulation) {
      status = '깃발을 놓은 뒤의 본부·거점 연결과 곰덫 방어 영토를 확인합니다. 게임에서 먼저 철거하면 연결이 끊기는 곳은 작업 내역에 표시합니다.';
    } else if (comparison) {
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
    showEvidence(key !== 'previous' && !simulation);
    byId('query').value = '';
    byId('results').hidden = !entries.length;
    byId('number-title').hidden = !entries.some(f => f.number != null);
    if (simulation) {
      selected = null;
      byId('selection').textContent = '';
      fit();
      prepareSimulation();
      if (model) editor.refresh();
    } else filter();
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
      focusPoint(f);
    } else {
      draw();
    }
  }

  function focusPoint(f) {
    Object.assign(camera, gamePoint(f));
    camera.scale = Math.max(camera.scale, 8);
    autoFit = false;
    draw();
  }

  function mapFlags() {
    if (simulating()) return model ? editor.flags : active?.flags || [];
    return visible;
  }

  function fit() {
    autoFit = true;
    const flags = mapFlags();
    if (flags.length && canvas.clientWidth && canvas.clientHeight) {
      const points = flags.map(gamePoint);
      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      camera.x = (x0 + x1) / 2;
      camera.y = (y0 + y1) / 2;
      camera.scale = Math.min(18, (canvas.clientWidth - 32) / (x1 - x0 + 12), (canvas.clientHeight - 32) / (y1 - y0 + 12));
    }
    draw();
  }

  // CSS 색은 그릴 때마다 다시 읽지 않는다. 테마가 바뀌면 비운다.
  const palette = new Map();
  function color(name) {
    if (!palette.has(name)) palette.set(name, getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim());
    return palette.get(name);
  }
  const rgb = name => {
    const value = parseInt(color(name).slice(1), 16);
    return [value >> 16, (value >> 8) & 255, value & 255];
  };

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

  // 깃발·본부 영토를 하나로 합친 그림. 겹친 곳이 더 진하게 칠해지지 않는다. 배치가 바뀔 때만 다시 만든다.
  let territoryLayer = null;
  function territoryCanvas(flags, hqs) {
    const tint = color('c-terr');
    if (territoryLayer?.flags === flags && territoryLayer.hqs === hqs && territoryLayer.tint === tint) return territoryLayer;
    const squares = (hqs || []).map(h => [h.x - 6, h.y - 6, 15]);
    for (const f of flags) if (f.state !== 'unchecked' && f.state !== 'absent') squares.push([f.x - 3, f.y - 3, 7]);
    territoryLayer = { flags, hqs, tint, canvas: null };
    if (!squares.length) return territoryLayer;
    let x0 = G, y0 = G, x1 = 0, y1 = 0;
    for (const [x, y, w] of squares) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + w);
    }
    const layer = document.createElement('canvas');
    layer.width = x1 - x0;
    layer.height = y1 - y0;
    const g = layer.getContext('2d');
    g.fillStyle = tint;
    for (const [x, y, w] of squares) g.fillRect(x - x0, y - y0, w, w);
    Object.assign(territoryLayer, { canvas: layer, x0, y0 });
    return territoryLayer;
  }

  // 조사된 다른 연맹 영토([y, x0, x1] 줄). v3와 같은 색으로 칠한다.
  let foreignLayer = null;
  function foreignCanvas() {
    if (!sites?.foreign?.length) return null;
    const tint = color('c-oth');
    if (foreignLayer?.tint === tint) return foreignLayer;
    let x0 = G, y0 = G, x1 = 0, y1 = 0;
    for (const [y, a, b] of sites.foreign) {
      x0 = Math.min(x0, a); x1 = Math.max(x1, b);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const layer = document.createElement('canvas');
    layer.width = x1 - x0 + 1;
    layer.height = y1 - y0 + 1;
    const g = layer.getContext('2d');
    g.fillStyle = tint;
    for (const [y, a, b] of sites.foreign) g.fillRect(a - x0, y - y0, b - a + 1, 1);
    foreignLayer = { tint, canvas: layer, x0, y0 };
    return foreignLayer;
  }

  // 옮기거나 지을 수 있는 칸(편집기의 빠른 판정 결과)을 칸 단위 그림으로 만든다.
  let targetLayer = null;
  function targetCanvas(targets) {
    if (!targets?.count) return null;
    const tint = color('ok');
    if (targetLayer?.source === targets && targetLayer.tint === tint) return targetLayer.canvas;
    const layer = document.createElement('canvas');
    layer.width = targets.w;
    layer.height = targets.h;
    const g = layer.getContext('2d'), im = g.createImageData(targets.w, targets.h);
    const [r, gr, b] = rgb('ok');
    targets.mask.forEach((on, i) => {
      if (!on) return;
      im.data[i * 4] = r;
      im.data[i * 4 + 1] = gr;
      im.data[i * 4 + 2] = b;
      im.data[i * 4 + 3] = 255;
    });
    g.putImageData(im, 0, 0);
    targetLayer = { source: targets, tint, canvas: layer };
    return layer;
  }

  const inTargets = (targets, p) => Boolean(targets?.count) && p.x >= targets.x0 && p.y >= targets.y0
    && p.x < targets.x0 + targets.w && p.y < targets.y0 + targets.h && targets.mask[(p.y - targets.y0) * targets.w + p.x - targets.x0] === 1;

  function screen(point) {
    return { x: canvas.clientWidth / 2 + (point.x - camera.x) * camera.scale,
      y: canvas.clientHeight / 2 + (point.y - camera.y) * camera.scale };
  }

  function mapCell(px, py) {
    const u = camera.x + (px - canvas.clientWidth / 2) / camera.scale;
    const v = camera.y + (py - canvas.clientHeight / 2) / camera.scale;
    return { x: Math.floor((u-v) * Math.SQRT1_2), y: Math.floor((-u-v) * Math.SQRT1_2) };
  }

  function eventLocation(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    return { x, y, cell: mapCell(x, y) };
  }

  function nearestFlag(point, flags, radius) {
    let nearest = -1, distance = radius;
    flags.forEach((flag, i) => {
      const p = screen(gamePoint(flag));
      const d = Math.hypot(point.x - p.x, point.y - p.y);
      if (d <= distance) { nearest = i; distance = d; }
    });
    return nearest;
  }

  function iconSize() {
    return Math.min(32, Math.max(10, 5 + camera.scale * 1.8));
  }

  function drawFlag(p, size) {
    if (flagIcon.naturalWidth) {
      const height = size * flagIcon.naturalHeight / flagIcon.naturalWidth;
      ctx.drawImage(flagIcon, p.x-size/2, p.y-height/2, size, height);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size*.28, 0, 2*Math.PI);
      ctx.fill();
    }
  }

  // 칸 cell을 중심으로 한 변 2×half칸 정사각형. 게임 시점에서는 마름모로 보인다.
  function drawArea(cell, half, tint, fillAlpha, lineWidth) {
    const p = screen(gamePoint(cell));
    const radius = half * camera.scale * Math.SQRT2;
    const dash = Math.max(1.5, Math.min(7, 1.3 * camera.scale));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p.x,p.y-radius); ctx.lineTo(p.x+radius,p.y);
    ctx.lineTo(p.x,p.y+radius); ctx.lineTo(p.x-radius,p.y); ctx.closePath();
    if (fillAlpha) {
      ctx.fillStyle = tint;
      ctx.globalAlpha = fillAlpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = tint;
    ctx.setLineDash([dash, dash*.75]);
    ctx.stroke();
    ctx.restore();
  }

  function drawFootprint(flag, tint, preview) {
    drawArea(flag, 3.5, tint, preview ? .16 : .08, preview ? 2.5 : 2);
  }

  function drawCross(p, radius) {
    ctx.beginPath();
    ctx.moveTo(p.x-radius, p.y-radius); ctx.lineTo(p.x+radius, p.y+radius);
    ctx.moveTo(p.x+radius, p.y-radius); ctx.lineTo(p.x-radius, p.y+radius);
    ctx.stroke();
  }

  // 거점 15×15 영역. 우리 영토가 네 변 가운데 한 칸이라도 닿으면 연결, 아니면 빨강으로 표시한다.
  function drawOutpostAreas() {
    const linked = color('m-struct'), cut = color('bad');
    for (const p of editor.stats.outposts) {
      drawArea({ x: p.x + 1, y: p.y + 1 }, 7.5, p.contacts > 0 ? linked : cut, .14, Math.max(1.4, Math.min(2.4, camera.scale * .35)));
    }
  }

  function drawOutpostNames() {
    if (camera.scale < 5) return;
    ctx.save();
    ctx.font = `600 ${Math.round(Math.min(13, 8 + camera.scale * .3))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = color('panel');
    for (const p of editor.stats.outposts) {
      const s = screen(gamePoint({ x: p.x + 1, y: p.y + 1 }));
      const y = s.y + Math.min(11, Math.max(4, camera.scale * .9)) + 3;
      ctx.fillStyle = p.contacts > 0 ? color('ink') : color('bad');
      const text = p.contacts > 0 ? p.name : p.name + ' · 연결 끊김';
      ctx.strokeText(text, s.x, y);
      ctx.fillText(text, s.x, y);
    }
    ctx.restore();
  }

  function drawLandmarks() {
    const size = Math.min(11, Math.max(4, camera.scale * .9));
    const outline = color('panel');
    ctx.save();
    for (const [markers, shape, tint] of [
      [editor.stats.outposts, 'square', color('m-struct')],
      [model.hqs, 'diamond', color('c-hq')], [model.traps, 'ring', color('c-t2')]
    ]) {
      for (const point of markers) {
        const p = screen(gamePoint({x: point.x+1, y: point.y+1}));
        ctx.save();
        ctx.translate(p.x,p.y);
        ctx.fillStyle = tint; ctx.strokeStyle = outline; ctx.lineWidth = 1.4;
        if (shape === 'ring') {
          ctx.beginPath(); ctx.arc(0,0,size,0,2*Math.PI); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(0,0,size*.4,0,2*Math.PI); ctx.stroke();
        } else {
          if (shape === 'diamond') ctx.rotate(Math.PI/4);
          ctx.fillRect(-size,-size,2*size,2*size);
          ctx.strokeRect(-size,-size,2*size,2*size);
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawEditMarkers(flags, removable) {
    const current = new Set(flags.map(positionKey));
    const size = Math.min(9, Math.max(4, camera.scale));
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = color('bad');
    for (const f of active.flags) if (!current.has(positionKey(f))) drawCross(screen(gamePoint(f)), size);
    if (removable?.size) {
      const radius = Math.max(6, iconSize() * .62);
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 2]);
      for (const f of flags) {
        if (!removable.has(positionKey(f))) continue;
        const p = screen(gamePoint(f));
        ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, 2*Math.PI); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (editor.from && !drag?.moved) {
      const p = screen(gamePoint(editor.from));
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color('c-pick');
      ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(9,size+3),0,2*Math.PI); ctx.stroke();
    }
    ctx.restore();
  }

  // 끌기·확대처럼 연달아 오는 입력은 화면 한 장에 한 번만 그린다.
  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }

  function draw() {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (!ctx || !canvas.clientWidth) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const k = camera.scale * Math.SQRT1_2;
    const flags = mapFlags(), editing = simulating() && Boolean(model);
    const moving = drag?.flag && drag.moved ? drag : null;
    const hint = editing ? editor.hints : null;
    const targets = moving ? moving.targets : hint?.targets;
    ctx.save();
    ctx.transform(k, -k, -k, -k, w / 2 - camera.x * camera.scale, h / 2 - camera.y * camera.scale);
    ctx.imageSmoothingEnabled = false;
    if (terrain) ctx.drawImage(terrain, 0, 0);
    const foreign = byId('foreign-areas').checked ? foreignCanvas() : null;
    if (foreign) {
      ctx.globalAlpha = .32;
      ctx.drawImage(foreign.canvas, foreign.x0, foreign.y0);
    }
    const territory = territoryCanvas(flags, editing ? model.hqs : null);
    if (territory.canvas) {
      ctx.globalAlpha = .22;
      ctx.drawImage(territory.canvas, territory.x0, territory.y0);
    }
    const overlay = targetCanvas(targets);
    if (overlay) {
      ctx.globalAlpha = .42;
      ctx.drawImage(overlay, targets.x0, targets.y0);
    }
    ctx.restore();
    if (editing) drawOutpostAreas();
    if (byId('resource-icons').checked) {
      resources.draw(ctx, nodes, camera, { emphasize: true, focusFlags: editing ? flags : entries,
        hqs: model?.hqs, allResources: byId('resource-scope').value === 'all', owned: editing ? editor.stats.owned : undefined,
        baselineOwned: editing ? editor.baseline.owned : undefined });
    }
    if (editing) drawLandmarks();
    if (editing) {
      const tint = color('ok');
      for (const f of flags) {
        if (editor.placed.has(positionKey(f)) && (!moving || f !== moving.flag)) drawFootprint(f, tint, false);
      }
    }
    const target = moving ? moving.target : editing ? editor.to : null;
    if (target) {
      const blocked = moving ? moving.problem : byId('sim-preview').classList.contains('err');
      drawFootprint(target, color(blocked ? 'bad' : 'accent'), true);
    }
    const colors = Object.fromEntries(Object.entries(groups).filter(([, value]) => value[1]).map(([key, value]) => [key, color(value[1])]));
    const normal = color('c-banner'), outline = color('panel');
    const size = iconSize(), radius = Math.max(3, size * .4);
    for (const f of flags) {
      const p = screen(gamePoint(f));
      if (p.x < -size || p.y < -size || p.x > w+size || p.y > h+size) continue;
      ctx.fillStyle = ctx.strokeStyle = colors[f.state] || normal;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (f.state === 'absent') {
        drawCross(p, radius);
      } else if (f.state === 'unchecked') {
        ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
      } else {
        // 곰덫 주변의 실측 깃발은 고정이라 흐리게 그린다.
        ctx.globalAlpha = moving?.flag === f ? .3 : editing && model.isProtected(f) ? .6 : 1;
        drawFlag(p, size);
        if (comparison) {
          ctx.beginPath();
          ctx.arc(p.x+size*.35, p.y+size*.32, Math.max(2.2,size*.15), 0, 2*Math.PI);
          ctx.fill(); ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    if (moving?.target) drawFlag(screen(gamePoint(moving.target)), size);
    if (editing) {
      drawOutpostNames();
      drawEditMarkers(flags, hint?.removable);
      if (!drag?.moved) {
        const label = [editor.from && coord(editor.from), editor.to && coord(editor.to)].filter(Boolean).join(' → ');
        const feedback = byId('sim-feedback');
        const warning = byId('sim-preview').classList.contains('err') ? byId('sim-preview').textContent : '';
        const error = warning || (feedback.classList.contains('err') ? feedback.textContent : '');
        const status = [label, error].filter(Boolean).join(' · ') || feedback.textContent;
        byId('selection').classList.toggle('err', Boolean(error));
        if (byId('selection').textContent !== status) byId('selection').textContent = status;
      }
    }
    if (!simulating() && selected != null) {
      const p = screen(gamePoint(visible[selected]));
      ctx.strokeStyle = color('c-pick');
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  function zoom(factor) {
    camera.scale = clampScale(camera.scale * factor);
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
  byId('resource-icons').addEventListener('change', () => {
    byId('resource-scope').disabled = !byId('resource-icons').checked;
    draw();
  });
  byId('resource-scope').addEventListener('change', draw);
  byId('foreign-areas').addEventListener('change', draw);
  function canDragFromView() {
    if (simulating()) return editor.tool === 'move';
    return snapshots.get('current')?.complete && byId('survey').value !== 'previous';
  }

  function pointerRadius(event) {
    return Math.max(event.pointerType === 'touch' ? 14 : 8, iconSize()*.55);
  }

  // 누른 곳에서 끌 수 있는 깃발. 고정 깃발이나 작은 배율의 다른 깃발 위에서는 지도를 옮긴다.
  function grabbableFlag(location, event) {
    if (!canDragFromView()) return null;
    const flags = mapFlags();
    const flag = flags[nearestFlag(location, flags, pointerRadius(event))];
    if (!flag || ['absent', 'unchecked'].includes(flag.state) || model?.isProtected(flag)) return null;
    const chosen = simulating() && editor.from?.x === flag.x && editor.from?.y === flag.y;
    return camera.scale >= DRAG_SCALE || chosen ? flag : null;
  }

  function dropCell(event, held) {
    const p = eventLocation(event);
    if (p.x < 0 || p.y < 0 || p.x >= canvas.clientWidth || p.y >= canvas.clientHeight) return null;
    return mapCell(p.x - held.grabX, p.y - held.grabY);
  }

  // 손떨림으로 몇 픽셀 움직인 클릭은 끌기가 아니다. 깃발은 놓을 칸까지 바뀌어야 끌기로 본다.
  function startsDrag(e, target) {
    if (drag.moved) return true;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < drag.slop) return false;
    return !drag.flag || !target || target.x !== drag.flag.x || target.y !== drag.flag.y;
  }

  function moveProblem(from, to, targets) {
    if (inTargets(targets, to)) return '';
    return model.issue(editor.flags, { type: 'move', from, to });
  }

  async function finishMove(source, destination, serial) {
    const entering = !simulating();
    if (entering) {
      byId('survey').value = 'sim';
      showSurvey();
      updateLink();
    }
    if (!model) await prepareSimulation();
    if (!model || !simulating() || serial !== gesture) return;
    const applied = editor.drop(source, destination);
    if (entering) focusPoint(applied ? destination : source);
  }

  function clearDrag() {
    const wasMoving = Boolean(drag?.flag && drag.moved);
    drag = null;
    canvas.classList.remove('drag');
    if (wasMoving) { byId('selection').classList.remove('err'); byId('selection').textContent = ''; draw(); }
  }

  function pinchState() {
    const [a, b] = [...pointers.values()];
    const rect = canvas.getBoundingClientRect();
    return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      x: (a.x + b.x) / 2 - rect.left - canvas.clientWidth / 2, y: (a.y + b.y) / 2 - rect.top - canvas.clientHeight / 2 };
  }

  // 두 손가락: 끌던 깃발은 내려놓지 않고 취소한다. 두 손가락 가운데의 지점을 붙잡은 채 확대·이동한다.
  function startPinch() {
    clearDrag();
    gesture++;
    const state = pinchState();
    pinch = { distance: state.distance, scale: camera.scale,
      anchorX: camera.x + state.x / camera.scale, anchorY: camera.y + state.y / camera.scale };
    autoFit = false;
  }

  function movePinch() {
    const state = pinchState();
    camera.scale = clampScale(pinch.scale * state.distance / pinch.distance);
    camera.x = pinch.anchorX - state.x / camera.scale;
    camera.y = pinch.anchorY - state.y / camera.scale;
    requestDraw();
  }

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      startPinch();
      return;
    }
    if (pinch) return;
    gesture++;
    const location = eventLocation(e);
    const flag = grabbableFlag(location, e);
    const center = flag && screen(gamePoint(flag));
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y, moved: false,
      slop: e.pointerType === 'mouse' ? 4 : 10,
      flag, target: flag, grabX: flag ? location.x-center.x : 0, grabY: flag ? location.y-center.y : 0 };
    if (flag && !model) prepareSimulation();
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (pointers.size >= 2) movePinch();
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const target = drag.flag ? dropCell(e, drag) : null;
    if (!startsDrag(e, target)) return;
    drag.moved = true;
    autoFit = false;
    canvas.classList.add('drag');
    if (drag.flag) {
      if (model && !drag.targets) drag.targets = editor.targetsFor(drag.flag);
      if (target && model && (drag.target?.x !== target.x || drag.target?.y !== target.y || drag.problem == null)) {
        drag.problem = moveProblem(drag.flag, target, drag.targets);
      }
      if (!target) drag.problem = '';
      drag.target = target;
      byId('selection').classList.toggle('err', Boolean(drag.problem));
      byId('selection').textContent = target ? [`${coord(drag.flag)} → ${coord(target)}`, drag.problem].filter(Boolean).join(' · ') : '지도 안에 놓으면 이동합니다.';
    } else {
      camera.x = drag.cx - dx / camera.scale;
      camera.y = drag.cy - dy / camera.scale;
    }
    requestDraw();
  });
  canvas.addEventListener('pointerup', e => {
    if (!pointers.delete(e.pointerId)) return;
    if (pinch) {
      if (!pointers.size) pinch = null;
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const location = eventLocation(e);
    const destination = drag.flag ? dropCell(e, drag) : null;
    if (startsDrag(e, destination)) {
      const from = drag.flag;
      clearDrag();
      if (from) {
        if (destination && (destination.x !== from.x || destination.y !== from.y)) finishMove(from, destination, gesture);
        else draw();
      }
      return;
    }
    drag = null;
    const flags = mapFlags();
    const nearest = nearestFlag(location, flags, simulating() ? pointerRadius(e) : Math.max(14, pointerRadius(e)));
    if (simulating()) {
      if (model) editor.mapPick(location.cell, flags[nearest] || null);
    } else if (nearest >= 0) {
      pick(nearest, false);
    } else if (byId('resource-icons').checked) {
      const cell = location.cell;
      const node = nodes.find(([,x,y]) => cell.x >= x && cell.x <= x+1 && cell.y >= y && cell.y <= y+1);
      if (node) byId('selection').textContent = `${['빵','목재','석재','철'][node[0]]} 자원지 · ${coord({x:node[1],y:node[2]})}`;
    }
  });
  function releasePointer(e) {
    pointers.delete(e.pointerId);
    if (pinch && !pointers.size) pinch = null;
    if (drag && drag.id === e.pointerId) clearDrag();
  }
  canvas.addEventListener('lostpointercapture', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (drag) {
      const id = drag.id;
      clearDrag();
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    } else if (simulating()) editor.clearPick();
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const p = eventLocation(e), scale = camera.scale;
    camera.scale = clampScale(scale * (e.deltaY < 0 ? 1.25 : .8));
    camera.x += (p.x - canvas.clientWidth/2) * (1/scale - 1/camera.scale);
    camera.y += (p.y - canvas.clientHeight/2) * (1/scale - 1/camera.scale);
    // 지도를 끄는 중에 휠을 돌리면 끌기 기준을 새 배율에 맞춘다(지도가 튀지 않게).
    if (drag && !drag.flag) Object.assign(drag, { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y });
    autoFit = false;
    requestDraw();
  }, { passive: false });
  new ResizeObserver(() => autoFit ? fit() : draw()).observe(canvas);
  function retheme() {
    palette.clear();
    buildTerrain();
    draw();
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  load();
})();
