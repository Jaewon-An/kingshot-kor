/* 실측 좌표를 복사해서 편집한다. 모의 작업 내역은 서버(/api/banner/v4/sim)로 모든 기기에 공유하고,
 * 서버에 닿지 않을 때를 위해 이 브라우저에도 남긴다(연결되면 올린다). */
(() => {
  'use strict';
  const API = '/api/banner/v4/sim';
  const byId = id => document.getElementById(id);
  const labels = { move: '이동', remove: '철거', add: '건설' };
  const tips = {
    move: '깃발을 누르면 옮길 수 있는 칸이 초록으로 보입니다. 칸을 누르거나 좌표를 입력하세요. 확대한 지도에서는 깃발을 끌어 놓아도 됩니다.',
    remove: '빨간 원이 지금 철거할 수 있는 깃발입니다. 지도에서 누르거나 좌표를 입력하세요.',
    add: '새 깃발을 지을 수 있는 칸이 초록으로 보입니다. 칸을 누르거나 좌표를 입력하세요.'
  };
  const names = ['빵', '목재', '석재', '철'];
  const formatter = new Intl.NumberFormat('ko-KR');
  const format = value => formatter.format(value);
  const signed = value => value > 0 ? '+' + format(value) : format(value);
  const xy = point => '(' + point.x + ', ' + point.y + ')';
  const same = (a, b) => a.x === b.x && a.y === b.y;
  const copy = point => ({ x: point.x, y: point.y });
  const validPoint = point => point && [point.x, point.y].every(n => Number.isInteger(n) && n >= 0 && n < 1200);
  const savedTime = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });

  function makeEl(tag, text, className) {
    const el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  function describe(op) {
    if (op.type === 'move') return '이동 ' + xy(op.from) + ' → ' + xy(op.to);
    return labels[op.type] + ' ' + xy(op.to || op.from);
  }

  function applyTo(flags, op) {
    const kept = op.type === 'add' ? flags : flags.filter(p => !same(p, op.from));
    return op.type === 'remove' ? kept : [...kept, copy(op.to)];
  }

  function operation(type, from, to) {
    if (!Object.hasOwn(labels, type)) return null;
    const result = { type };
    if (type !== 'add') {
      if (!validPoint(from)) return null;
      result.from = copy(from);
    }
    if (type !== 'remove') {
      if (!validPoint(to)) return null;
      result.to = copy(to);
    }
    return result;
  }

  // 서버에는 짧은 배열로 보낸다: ['move', 원X, 원Y, 새X, 새Y] · ['remove', X, Y] · ['add', X, Y]
  function pack(op) {
    if (op.type === 'move') return ['move', op.from.x, op.from.y, op.to.x, op.to.y];
    const p = op.from || op.to;
    return [op.type, p.x, p.y];
  }

  function unpack(item) {
    if (!Array.isArray(item)) return null;
    const [type, a, b, c, d] = item;
    if (type === 'move') return { type, from: { x: a, y: b }, to: { x: c, y: d } };
    return type === 'remove' ? { type, from: { x: a, y: b } } : { type, to: { x: a, y: b } };
  }

  function create({ onChange, onLocate }) {
    let model, record, beginning = [], flags = [], stats, steps = [];
    let baselineKeys, placed = new Set(), hintCache = null, targetCache = null;
    let tool = 'move', storageKey, basisText, basis;
    let ver = null, dirty = false, syncing = false, pulling = false, savedAt = null, localOK = true, staleNote = '';
    const form = byId('sim-form');
    const applyButton = byId('sim-apply');
    const feedback = byId('sim-feedback');
    const preview = byId('sim-preview');
    const storageStatus = byId('sim-storage');

    function inputs(side) {
      return [byId(side + '-x'), byId(side + '-y')];
    }

    function pointAt(side) {
      const pair = inputs(side);
      if (pair.some(el => !el.value.trim() || el.validity.badInput)) return null;
      const [x, y] = pair.map(el => el.valueAsNumber);
      return validPoint({ x, y }) ? { x, y } : null;
    }

    function setPoint(side, p) {
      const [x, y] = inputs(side);
      x.value = p?.x ?? '';
      y.value = p?.y ?? '';
    }

    function say(text, error = false) {
      feedback.textContent = text;
      feedback.classList.toggle('err', error);
    }

    function resourceChanges(before, after) {
      return names.map((name, i) => {
        const diff = after.counts[i] - before.counts[i];
        return diff ? name + ' ' + signed(diff) + '곳' : '';
      }).filter(Boolean);
    }

    function contactChanges(before, after) {
      return after.outposts.flatMap((p, i) => p.contacts === before.outposts[i].contacts ? []
        : [p.name + ' 접촉 ' + before.outposts[i].contacts + '→' + p.contacts + '칸']);
    }

    // 깃발 from을 옮길 수 있는 칸(from이 없으면 건설할 수 있는 칸). 같은 배치·같은 깃발이면 다시 계산하지 않는다.
    function targetsFor(from) {
      if (!model) return null;
      const signature = from ? from.x + ',' + from.y : 'add';
      if (targetCache?.flags !== flags || targetCache.signature !== signature) {
        targetCache = { flags, signature, value: model.targets(flags, from || null) };
      }
      return targetCache.value;
    }

    // 지도에 띄울 도움 표시: 이동·건설은 가능한 칸, 철거는 철거할 수 있는 깃발
    function hints() {
      if (!model) return null;
      const from = tool === 'move' ? pointAt('from') : null;
      const signature = tool + ':' + (from ? from.x + ',' + from.y : '');
      if (hintCache?.flags === flags && hintCache.signature === signature) return hintCache;
      let targets = null, removable = null;
      if (tool === 'move' && from && flags.some(p => same(p, from)) && !model.isProtected(from)) targets = targetsFor(from);
      else if (tool === 'add' && flags.length < record.capacity) targets = targetsFor(null);
      else if (tool === 'remove') removable = model.removable(flags);
      hintCache = { flags, signature, targets, removable };
      return hintCache;
    }

    function guide(from) {
      const hint = hints();
      if (tool === 'move' && from && hint?.targets) {
        return hint.targets.count ? '초록 칸으로 옮길 수 있습니다 · ' + format(hint.targets.count) + '칸'
          : '이 깃발은 본부·거점 연결과 곰덫 영토를 지키면서 옮길 수 있는 칸이 없습니다.';
      }
      if (tool === 'remove' && hint?.removable) return '지금 철거할 수 있는 깃발 ' + hint.removable.size + '기 (빨간 원)';
      if (tool === 'add' && hint?.targets) return '초록 칸에 지을 수 있습니다 · ' + format(hint.targets.count) + '칸';
      return tool === 'move' && from ? '이동할 칸을 선택하세요.' : '';
    }

    function checkForm() {
      applyButton.disabled = true;
      preview.textContent = '';
      preview.classList.remove('err');
      if (!model) return null;
      const from = pointAt('from'), to = pointAt('to');
      let error = '';
      const needed = tool === 'move' ? ['from', 'to'] : [tool === 'add' ? 'to' : 'from'];
      if (needed.some(side => inputs(side).some(el => el.validity.badInput || el.value && !el.validity.valid))) {
        error = '좌표는 0부터 1199까지의 정수로 입력하세요.';
      } else if (tool !== 'add' && from && !flags.some(p => same(p, from))) {
        error = '해당 좌표에 깃발이 없습니다.';
      } else if (tool !== 'add' && from && model.isProtected(from)) {
        error = '곰덫 주변의 기존 깃발은 고정되어 있습니다.';
      } else if (tool === 'add' && flags.length >= record.capacity) {
        // 칸을 고르기 전에는 안내만 한다. 방금 건설을 마친 직후 지도에 오류처럼 뜨지 않게 한다.
        if (!to) {
          preview.textContent = '깃발 ' + flags.length + ' / ' + record.capacity + '기입니다. 새로 지으려면 먼저 한 기를 철거하세요.';
          return null;
        }
        error = '깃발 상한에 도달했습니다. 먼저 한 기를 철거하세요.';
      }
      const op = operation(tool, from, to);
      if (!error && op) error = model.issue(flags, op);
      if (error) {
        preview.classList.add('err');
        preview.textContent = error;
        return null;
      }
      if (!op) {
        preview.textContent = guide(from);
        return null;
      }
      const proposed = applyTo(flags, op);
      const next = model.evaluate(proposed);
      const change = [...resourceChanges(stats, next), ...contactChanges(stats, next)];
      const note = op.to ? model.siteNote(op.to) : '';
      const warning = op.type === 'move' ? model.moveWarning(flags, op.from) : '';
      preview.textContent = ['적용 시 깃발 ' + proposed.length + '기', change.join(' · ') || '자원지와 거점 접촉 유지', warning, note].filter(Boolean).join(' · ');
      applyButton.disabled = false;
      return { op, proposed, next, warning };
    }

    function selectTool(next, clear) {
      tool = next;
      for (const el of byId('sim-tools').querySelectorAll('[data-tool]')) {
        el.setAttribute('aria-pressed', String(el.dataset.tool === tool));
      }
      byId('sim-from').hidden = tool === 'add';
      byId('sim-from').disabled = tool === 'add';
      byId('sim-to').hidden = tool === 'remove';
      byId('sim-to').disabled = tool === 'remove';
      byId('sim-help').textContent = tips[tool];
      applyButton.textContent = labels[tool] + ' 적용';
      if (clear) {
        setPoint('from', null);
        setPoint('to', null);
        say('');
        checkForm();
        onChange();
      }
    }

    function render() {
      // 깃발이 두 번 이동하거나 다른 깃발의 원래 자리로 들어간 경우에도 마지막 영역만 표시한다.
      const origins = new Map();
      for (const step of steps) {
        const source = step.from && step.from.y * 1200 + step.from.x;
        const target = step.to && step.to.y * 1200 + step.to.x;
        const origin = step.from ? (origins.get(source) ?? source) : (baselineKeys.has(target) ? target : -1);
        if (step.from) origins.delete(source);
        if (step.to && target !== origin) origins.set(target, origin);
      }
      placed = new Set(origins.keys());
      const connected = stats.outposts.filter(p => p.contacts > 0).length;
      byId('sim-counts').textContent = '깃발 ' + flags.length + ' / ' + record.capacity + '기 · 빈자리 ' + (record.capacity - flags.length) + '개';
      byId('sim-connections').textContent = '본부에 연결된 깃발 ' + stats.connectedFlags.size + '기 · 거점 ' + connected + ' / ' + stats.outposts.length + '곳 연결';
      byId('sim-resources').replaceChildren(...names.map((name, i) => {
        const card = makeEl('div', null, 'resource-stat');
        const icon = makeEl('i', null, 'res-icon res-' + i);
        icon.setAttribute('aria-hidden', 'true');
        const delta = stats.counts[i] - model.baseline.counts[i];
        const deltaText = makeEl('small', '실측 대비 ' + signed(delta) + '곳' + (delta ? ' · ' + signed(delta * 3600) + '/시간' : ''),
          delta > 0 ? 'gain' : delta < 0 ? 'loss' : '');
        card.append(icon, makeEl('strong', name + ' ' + stats.counts[i] + '곳'),
          makeEl('span', format(stats.counts[i] * 3600) + '/시간'), deltaText);
        return card;
      }));
      byId('sim-outposts').replaceChildren(...stats.outposts.map((p, i) => {
        const before = model.baseline.outposts[i].contacts;
        const count = (before === p.contacts ? '' : before + '→') + p.contacts;
        return makeEl('li', p.name + ' ' + xy(p) + ' · 접촉 ' + count + '칸');
      }));
      byId('sim-undo').disabled = byId('sim-reset').disabled = !steps.length;
      byId('sim-log-count').textContent = String(steps.length);
      const list = byId('sim-steps');
      list.replaceChildren(...steps.map((step, i) => {
        const li = makeEl('li'), button = makeEl('button', describe(step), 'coord');
        button.type = 'button';
        button.dataset.step = String(i);
        button.title = '지도에서 위치 보기';
        li.append(button);
        if (step.warning) li.append(makeEl('p', step.warning, 'hint'));
        return li;
      }).reverse());
      checkForm();
      onChange();
    }

    // 작업 목록을 실측 배치부터 다시 적용한다. 맞지 않는 단계에서 멈추고, 뺀 뒤쪽 단계 수를 돌려준다.
    function replay(list) {
      flags = [...beginning];
      steps = [];
      let dropped = 0;
      for (const [i, item] of list.entries()) {
        const op = item && operation(item.type, item.from, item.to);
        if (!op || model.issue(flags, op)) {
          dropped = list.length - i;
          break;
        }
        if (op.type === 'move') {
          const warning = model.moveWarning(flags, op.from);
          if (warning) op.warning = warning;
        }
        flags = applyTo(flags, op);
        steps.push(op);
      }
      stats = steps.length ? model.evaluate(flags) : model.baseline;
      return dropped;
    }

    function readLocal() {
      try {
        const raw = localStorage.getItem(storageKey);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return undefined;
      }
    }

    function saveLocal() {
      try {
        if (steps.length || dirty) localStorage.setItem(storageKey, JSON.stringify({ basis: basisText, steps, pending: dirty }));
        else localStorage.removeItem(storageKey);
        localOK = true;
      } catch {
        localOK = false;
      }
    }

    function showStatus(note = '') {
      let text;
      if (ver === null || dirty) {
        text = localOK ? '서버에 연결되지 않아 이 브라우저에만 저장했습니다. 연결되면 올립니다.'
          : '서버와 브라우저 저장소를 쓸 수 없어 이번 탭에서만 배치를 유지합니다.';
      } else {
        text = '모의 배치는 모든 기기에 공유됩니다' + (savedAt ? ' · 마지막 저장 ' + savedTime.format(new Date(savedAt)) : '') + '.';
      }
      storageStatus.textContent = [text, staleNote, note].filter(Boolean).join(' ');
    }

    // 다른 조사 기준으로 저장된 서버 기록을 덮어써도 되는가. 더 최근 조사의 기록이면 이 화면이 낡은 것이다.
    function canReplace(shared) {
      if (!shared || !Array.isArray(shared.steps) || !shared.steps.length || shared.basis === basis) return true;
      const theirs = Date.parse(shared.survey), ours = Date.parse(record.surveyedAt);
      return !Number.isFinite(theirs) || !Number.isFinite(ours) || theirs <= ours;
    }

    function adopt(list, message) {
      const dropped = replay(list.map(unpack));
      saveLocal();
      say(message + (dropped ? ' 맞지 않는 뒤쪽 ' + dropped + '단계는 빼고 표시합니다.' : ''));
      render();
    }

    async function flush() {
      if (syncing) return;
      syncing = true;
      let conflicts = 0;
      try {
        while (dirty && ver !== null && conflicts < 3) {
          dirty = false;
          let response, body;
          try {
            response = await fetch(API, {
              method: 'PUT', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ base: ver, basis, survey: record.surveyedAt, steps: steps.map(pack) })
            });
            body = await response.json();
          } catch {
            dirty = true;
            break;
          }
          if (response.status === 409) {
            conflicts++;
            ver = Number.isInteger(body.ver) ? body.ver : ver;
            if (body.basis === basis && Array.isArray(body.steps)) {
              savedAt = body.updated_at || null;
              dirty = false;
              adopt(body.steps, '다른 기기에서 먼저 바꾼 모의 배치를 따랐습니다. 방금 작업은 저장되지 않았으니 다시 해 주세요.');
            } else if (canReplace(body)) dirty = true;
            else {
              staleNote = '더 최근 조사 기준의 공유 배치가 있습니다. 새로고침하세요.';
              dirty = true;
              break;
            }
            continue;
          }
          if (!response.ok) {
            dirty = true;
            break;
          }
          ver = body.ver;
          savedAt = body.updated_at || null;
        }
      } finally {
        syncing = false;
        saveLocal();
        showStatus();
      }
    }

    function markDirty() {
      dirty = true;
      saveLocal();
      showStatus();
      flush();
    }

    async function pull() {
      if (!model || pulling || syncing) return;
      pulling = true;
      try {
        const response = await fetch(API, { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const shared = await response.json();
        ver = Number.isInteger(shared.ver) ? shared.ver : 0;
        staleNote = '';
        if (dirty) {
          pulling = false;
          return flush();
        }
        if (shared.basis === basis && Array.isArray(shared.steps)) {
          savedAt = shared.updated_at || savedAt;
          if (JSON.stringify(shared.steps) !== JSON.stringify(steps.map(pack))) {
            adopt(shared.steps, '다른 기기에서 바꾼 모의 배치를 불러왔습니다.');
          }
        } else if (!canReplace(shared)) {
          staleNote = '더 최근 조사 기준의 공유 배치가 있습니다. 새로고침하세요.';
        } else if (steps.length) {
          // 이 브라우저에만 있던 모의 배치를 처음 서버에 올린다.
          pulling = false;
          dirty = true;
          return flush();
        }
      } catch {
        // 연결이 안 되면 다음 확인 때 다시 시도한다.
      } finally {
        pulling = false;
        showStatus();
      }
    }

    function init(data) {
      record = data.record;
      model = data.model;
      beginning = record.flags.map(copy);
      const positions = beginning.map(p => p.y * 1200 + p.x).sort((a, b) => a - b);
      baselineKeys = new Set(positions);
      basisText = JSON.stringify([record.kingdom, record.alliance, record.surveyedAt, record.capacity, positions]);
      // 좌표·상한이 갱신되면 과거 모의를 다시 적용하지 않는다. 저장값 안에서도 원본 전체를 대조한다.
      let hash = 2166136261;
      for (let i = 0; i < basisText.length; i++) hash = Math.imul(hash ^ basisText.charCodeAt(i), 16777619);
      basis = (hash >>> 0).toString(16);
      storageKey = 'kingshot.banner.v4.sim.v1.' + basis;
      const shared = data.shared && typeof data.shared === 'object' ? data.shared : null;
      ver = shared ? (Number.isInteger(shared.ver) ? shared.ver : 0) : null;
      savedAt = shared?.updated_at || null;
      const local = readLocal();
      localOK = local !== undefined;
      const mine = local && local.basis === basisText && Array.isArray(local.steps) ? local : null;
      let list = [], message = '';
      if (mine && (mine.pending || !shared)) {
        list = mine.steps;
        dirty = Boolean(mine.pending);
        message = shared ? '이 브라우저에만 저장됐던 모의 작업을 서버에 올립니다.' : '서버에 연결되지 않아 이 브라우저에 저장된 모의 작업을 불러왔습니다.';
      } else if (shared && shared.basis === basis && Array.isArray(shared.steps)) {
        list = shared.steps.map(unpack);
        message = '공유된 모의 작업 ' + list.length + '단계를 불러왔습니다.';
      } else if (mine && mine.steps.length && canReplace(shared)) {
        list = mine.steps;
        dirty = true;
        message = '이 브라우저에만 저장됐던 모의 작업을 서버에 올립니다.';
      }
      if (shared && !canReplace(shared)) staleNote = '더 최근 조사 기준의 공유 배치가 있습니다. 새로고침하세요.';
      const dropped = replay(list);
      selectTool('move', false);
      if (list.length) say(message + (dropped ? ' 맞지 않는 뒤쪽 ' + dropped + '단계는 뺐습니다.' : ''));
      render();
      saveLocal();
      showStatus();
      if (dirty) flush();
      setInterval(() => { if (!document.hidden && !byId('sim-panel').hidden) pull(); }, 20000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && !byId('sim-panel').hidden) pull(); });
    }

    function commit() {
      const candidate = checkForm();
      if (!candidate) return false;
      const { op, proposed, next, warning } = candidate;
      if (warning) op.warning = warning;
      steps.push(op);
      flags = proposed;
      stats = next;
      setPoint('from', null);
      setPoint('to', null);
      say([describe(op) + ' 적용', warning].filter(Boolean).join(' · '));
      render();
      markDirty();
      return true;
    }

    function mapPick(point, flag) {
      if (!model) return;
      say('');
      if (tool === 'remove') setPoint('from', flag || point);
      else if (tool === 'move' && flag && (!pointAt('from') || same(point, flag))) {
        setPoint('from', flag);
        setPoint('to', null);
      } else setPoint('to', point);
      checkForm();
      onChange();
    }

    function drop(from, to) {
      if (!model) return false;
      selectTool('move', false);
      say('');
      if (!flags.some(p => same(p, from))) {
        setPoint('from', null);
        setPoint('to', null);
        checkForm();
        say('공유된 모의 배치에서는 ' + xy(from) + ' 깃발을 이미 옮기거나 철거했습니다.', true);
        onChange();
        return false;
      }
      setPoint('from', from);
      setPoint('to', to);
      if (commit()) return true;
      say(preview.textContent || '이 위치로 옮길 수 없습니다.', true);
      onChange();
      return false;
    }

    function undo() {
      if (!steps.length) return;
      const op = steps.pop();
      flags = steps.length ? applyTo(flags, { type: op.type === 'add' ? 'remove' : op.type === 'remove' ? 'add' : 'move',
        from: op.to, to: op.from }) : [...beginning];
      stats = steps.length ? model.evaluate(flags) : model.baseline;
      setPoint('from', null);
      setPoint('to', null);
      say(describe(op) + ' 취소');
      render();
      markDirty();
    }

    function reset() {
      if (!steps.length) return;
      if (!confirm('모든 기기에 공유된 모의 작업 ' + steps.length + '단계를 지우고 실측 배치로 돌아갈까요?')) return;
      steps = [];
      flags = [...beginning];
      stats = model.baseline;
      setPoint('from', null);
      setPoint('to', null);
      say('실측 배치로 돌아왔습니다.');
      render();
      markDirty();
    }

    function clearPick() {
      if (!model || (!pointAt('from') && !pointAt('to'))) return false;
      setPoint('from', null);
      setPoint('to', null);
      say('');
      checkForm();
      onChange();
      return true;
    }

    function setError(message) {
      applyButton.disabled = true;
      say(message, true);
    }

    byId('sim-tools').addEventListener('click', e => {
      const button = e.target.closest('[data-tool]');
      if (model && button && button.dataset.tool !== tool) selectTool(button.dataset.tool, true);
    });
    form.addEventListener('input', () => { say(''); checkForm(); onChange(); });
    form.addEventListener('submit', e => { e.preventDefault(); if (model) commit(); });
    byId('sim-undo').addEventListener('click', undo);
    byId('sim-reset').addEventListener('click', reset);
    byId('sim-steps').addEventListener('click', e => {
      const button = e.target.closest('[data-step]');
      if (button) {
        const op = steps[Number(button.dataset.step)];
        if (op) onLocate(op.to || op.from);
      }
    });
    // Ctrl+Z(⌘Z) 한 단계 취소. 좌표 입력칸에서는 브라우저의 글자 되돌리기를 그대로 둔다.
    document.addEventListener('keydown', e => {
      if (!model || byId('sim-panel').hidden || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      if (e.target.closest?.('input, select, textarea')) return;
      e.preventDefault();
      undo();
    });
    return {
      init, mapPick, drop, setError, clearPick, targetsFor,
      refresh: pull,
      get hints() { return hints(); },
      get placed() { return placed; },
      get flags() { return flags; }, get stats() { return stats; },
      get baseline() { return model?.baseline; }, get tool() { return tool; },
      get from() { return tool === 'add' ? null : pointAt('from'); },
      get to() { return tool === 'remove' ? null : pointAt('to'); }
    };
  }

  window.KSBannerEditor = { create };
})();
