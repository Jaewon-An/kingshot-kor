// Cloudflare Pages advanced-mode worker (works with dashboard drag-and-drop uploads).
// Static files are served from env.ASSETS; /api/* is handled here.
//
// Bindings (Pages project ▸ Settings):
//   LAYOUT_KV   KV namespace holding the published layouts (keys "current", "v2", "sgd", "sword", "castle" and "castle2") and the /banner/v2/ progress ("banner_v2_steps")
//   ADMIN_HASH  secret "salt$sha256hex(salt:id:password)" — made by `node tools/set-admin.mjs`
//   CASTLE_HASH the same for the /castle editor's own account (castle/admin.txt) — `node tools/set-admin.mjs --castle`
const TOKEN_TTL = 12 * 60 * 60 * 1000;
const MAX_LAYOUT_BYTES = 1024 * 1024;
// Published layouts: "/v1" (+ /v1/admin), "/v2" (+ /v2/admin, the new seats around the bear traps in the fertile land)
// "/sgd" (the SGD alliance's seats around its one bear trap), "/sword" (who goes where in Swordland Showdown — an object, not a list, so its own check)
// and "/castle" + "/castle2" (two separate plans of whose city sits on which tile around the King's Castle — also an object, saved on every drag).
// Each keeps one step of rollback in `prev`; the bundled file is served until the first publish.
const LAYOUTS = {
  '/api/layout': { key: 'current', prev: 'previous', stamp: 'updated_at', file: '/layouts/current.json' },
  '/api/v2/layout': { key: 'v2', prev: 'v2_previous', stamp: 'v2_updated_at', file: '/layouts/v2.json' },
  '/api/sgd/layout': { key: 'sgd', prev: 'sgd_previous', stamp: 'sgd_updated_at', file: '/layouts/sgd.json' },
  '/api/sword/layout': { key: 'sword', prev: 'sword_previous', stamp: 'sword_updated_at', file: '/layouts/sword.json', valid: d => validSword(d) },
  '/api/castle/layout': { key: 'castle', prev: 'castle_previous', stamp: 'castle_updated_at', file: '/layouts/castle.json', valid: d => validCastle(d), auth: ['CASTLE_HASH', 'ADMIN_HASH'] },
  '/api/castle2/layout': { key: 'castle2', prev: 'castle2_previous', stamp: 'castle2_updated_at', file: '/layouts/castle2.json', valid: d => validCastle(d), auth: ['CASTLE_HASH', 'ADMIN_HASH'] },
};
// Accounts: the admin account (ADMIN_HASH) publishes every layout; /castle and /castle2 can also be saved with their own account (CASTLE_HASH).
// POST /api/login { scope: 'castle' } takes either account (castle first). A token is signed with its account's hash,
// so a castle-account token only works on /castle and /castle2.
const ACCOUNTS = { '': ['ADMIN_HASH'], castle: ['CASTLE_HASH', 'ADMIN_HASH'] };
async function anyToken(env, names, request) {
  for (const n of names) if (await checkToken(env[n], request)) return true;
  return false;
}

// Shared progress of the /banner/v2/ work order (finished step keys like "build521,750"), so every phone/PC
// sees the same step. Anyone may update it (no login: R4s mark steps from their phones); `ver` counts writes and a
// PUT must name the ver it started from, so a stale screen can't overwrite newer progress (409 hands back the current state).
// The record keeps the last 100 changes in `log` (GET ?log=1) to put a wrong press back.
const STEPS = { '/api/banner/v2/steps': 'banner_v2_steps' };
const STEP_KEY = /^(build|remove|hq)\d{1,4},\d{1,4}$/;
const validStepKeys = keys => Array.isArray(keys) && keys.length <= 2000 && keys.every(k => typeof k === 'string' && STEP_KEY.test(k));
const device = ua => (/Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : 'other');

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
async function hmac(keyText, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function sameText(a, b) {  // constant-time compare
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });

