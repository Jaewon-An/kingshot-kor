// Copies only the public site files into dist/ (screenshots, server.js and tools stay out).
// Usage: node tools/build-dist.mjs
import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
// _worker.js = the /api server on Cloudflare (also sends / to /v2/). admin.txt / .admin-secret are never copied.
// v1/index.html + app.js, style.css, flags.js = the old layout pages (/v1/, /v1/admin, /v1/flags) and the /v2/admin editor
// v2/ = the new-seat pages: /v2 (seat guide), /v2/map, /v2/plan (작전도), engine + tools for /v2/admin
// sgd/ = /sgd, the SGD alliance's seat map (one bear trap; uses v2/core.js, v2/plan.js, v2/guide.css)
const PUBLIC = ['v1', 'v2', 'sgd', 'app.js', 'flags.js', 'style.css', 'mapdata.js', '_worker.js', 'layouts', '404.html'];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST);
for (const f of PUBLIC) await cp(path.join(ROOT, f), path.join(DIST, f), { recursive: true });
// v1/index.html becomes the editor or the flag survey from its own path; <base href="/"> keeps its files at the root.
// Cloudflare Pages serves v1/admin.html at /v1/admin, v1/flags.html at /v1/flags, v2/admin.html at /v2/admin (the v2 editor).
const page = path.join(ROOT, 'v1', 'index.html');
for (const out of ['v1/admin.html', 'v1/flags.html', 'v2/admin.html']) await cp(page, path.join(DIST, out));
console.log(`dist/ ready: ${PUBLIC.join(', ')}, v1/admin.html, v1/flags.html, v2/admin.html`);
