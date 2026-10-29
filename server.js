// Local server with the same API as _worker.js on Cloudflare:
//   static files, /api/login, GET/PUT /api/layout, GET/PUT /api/v2/layout, GET/PUT /api/sgd/layout
// Locally the published layouts are the files layouts/current.json, layouts/v2.json and layouts/sgd.json.
// Usage: node server.js   (PORT env var, default 8080) — no dependencies.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const LAYOUT_FILES = {
  '/api/layout': path.join(ROOT, 'layouts', 'current.json'),
  '/api/v2/layout': path.join(ROOT, 'layouts', 'v2.json'),
  '/api/sgd/layout': path.join(ROOT, 'layouts', 'sgd.json'),
};
const TOKEN_TTL = 12 * 60 * 60 * 1000;

// ADMIN_HASH = "salt$sha256(salt:id:password)"; from .admin-secret (tools/set-admin.mjs) or derived from admin.txt
function loadAdminHash() {
  try { return fs.readFileSync(path.join(ROOT, '.admin-secret'), 'utf8').trim(); } catch (_) { /* fall back */ }
  try {
    const line = fs.readFileSync(path.join(ROOT, 'admin.txt'), 'utf8').trim();
    const i = line.indexOf(' / ');
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}$${sha256(`${salt}:${line.slice(0, i).trim()}:${line.slice(i + 3).trim()}`)}`;
  } catch (_) { return ''; }
}
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const ADMIN_HASH = loadAdminHash();

function checkLogin(id, pw) {
  const [salt, want] = ADMIN_HASH.split('$');
  return !!salt && !!want && same(sha256(`${salt}:${id}:${pw}`), want);
}
function makeToken() {
  const exp = String(Date.now() + TOKEN_TTL);
  return `${exp}.${hmac(ADMIN_HASH, exp)}`;
}
function checkToken(req) {
  const m = /^Bearer (\d+)\.([0-9a-f]{64})$/.exec(req.headers.authorization || '');
  return !!m && !!ADMIN_HASH && Number(m[1]) >= Date.now() && same(hmac(ADMIN_HASH, m[1]), m[2]);
}
const validLayout = list => Array.isArray(list) && list.length <= 5000 && list.every(o =>
  o && typeof o.name === 'string' && o.name.length <= 40 && Number.isFinite(o.tx) && Number.isFinite(o.ty) &&
  (o.nickname === undefined || (typeof o.nickname === 'string' && o.nickname.length <= 80)));
// same as _worker.js: the front page is /v2/, the old layout pages live under /v1/
const REDIRECTS = {
  '/': '/v2/', '/index.html': '/v2/',
  '/admin': '/v1/admin', '/admin/': '/v1/admin', '/admin.html': '/v1/admin',
  '/flags': '/v1/flags', '/flags/': '/v1/flags', '/flags.html': '/v1/flags',
};
// v1/index.html serves all of these (the page picks its mode from the path, like the copies tools/build-dist.mjs makes)
const V1_PAGES = ['/v1', '/v1/', '/v1/index.html', '/v1/admin', '/v1/admin/', '/v1/admin.html', '/v1/flags', '/v1/flags/', '/v1/flags.html', '/v2/admin', '/v2/admin/', '/v2/admin.html'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = TYPES['.json']) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  if (url.pathname === '/api/login' && req.method === 'POST') {
    let body = {};
    try { body = JSON.parse(await readBody(req, 4096)); } catch (_) { /* empty */ }
    if (!ADMIN_HASH) return send(res, 500, { error: '관리자 계정이 설정되지 않았습니다 (admin.txt)' });
    if (!checkLogin(String(body.id || ''), String(body.pw || ''))) return send(res, 401, { error: '아이디 또는 비밀번호가 틀렸습니다' });
    return send(res, 200, { token: makeToken() });
  }
  const layoutFile = LAYOUT_FILES[url.pathname];
  if (layoutFile && req.method === 'GET') {
    return fs.readFile(layoutFile, (err, data) => {
      if (err) return send(res, 404, { error: 'no layout' });
      res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', 'X-Layout-Updated': fs.statSync(layoutFile).mtime.toISOString() });
      res.end(data);
    });
  }
  if (layoutFile && req.method === 'PUT') {
    if (!checkToken(req)) return send(res, 401, { error: '로그인이 필요합니다' });
    let list;
    try { list = JSON.parse(await readBody(req)); } catch (_) { return send(res, 400, { error: 'JSON 형식이 아닙니다' }); }
    if (!validLayout(list)) return send(res, 400, { error: '배치 데이터 형식이 아닙니다' });
    try { fs.copyFileSync(layoutFile, layoutFile.replace(/\.json$/, '.previous.json')); } catch (_) { /* first publish */ }
    fs.writeFileSync(layoutFile, JSON.stringify(list, null, 1));
    return send(res, 200, { ok: true, count: list.length });
  }
  return send(res, 404, { error: 'not found' });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    return api(req, res, url).catch(err => send(res, 500, { error: err.message }));
  }
  const to = REDIRECTS[url.pathname];
  if (to) { res.writeHead(302, { Location: to + url.search }); return res.end(); }
  const PAGES = { '/v2': '/v2/index.html', '/v2/': '/v2/index.html', '/v2/plan': '/v2/plan.html', '/v2/map': '/v2/map.html', '/sgd': '/sgd/index.html', '/sgd/': '/sgd/index.html', '/banner/v1': '/banner/v1/index.html', '/banner/v1/': '/banner/v1/index.html', '/banner/v2': '/banner/v2/index.html', '/banner/v2/': '/banner/v2/index.html' };
  const page = V1_PAGES.includes(url.pathname) ? '/v1/index.html' : PAGES[url.pathname] || url.pathname;
  const rel = decodeURIComponent(page);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || rel.includes('..')) return send(res, 403, 'forbidden', 'text/plain');
  // never serve credentials, secrets, server code or the raw screenshots
  const notFound = () => fs.readFile(path.join(ROOT, '404.html'), (e, html) => (e ? send(res, 404, 'not found', 'text/plain') : send(res, 404, html, TYPES['.html'])));
  if (/^\/(admin\.txt|\.admin-secret|_worker\.js|server\.js|screenshot\/)/i.test(rel)) return notFound();
  fs.readFile(file, (err, data) => {
    if (err) return notFound();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`킹샷 배치 시뮬레이터: http://localhost:${PORT}  (신규 자리: /v2, /v2/admin · 기존 배치도: /v1, /v1/admin · SGD: /sgd${ADMIN_HASH ? '' : ' — 계정 미설정'})`));