// `hash` = the account's secret ("salt$sha256hex"), e.g. env.ADMIN_HASH
async function checkLogin(hash, id, pw) {
  const [salt, want] = String(hash || '').split('$');
  if (!salt || !want) return false;
  return sameText(await sha256(`${salt}:${id}:${pw}`), want);
}
async function makeToken(hash) {
  const exp = String(Date.now() + TOKEN_TTL);
  return `${exp}.${await hmac(hash, exp)}`;
}
async function checkToken(hash, request) {
  const m = /^Bearer (\d+)\.([0-9a-f]{64})$/.exec(request.headers.get('Authorization') || '');
  if (!m || !hash || Number(m[1]) < Date.now()) return false;
  return sameText(await hmac(hash, m[1]), m[2]);
}

// Only accept something that looks like a simulator layout.
function validLayout(list) {
  return Array.isArray(list) && list.length <= 5000 && list.every(o =>
    o && typeof o.name === 'string' && o.name.length <= 40 && Number.isFinite(o.tx) && Number.isFinite(o.ty) &&
    (o.nickname === undefined || (typeof o.nickname === 'string' && o.nickname.length <= 80)));
}
// /sword (성검 쟁탈 인원 배치): { legions: [{ name, side, memo?, notes?: { 자리 id: 메모 }, members: [{ n, at, then?, lead? }] }] } — sword/sword.js의 normalize()와 같은 모양
const SWORD_POST = /^[A-Za-z0-9]{0,16}$/;
function validSword(d) {
  return !!d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.legions) && d.legions.length >= 1 && d.legions.length <= 4 &&
    d.legions.every(l => l && typeof l.name === 'string' && l.name.length <= 30 && (l.side === 'blue' || l.side === 'red') &&
      (l.memo === undefined || (typeof l.memo === 'string' && l.memo.length <= 1000)) &&
      (l.notes === undefined || (!!l.notes && typeof l.notes === 'object' && !Array.isArray(l.notes) && Object.keys(l.notes).length <= 20 &&
        Object.entries(l.notes).every(([id, t]) => id && SWORD_POST.test(id) && typeof t === 'string' && t.length <= 100))) &&
      Array.isArray(l.members) && l.members.length <= 200 && l.members.every(m => m && typeof m.n === 'string' && m.n.trim() && m.n.length <= 40 &&
        typeof m.at === 'string' && SWORD_POST.test(m.at) && (m.then === undefined || (typeof m.then === 'string' && SWORD_POST.test(m.then))) &&
        (m.lead === undefined || typeof m.lead === 'boolean')));
}
// /castle · /castle2 (캐슬 둘레 도시 배치 1 · 2): { memo?, members: [{ n, i?, j?, ext? }] } — castle/castle.js의 normalize()와 같은 모양 (i·j = 격자 칸, 캐슬 0~5 + 둘레 6열)
const CASTLE_CELL = v => Number.isInteger(v) && v >= -6 && v <= 11;
function validCastle(d) {
  return !!d && typeof d === 'object' && !Array.isArray(d) && (d.memo === undefined || (typeof d.memo === 'string' && d.memo.length <= 1000)) &&
    Array.isArray(d.members) && d.members.length <= 300 && d.members.every(m => m && typeof m.n === 'string' && m.n.trim() && m.n.length <= 40 &&
      ((m.i === undefined && m.j === undefined) || (CASTLE_CELL(m.i) && CASTLE_CELL(m.j))) && (m.ext === undefined || typeof m.ext === 'boolean'));
}

