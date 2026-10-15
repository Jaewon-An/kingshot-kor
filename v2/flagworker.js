/* /v2/admin "깃발 재배치 최적화"를 화면이 멈추지 않게 따로 계산하는 웹 워커.
 * 받는 것: { list: v2 배치, existing: 지금 깃발, opt }  돌려주는 것: { ok, r } 또는 { ok: false, error } */
self.window = self;   // mapdata.js가 window.KS_MAPDATA에 씀
importScripts('/mapdata.js', '/v2/core.js', '/v2/plan.js', '/v2/flagplan.js');
let mapPromise = null;
self.onmessage = async e => {
  try {
    if (!mapPromise) mapPromise = self.KSPlan.loadMap();
    const map = await mapPromise;
    const r = self.KSFlagPlan.optimize(map, e.data.list, e.data.existing, e.data.opt || {});
    const chk = self.KSPlan.check(map, r.objects, { rule: r.rule === 'edge' ? 'adjacent' : 'corner' });
    self.postMessage({ ok: true, r: { objects: r.objects, keep: r.keep, build: r.build, remove: r.remove, plan: r.plan, rule: r.rule, alt: r.alt || null, stats: r.stats, promoted: r.promoted || [], filled: r.filled ? { moved: r.filled.moved, before: r.filled.before, after: r.filled.after } : null, errs: chk.errs } });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
