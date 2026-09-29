// Cloudflare Pages advanced-mode worker (works with dashboard drag-and-drop uploads).
// Static files are served from env.ASSETS; /api/* is handled here.
//
// Bindings (Pages project ▸ Settings):
//   LAYOUT_KV   KV namespace holding the published layout (key "current")
//   ADMIN_HASH  secret "salt$sha256hex(salt:id:password)" — made by `node tools/set-admin.mjs`
const TOKEN_TTL = 12 * 60 * 60 * 1000;
const MAX_LAYOUT_BYTES = 1024 * 1024;

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

async function checkLogin(env, id, pw) {
  const [salt, want] = String(env.ADMIN_HASH || '').split('$');
  if (!salt || !want) return false;
  return sameText(await sha256(`${salt}:${id}:${pw}`), want);
}
async function makeToken(env) {
  const exp = String(Date.now() + TOKEN_TTL);
  return `${exp}.${await hmac(env.ADMIN_HASH, exp)}`;
}
async function checkToken(env, request) {
  const m = /^Bearer (\d+)\.([0-9a-f]{64})$/.exec(request.headers.get('Authorization') || '');
  if (!m || !env.ADMIN_HASH || Number(m[1]) < Date.now()) return false;
  return sameText(await hmac(env.ADMIN_HASH, m[1]), m[2]);
}

// Only accept something that looks like a simulator layout.
function validLayout(list) {
  return Array.isArray(list) && list.length <= 5000 && list.every(o =>
    o && typeof o.name === 'string' && o.name.length <= 40 && Number.isFinite(o.tx) && Number.isFinite(o.ty) &&
    (o.nickname === undefined || (typeof o.nickname === 'string' && o.nickname.length <= 80)));
}

async function api(request, env, url) {
  const path = url.pathname;

  if (path === '/api/layout' && request.method === 'GET') {
    const stored = env.LAYOUT_KV ? await env.LAYOUT_KV.get('current') : null;
    if (stored) return new Response(stored, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' } });
    return env.ASSETS.fetch(new Request(new URL('/layouts/current.json', url), request));
  }

  if (path === '/api/layout' && request.method === 'PUT') {
    if (!(await checkToken(env, request))) return json({ error: '로그인이 필요합니다' }, 401);
    if (!env.LAYOUT_KV) return json({ error: 'LAYOUT_KV 바인딩이 없습니다' }, 500);
    const text = await request.text();
    if (text.length > MAX_LAYOUT_BYTES) return json({ error: '배치 데이터가 너무 큽니다' }, 413);
    let list;
    try { list = JSON.parse(text); } catch (_) { return json({ error: 'JSON 형식이 아닙니다' }, 400); }
    if (!validLayout(list)) return json({ error: '배치 데이터 형식이 아닙니다' }, 400);
    const prev = await env.LAYOUT_KV.get('current');
    if (prev) await env.LAYOUT_KV.put('previous', prev);   // one step of rollback
    await env.LAYOUT_KV.put('current', JSON.stringify(list));
    await env.LAYOUT_KV.put('updated_at', new Date().toISOString());
    return json({ ok: true, count: list.length });
  }

  if (path === '/api/login' && request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (_) { /* empty body */ }
    if (!env.ADMIN_HASH) return json({ error: 'ADMIN_HASH 비밀값이 설정되지 않았습니다' }, 500);
    if (!(await checkLogin(env, String(body.id || ''), String(body.pw || '')))) return json({ error: '아이디 또는 비밀번호가 틀렸습니다' }, 401);
    return json({ token: await makeToken(env) });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(request, env, url); }
      catch (err) { return json({ error: err.message }, 500); }
    }
    return env.ASSETS.fetch(request);
  },
};