async function api(request, env, url) {
  const path = url.pathname;
  const L = LAYOUTS[path];

  if (L && request.method === 'GET') {
    // the publish time rides along as KV metadata, so one read serves both (X-Layout-Updated header)
    const { value, metadata } = env.LAYOUT_KV ? await env.LAYOUT_KV.getWithMetadata(L.key) : {};
    if (value) {
      const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' };
      if (metadata && metadata.updated_at) headers['X-Layout-Updated'] = metadata.updated_at;
      return new Response(value, { headers });
    }
    return env.ASSETS.fetch(new Request(new URL(L.file, url), request));
  }

  if (L && request.method === 'PUT') {
    if (!(await anyToken(env, L.auth || ['ADMIN_HASH'], request))) return json({ error: '로그인이 필요합니다' }, 401);
    if (!env.LAYOUT_KV) return json({ error: 'LAYOUT_KV 바인딩이 없습니다' }, 500);
    const text = await request.text();
    if (text.length > MAX_LAYOUT_BYTES) return json({ error: '배치 데이터가 너무 큽니다' }, 413);
    let list;
    try { list = JSON.parse(text); } catch (_) { return json({ error: 'JSON 형식이 아닙니다' }, 400); }
    if (!(L.valid || validLayout)(list)) return json({ error: '배치 데이터 형식이 아닙니다' }, 400);
    const prev = await env.LAYOUT_KV.get(L.key);
    if (prev) await env.LAYOUT_KV.put(L.prev, prev);   // one step of rollback
    const now = new Date().toISOString();
    await env.LAYOUT_KV.put(L.key, JSON.stringify(list), { metadata: { updated_at: now } });
    await env.LAYOUT_KV.put(L.stamp, now);
    return json({ ok: true, count: Array.isArray(list) ? list.length : undefined });
  }

  const SK = STEPS[path];
  if (SK && request.method === 'GET') {
    const rec = (env.LAYOUT_KV && (await env.LAYOUT_KV.get(SK, 'json'))) || { keys: null, ver: 0, log: [] };
    if (!url.searchParams.has('log')) delete rec.log;
    return json(rec);
  }

  if (SK && request.method === 'PUT') {
    if (!env.LAYOUT_KV) return json({ error: 'LAYOUT_KV 바인딩이 없습니다' }, 500);
    const text = await request.text();
    if (text.length > 64 * 1024) return json({ error: '진행 기록이 너무 큽니다' }, 413);
    let body;
    try { body = JSON.parse(text); } catch (_) { return json({ error: 'JSON 형식이 아닙니다' }, 400); }
    if (!body || !Number.isInteger(body.base) || body.base < 0 || !validStepKeys(body.keys)) return json({ error: '진행 기록 형식이 아닙니다' }, 400);
    const cur = (await env.LAYOUT_KV.get(SK, 'json')) || { keys: null, ver: 0, log: [] };
    if (body.base !== cur.ver) return json({ error: '다른 기기에서 먼저 바뀌었습니다', keys: cur.keys, ver: cur.ver, updated_at: cur.updated_at }, 409);
    const now = new Date().toISOString(), ver = cur.ver + 1;
    const log = [...(cur.log || []), { ver, n: body.keys.length, from: cur.keys ? cur.keys.length : null, at: now, dev: device(request.headers.get('User-Agent') || '') }].slice(-100);
    await env.LAYOUT_KV.put(SK, JSON.stringify({ keys: body.keys, ver, updated_at: now, log }));
    return json({ ok: true, ver, n: body.keys.length, updated_at: now });
  }

  if (path === '/api/login' && request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (_) { /* empty body */ }
    const scope = String(body.scope || '');
    if (!Object.hasOwn(ACCOUNTS, scope)) return json({ error: '없는 계정 종류입니다' }, 400);
    const names = ACCOUNTS[scope].filter(n => env[n]);
    if (!names.length) return json({ error: `${ACCOUNTS[scope].join(' / ')} 비밀값이 설정되지 않았습니다` }, 500);
    for (const n of names) {
      if (await checkLogin(env[n], String(body.id || ''), String(body.pw || ''))) return json({ token: await makeToken(env[n]) });
    }
    return json({ error: '아이디 또는 비밀번호가 틀렸습니다' }, 401);
  }

  return json({ error: 'not found' }, 404);
}

// The front page is the v2 seat guide; the old layout pages moved under /v1/ (old links still work).
// 302, not 301: browsers would otherwise remember the move for good.
const REDIRECTS = {
  '/': '/v2/', '/index.html': '/v2/',
  '/admin': '/v1/admin', '/admin/': '/v1/admin', '/admin.html': '/v1/admin',
  '/flags': '/v1/flags', '/flags/': '/v1/flags', '/flags.html': '/v1/flags',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(request, env, url); }
      catch (err) { return json({ error: err.message }, 500); }
    }
    const to = REDIRECTS[url.pathname];
    if (to) return Response.redirect(new URL(to + url.search, url).href, 302);
    return env.ASSETS.fetch(request);
  },
};
