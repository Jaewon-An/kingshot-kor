// Copies only the public site files into dist/ (screenshots, server.js and tools stay out).
// Usage: node tools/build-dist.mjs
import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
// _worker.js = the /api server on Cloudflare (also sends / to /v2/). admin.txt / .admin-secret / api-token.txt are never copied, from any folder (castle/admin.txt).
// v1/index.html + app.js, style.css, flags.js = the old layout pages (/v1/, /v1/admin, /v1/flags) and the /v2/admin editor
// v2/ = the new-seat pages: /v2 (seat guide), /v2/map, /v2/plan (작전도), engine + tools for /v2/admin
// sgd/ = /sgd, the SGD alliance's seat map (one bear trap; uses v2/core.js, v2/plan.js, v2/guide.css)
// sword/ = /sword, the Swordland Showdown member map (who goes to which building; data /api/sword/layout = layouts/sword.json, roster from the v2 layout)
// castle/ = /castle, the cities around the King's Castle (drag a name onto a tile; data /api/castle/layout = layouts/castle.json, saved on every drop);
//   /castle2 is the same page for a second plan (castle/index.html copied below; castle.js picks /api/castle2/layout = layouts/castle2.json from the path),
//   /castle/map?p=1|2 (castle/map.html) the same page again as one map-only, view-only plan; /castle/kor (castle/kor.html) shows both side by side to share
// war/ = /war, a shared Castle Battle note (English): why to swap out lightly injured troops, with the battle report screenshot (war/report.webp; the raw KakaoTalk jpg is not committed)
// banner/ = /banner/v1/ (KOR banner + territory map), /banner/v2/ (banner re-layout plan) and /banner/v3/ (outpost connection route, own v3.js); shared banner/banner.js (uses mapdata.js, v2/core.js, v2/plan.js, v2/guide.css)
const PUBLIC = ['v1', 'v2', 'sgd', 'sword', 'castle', 'banner', 'war', 'app.js', 'flags.js', 'style.css', 'mapdata.js', '_worker.js', 'layouts', '404.html'];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST);
const secret = src => /^(admin\.txt|\.admin-secret|api-token\.txt)$/i.test(path.basename(src));
for (const f of PUBLIC) await cp(path.join(ROOT, f), path.join(DIST, f), { recursive: true, filter: src => !secret(src) });
// v1/index.html becomes the editor or the flag survey from its own path; <base href="/"> keeps its files at the root.
// Cloudflare Pages serves v1/admin.html at /v1/admin, v1/flags.html at /v1/flags, v2/admin.html at /v2/admin (the v2 editor).
const page = path.join(ROOT, 'v1', 'index.html');
for (const out of ['v1/admin.html', 'v1/flags.html', 'v2/admin.html']) await cp(page, path.join(DIST, out));
for (const out of ['castle2/index.html', 'castle/map.html']) await cp(path.join(ROOT, 'castle', 'index.html'), path.join(DIST, out));
console.log(`dist/ ready: ${PUBLIC.join(', ')}, v1/admin.html, v1/flags.html, v2/admin.html, castle2/index.html, castle/map.html`);
