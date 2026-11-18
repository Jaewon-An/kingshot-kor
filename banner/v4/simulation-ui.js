/* 실측 좌표를 복사해서 편집한다. 모의 작업 내역은 현재 브라우저에 저장한다. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const labels = { move: '이동', remove: '철거', add: '건설' };
  const tips = {
    move: '지도에서 깃발과 이동할 칸을 차례로 누르거나 좌표를 입력하세요. 깃발을 끌어 놓으면 바로 이동합니다.',
    remove: '지도에서 철거할 깃발을 누르거나 기존 깃발의 좌표를 입력하세요.',
    add: '지도에서 새 깃발을 지을 칸을 누르거나 새 위치의 좌표를 입력하세요.'
  };
  const names = ['빵', '목재', '석재', '철'];
  const formatter = new Intl.NumberFormat('ko-KR');
  const format = value => formatter.format(value);
  const signed = value => value > 0 ? '+' + format(value) : format(value);
  const xy = point => '(' + point.x + ', ' + point.y + ')';
  const same = (a, b) => a.x === b.x && a.y === b.y;
  const copy = point => ({ x: point.x, y: point.y });
  const validPoint = point => point && [point.x, point.y].every(n => Number.isInteger(n) && n >= 0 && n < 1200);

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

  function create({ onChange, onLocate }) {
    let model, record, beginning = [], flags = [], stats, steps = [];
    let tool = 'move', storageKey, basis;
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
        if (tool === 'move' && from) preview.textContent = '이동할 칸을 선택하세요.';
        return null;
      }
      const proposed = applyTo(flags, op);
      const next = model.evaluate(proposed);
      const change = [...resourceChanges(stats, next), ...contactChanges(stats, next)];
      const note = op.to ? model.siteNote(op.to) : '';
      preview.textContent = ['적용 시 깃발 ' + proposed.length + '기', change.join(' · ') || '자원지와 거점 접촉 유지', note].filter(Boolean).join(' · ');
      applyButton.disabled = false;
      return { op, proposed, next };
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
        return li;
      }).reverse());
      checkForm();
      onChange();
    }

    function save() {
      try {
        if (steps.length) localStorage.setItem(storageKey, JSON.stringify({ basis, steps }));
        else localStorage.removeItem(storageKey);
        storageStatus.textContent = '모의 배치는 이 브라우저에 자동 저장됩니다.';
      } catch {
        storageStatus.textContent = '브라우저 저장소를 쓸 수 없어 이번 탭에서만 배치를 유지합니다.';
      }
    }

    function restore() {
      let storage;
      try { storage = localStorage.getItem(storageKey); }
      catch {
        storageStatus.textContent = '브라우저 저장소를 읽을 수 없어 이번 탭에서 실측 배치로 시작합니다.';
        return;
      }
      flags = [...beginning];
      steps = [];
      stats = model.baseline;
      if (!storage) return;
      let saved;
      try { saved = JSON.parse(storage); }
      catch {
        storageStatus.textContent = '저장된 작업 내역을 읽을 수 없어 실측 배치를 표시합니다.';
        return;
      }
      if (saved?.basis !== basis || !Array.isArray(saved.steps)) return;
      for (const item of saved.steps) {
        const op = item && operation(item.type, item.from, item.to);
        if (!op || model.issue(flags, op)) {
          storageStatus.textContent = '저장된 작업 중 유효한 앞 ' + steps.length + '단계까지 복원했습니다.';
          break;
        }
        flags = applyTo(flags, op);
        steps.push(op);
      }
      if (steps.length) stats = model.evaluate(flags);
    }

    function init(data) {
      record = data.record;
      model = data.model;
      beginning = record.flags.map(copy);
      flags = [...beginning];
      stats = model.baseline;
      steps = [];
      const positions = flags.map(p => p.y * 1200 + p.x).sort((a, b) => a - b);
      basis = JSON.stringify([record.kingdom, record.alliance, record.surveyedAt, record.capacity, positions]);
      // 좌표·상한이 갱신되면 과거 모의를 다시 적용하지 않는다. 저장값 안에서도 원본 전체를 대조한다.
      let hash = 2166136261;
      for (let i = 0; i < basis.length; i++) hash = Math.imul(hash ^ basis.charCodeAt(i), 16777619);
      storageKey = 'kingshot.banner.v4.sim.v1.' + (hash >>> 0).toString(16);
      restore();
      selectTool('move', false);
      if (steps.length) say('저장된 모의 작업 ' + steps.length + '단계를 불러왔습니다.');
      render();
    }

    function commit() {
      const candidate = checkForm();
      if (!candidate) return false;
      const { op, proposed, next } = candidate;
      steps.push(op);
      flags = proposed;
      stats = next;
      save();
      setPoint('from', null);
      setPoint('to', null);
      say(describe(op) + ' 적용');
      render();
      return true;
    }

    function mapPick(point, flag) {
      if (!model) return;
      say('');
      if (tool === 'remove') setPoint('from', flag || point);
      else if (tool === 'move' && flag) {
        setPoint('from', flag);
        setPoint('to', null);
      } else setPoint('to', point);
      checkForm();
      onChange();
    }

    function drop(from, to) {
      if (!model) return false;
      selectTool('move', false);
      setPoint('from', from);
      setPoint('to', to);
      say('');
      if (commit()) return true;
      onChange();
      return false;
    }

    function undo() {
      if (!steps.length) return;
      const op = steps.pop();
      flags = applyTo(flags, { type: op.type === 'add' ? 'remove' : op.type === 'remove' ? 'add' : 'move',
        from: op.to, to: op.from });
      stats = steps.length ? model.evaluate(flags) : model.baseline;
      if (!steps.length) flags = [...beginning];
      setPoint('from', null);
      setPoint('to', null);
      save();
      say(describe(op) + ' 취소');
      render();
    }

    function reset() {
      if (!steps.length) return;
      steps = [];
      flags = [...beginning];
      stats = model.baseline;
      setPoint('from', null);
      setPoint('to', null);
      save();
      say('실측 배치로 돌아왔습니다.');
      render();
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
    window.addEventListener('storage', e => {
      if (!model || (e.key !== storageKey && e.key !== null)) return;
      restore();
      say('이 브라우저에 저장된 모의 배치를 불러왔습니다.');
      render();
    });
    return {
      init, mapPick, drop, setError,
      get flags() { return flags; }, get stats() { return stats; },
      get baseline() { return model?.baseline; }, get tool() { return tool; },
      get from() { return tool === 'add' ? null : pointAt('from'); },
      get to() { return tool === 'remove' ? null : pointAt('to'); }
    };
  }

  window.KSBannerEditor = { create };
})();
