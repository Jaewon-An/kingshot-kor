// Copies only the public site files into dist/ (screenshots, server.js and tools stay out).
// Usage: node tools/build-dist.mjs
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
// _worker.js = the /api server on Cloudflare. admin.txt / .admin-secret are never copied.
// flags.js = the KOR flag survey page (/flags), data in layouts/flags.json
// v2/ = the new-seat pages: /v2 (seat guide), /v2/plan (작전도), engine + tools for /v2/admin
const PUBLIC = ['index.html', 'app.js', 'flags.js', 'style.css', 'mapdata.js', '_worker.js', 'layouts', 'v2'];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST);
for (const f of PUBLIC) await cp(path.join(ROOT, f), path.join(DIST, f), { recursive: true });
// admin.html = same page; it becomes the editor from its path (Cloudflare Pages serves it at /admin)
await cp(path.join(ROOT, 'index.html'), path.join(DIST, 'admin.html'));
// flags.html = same page, read-only KOR flag survey (served at /flags; app.js loads flags.js there)
await cp(path.join(ROOT, 'index.html'), path.join(DIST, 'flags.html'));
// v2/admin.html = the editor for the v2 layout (served at /v2/admin); <base> keeps its files at the root (same as server.js)
const index = await readFile(path.join(ROOT, 'index.html'), 'utf8');
await writeFile(path.join(DIST, 'v2', 'admin.html'), index.replace('<head>', '<head>\n<base href="/">'));
console.log(`dist/ ready: ${PUBLIC.join(', ')}, admin.html, flags.html, v2/admin.html`);
