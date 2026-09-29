// Copies only the public site files into dist/ (screenshots, server.js and tools stay out).
// Usage: node tools/build-dist.mjs
import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
// _worker.js = the /api server on Cloudflare. admin.txt / .admin-secret are never copied.
// flags.js = the KOR flag survey page (/flags), data in layouts/flags.json
const PUBLIC = ['index.html', 'app.js', 'flags.js', 'style.css', 'mapdata.js', '_worker.js', 'layouts'];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST);
for (const f of PUBLIC) await cp(path.join(ROOT, f), path.join(DIST, f), { recursive: true });
// admin.html = same page; it becomes the editor from its path (Cloudflare Pages serves it at /admin)
await cp(path.join(ROOT, 'index.html'), path.join(DIST, 'admin.html'));
// flags.html = same page, read-only KOR flag survey (served at /flags; app.js loads flags.js there)
await cp(path.join(ROOT, 'index.html'), path.join(DIST, 'flags.html'));
console.log(`dist/ ready: ${PUBLIC.join(', ')}, admin.html, flags.html`);
