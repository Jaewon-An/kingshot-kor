(function () {
'use strict';

/* ================================================================
 * Coordinate frames
 *   world tile (tx, ty): canvas grid, drawn rotated 45° (same as the reference tool)
 *   game (X, Y)        : in-game coordinates.  X = 1199 - ty,  Y = 1199 - tx
 * A game footprint whose min corner is (gx, gy) and size s occupies world tiles
 *   tx = 1200-gy-s … 1199-gy,  ty = 1200-gx-s … 1199-gx
 * ================================================================ */

const $ = id => document.getElementById(id);
const canvas = $('mapCanvas');
const ctx = canvas.getContext('2d');
const canvasWrap = $('canvas-wrap');
const editor = $('map-editor');
const inlineInput = $('inline-input');
const infoDisplay = $('coord-info');
const buffRateInput = $('buff-rate');
const trapSelector = $('trap-selector');
const fsBtn = $('fullscreen-btn');

const TILE_SIZE = 32;
const MAP_SIZE = 1200;
const MAX_COORD = 1199;
const ROTATE_ANGLE = Math.PI / 4;
const WORLD_SIZE = MAP_SIZE * TILE_SIZE;
// `/v2/admin` is this editor for the v2 layout (new seats around the bear traps in the fertile land):
// its own published copy (api/v2/layout), its own draft; the public /v2 page is v2/guide.js.
const V2 = /^\/v2(\/|$)/.test(location.pathname);
const STORAGE_KEY = V2 ? 'ks-sim-objects-v2' : 'ks-sim-objects-v1';
const KID_KEY = 'ks-sim-kid';
const DEFAULT_KID = '2382';
// Live castle positions from kingshotstats are switched off: the site serves only the saved layout.
const LIVE_ENABLED = false;
// `/v1/` is the public read-only view of the published layout; `/v1/admin` (v1/admin.html) is the editor.
const ADMIN = /\/admin(\.html)?\/?$/.test(location.pathname);
const READONLY = !ADMIN;
const BASE = new URL('.', document.currentScript.src);
const PUBLISHED_LAYOUT = new URL(V2 ? 'layouts/v2.json' : 'layouts/current.json', BASE).href;
const LAYOUT_API = V2 ? 'v2/layout' : 'layout';

const TEMPLATES = {
  'Player':  { color: '#EFFFF3', w: 2, h: 2, type: 'one-tone', kind: 'city' },
  '곰덫':    { color: '#FF7200', w: 3, h: 3, type: 'one-tone', kind: 'trap' },
  '깃발 1':  { color: 'rgba(52, 152, 219, 0.5)', w: 7, h: 7, type: 'two-tone', kind: 'banner' },
  '깃발 2':  { color: 'rgba(237, 28, 36, 0.5)', w: 7, h: 7, type: 'two-tone', kind: 'banner' },
  '본부 1':  { color: 'rgba(52, 152, 219, 0.5)', w: 15, h: 15, type: 'two-tone', kind: 'hq' },
  '본부 2':  { color: 'rgba(237, 28, 36, 0.5)', w: 15, h: 15, type: 'two-tone', kind: 'hq' },
  '연맹자원': { color: '#0F461E', w: 2, h: 2, type: 'one-tone', kind: 'alres' },};
const TERRITORY_NAMES = ['깃발 1', '깃발 2', '본부 1', '본부 2'];
const isTerritory = o => TERRITORY_NAMES.includes(o.name);
const teamOf = o => (o.name.endsWith('1') ? 1 : 2);
const kindOf = o => (TEMPLATES[o.name] ? TEMPLATES[o.name].kind : 'city');

function coreRect(o, tx = o.tx, ty = o.ty) {
  if (o.type === 'two-tone') {
    const c = o.name.startsWith('본부') ? 3 : 1;
    const off = Math.floor((o.w - c) / 2);
    return { x: tx + off, y: ty + off, w: c, h: c };
  }
  return { x: tx, y: ty, w: o.w, h: o.h };
}
const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const tileToGame = (tx, ty) => ({ x: MAX_COORD - ty, y: MAX_COORD - tx });
const gameToTile = (x, y) => ({ tx: MAX_COORD - y, ty: MAX_COORD - x });
const gameRectToWorld = (gx, gy, s) => ({ x: MAP_SIZE - gy - s, y: MAP_SIZE - gx - s });

/* ================= state ================= */
let camera = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, zoom: 1 };
let objects = [];
let selectedObjects = [];
let activeTrap = null;
let editingObject = null;
let placingBanner = null;   // template being placed (HTML5 drag or tap-to-place)
let armedName = null;       // tap-to-place mode
let hoverTile = null;       // tile under the cursor {tx, ty}
let lastTile = { lx: 0, ly: 0 };
let isLeftDown = false, isPanning = false;
let lastMouse = { x: 0, y: 0 };
let dragStart = null;       // {tile:{x,y}, items:[{obj,initTx,initTy}], startBlocked:Set}
let renderRequested = false;
let ping = null;            // {x,y,w,h,until}
let nearArea = null;        // {x,y,s} world rect of the lookup window
let mark = null;            // {tx,ty,gx,gy} tile from 좌표 찾기 or ?mark=X,Y; stays until cleared
let dpr = window.devicePixelRatio || 1;

/* ================= map data ================= */
const MD = window.KS_MAPDATA;
const T_MOUNTAIN = 1, T_LAKE = 2, T_NODE0 = 3, T_STRUCT = 7, T_KING = 8;
const NODE_NAMES = ['빵', '나무', '석재', '철'];
const NODE_RGB = [[255, 179, 0], [102, 187, 106], [176, 190, 197], [66, 165, 245]];
const RING_KO = { forbidden: '금지구역', ruins: '유적', fertile: '비옥지', plains: '평원', badlands: '황무지' };
const CAT_KO = {
  'Fortress': '요새', 'Sanctuary': '성소', 'Construction Outpost': '건설 전초기지',
  'Defense Outpost': '방어 전초기지', 'Research Outpost': '연구 전초기지', 'Attack Outpost': '공격 전초기지',
  'Gathering Outpost': '채집 전초기지', 'Resource Production Outpost': '생산 전초기지',
  'Training Outpost': '훈련 전초기지', 'Frontier Lodge': '변경 산장', 'castle': '왕성',
};
const layers = { terrain: true, nodes: true, structs: true, fzones: true, rings: false, free: true, real: true };
let blockOn = true;
let terr = null;                     // world grid: 0 empty, 1 mountain, 2 lake, 3..6 node, 7 structure, 8 king zone
const nobuild = new Uint8Array(MAP_SIZE * MAP_SIZE); // bit 1: any structure zone, bit 2: zone that also blocks cities
let terrainReady = false;
const nodes = [];                    // {tx, ty, t, gx, gy}
const structs = [];                  // {x, y, s, fx, fy, fs, ce, letter, color, cat, name, gx, gy}
let mapImg = null;
const territoryGrid = new Uint8Array(MAP_SIZE * MAP_SIZE); // bit 1: team 1, bit 2: team 2
let territoryTouched = [];
const nodeCoverage = { 1: [0, 0, 0, 0], 2: [0, 0, 0, 0] };

function ringAt(tx, ty) {
  if (!MD) return 'badlands';
  const g = tileToGame(tx, ty);
  for (const k of ['forbidden', 'ruins', 'fertile', 'plains']) {
    const z = MD.ZONES[k];
    if (g.x >= z.x1 && g.x <= z.x2 && g.y >= z.y1 && g.y <= z.y2) return k;
  }
  return 'badlands';
}

function initStructures() {
  if (!MD) return;
  terr = new Uint8Array(MAP_SIZE * MAP_SIZE);
  const fillRect = (x, y, w, h, fn) => {
    for (let ty = Math.max(0, y); ty < Math.min(MAP_SIZE, y + h); ty++)
      for (let tx = Math.max(0, x); tx < Math.min(MAP_SIZE, x + w); tx++) fn(ty * MAP_SIZE + tx);
  };
  const kz = MD.KING_ZONE, kw = gameRectToWorld(kz.x1, kz.y1, kz.x2 - kz.x1);
  fillRect(kw.x, kw.y, kz.x2 - kz.x1, kz.y2 - kz.y1, i => { terr[i] = T_KING; });
  for (const [gx, gy, s, fs, ce, letter, color, cat, name] of MD.STRUCTS) {
    const w = gameRectToWorld(gx, gy, s);
    const fgx = Math.round(gx + s / 2 - fs / 2), fgy = Math.round(gy + s / 2 - fs / 2);
    const fw = gameRectToWorld(fgx, fgy, fs);
    structs.push({ x: w.x, y: w.y, s, fx: fw.x, fy: fw.y, fs, ce: !!ce, letter, color, cat, name, gx, gy });
    fillRect(fw.x, fw.y, fs, fs, i => { nobuild[i] |= ce ? 1 : 3; });
    fillRect(w.x, w.y, s, s, i => { terr[i] = T_STRUCT; });
  }
  for (const [label, letter, gx, gy, s, color] of MD.CASTLE) {
    const w = gameRectToWorld(gx, gy, s);
    structs.push({ x: w.x, y: w.y, s, fx: 0, fy: 0, fs: 0, ce: true, letter, color, cat: 'castle',
      name: label === "King's Castle" ? '왕성' : '포탑', gx, gy });
    fillRect(w.x, w.y, s, s, i => { terr[i] = T_STRUCT; });
  }
}

async function inflateB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function loadMapData() {
  const status = $('map-status');
  if (!MD) { status.textContent = 'mapdata.js 를 찾을 수 없습니다.'; return; }
  if (typeof DecompressionStream === 'undefined') {
    status.textContent = '이 브라우저는 지형 데이터를 지원하지 않습니다 (최신 Chrome/Safari/Firefox 필요).';
    return;
  }
  try {
    // terrain rows are iy (game Y = 1199 - iy), columns ix (game X = ix) -> world tx = iy, ty = 1199 - ix
    const raw = await inflateB64(MD.TERRAIN_B64);
    for (let iy = 0; iy < MAP_SIZE; iy++) {
      for (let xb = 0; xb < 300; xb++) {
        const b = raw[iy * 300 + xb];
        if (!b) continue;
        for (let k = 0; k < 4; k++) {
          const t = (b >> (k * 2)) & 3;
          if (!t) continue;
          const i = (MAX_COORD - (xb * 4 + k)) * MAP_SIZE + iy;
          if (!terr[i]) terr[i] = t;
        }
      }
    }
    const nraw = await inflateB64(MD.NODES_B64);
    for (let i = 0; i + 2 < nraw.length; i += 3) {
      const v = (nraw[i] << 16) | (nraw[i + 1] << 8) | nraw[i + 2];
      const t = (v >> 22) & 3, ix = (v >> 11) & 2047, iy = v & 2047;
      const n = { tx: iy, ty: MAX_COORD - 1 - ix, t, gx: ix, gy: MAX_COORD - 1 - iy };
      if (n.tx < 0 || n.ty < 0 || n.tx + 1 > MAX_COORD || n.ty + 1 > MAX_COORD) continue;
      nodes.push(n);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const j = (n.ty + dy) * MAP_SIZE + n.tx + dx;
        if (!terr[j]) terr[j] = T_NODE0 + t;
      }
    }
    terrainReady = true;
    status.textContent = `산·호수 지형, 연맹 자원지 ${nodes.length.toLocaleString()}곳, 구조물 ${MD.STRUCTS.length}곳`;
    buildMapImage();
    requestDraw();
  } catch (err) {
    status.textContent = '지도 데이터를 읽지 못했습니다: ' + err.message;
  }
}

function buildMapImage() {
  if (!terrainReady) return;
  mapImg = document.createElement('canvas');
  mapImg.width = MAP_SIZE; mapImg.height = MAP_SIZE;
  const g = mapImg.getContext('2d');
  const img = g.createImageData(MAP_SIZE, MAP_SIZE);
  for (let i = 0; i < terr.length; i++) {
    const t = terr[i];
    let rgb;
    if (t === T_MOUNTAIN && layers.terrain) rgb = [101, 104, 114];
    else if (t === T_LAKE && layers.terrain) rgb = [40, 96, 150];
    else if (t >= T_NODE0 && t < T_STRUCT && layers.nodes) rgb = NODE_RGB[t - T_NODE0];
    else continue;
    const o = i * 4;
    img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 230;
  }
  g.putImageData(img, 0, 0);
}

/* Why an object can't stand at (tx, ty), or null. `ignore` = objects moving together. */
function blockReason(o, tx, ty, ignore) {
  const kind = kindOf(o);
  const c = coreRect(o, tx, ty);
  if (terr) {
    for (let y = c.y; y < c.y + c.h; y++) {
      for (let x = c.x; x < c.x + c.w; x++) {
        const i = y * MAP_SIZE + x;
        const v = terr[i];
        if (v === T_MOUNTAIN || v === T_LAKE) return '산/호수 위에는 배치할 수 없습니다';
        if (v >= T_NODE0 && v < T_STRUCT) return '연맹 자원지 위에는 배치할 수 없습니다';
        if (v === T_STRUCT) return '구조물 위에는 배치할 수 없습니다';
        if (v === T_KING) return '왕성 구역에는 배치할 수 없습니다';
        if (kind === 'city' ? (nobuild[i] & 2) : (nobuild[i] & 1)) return '구조물 건설 금지구역입니다';
        const ring = ringAt(x, y);
        if (kind !== 'city' && ring === 'forbidden') return '금지구역입니다';
        if (kind !== 'city' && ring === 'ruins') return '유적 지역에는 연맹 건물을 지을 수 없습니다';
        if (kind === 'hq' && ring === 'fertile') return '본부는 평원/황무지에만 지을 수 있습니다';
      }
    }
  }
  for (const other of objects) {
    if (other === o || (ignore && ignore.has(other))) continue;
    if (rectsOverlap(c, coreRect(other))) return '다른 기물과 겹칩니다';
  }
  return null;
}

/* ================= territory & coverage ================= */
function computeTerritory(objs) {
  for (const i of territoryTouched) territoryGrid[i] = 0;
  territoryTouched = [];
  for (const f of objs) {
    if (!isTerritory(f)) continue;
    const bit = teamOf(f);
    for (let y = Math.max(0, f.ty); y < Math.min(MAP_SIZE, f.ty + f.h); y++)
      for (let x = Math.max(0, f.tx); x < Math.min(MAP_SIZE, f.tx + f.w); x++) {
        const i = y * MAP_SIZE + x;
        if (!territoryGrid[i]) territoryTouched.push(i);
        territoryGrid[i] |= bit;
      }
  }
}

function territoryOf(o) {
  let a = 0, e = 0;
  for (let y = o.ty; y < o.ty + o.h; y++)
    for (let x = o.tx; x < o.tx + o.w; x++) {
      const v = territoryGrid[y * MAP_SIZE + x];
      if (v & 1) a++;
      if (v & 2) e++;
    }
  const total = o.w * o.h;
  return a === total ? 1 : e === total ? 2 : 0;
}

// A node counts for a team when at least 75% (3 of 4 tiles) sits in its territory.
function nodeTeams(n) {
  let a = 0, e = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const v = territoryGrid[(n.ty + dy) * MAP_SIZE + n.tx + dx];
    if (v & 1) a++;
    if (v & 2) e++;
  }
  return (a >= 3 ? 1 : 0) | (e >= 3 ? 2 : 0);
}

function updateCoverage() {
  nodeCoverage[1] = [0, 0, 0, 0];
  nodeCoverage[2] = [0, 0, 0, 0];
  if (territoryTouched.length) {
    for (const n of nodes) {
      const t = nodeTeams(n);
      if (t & 1) nodeCoverage[1][n.t]++;
      if (t & 2) nodeCoverage[2][n.t]++;
    }
  }
  for (const team of [1, 2]) {
    const cells = document.querySelectorAll(`#coverage-table tr[data-team="${team}"] td`);
    const arr = nodeCoverage[team];
    arr.forEach((v, i) => { cells[i].textContent = v; });
    cells[4].textContent = arr.reduce((s, v) => s + v, 0);
  }
}

/* ================= view transforms ================= */
function viewSize() { return { w: canvas.width / dpr, h: canvas.height / dpr }; }

function getRotatedWorldPos(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const dx = (clientX - rect.left - rect.width / 2) / camera.zoom;
  const dy = (clientY - rect.top - rect.height / 2) / camera.zoom;
  const cos = Math.cos(-ROTATE_ANGLE), sin = Math.sin(-ROTATE_ANGLE);
  return { x: dx * cos - dy * sin + camera.x, y: dx * sin + dy * cos + camera.y };
}

function worldToClient(wx, wy) {
  const { w, h } = viewSize();
  const dx = wx - camera.x, dy = wy - camera.y;
  const cos = Math.cos(ROTATE_ANGLE), sin = Math.sin(ROTATE_ANGLE);
  return { x: (dx * cos - dy * sin) * camera.zoom + w / 2, y: (dx * sin + dy * cos) * camera.zoom + h / 2 };
}

function tileAt(clientX, clientY) {
  const m = getRotatedWorldPos(clientX, clientY);
  return { tx: Math.floor(m.x / TILE_SIZE), ty: Math.floor(m.y / TILE_SIZE) };
}

// Pan by a screen-space delta (the map is rotated, so the delta must be rotated back).
function panBy(dxScreen, dyScreen) {
  const cos = Math.cos(-ROTATE_ANGLE), sin = Math.sin(-ROTATE_ANGLE);
  camera.x -= (dxScreen * cos - dyScreen * sin) / camera.zoom;
  camera.y -= (dxScreen * sin + dyScreen * cos) / camera.zoom;
}

function zoomAt(clientX, clientY, factor) {
  const before = getRotatedWorldPos(clientX, clientY);
  camera.zoom = clamp(camera.zoom * factor, 0.05, 5);
  const after = getRotatedWorldPos(clientX, clientY);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
}

function centerOnTile(tx, ty, w = 1, h = 1) {
  camera.x = (tx + w / 2) * TILE_SIZE;
  camera.y = (ty + h / 2) * TILE_SIZE;
  ping = { x: tx, y: ty, w, h, until: performance.now() + 2000 };
  requestDraw();
}

/* visible tile range for a camera/viewport */
function visibleRange(W, H, cam) {
  const cos = Math.cos(-ROTATE_ANGLE), sin = Math.sin(-ROTATE_ANGLE);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [sx, sy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const dx = (sx - W / 2) / cam.zoom, dy = (sy - H / 2) / cam.zoom;
    const wx = dx * cos - dy * sin + cam.x, wy = dx * sin + dy * cos + cam.y;
    x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
  }
  return {
    x0: clamp(Math.floor(x0 / TILE_SIZE) - 1, 0, MAP_SIZE), x1: clamp(Math.ceil(x1 / TILE_SIZE) + 1, 0, MAP_SIZE),
    y0: clamp(Math.floor(y0 / TILE_SIZE) - 1, 0, MAP_SIZE), y1: clamp(Math.ceil(y1 / TILE_SIZE) + 1, 0, MAP_SIZE),
  };
}

/* ================= rendering ================= */
function requestDraw() {
  if (renderRequested) return;
  renderRequested = true;
  requestAnimationFrame(() => { renderRequested = false; draw(); });
}

function drawLabel(tCtx, cx, cy, lines, color, zoom) {
  tCtx.save();
  tCtx.translate(cx, cy);
  tCtx.rotate(-ROTATE_ANGLE);
  tCtx.fillStyle = color;
  tCtx.textAlign = 'center';
  tCtx.textBaseline = 'middle';
  const fSize = Math.max(9, 13 / zoom);
  if (lines.length === 1) {
    tCtx.font = `bold ${fSize}px Arial`;
    tCtx.fillText(lines[0], 0, 0);
  } else {
    tCtx.font = `bold ${fSize}px Arial`;
    tCtx.fillText(lines[0], 0, -fSize * 0.7);
    tCtx.font = `${fSize * 0.8}px Arial`;
    tCtx.fillText(lines[1], 0, fSize * 0.8);
  }
  tCtx.restore();
}

function renderScene(tCtx, W, H, cam, objs, opts = {}) {
  const T = TILE_SIZE;
  tCtx.fillStyle = '#0a0a0a';
  tCtx.fillRect(0, 0, W, H);
  tCtx.save();
  tCtx.translate(W / 2, H / 2);
  tCtx.scale(cam.zoom, cam.zoom);
  tCtx.rotate(ROTATE_ANGLE);
  tCtx.translate(-cam.x, -cam.y);
  const px = 1 / cam.zoom;
  const vr = visibleRange(W, H, cam);

  tCtx.fillStyle = '#101310';
  tCtx.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);

  if (layers.rings && MD) {
    const fills = { plains: 'rgba(60,130,60,.10)', fertile: 'rgba(40,120,45,.16)', ruins: 'rgba(150,95,40,.22)', forbidden: 'rgba(120,20,35,.35)' };
    tCtx.lineWidth = 2 * px;
    tCtx.strokeStyle = 'rgba(255,255,255,.18)';
    for (const k of ['plains', 'fertile', 'ruins', 'forbidden']) {
      const z = MD.ZONES[k];
      const x = (MAX_COORD - z.y2) * T, y = (MAX_COORD - z.x2) * T;
      const s = (z.x2 - z.x1 + 1) * T;
      tCtx.fillStyle = fills[k];
      tCtx.fillRect(x, y, s, s);
      tCtx.strokeRect(x, y, s, s);
    }
  }

  if (mapImg) {
    tCtx.imageSmoothingEnabled = false;
    tCtx.drawImage(mapImg, 0, 0, WORLD_SIZE, WORLD_SIZE);
  }

  if (cam.zoom > 0.1) {
    tCtx.beginPath();
    tCtx.strokeStyle = 'rgba(255,255,255,.07)';
    tCtx.lineWidth = px;
    const step = cam.zoom < 0.4 ? 5 : 1;
    const sx = Math.floor(vr.x0 / step) * step, sy = Math.floor(vr.y0 / step) * step;
    for (let i = sx; i <= vr.x1; i += step) { tCtx.moveTo(i * T, vr.y0 * T); tCtx.lineTo(i * T, vr.y1 * T); }
    for (let i = sy; i <= vr.y1; i += step) { tCtx.moveTo(vr.x0 * T, i * T); tCtx.lineTo(vr.x1 * T, i * T); }
    tCtx.stroke();
  }

  // map border
  tCtx.strokeStyle = '#444';
  tCtx.lineWidth = 2 * px;
  tCtx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

  if (layers.fzones) {
    tCtx.save();
    tCtx.setLineDash([6 * px, 4 * px]);
    tCtx.lineWidth = 1.5 * px;
    tCtx.fillStyle = 'rgba(255,90,90,.06)';
    tCtx.strokeStyle = 'rgba(255,90,90,.55)';
    for (const s of structs) {
      if (!s.fs) continue;
      tCtx.fillRect(s.fx * T, s.fy * T, s.fs * T, s.fs * T);
      tCtx.strokeRect(s.fx * T, s.fy * T, s.fs * T, s.fs * T);
    }
    tCtx.restore();
  }

  if (layers.structs) {
    for (const s of structs) {
      tCtx.fillStyle = s.color;
      tCtx.fillRect(s.x * T, s.y * T, s.s * T, s.s * T);
      tCtx.strokeStyle = 'rgba(0,0,0,.6)';
      tCtx.lineWidth = 2 * px;
      tCtx.strokeRect(s.x * T, s.y * T, s.s * T, s.s * T);
    }
    for (const s of structs) {
      const screenSize = s.s * T * cam.zoom;
      if (screenSize < 14) continue;
      const cx = (s.x + s.s / 2) * T, cy = (s.y + s.s / 2) * T;
      const label = cam.zoom >= 0.25 ? [s.name, `${s.gx}, ${s.gy}`] : [s.letter];
      drawLabel(tCtx, cx, cy, label, '#fff', cam.zoom);
    }
  }

  if (live.players.length && live.show) drawLivePlayers(tCtx, cam, vr);

  // ---- placed objects (same rules and look as the reference tool) ----
  computeTerritory(objs);
  const showCoords = $('show-coords').checked;
  const renderList = [...objs.filter(isTerritory), ...objs.filter(o => !isTerritory(o))];
  for (const o of renderList) {
    const ox = o.tx * T, oy = o.ty * T, ow = o.w * T, oh = o.h * T;
    let drawColor = o.color;
    // castles always keep one colour; traps / alliance buildings still turn red outside territory
    if (!isTerritory(o) && o.name !== 'Player' && territoryOf(o) === 0) drawColor = '#ff0000';

    if (o.type === 'two-tone') {
      tCtx.save();
      tCtx.globalAlpha = 0.5;
      tCtx.fillStyle = drawColor;
      tCtx.fillRect(ox, oy, ow, oh);
      tCtx.restore();
      const c = coreRect(o);
      tCtx.fillStyle = teamOf(o) === 1 ? '#3498db' : '#ed1c24';
      tCtx.fillRect(c.x * T, c.y * T, c.w * T, c.h * T);
    } else {
      tCtx.fillStyle = drawColor;
      tCtx.fillRect(ox, oy, ow, oh);
    }

    if (!opts.exporting && terrainReady && blockReason(o, o.tx, o.ty)) {
      const c = coreRect(o);
      tCtx.save();
      tCtx.setLineDash([5 * px, 4 * px]);
      tCtx.strokeStyle = '#ffd400';
      tCtx.lineWidth = Math.max(2, 3 * px);
      tCtx.strokeRect(c.x * T, c.y * T, c.w * T, c.h * T);
      tCtx.restore();
    }

    if (selectedObjects.includes(o) && !isTerritory(o)) {
      tCtx.save();
      tCtx.strokeStyle = '#fff';
      tCtx.lineWidth = Math.max(2, 4 * px);
      tCtx.strokeRect(ox, oy, ow, oh);
      tCtx.restore();
    }

    const logic = worldToLogic(o.tx, o.ty, o);
    let displayText = o.nickname || o.name;
    if (activeTrap && objs.includes(activeTrap) && o.name === 'Player') {
      const gapX = Math.max(0, activeTrap.tx - (o.tx + o.w - 1), o.tx - (activeTrap.tx + activeTrap.w - 1));
      const gapY = Math.max(0, activeTrap.ty - (o.ty + o.h - 1), o.ty - (activeTrap.ty + activeTrap.h - 1));
      const dist = gapX + gapY - 1;
      const buff = parseFloat(buffRateInput.value) || 0;
      const distTime = ((9 + dist * 2.7) / (1 + buff / 100)).toFixed(1);
      displayText = `${o.nickname || o.name} (${distTime}s)`;
    }
    const textColor = o.name === 'Player' && drawColor !== '#ff0000' ? '#000' : '#fff';
    // the coordinate line only fits once the object is reasonably large on screen
    const coordsFit = showCoords && ow * cam.zoom >= 56;
    drawLabel(tCtx, ox + ow / 2, oy + oh / 2,
      coordsFit ? [displayText, `${logic.lx}, ${logic.ly}`] : [displayText], textColor, cam.zoom);
  }

  // v2: flags standing in the game now (the /flags survey) — dashed territory outline + the flag tiles, for reference
  if (V2 && layers.real && realFlags.length && !opts.exporting) {
    tCtx.save();
    tCtx.strokeStyle = '#3fd9c4';
    tCtx.lineWidth = Math.max(2, 3 * px);
    tCtx.setLineDash([8 * px, 5 * px]);
    tCtx.beginPath();
    for (const [x0, y0, x1, y1] of realSegs) { tCtx.moveTo(x0 * T, y0 * T); tCtx.lineTo(x1 * T, y1 * T); }
    tCtx.stroke();
    tCtx.setLineDash([]);
    tCtx.fillStyle = 'rgba(63, 217, 196, 0.55)';
    for (const f of realFlags) { tCtx.fillRect(f.tx * T, f.ty * T, T, T); tCtx.strokeRect(f.tx * T, f.ty * T, T, T); }
    // flags standing now on a tile the edited layout gives to a castle / trap / building: red X (must come down)
    const solid = objs.filter(o => !isTerritory(o)).map(o => coreRect(o));
    const hqCore = objs.filter(o => o.name === '본부 1').map(o => coreRect(o));
    const blocked = (tx, ty) => solid.concat(hqCore).some(c => tx >= c.x && tx < c.x + c.w && ty >= c.y && ty < c.y + c.h);
    tCtx.strokeStyle = '#ff3b3b';
    tCtx.lineWidth = Math.max(2, 4 * px);
    tCtx.beginPath();
    for (const f of realFlags) {
      if (!blocked(f.tx, f.ty)) continue;
      tCtx.moveTo((f.tx - 0.6) * T, (f.ty - 0.6) * T); tCtx.lineTo((f.tx + 1.6) * T, (f.ty + 1.6) * T);
      tCtx.moveTo((f.tx + 1.6) * T, (f.ty - 0.6) * T); tCtx.lineTo((f.tx - 0.6) * T, (f.ty + 1.6) * T);
    }
    tCtx.stroke();
    tCtx.restore();
  }

  // selected flags/HQs: outline drawn on top of everything so the cities inside can't hide it
  for (const o of selectedObjects) {
    if (!isTerritory(o) || !objs.includes(o)) continue;
    const ox = o.tx * T, oy = o.ty * T, ow = o.w * T, oh = o.h * T;
    tCtx.save();
    tCtx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    tCtx.fillRect(ox, oy, ow, oh);
    tCtx.strokeStyle = '#1e6fff';
    tCtx.lineWidth = Math.max(3, 5 * px);
    tCtx.setLineDash([12 * px, 7 * px]);
    tCtx.strokeRect(ox, oy, ow, oh);
    tCtx.restore();
  }

  // nodes inside territory (75%+) get an outline in the team colour
  if (terrainReady && layers.nodes && territoryTouched.length) {
    tCtx.lineWidth = Math.max(1.5, 2.5 * px);
    for (const n of nodes) {
      if (n.tx < vr.x0 - 2 || n.tx > vr.x1 || n.ty < vr.y0 - 2 || n.ty > vr.y1) continue;
      const t = nodeTeams(n);
      if (!t) continue;
      tCtx.strokeStyle = t & 1 ? '#7fd0ff' : '#ff8080';
      tCtx.strokeRect(n.tx * T, n.ty * T, 2 * T, 2 * T);
    }
  }

  // empty castle spots inside team-1 territory
  if (layers.free && terrainReady && territoryTouched.length) {
    const spots = freeSpots(objs);
    tCtx.save();
    tCtx.fillStyle = 'rgba(177, 120, 255, 0.38)';
    tCtx.strokeStyle = 'rgba(206, 170, 255, 0.95)';
    tCtx.lineWidth = Math.max(1, 2 * px);
    tCtx.setLineDash([5 * px, 3 * px]);
    for (const s of spots) {
      if (s.tx < vr.x0 - 2 || s.tx > vr.x1 || s.ty < vr.y0 - 2 || s.ty > vr.y1) continue;
      tCtx.fillRect(s.tx * T, s.ty * T, 2 * T, 2 * T);
      tCtx.strokeRect(s.tx * T + px, s.ty * T + px, 2 * T - 2 * px, 2 * T - 2 * px);
    }
    tCtx.restore();
    if (2 * T * cam.zoom >= 24) {
      for (const s of spots) {
        if (s.tx < vr.x0 - 2 || s.tx > vr.x1 || s.ty < vr.y0 - 2 || s.ty > vr.y1) continue;
        drawLabel(tCtx, (s.tx + 1) * T, (s.ty + 1) * T, 2 * T * cam.zoom >= 56 ? ['Free', `${s.gx}, ${s.gy}`] : ['Free'], '#f3e9ff', cam.zoom);
      }
    }
  }

  if (opts.preview && hoverTile) {
    const p = opts.preview;
    const pos = previewPos(p);
    const blocked = blockOn && terrainReady ? blockReason(p, pos.tx, pos.ty) : null;
    tCtx.save();
    tCtx.globalAlpha = 0.55;
    tCtx.fillStyle = blocked ? '#ff3b3b' : '#3fa9f5';
    tCtx.fillRect(pos.tx * T, pos.ty * T, p.w * T, p.h * T);
    tCtx.restore();
  }

  if (!opts.exporting && nearArea) {
    tCtx.save();
    tCtx.setLineDash([10 * px, 6 * px]);
    tCtx.strokeStyle = 'rgba(255,255,255,.8)';
    tCtx.lineWidth = 2 * px;
    tCtx.strokeRect(nearArea.x * T, nearArea.y * T, nearArea.s * T, nearArea.s * T);
    tCtx.restore();
  }

  // marked coordinate: red tile, a ring that stays visible when zoomed out, and its X/Y above it
  if (!opts.exporting && mark) {
    const cx = (mark.tx + 0.5) * T, cy = (mark.ty + 0.5) * T;
    const r = Math.max(1.5 * T, 18 * px);
    tCtx.save();
    tCtx.fillStyle = 'rgba(255, 40, 80, 0.55)';
    tCtx.fillRect(mark.tx * T, mark.ty * T, T, T);
    tCtx.strokeStyle = '#ff2850';
    tCtx.lineWidth = Math.max(2, 3 * px);
    tCtx.strokeRect(mark.tx * T, mark.ty * T, T, T);
    tCtx.beginPath();
    tCtx.arc(cx, cy, r, 0, Math.PI * 2);
    tCtx.stroke();
    tCtx.restore();
    // world (-d, -d)/√2 is straight up on screen once the 45° map rotation is applied
    const d = (r + Math.max(9, 13 * px)) / Math.SQRT2;
    drawLabel(tCtx, cx - d, cy - d, [`X:${mark.gx} Y:${mark.gy}`], '#ff5c7a', cam.zoom);
  }

  if (!opts.exporting && ping) {
    const now = performance.now();
    if (now > ping.until) ping = null;
    else {
      const phase = (now % 700) / 700;
      const grow = (4 + phase * 10) * T * Math.max(0.3, px);
      tCtx.save();
      tCtx.strokeStyle = `rgba(255,255,0,${1 - phase})`;
      tCtx.lineWidth = 3 * px;
      tCtx.strokeRect(ping.x * T - grow, ping.y * T - grow, ping.w * T + grow * 2, ping.h * T + grow * 2);
      tCtx.restore();
      requestDraw();
    }
  }

  tCtx.restore();
}

/* Free castle spots: 2×2 places fully inside team-1 territory where a Player could legally stand and
 * nothing (placed object or live castle) is in the way. Spots sit on a fixed 2-tile grid (even game
 * coordinates; on v2 the grid the cities use) so they line up and never straddle each other.
 * Relies on territoryGrid being computed for `objs` (renderScene does that first). */
const FREE_PROBE = { name: 'Player', type: 'one-tone', w: 2, h: 2 };
let freeKey = '', freeCache = [];
function gridParity(objs) {
  if (!V2) return { x: 0, y: 0 };
  const n = [0, 0, 0, 0];
  for (const o of objs) if (o.name === 'Player') { const g = tileToGame(o.tx + 1, o.ty + 1); n[(g.x & 1) * 2 + (g.y & 1)]++; }
  const i = n.indexOf(Math.max(...n));
  return { x: i >> 1, y: i & 1 };
}
function freeSpots(objs) {
  const liveShown = live.show ? visibleLive() : [];
  const key = objs.map(o => `${o.tx},${o.ty},${o.name}`).join('|') + `#${liveShown.length}`;
  if (key === freeKey) return freeCache;
  const par = gridParity(objs);
  const taken = new Set();
  const mark = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) taken.add(j * MAP_SIZE + i); };
  for (const o of objs) { const c = coreRect(o); mark(c.x, c.y, c.w, c.h); }
  for (const p of liveShown) mark(p.tx, p.ty, 2, 2);
  const inTeam1 = i => (territoryGrid[i] & 1) !== 0;
  const spots = [];
  const skipObjects = new Set(objs);   // object overlap is already covered by `taken`
  for (const i of [...territoryTouched].sort((a, b) => a - b)) {
    const tx = i % MAP_SIZE, ty = (i / MAP_SIZE) | 0;
    if (tx + 1 >= MAP_SIZE || ty + 1 >= MAP_SIZE) continue;
    const g = tileToGame(tx + 1, ty + 1);                           // game min corner of the 2×2
    if ((g.x - par.x) & 1 || (g.y - par.y) & 1) continue;           // fixed 2-tile grid: spots line up in rows/columns
    const cells = [i, i + 1, i + MAP_SIZE, i + MAP_SIZE + 1];
    if (!cells.every(inTeam1) || cells.some(c => taken.has(c))) continue;
    if (blockReason(FREE_PROBE, tx, ty, skipObjects)) continue;     // terrain / nodes / structures / zones
    spots.push({ tx, ty, gx: g.x, gy: g.y });
    mark(tx, ty, 2, 2);
  }
  freeKey = key;
  freeCache = spots;
  const el = $('free-count');
  if (el) el.textContent = `${spots.length}곳`;
  return spots;
}

function worldToLogic(tx, ty, obj = null) {
  let x = tx, y = ty;
  if (obj) {
    if (obj.type === 'two-tone') { x += Math.floor(obj.w / 2); y += Math.floor(obj.h / 2); }
    else { x += obj.w - 1; y += obj.h - 1; }
  }
  return { lx: clamp(MAX_COORD - y, 0, MAX_COORD), ly: clamp(MAX_COORD - x, 0, MAX_COORD) };
}

function previewPos(p) {
  return {
    tx: clamp(hoverTile.tx - Math.floor(p.w / 2), 0, MAP_SIZE - p.w),
    ty: clamp(hoverTile.ty - Math.floor(p.h / 2), 0, MAP_SIZE - p.h),
  };
}

function draw() {
  const { w, h } = viewSize();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderScene(ctx, w, h, camera, objects, { preview: placingBanner });
  updateCoverage();
  updateInfo();
}

function updateInfo() {
  let text = `Zoom : ${Math.round(camera.zoom * 100)}% / X : ${lastTile.lx} Y : ${lastTile.ly}`;
  if (hoverTile && hoverTile.tx >= 0 && hoverTile.ty >= 0 && hoverTile.tx < MAP_SIZE && hoverTile.ty < MAP_SIZE) {
    const extra = [RING_KO[ringAt(hoverTile.tx, hoverTile.ty)]];
    if (terr) {
      const v = terr[hoverTile.ty * MAP_SIZE + hoverTile.tx];
      if (v === T_MOUNTAIN) extra.push('산');
      else if (v === T_LAKE) extra.push('호수');
      else if (v >= T_NODE0 && v < T_STRUCT) extra.push(`자원지(${NODE_NAMES[v - T_NODE0]})`);
      else if (v === T_KING) extra.push('왕성 구역');
      if (v === T_STRUCT) {
        const s = structAt(hoverTile.tx, hoverTile.ty);
        if (s) extra.push(`${CAT_KO[s.cat] || s.cat} ${s.name}`);
      } else if (nobuild[hoverTile.ty * MAP_SIZE + hoverTile.tx]) extra.push('건설 금지구역');
    }
    const rf = V2 && layers.real && realFlags.find(f => f.tx === hoverTile.tx && f.ty === hoverTile.ty);
    if (rf) extra.push(`현재 깃발 ${rf.name} (게임에 설치됨)`);
    const pl = live.byTile.get(hoverTile.ty * MAP_SIZE + hoverTile.tx);
    if (pl && live.show && !supersededLive().has(pl))extra.push(`${pl.abbr ? `[${pl.abbr}] ` : ''}${pl.name} · TC${pl.tc ?? '?'}`);
    text += ' · ' + extra.join(' · ');
  }
  infoDisplay.textContent = text;
}

function structAt(tx, ty) {
  return structs.find(s => tx >= s.x && tx < s.x + s.s && ty >= s.y && ty < s.y + s.s);
}

/* ================= UI helpers ================= */
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function updateCounts() {
  const counts = { 'Player': 0, '곰덫': 0, '깃발 1': 0, '깃발 2': 0 };
  objects.forEach(o => { if (o.name in counts) counts[o.name]++; });
  document.querySelectorAll('.banner-item').forEach(b => {
    const span = b.querySelector('.count-text');
    if (span && b.dataset.name in counts) span.textContent = `(${counts[b.dataset.name]})`;
  });
}

function updateTrapSelector() {
  const traps = objects.filter(o => o.name === '곰덫');
  if (activeTrap && !traps.includes(activeTrap)) activeTrap = null;
  trapSelector.innerHTML = '<option value="none">없음</option>';
  traps.forEach((trap, idx) => {
    const option = document.createElement('option');
    option.value = String(idx);
    option.textContent = trap.nickname || `곰덫 ${idx + 1}`;
    if (trap === activeTrap) option.selected = true;
    trapSelector.appendChild(option);
  });
}

let saveTimer = null;
const undoStack = [];   // serialized states, newest last (admin undo)
function changed() {
  updateTrapSelector();
  updateCounts();
  requestDraw();
  if (READONLY) return;
  const snap = JSON.stringify(serialize());
  if (undoStack[undoStack.length - 1] !== snap) {
    undoStack.push(snap);
    if (undoStack.length > 100) undoStack.shift();
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, snap); } catch (_) { /* storage unavailable */ }
  }, 400);
}

function undo() {
  if (undoStack.length < 2) { toast('되돌릴 작업이 없습니다'); return; }
  undoStack.pop();
  const prev = undoStack.pop();       // loadObjects -> changed() pushes it back
  loadObjects(JSON.parse(prev));
  toast('되돌렸습니다');
}

function serialize() {
  return objects.map(({ name, w, h, type, color, tx, ty, nickname }) => ({ name, w, h, type, color, tx, ty, nickname }));
}

function loadObjects(list) {
  if (!Array.isArray(list)) throw new Error('bad format');
  objects = list
    .filter(o => o && typeof o.name === 'string' && Number.isFinite(o.tx) && Number.isFinite(o.ty))
    .map(o => {
      const t = TEMPLATES[o.name] || {};
      const w = o.w || t.w || 2, h = o.h || t.h || 2;
      return {
        name: o.name, w, h, type: o.type || t.type || 'one-tone', color: o.color || t.color || '#3fa9f5',
        tx: clamp(Math.round(o.tx), 0, MAP_SIZE - w), ty: clamp(Math.round(o.ty), 0, MAP_SIZE - h),
        nickname: o.nickname ?? o.name,
      };
    });
  selectedObjects = [];
  activeTrap = null;
  changed();
}

function makeObject(name, tx, ty, nickname) {
  const t = TEMPLATES[name];
  return { name, w: t.w, h: t.h, type: t.type, color: t.color, tx, ty, nickname: nickname ?? name };
}

function placeAtHover(name) {
  if (!hoverTile) return false;
  const obj = makeObject(name, 0, 0);
  const pos = previewPos(obj);
  obj.tx = pos.tx; obj.ty = pos.ty;
  if (blockOn && terrainReady) {
    const reason = blockReason(obj, pos.tx, pos.ty);
    if (reason) { toast(reason); return false; }
  }
  objects.push(obj);
  selectedObjects = [obj];
  changed();
  return true;
}

function deleteSelected() {
  if (!selectedObjects.length) return;
  objects = objects.filter(o => !selectedObjects.includes(o));
  selectedObjects = [];
  changed();
}

function setArmed(name) {
  armedName = name;
  placingBanner = name ? { ...TEMPLATES[name], name } : null;
  document.querySelectorAll('.banner-item').forEach(b => b.classList.toggle('armed', b.dataset.name === name));
  const hint = $('placing-hint');
  hint.style.display = name ? 'block' : 'none';
  hint.textContent = name ? `${name} 배치 중 — 지도를 클릭/탭하세요 (Esc 또는 버튼 다시 눌러 종료)` : '';
  requestDraw();
}

function pickObjectAt(tx, ty) {
  const all = objects.filter(o => tx >= o.tx && tx < o.tx + o.w && ty >= o.ty && ty < o.ty + o.h).reverse();
  const areas = all.filter(isTerritory);
  // overlapping areas: the one whose centre is nearest wins, so every flag can be reached
  const dist = o => Math.hypot(o.tx + o.w / 2 - (tx + 0.5), o.ty + o.h / 2 - (ty + 0.5));
  areas.sort((a, b) => dist(a) - dist(b));
  // a flag/HQ's centre (core ±1 tile) grabs that flag even when cities sit inside its area
  const onCore = areas.find(o => { const c = coreRect(o); return tx >= c.x - 1 && tx <= c.x + c.w && ty >= c.y - 1 && ty <= c.y + c.h; });
  if (onCore) return onCore;
  const solid = all.find(o => !isTerritory(o));
  if (solid) return solid;
  return areas[0] || null;
}

function startDrag(tile) {
  const moving = new Set(selectedObjects);
  dragStart = {
    tile: { x: tile.tx, y: tile.ty },
    items: selectedObjects.map(o => ({ obj: o, initTx: o.tx, initTy: o.ty })),
    // objects that were already invalid may still be moved freely
    startBlocked: new Set(selectedObjects.filter(o => blockReason(o, o.tx, o.ty, moving))),
    moving,
  };
}

let lastBlockToast = 0;
function dragTo(tile) {
  if (!dragStart) return;
  const dx = tile.tx - dragStart.tile.x, dy = tile.ty - dragStart.tile.y;
  const cand = dragStart.items.map(it => ({
    obj: it.obj,
    tx: clamp(it.initTx + dx, 0, MAP_SIZE - it.obj.w),
    ty: clamp(it.initTy + dy, 0, MAP_SIZE - it.obj.h),
  }));
  if (blockOn && terrainReady) {
    for (const c of cand) {
      if (dragStart.startBlocked.has(c.obj)) continue;
      const reason = blockReason(c.obj, c.tx, c.ty, dragStart.moving);
      if (reason) {
        if (performance.now() - lastBlockToast > 1200) { toast(reason); lastBlockToast = performance.now(); }
        return;
      }
    }
  }
  cand.forEach(c => { c.obj.tx = c.tx; c.obj.ty = c.ty; });
  requestDraw();
}

function endDrag() {
  if (dragStart && dragStart.items.some(it => it.obj.tx !== it.initTx || it.obj.ty !== it.initTy)) changed();
  dragStart = null;
}

function beginRename(obj) {
  editingObject = obj;
  const pos = worldToClient((obj.tx + obj.w / 2) * TILE_SIZE, (obj.ty + obj.h / 2) * TILE_SIZE);
  inlineInput.style.display = 'block';
  inlineInput.style.left = `${pos.x}px`;
  inlineInput.style.top = `${pos.y}px`;
  inlineInput.value = obj.nickname || obj.name;
  inlineInput.focus();
  inlineInput.select();
}

inlineInput.addEventListener('blur', () => {
  if (editingObject) { editingObject.nickname = inlineInput.value; changed(); }
  inlineInput.style.display = 'none';
  editingObject = null;
});
inlineInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') inlineInput.blur();
  if (e.key === 'Escape') { editingObject = null; inlineInput.blur(); }
});

/* ================= mouse ================= */
canvas.addEventListener('contextmenu', e => e.preventDefault());

let rightDownAt = null;
canvas.addEventListener('mousedown', e => {
  const tile = tileAt(e.clientX, e.clientY);
  if (e.button === 2 || e.button === 1) {
    isPanning = true;
    rightDownAt = { x: e.clientX, y: e.clientY };
    lastMouse = { x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button !== 0) return;
  if (armedName) {
    hoverTile = tile;
    placeAtHover(armedName);
    return;
  }
  const found = READONLY ? null : pickObjectAt(tile.tx, tile.ty);
  if (found) {
    if (e.shiftKey) {
      if (selectedObjects.includes(found)) selectedObjects = selectedObjects.filter(s => s !== found);
      else selectedObjects.push(found);
    } else if (!selectedObjects.includes(found)) {
      selectedObjects = [found];
    }
    isLeftDown = true;
    startDrag(tile);
  } else {
    if (!e.shiftKey) selectedObjects = [];
    isPanning = true;   // left-drag on empty ground pans as well
    lastMouse = { x: e.clientX, y: e.clientY };
  }
  requestDraw();
});

window.addEventListener('mousemove', e => {
  const tile = tileAt(e.clientX, e.clientY);
  const overCanvas = e.target === canvas;
  if (overCanvas || isPanning || isLeftDown) {
    hoverTile = tile;
    lastTile = worldToLogic(tile.tx, tile.ty);
  }
  if (isPanning) {
    panBy(e.clientX - lastMouse.x, e.clientY - lastMouse.y);
    lastMouse = { x: e.clientX, y: e.clientY };
  } else if (isLeftDown) {
    dragTo(tile);
  }
  if (overCanvas || isPanning || isLeftDown) requestDraw();
});

window.addEventListener('mouseup', e => {
  if (e.button === 2 && rightDownAt && armedName &&
      Math.hypot(e.clientX - rightDownAt.x, e.clientY - rightDownAt.y) < 4) setArmed(null);
  rightDownAt = null;
  if (isLeftDown) endDrag();
  isLeftDown = false;
  isPanning = false;
});

canvas.addEventListener('mouseleave', () => {
  if (!isLeftDown && !isPanning) { hoverTile = null; requestDraw(); }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.pow(1.1, -e.deltaY / 100));
  requestDraw();
}, { passive: false });

canvas.addEventListener('dblclick', e => {
  if (READONLY) return;
  const tile = tileAt(e.clientX, e.clientY);
  const found = pickObjectAt(tile.tx, tile.ty);
  if (found) beginRename(found);
});

/* ================= touch ================= */
let touch = null; // {mode:'pan'|'drag'|'pinch', start:{x,y}, moved, longPress, dist, mid}
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const ts = e.touches;
  if (ts.length === 1) {
    const t = ts[0];
    const tile = tileAt(t.clientX, t.clientY);
    hoverTile = tile;
    lastTile = worldToLogic(tile.tx, tile.ty);
    touch = { mode: 'pan', start: { x: t.clientX, y: t.clientY }, last: { x: t.clientX, y: t.clientY }, moved: false, tile };
    if (!armedName && !READONLY) {
      const found = pickObjectAt(tile.tx, tile.ty);
      if (found) {
        if (!selectedObjects.includes(found)) selectedObjects = [found];
        touch.mode = 'drag';
        startDrag(tile);
        touch.longPress = setTimeout(() => {
          if (touch && !touch.moved) { dragStart = null; touch.mode = 'none'; beginRename(found); }
        }, 550);
      }
    }
  } else if (ts.length === 2) {
    if (touch && touch.longPress) clearTimeout(touch.longPress);
    if (dragStart) endDrag();
    const [a, b] = ts;
    touch = {
      mode: 'pinch', moved: true,
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      mid: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
    };
  }
  requestDraw();
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  if (!touch) return;
  e.preventDefault();
  const ts = e.touches;
  if (touch.mode === 'pinch' && ts.length === 2) {
    const [a, b] = ts;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    panBy(mid.x - touch.mid.x, mid.y - touch.mid.y);
    if (touch.dist > 0) zoomAt(mid.x, mid.y, dist / touch.dist);
    touch.dist = dist;
    touch.mid = mid;
  } else if (ts.length === 1) {
    const t = ts[0];
    if (Math.hypot(t.clientX - touch.start.x, t.clientY - touch.start.y) > 6) {
      touch.moved = true;
      clearTimeout(touch.longPress);
    }
    const tile = tileAt(t.clientX, t.clientY);
    hoverTile = tile;
    lastTile = worldToLogic(tile.tx, tile.ty);
    if (touch.mode === 'pan' && touch.moved) {
      panBy(t.clientX - touch.last.x, t.clientY - touch.last.y);
    } else if (touch.mode === 'drag') {
      dragTo(tile);
    }
    touch.last = { x: t.clientX, y: t.clientY };
  }
  requestDraw();
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (!touch) return;
  if (e.touches.length > 0) return; // wait until all fingers are lifted
  clearTimeout(touch.longPress);
  if (touch.mode === 'drag') endDrag();
  if (touch.mode === 'pan' && !touch.moved) {
    if (armedName) { hoverTile = touch.tile; placeAtHover(armedName); }
    else selectedObjects = [];
  }
  touch = null;
  requestDraw();
});

/* ================= keyboard ================= */
window.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (READONLY) return;
  if (e.key === 'Delete' || e.key === 'Del') deleteSelected();
  if (e.key === 'Escape' && armedName) setArmed(null);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
});

/* ================= palette ================= */
document.querySelectorAll('.banner-item').forEach(b => {
  const t = TEMPLATES[b.dataset.name];
  b.style.background = t.color;
  if (b.dataset.name === 'Player') b.style.color = '#000';
  b.addEventListener('dragstart', e => {
    setArmed(null);
    placingBanner = { ...t, name: b.dataset.name };
    e.dataTransfer.setData('text/plain', b.dataset.name);
  });
  b.addEventListener('dragend', () => {
    setTimeout(() => { if (!armedName) placingBanner = null; requestDraw(); }, 10);
  });
  b.addEventListener('click', () => setArmed(armedName === b.dataset.name ? null : b.dataset.name));
});

canvasWrap.addEventListener('dragover', e => {
  e.preventDefault();
  if (!placingBanner) return;
  hoverTile = tileAt(e.clientX, e.clientY);
  requestDraw();
});
canvasWrap.addEventListener('drop', e => {
  e.preventDefault();
  if (!placingBanner) return;
  hoverTile = tileAt(e.clientX, e.clientY);
  placeAtHover(placingBanner.name);
  placingBanner = null;
  requestDraw();
});

/* ================= top bar ================= */
$('delete-btn').onclick = deleteSelected;

$('bulk-apply').onclick = () => {
  const targetName = $('bulk-type').value;
  const nickname = $('bulk-nickname').value.trim();
  const targets = objects.filter(o => o.name === targetName);
  if (!targets.length) { alert(`맵에 배치된 ${targetName} 기물이 없습니다.`); return; }
  const t = TEMPLATES[targetName];
  targets.forEach(o => {
    if (nickname) o.nickname = nickname;
    Object.assign(o, { color: t.color, w: t.w, h: t.h, type: t.type });
  });
  $('bulk-nickname').value = '';
  changed();
};

trapSelector.onchange = () => {
  const traps = objects.filter(o => o.name === '곰덫');
  activeTrap = trapSelector.value === 'none' ? null : traps[parseInt(trapSelector.value, 10)] || null;
  requestDraw();
};
buffRateInput.oninput = requestDraw;
$('show-coords').onchange = requestDraw;

function readGameInput(xEl, yEl) {
  const x = parseInt(xEl.value, 10), y = parseInt(yEl.value, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) { toast('좌표를 입력하세요'); return null; }
  return { x: clamp(x, 0, MAX_COORD), y: clamp(y, 0, MAX_COORD) };
}

$('move-btn').onclick = () => {
  // 찾기 with both boxes empty removes the marker
  if (!$('target-x').value.trim() && !$('target-y').value.trim()) {
    if (mark) { mark = null; requestDraw(); toast('좌표 표시를 지웠습니다'); }
    else toast('좌표를 입력하세요');
    return;
  }
  const g = readGameInput($('target-x'), $('target-y'));
  if (!g) return;
  const t = gameToTile(g.x, g.y);
  mark = { ...t, gx: g.x, gy: g.y };
  centerOnTile(t.tx, t.ty);
};
[$('target-x'), $('target-y')].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') $('move-btn').click(); }));

$('find-btn').onclick = () => {
  if (!activeTrap) { toast('거리기준에서 곰덫을 선택하세요'); return; }
  centerOnTile(activeTrap.tx, activeTrap.ty, activeTrap.w, activeTrap.h);
};

$('save-img-btn').onclick = () => {
  if (!objects.length) { toast('배치된 기물이 없습니다'); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  objects.forEach(o => {
    minX = Math.min(minX, o.tx * TILE_SIZE); minY = Math.min(minY, o.ty * TILE_SIZE);
    maxX = Math.max(maxX, (o.tx + o.w) * TILE_SIZE); maxY = Math.max(maxY, (o.ty + o.h) * TILE_SIZE);
  });
  const S = 1600;
  const off = document.createElement('canvas');
  off.width = S; off.height = S;
  const zoom = S / (Math.max(maxX - minX, maxY - minY, TILE_SIZE * 10) * 1.5);
  const keepSel = selectedObjects;
  selectedObjects = [];
  renderScene(off.getContext('2d'), S, S, { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom }, objects, { exporting: true });
  selectedObjects = keepSel;
  const link = document.createElement('a');
  link.download = `map_${Date.now()}.png`;
  link.href = off.toDataURL('image/png');
  link.click();
};

$('save-data-btn').onclick = () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `map_data_${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$('load-data-btn').onclick = () => $('data-input').click();
$('data-input').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imp = JSON.parse(ev.target.result);
      loadObjects(Array.isArray(imp) ? imp : imp.objects);
      toast(`${objects.length}개 기물을 불러왔습니다`);
    } catch (_) { alert('로드 실패'); }
  };
  reader.readAsText(file);
  e.target.value = '';
};

fsBtn.onclick = () => {
  if (!document.fullscreenElement) {
    if (editor.requestFullscreen) editor.requestFullscreen().catch(() => toast('전체화면을 지원하지 않습니다'));
    else toast('전체화면을 지원하지 않습니다');
  } else {
    document.exitFullscreen();
  }
};
document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  fsBtn.textContent = on ? '화면복구' : '전체화면';
  fsBtn.classList.toggle('btn-gray', on);
  fsBtn.classList.toggle('btn-main', !on);
});

/* ================= drawer: layers ================= */
const drawer = $('drawer');
$('drawer-btn').onclick = () => { drawer.hidden = !drawer.hidden; };
$('drawer-close').onclick = () => { drawer.hidden = true; };

document.querySelectorAll('[data-layer]').forEach(cb => {
  cb.checked = layers[cb.dataset.layer];
  cb.onchange = () => {
    layers[cb.dataset.layer] = cb.checked;
    if (cb.dataset.layer === 'terrain' || cb.dataset.layer === 'nodes') buildMapImage();
    requestDraw();
  };
});
$('block-toggle').onchange = e => { blockOn = e.target.checked; requestDraw(); };

/* ================= drawer: nearby lookup ================= */
function nearbyLookup(X, Y, R) {
  const out = { structs: [], nodes: [], players: [], mountain: 0, lake: 0, nodeCount: [0, 0, 0, 0] };
  const distToRect = (gx, gy, s) => {
    const dx = Math.max(0, gx - X, X - (gx + s - 1));
    const dy = Math.max(0, gy - Y, Y - (gy + s - 1));
    return { gap: Math.max(dx, dy), d: Math.hypot(dx, dy) };
  };
  for (const s of structs) {
    const r = distToRect(s.gx, s.gy, s.s);
    if (r.gap <= R) out.structs.push({ s, ...r });
  }
  for (const n of nodes) {
    const r = distToRect(n.gx, n.gy, 2);
    if (r.gap <= R) { out.nodes.push({ n, ...r }); out.nodeCount[n.t]++; }
  }
  if (terr) {
    for (let gy = Math.max(0, Y - R); gy <= Math.min(MAX_COORD, Y + R); gy++)
      for (let gx = Math.max(0, X - R); gx <= Math.min(MAX_COORD, X + R); gx++) {
        const t = gameToTile(gx, gy);
        const v = terr[t.ty * MAP_SIZE + t.tx];
        if (v === T_MOUNTAIN) out.mountain++;
        else if (v === T_LAKE) out.lake++;
      }
  }
  for (const p of visibleLive()) {
    const r = distToRect(p.gx, p.gy, 2);
    if (r.gap <= R) out.players.push({ p, ...r });
  }
  const byDist = (a, b) => a.d - b.d;
  out.structs.sort(byDist); out.nodes.sort(byDist); out.players.sort(byDist);
  return out;
}

function resultItem(label, meta, onClick) {
  const el = document.createElement('div');
  el.className = 'item';
  const a = document.createElement('span'); a.textContent = label;
  const b = document.createElement('span'); b.textContent = meta;
  el.append(a, b);
  el.onclick = onClick;
  return el;
}

function runNearby() {
  const g = readGameInput($('near-x'), $('near-y'));
  if (!g) return;
  const R = clamp(parseInt($('near-r').value, 10) || 30, 1, 200);
  const res = nearbyLookup(g.x, g.y, R);
  const t = gameToTile(g.x, g.y);
  nearArea = { x: MAX_COORD - (g.y + R), y: MAX_COORD - (g.x + R), s: 2 * R + 1 };
  centerOnTile(t.tx, t.ty);

  const box = $('near-result');
  box.innerHTML = '';
  const head = (text) => { const d = document.createElement('div'); d.className = 'grp'; d.textContent = text; box.append(d); };
  const ring = RING_KO[ringAt(t.tx, t.ty)];
  head(`${g.x}, ${g.y} 주변 ±${R}칸 · ${ring}`);
  box.append(resultItem('장애물 타일', `산 ${res.mountain} · 호수 ${res.lake}`, () => {}));
  box.append(resultItem('연맹 자원지', res.nodeCount.map((c, i) => `${NODE_NAMES[i]} ${c}`).join(' · '), () => {}));

  if (res.structs.length) {
    head(`구조물 ${res.structs.length}`);
    res.structs.slice(0, 12).forEach(({ s, d }) => box.append(resultItem(
      `${CAT_KO[s.cat] || s.cat} · ${s.name}`, `${s.gx}, ${s.gy} · ~${Math.round(d)}칸`,
      () => centerOnTile(s.x, s.y, s.s, s.s))));
  }
  if (res.nodes.length) {
    head(`가까운 연맹 자원지 (${res.nodes.length}곳 중 ${Math.min(20, res.nodes.length)})`);
    computeTerritory(objects);
    res.nodes.slice(0, 20).forEach(({ n, d }) => {
      const team = nodeTeams(n);
      const owner = team & 1 ? ' · 1팀 영토' : team & 2 ? ' · 2팀 영토' : '';
      box.append(resultItem(`${NODE_NAMES[n.t]} ${n.gx}, ${n.gy}${owner}`, `~${Math.round(d)}칸`,
        () => centerOnTile(n.tx, n.ty, 2, 2)));
    });
  }
  if (res.players.length) {
    head(`플레이어 ${res.players.length}명`);
    res.players.slice(0, 30).forEach(({ p, d }) => box.append(resultItem(
      `${p.abbr ? `[${p.abbr}] ` : ''}${p.name}`, `${p.gx}, ${p.gy} · ~${Math.round(d)}칸`,
      () => centerOnTile(p.tx, p.ty, 2, 2))));
  }
  requestDraw();
}

$('near-btn').onclick = runNearby;
[$('near-x'), $('near-y'), $('near-r')].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') runNearby(); }));
$('near-center-btn').onclick = () => {
  const g = tileToGame(Math.floor(camera.x / TILE_SIZE), Math.floor(camera.y / TILE_SIZE));
  $('near-x').value = clamp(g.x, 0, MAX_COORD);
  $('near-y').value = clamp(g.y, 0, MAX_COORD);
  runNearby();
};
$('near-clear-btn').onclick = () => { nearArea = null; $('near-result').innerHTML = ''; requestDraw(); };

/* ================= drawer: live kingdom ================= */
const live = { players: [], byTile: new Map(), filter: '*', show: true, kid: null };
const RAW_API = kid => `https://kingshotstats.com/api/map?kid=${encodeURIComponent(kid)}`;

function allianceColor(abbr) {
  if (!abbr) return '#9aa5b1';
  let h = 0;
  for (let i = 0; i < abbr.length; i++) h = (h * 31 + abbr.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 60%)`;
}

// The placed layout is the source of truth: hide live castles that are already placed by name,
// or whose (outdated) position is now occupied by a placed object.
const normName = s => String(s).replace(/ /g, ' ').trim().toLowerCase();
let supersededKey = '', supersededSet = new Set();
function supersededLive() {
  const key = objects.length + ':' + objects.map(o => o.tx + ',' + o.ty + ',' + o.nickname).join('|');
  if (key === supersededKey) return supersededSet;
  const names = new Set(objects.filter(o => o.name === 'Player').map(o => normName(o.nickname)));
  const occupied = new Set();
  for (const o of objects) {
    const c = coreRect(o);
    for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) occupied.add(y * MAP_SIZE + x);
  }
  supersededSet = new Set(live.players.filter(p => names.has(normName(p.name)) ||
    [0, 1].some(dy => [0, 1].some(dx => occupied.has((p.ty + dy) * MAP_SIZE + p.tx + dx)))));
  supersededKey = key;
  return supersededSet;
}
const visibleLive = () => { const hide = supersededLive(); return live.players.filter(p => !hide.has(p)); };

function drawLivePlayers(tCtx, cam, vr) {
  const T = TILE_SIZE;
  const labels = cam.zoom >= 0.45;
  const players = visibleLive();
  for (const p of players) {
    if (p.tx < vr.x0 - 2 || p.tx > vr.x1 || p.ty < vr.y0 - 2 || p.ty > vr.y1) continue;
    const dim = live.filter !== '*' && p.abbr !== live.filter;
    tCtx.globalAlpha = dim ? 0.25 : 0.9;
    tCtx.fillStyle = p.color;
    tCtx.fillRect(p.tx * T + 2, p.ty * T + 2, 2 * T - 4, 2 * T - 4);
  }
  tCtx.globalAlpha = 1;
  if (!labels) return;
  for (const p of players) {
    if (p.tx < vr.x0 - 2 || p.tx > vr.x1 || p.ty < vr.y0 - 2 || p.ty > vr.y1) continue;
    if (live.filter !== '*' && p.abbr !== live.filter) continue;
    drawLabel(tCtx, (p.tx + 1) * T, (p.ty + 1) * T, [p.abbr ? `[${p.abbr}]${p.name}` : p.name], '#fff', cam.zoom * 1.3);
  }
}

function setLiveStatus(msg) { $('live-status').textContent = msg; }

function applyLive(data) {
  const cities = Array.isArray(data) ? data : (data.cities || data.players || data.data);
  if (!Array.isArray(cities)) throw new Error('플레이어 목록이 없습니다');
  const players = [];
  for (const c of cities) {
    if (typeof c.x !== 'number' || typeof c.y !== 'number') continue;
    const gx = clamp(c.x, 0, MAX_COORD - 1), gy = clamp(c.y, 0, MAX_COORD - 1);
    const t = gameRectToWorld(gx, gy, 2);
    const abbr = c.alliance_abbr || '';
    players.push({
      name: String(c.nick_name || c.name || '?'), abbr, gx, gy, tx: t.x, ty: t.y,
      tc: c.tc ?? c.stove_lv ?? null, power: c.power ?? null, color: allianceColor(abbr),
    });
  }
  if (!players.length) throw new Error('좌표가 있는 플레이어가 없습니다');
  live.players = players;
  supersededKey = '';
  live.kid = data.kid ?? live.kid;
  live.byTile = new Map();
  for (const p of players)
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) live.byTile.set((p.ty + dy) * MAP_SIZE + p.tx + dx, p);

  const counts = new Map();
  players.forEach(p => counts.set(p.abbr, (counts.get(p.abbr) || 0) + 1));
  const sel = $('live-filter');
  sel.innerHTML = '';
  sel.append(new Option(`전체 (${players.length})`, '*'));
  [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([abbr, n]) => sel.append(new Option(`${abbr || '무소속'} (${n})`, abbr)));
  live.filter = '*';
  $('live-controls').hidden = false;
  setLiveStatus(`왕국 #${live.kid ?? '?'} · 플레이어 ${players.length.toLocaleString()}명`);
  requestDraw();
}

async function loadKingdom(kid) {
  live.kid = kid;
  $('raw-link').href = RAW_API(kid);
  setLiveStatus(`왕국 #${kid} 불러오는 중…`);
  const urls = [];
  if (location.protocol.startsWith('http')) urls.push(new URL(`api/kingdom?kid=${encodeURIComponent(kid)}`, BASE).href);
  urls.push(RAW_API(kid));
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      applyLive(await res.json());
      try { localStorage.setItem(KID_KEY, kid); } catch (_) { /* storage unavailable */ }
      return;
    } catch (_) { /* try the next source */ }
  }
  setLiveStatus('직접 불러오기 실패 (CORS). server.js로 실행하거나 아래 "직접 붙여넣기"를 사용하세요.');
  $('paste-box').open = true;
}

$('kid-btn').onclick = () => {
  const kid = $('kid-input').value.trim();
  if (!/^\d+$/.test(kid)) { toast('왕국 번호를 숫자로 입력하세요'); return; }
  loadKingdom(kid);
};
$('kid-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('kid-btn').click(); });
$('kid-input').addEventListener('input', () => {
  const kid = $('kid-input').value.trim();
  if (/^\d+$/.test(kid)) $('raw-link').href = RAW_API(kid);
});
$('paste-btn').onclick = () => {
  try { applyLive(JSON.parse($('paste-input').value)); $('paste-input').value = ''; $('paste-box').open = false; }
  catch (err) { setLiveStatus('붙여넣은 데이터를 읽지 못했습니다: ' + err.message); }
};
$('live-filter').onchange = e => { live.filter = e.target.value; requestDraw(); };
$('live-show').onchange = e => { live.show = e.target.checked; requestDraw(); };
$('live-clear-btn').onclick = () => {
  live.players = []; live.byTile = new Map();
  $('live-controls').hidden = true;
  setLiveStatus('');
  requestDraw();
};

function filteredPlayers() {
  return visibleLive().filter(p => live.filter === '*' || p.abbr === live.filter);
}

$('live-find-btn').onclick = () => {
  const ps = filteredPlayers();
  if (!ps.length) return;
  // jump to the densest cluster (most castles within ±30 tiles), not the average position
  const sample = ps.length > 1500 ? ps.filter((_, i) => i % Math.ceil(ps.length / 1500) === 0) : ps;
  let best = sample[0], bestN = -1;
  for (const p of sample) {
    let n = 0;
    for (const q of ps) if (Math.abs(q.tx - p.tx) <= 30 && Math.abs(q.ty - p.ty) <= 30) n++;
    if (n > bestN) { bestN = n; best = p; }
  }
  centerOnTile(best.tx, best.ty, 2, 2);
};

$('live-import-btn').onclick = () => {
  const ps = filteredPlayers();
  if (!ps.length) return;
  if (live.filter === '*' && !confirm(`전체 ${ps.length}명을 Player 기물로 추가할까요? 연맹을 먼저 고르는 것을 권장합니다.`)) return;
  const existing = new Set(objects.filter(o => o.name === 'Player').map(o => `${o.tx},${o.ty}`));
  let added = 0;
  for (const p of ps) {
    if (existing.has(`${p.tx},${p.ty}`)) continue;
    objects.push(makeObject('Player', p.tx, p.ty, p.name));
    added++;
  }
  changed();
  toast(`Player ${added}명 추가 (이미 있는 위치 ${ps.length - added}개 제외)`);
};

/* ================= boot ================= */
function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvasWrap.clientWidth * dpr);
  canvas.height = Math.round(canvasWrap.clientHeight * dpr);
  requestDraw();
}
new ResizeObserver(resize).observe(canvasWrap);

// start view: 100% zoom on 사냥 함정 2 (else the 2nd trap, else the middle of the cities)
const HOME_TRAP = '사냥 함정 2';
function centerOnObjects() {
  const traps = objects.filter(o => o.name === '곰덫');
  const home = traps.find(o => o.nickname === HOME_TRAP) || traps[1];
  if (home) {
    camera.x = (home.tx + home.w / 2) * TILE_SIZE;
    camera.y = (home.ty + home.h / 2) * TILE_SIZE;
  } else {
    const players = objects.filter(o => o.name === 'Player' || o.name === '곰덫');
    if (!players.length) return;
    const med = arr => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    camera.x = med(players.map(o => o.tx)) * TILE_SIZE;
    camera.y = med(players.map(o => o.ty)) * TILE_SIZE;
  }
  camera.zoom = 1;
  if (mark) centerOnTile(mark.tx, mark.ty);   // ?mark=X,Y opens on the marked tile instead
  requestDraw();
}

initStructures();
loadMapData();
updateCounts();
resize();

// Kingdom: ?kid= in the URL, else the last one loaded, else the default kingdom.
const kidParam = new URLSearchParams(location.search).get('kid');
let startKid = DEFAULT_KID;
try { startKid = localStorage.getItem(KID_KEY) || DEFAULT_KID; } catch (_) { /* storage unavailable */ }
if (kidParam && /^\d+$/.test(kidParam)) startKid = kidParam;
$('kid-input').value = startKid;
$('raw-link').href = RAW_API(startKid);

// ?mark=X,Y: open with that game coordinate marked (same marker as 좌표 찾기)
const markParam = /^(\d+),(\d+)$/.exec(new URLSearchParams(location.search).get('mark') || '');
if (markParam) {
  const gx = clamp(+markParam[1], 0, MAX_COORD), gy = clamp(+markParam[2], 0, MAX_COORD);
  mark = { ...gameToTile(gx, gy), gx, gy };
  $('target-x').value = gx;
  $('target-y').value = gy;
}

const API = p => new URL(`api/${p}`, BASE).href;
// published layout: the server's copy (Cloudflare KV / local file), else the bundled file
const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
const fetchPublished = () => getJSON(API(LAYOUT_API)).catch(() => getJSON(PUBLISHED_LAYOUT));

// /v1/flags (v1/flags.html) is the KOR flag survey (flags.js + layouts/flags.json), kept apart from the seat layout.
// /v1/flags?layout=<name> instead shows another file from layouts/ read-only.
const layoutParam = new URLSearchParams(location.search).get('layout');
const FLAGS_PAGE = /\/flags(\.html)?\/?$/.test(location.pathname);
const PROPOSAL = FLAGS_PAGE && layoutParam && /^[\w.-]+$/.test(layoutParam) ? layoutParam : null;
if (PROPOSAL) document.title = 'KOR 깃발 최적화안';

function startView() {
  if (FLAGS_PAGE && !PROPOSAL) {
    // flags.js runs outside this closure: hand it what it needs
    window.KS_APP = {
      BASE, TEMPLATES, MAX_COORD, MAP_SIZE, WORLD_SIZE, NODE_NAMES, layers, live, drawer,
      get objects() { return objects; }, get nodes() { return nodes; }, get terrainReady() { return terrainReady; },
      makeObject, loadObjects, isTerritory, blockReason, centerOnTile, centerOnObjects, resultItem, toast, getJSON,
      applyLive, requestDraw, viewSize,
      select: list => { selectedObjects = list; requestDraw(); },
      setCamera: c => { camera = { ...camera, ...c }; requestDraw(); },
    };
    const s = document.createElement('script');
    s.src = new URL('flags.js', BASE).href;
    document.body.append(s);
    return;
  }
  // everyone sees exactly the published layout; nothing is read from or written to browser storage
  const load = PROPOSAL ? getJSON(new URL(`layouts/${PROPOSAL}.json`, BASE).href) : fetchPublished();
  load
    .then(list => { loadObjects(list); centerOnObjects(); if (PROPOSAL) toast('KOR 깃발 최적화안 (게시본 아님)'); })
    .catch(() => toast(PROPOSAL ? `배치 파일 ${PROPOSAL}.json 을 찾을 수 없습니다` : '게시된 배치도를 불러오지 못했습니다'));
}

function startAdmin() {
  document.body.classList.add('admin');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { /* no draft */ }
  if (Array.isArray(saved) && saved.length) { loadObjects(saved); centerOnObjects(); fillV2Traps(); }
  else fetchPublished().then(list => { loadObjects(list); centerOnObjects(); fillV2Traps(); }).catch(() => {});
}
if (V2) {
  document.body.classList.add('v2');
  document.title = '킹샷 배치 시뮬레이터 · v2 신규 자리';
  document.querySelector('.admin-badge').textContent = '관리자 · v2 신규 자리';
  const back = document.querySelector('#login-form a');
  back.href = '/v2/';
  back.textContent = '신규 자리 안내로 가기';
}

/* ---- admin sign-in: the server checks the password and hands out a signed, 12-hour token ---- */
const TOKEN_KEY = 'ks-admin-token';
let adminToken = null;
try { adminToken = sessionStorage.getItem(TOKEN_KEY); } catch (_) { /* no session storage */ }
const tokenValid = t => !!t && Number(t.split('.')[0]) > Date.now();
let adminStarted = false;

function requireLogin() {
  if (tokenValid(adminToken)) { if (!adminStarted) { adminStarted = true; startAdmin(); } return; }
  const gate = $('login');
  gate.hidden = false;
  $('login-id').focus();
  $('login-form').onsubmit = async e => {
    e.preventDefault();
    $('login-error').textContent = '확인 중…';
    try {
      const r = await fetch(API('login'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: $('login-id').value.trim(), pw: $('login-pw').value }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok || !res.token) {
        $('login-error').textContent = res.error || (r.status === 404 ? '서버 기능(_worker.js)이 없습니다.' : `로그인 실패 (${r.status})`);
        return;
      }
      adminToken = res.token;
      try { sessionStorage.setItem(TOKEN_KEY, adminToken); } catch (_) { /* keep in memory */ }
      $('login-pw').value = '';
      $('login-error').textContent = '';
      gate.hidden = true;
      if (!adminStarted) { adminStarted = true; startAdmin(); }
    } catch (_) {
      $('login-error').textContent = '서버에 연결하지 못했습니다.';
    }
  };
}

if (ADMIN) requireLogin();
else startView();
$('live-section').hidden = !LIVE_ENABLED;
if (LIVE_ENABLED && location.protocol.startsWith('http')) loadKingdom(startKid);

/* ================= admin: compare with the published layout ================= */
$('undo-btn').onclick = undo;
$('publish-btn').onclick = async () => {
  if (!confirm(`현재 배치(기물 ${objects.length}개)를 게시할까요? 모든 사람의 화면에 반영됩니다.`)) return;
  if (!tokenValid(adminToken)) { toast('다시 로그인하세요'); requireLogin(); return; }
  try {
    const r = await fetch(API(LAYOUT_API), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(serialize()),
    });
    const res = await r.json().catch(() => ({}));
    if (r.status === 401) {
      adminToken = null;
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) { /* ignore */ }
      toast('로그인이 만료되었습니다 — 다시 로그인한 뒤 게시하세요');
      requireLogin();
      return;
    }
    if (!r.ok) { toast(`게시 실패: ${res.error || r.status}`); return; }
    $('diff-result').innerHTML = '';
    toast(`게시했습니다 (기물 ${res.count}개) — 모든 사람에게 반영됩니다`);
  } catch (_) {
    toast('게시 실패: 서버에 연결하지 못했습니다');
  }
};

$('diff-btn').onclick = async () => {
  const box = $('diff-result');
  box.innerHTML = '';
  let published;
  try { published = await fetchPublished(); } catch (_) { toast('게시된 배치도를 불러오지 못했습니다'); return; }
  // pair objects by type+name; several objects can share a name (e.g. two "연맹 제철소"),
  // so within a name group identical positions pair first, then the nearest remaining ones
  const keyOf = o => `${o.name}\u0000${o.nickname}`;
  const group = list => list.reduce((m, o) => m.set(keyOf(o), [...(m.get(keyOf(o)) || []), o]), new Map());
  const pubG = group(published), curG = group(objects);
  const coord = o => { const l = worldToLogic(o.tx, o.ty, o); return `${l.lx},${l.ly}`; };
  const rows = [];
  for (const key of new Set([...pubG.keys(), ...curG.keys()])) {
    const ps = [...(pubG.get(key) || [])], cs = [...(curG.get(key) || [])];
    for (const o of [...cs]) {
      const i = ps.findIndex(p => p.tx === o.tx && p.ty === o.ty);
      if (i >= 0) { ps.splice(i, 1); cs.splice(cs.indexOf(o), 1); }
    }
    while (ps.length && cs.length) {
      const o = cs.shift();
      let bi = 0;
      ps.forEach((p, i) => { if (Math.hypot(p.tx - o.tx, p.ty - o.ty) < Math.hypot(ps[bi].tx - o.tx, ps[bi].ty - o.ty)) bi = i; });
      const p = ps.splice(bi, 1)[0];
      rows.push({ text: `이동: ${o.nickname}`, meta: `${coord(o)} → ${coord(p)}`, fix: () => { o.tx = p.tx; o.ty = p.ty; }, at: p });
    }
    for (const o of cs) rows.push({ text: `추가됨: ${o.nickname}`, meta: coord(o), fix: () => { objects = objects.filter(x => x !== o); } });
    for (const p of ps) rows.push({ text: `삭제됨: ${p.nickname}`, meta: coord(p), fix: () => { objects.push({ ...p }); }, at: p });
  }
  if (!rows.length) { box.append(resultItem('게시된 배치도와 같습니다', '', () => {})); return; }
  const head = document.createElement('div');
  head.className = 'grp';
  head.textContent = `차이 ${rows.length}건 — 항목을 누르면 게시본대로 되돌립니다`;
  box.append(head);
  for (const r of rows) {
    const el = resultItem(`↩ ${r.text}`, r.meta, () => {
      r.fix();
      selectedObjects = [];
      changed();
      if (r.at) centerOnTile(r.at.tx, r.at.ty, r.at.w, r.at.h);
      el.remove();
    });
    box.append(el);
  }
  box.append(resultItem('↩ 전부 게시본으로 되돌리기', '', () => { loadObjects(published); box.innerHTML = ''; toast('게시된 배치도로 되돌렸습니다'); }));
};

/* ================= v2 admin: flags standing in the game now (layouts/flags.json, same data as /flags) ================= */
let realFlags = [], realSegs = [], realRaw = [];
function setRealFlags(list) {
  realRaw = list;
  // a flag's in-game X/Y is its own tile; its territory is the 7×7 around it
  realFlags = list.map(f => ({ tx: MAX_COORD - f.y, ty: MAX_COORD - f.x, name: f.name }));
  const cells = new Set();
  for (const f of realFlags) for (let y = f.ty - 3; y <= f.ty + 3; y++) for (let x = f.tx - 3; x <= f.tx + 3; x++) cells.add(`${x},${y}`);
  realSegs = [];
  for (const c of cells) {
    const [x, y] = c.split(',').map(Number);
    if (!cells.has(`${x - 1},${y}`)) realSegs.push([x, y, x, y + 1]);
    if (!cells.has(`${x + 1},${y}`)) realSegs.push([x + 1, y, x + 1, y + 1]);
    if (!cells.has(`${x},${y - 1}`)) realSegs.push([x, y, x + 1, y]);
    if (!cells.has(`${x},${y + 1}`)) realSegs.push([x, y + 1, x + 1, y + 1]);
  }
}
if (V2) getJSON(new URL('layouts/flags.json', BASE).href).then(d => {
  setRealFlags(d.flags);
  $('v2-real-count').textContent = `${realFlags.length}개 · 조사 ${d.updated || '-'}`;
  requestDraw();
}).catch(() => { $('v2-real-count').textContent = '불러오지 못함'; });

/* ================= v2 admin: rule check · re-assign names (USB tools: v2/core.js + v2/plan.js) ================= */
let v2Map = null;
function v2Engine() {
  const load = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL(src, BASE).href;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`${src} 를 불러오지 못했습니다`));
    document.body.append(s);
  });
  if (!v2Map) v2Map = load('v2/core.js').then(() => load('v2/plan.js')).then(() => load('v2/flagplan.js')).then(() => window.KSPlan.loadMap());
  return v2Map.catch(err => { v2Map = null; throw err; });
}
const objNamed = n => objects.find(o => o.nickname === n);
const focusObj = o => { if (!o) return; selectedObjects = [o]; centerOnTile(o.tx, o.ty, o.w, o.h); };
const lineSummary = s => `곰덫2 1줄 ${s.lines[1]} · 2줄 ${s.lines[2]} · 3줄 ${s.lines[3]} · 4줄+ ${s.lines[4]} · 곰덫1 1줄 ${s.lines1[1]} · 2줄 ${s.lines1[2]}`;

// trap inputs start at the editor's current bear traps
function fillV2Traps() {
  if (!V2) return;
  const traps = objects.filter(o => o.name === '곰덫');
  const t1 = traps.find(o => o.nickname === '사냥 함정 1') || traps[0], t2 = traps.find(o => o.nickname === '사냥 함정 2') || traps[1];
  const corner = o => ({ x: MAP_SIZE - o.ty - o.h, y: MAP_SIZE - o.tx - o.w });   // game min corner (same as plan.js toGame)
  for (const [o, k] of [[t2, 't2'], [t1, 't1']]) {
    if (!o || $(`v2-${k}x`).value) continue;
    const g = corner(o);
    $(`v2-${k}x`).value = g.x;
    $(`v2-${k}y`).value = g.y;
  }
}

// 작전도 opens on the trap spots typed below (/v2/plan?t2=X,Y&t1=X,Y)
$('v2-plan-link').onclick = e => {
  const v = id => $(id).value.trim();
  const ok = ['v2-t2x', 'v2-t2y', 'v2-t1x', 'v2-t1y'].every(id => /^\d+$/.test(v(id)));
  e.currentTarget.href = ok ? `/v2/plan?t2=${v('v2-t2x')},${v('v2-t2y')}&t1=${v('v2-t1x')},${v('v2-t1y')}` : '/v2/plan';
};

$('v2-check-btn').onclick = async () => {
  const box = $('v2-check-result');
  box.textContent = '검사 중…';
  let map;
  try { map = await v2Engine(); } catch (err) { box.textContent = err.message; return; }
  const list = serialize();
  const r = window.KSPlan.check(map, list);
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'grp';
  head.textContent = r.stats
    ? `연맹원 ${r.stats.members} · 빈자리 ${r.stats.spare} · 깃발 ${r.stats.banners} · ${lineSummary(r.stats)}`
    : '';
  box.append(head);
  if (!r.errs.length) {
    const ok = resultItem('규칙 위반 없음', '겹침·장애물·영토·깃발 연결·오와 열', () => {});
    ok.classList.add('ok');
    box.append(ok);
    return;
  }
  // one row per broken object (click = go there), then the errors that are not about one object (오와 열 …)
  const rows = r.bad.map(b => { const o = objects[list.indexOf(b.o)]; return [o ? o.nickname || o.name : '?', b.msg, () => focusObj(o)]; })
    .concat(r.errs.filter(e => !e.includes(':')).map(e => [e, '', () => {}]));
  for (const [text, meta, go] of rows) {
    const el = resultItem(text, meta, go);
    el.classList.add('err');
    box.append(el);
  }
};

$('v2-assign-btn').onclick = async () => {
  const box = $('v2-assign-result');
  const num = id => parseInt($(id).value, 10);
  const t2 = { x: num('v2-t2x'), y: num('v2-t2y') }, t1 = { x: num('v2-t1x'), y: num('v2-t1y') };
  const total = clamp(num('v2-total') || 100, 1, 200);
  if (![t2.x, t2.y, t1.x, t1.y].every(v => Number.isFinite(v) && v >= 0 && v <= MAX_COORD - 2)) { toast('곰덫 좌표를 입력하세요'); return; }
  if (!confirm(`곰덫2 ${t2.x},${t2.y} / 곰덫1 ${t1.x},${t1.y} 기준으로 v2 배치를 새로 만듭니다.\n편집 중인 배치가 바뀝니다 (Ctrl+Z로 되돌릴 수 있음). 계속할까요?`)) return;
  box.textContent = '계산 중…';
  let map, old;
  try {
    [map, old] = await Promise.all([v2Engine(), getJSON(API('layout')).catch(() => getJSON(new URL('layouts/current.json', BASE).href))]);
  } catch (err) { box.textContent = `불러오기 실패: ${err.message}`; return; }
  let out;
  try {
    const hq = window.KSPlan.readLayout(serialize()).hq || undefined;   // keep the editor's HQ, else the plains HQ 523,759
    out = window.KSPlan.assign(map, old, { t2, t1, total, hq });
  } catch (err) { box.textContent = `계산 실패: ${err.message}`; return; }
  const { objects: list, stats: s } = out;
  loadObjects(list);
  centerOnObjects();
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'grp';
  head.textContent = `같은 상대 자리 ${s.same}/${s.members}명 · 옮긴 ${s.moved.length}명 · 깃발 ${s.banners} · 빈자리 ${s.spare} · 검증 오류 ${s.errs.length}`;
  box.append(head);
  const lines = document.createElement('div');
  lines.className = 'grp';
  lines.textContent = `연맹원 ${lineSummary(s)}${s.resMissing ? ` · 연맹 자원 ${s.resMissing}개 자리 없음` : ''}`;
  box.append(lines);
  for (const m of s.moved) box.append(resultItem(`옮김: ${m.n}`, `${m.from.x},${m.from.y} → ${m.to.x},${m.to.y} (${m.d.toFixed(1)}칸)`, () => focusObj(objNamed(m.n))));
  for (const e of s.errs.slice(0, 10)) { const el = resultItem(e, '', () => {}); el.classList.add('err'); box.append(el); }
  toast('계산한 배치를 불러왔습니다 — 확인 후 게시하기를 누르세요');
};

/* ================= v2 admin: flag relocation that reuses the flags standing now + work order (v2/flagplan.js) ================= */
let fpWorker = null;
function runFlagWorker(msg) {
  return new Promise((resolve, reject) => {
    if (!fpWorker) fpWorker = new Worker(new URL('v2/flagworker.js', BASE).href);
    fpWorker.onmessage = e => (e.data.ok ? resolve(e.data.r) : reject(new Error(e.data.error)));
    fpWorker.onerror = e => { fpWorker = null; reject(new Error(e.message || '계산 워커 오류')); };
    fpWorker.postMessage(msg);
  });
}
const RULE_KO = { corner: '꼭짓점 접촉', edge: '변 접촉' };
const focusGame = (x, y) => centerOnTile(MAX_COORD - y - 3, MAX_COORD - x - 3, 7, 7);
const fpCap = () => { const v = parseInt($('fp-cap').value, 10); return Number.isFinite(v) && v > 0 ? v : undefined; };

// steps: [{op, f, why, phase}] — build steps are named after the editor's flag on that tile
function showFlagOrder(box, plan, head) {
  box.innerHTML = '';
  for (const text of head) { const d = document.createElement('div'); d.className = 'grp'; d.textContent = text; box.append(d); }
  const nameAt = new Map(objects.filter(o => o.name === '깃발 1').map(o => { const g = tileToGame(o.tx + 3, o.ty + 3); return [`${g.x},${g.y}`, o.nickname]; }));
  const PH = { 1: '1단계 · 새 깃발 설치', 2: '2단계 · 새 자리 비우기 (꼭 철거)' };
  let ph = 0, n = 0;
  for (const s of plan.steps) {
    if (s.phase !== ph) { ph = s.phase; const d = document.createElement('div'); d.className = 'grp'; d.textContent = PH[ph]; box.append(d); }
    const label = s.op === 'build' ? `${++n}. 설치 ${nameAt.get(`${s.f.x},${s.f.y}`) || ''}` : `${++n}. 철거 ${s.f.name || ''}`;
    const el = resultItem(label, `${s.f.x},${s.f.y} · ${s.why}`, () => focusGame(s.f.x, s.f.y));
    el.classList.add(s.op === 'build' ? 'ok' : 'err');
    box.append(el);
  }
  if (plan.stuck) { const el = resultItem('일부 작업을 이어서 할 수 없습니다', `남은 설치 ${plan.left.build.length} · 철거 ${plan.left.remove.length}`, () => {}); el.classList.add('err'); box.append(el); }
  if (plan.optional && plan.optional.length) { const d = document.createElement('div'); d.className = 'grp'; d.textContent = `v2에 쓰지 않는 지금 깃발 ${plan.optional.length}개는 자리와 겹치지 않아 그대로 둬도 됩니다`; box.append(d); }
}

$('fp-btn').onclick = async () => {
  const box = $('fp-result');
  if (!realRaw.length) { toast('지금 깃발 데이터(layouts/flags.json)를 아직 불러오지 못했습니다'); return; }
  if (!confirm('지금 깃발을 재사용하도록 편집 중인 배치의 깃발(과 빈자리)을 바꿉니다. Ctrl+Z로 되돌릴 수 있습니다. 계속할까요?')) return;
  box.textContent = '계산 중… (몇 초 걸립니다)';
  $('fp-btn').disabled = true;
  let r;
  try {
    // 기존 배치(/v1 게시본): 마지막 줄 채우기(곰덫2 3줄 · 곰덫1 2줄)에서 각자의 기준 곰덫을 정하는 데 씀
    const oldList = await getJSON(API('layout')).catch(() => getJSON(new URL('layouts/current.json', BASE).href)).catch(() => null);
    r = await runFlagWorker({ list: serialize(), existing: realRaw, opt: { rule: $('fp-rule').value, cap: fpCap(), refitSpares: $('fp-refit').checked, oldList } });
  } catch (err) { box.textContent = `계산 실패: ${err.message}`; return; }
  finally { $('fp-btn').disabled = false; }
  loadObjects(r.objects);
  const s = r.stats;
  showFlagOrder(box, r.plan, [
    `${RULE_KO[r.rule]} 기준 · 깃발 ${s.total}개 = 유지 ${s.keep} + 새로 설치 ${s.build} · 꼭 철거 ${s.remove} (계산 전 ${s.before}개)`,
    r.alt ? `비교: ${RULE_KO[r.alt.rule]}이면 새로 ${r.alt.stats.build}개 · 전체 ${r.alt.stats.total}개` : '',
    r.errs.length ? `규칙 위반 ${r.errs.length}건: ${r.errs.slice(0, 2).join(' / ')}` : '규칙 위반 없음',
    r.promoted && r.promoted.length ? `우선 구역 채우기로 옮긴 연맹원: ${r.promoted.map(m => `${m.n} ${m.from.x},${m.from.y}→${m.to.x},${m.to.y}`).join(' / ')}` : '',
    r.filled && r.filled.moved.length ? `줄 채우기 (곰덫2 1·2·3줄 ${r.filled.before.t2.join('·')} → ${r.filled.after.t2.join('·')}): ${r.filled.moved.map(m => `${m.n} ${m.from.x},${m.from.y}→${m.to.x},${m.to.y}`).join(' / ')}` : '',
    `작업 순서 · 깃발 수 상한 ${Number.isFinite(r.plan.cap) ? r.plan.cap + '개' : '없음'}`,
  ].filter(Boolean));
  toast(`깃발 ${s.total}개 (새로 ${s.build}개) — 확인 후 게시하기를 누르세요`);
};

$('fp-order-btn').onclick = async () => {
  const box = $('fp-result');
  if (!realRaw.length) { toast('지금 깃발 데이터(layouts/flags.json)를 아직 불러오지 못했습니다'); return; }
  box.textContent = '계산 중…';
  try { await v2Engine(); } catch (err) { box.textContent = err.message; return; }
  const FP = window.KSFlagPlan, KP = window.KSPlan;
  const list = serialize(), L = KP.readLayout(list);
  const target = L.banners.map(b => ({ x: b.x, y: b.y }));
  const hq = L.hq || KP.HQ_DEFAULT;
  const rule = FP.reach(hq, target, 'edge').length === target.length ? 'edge' : 'corner';   // 계획 깃발이 변 접촉으로도 이어지면 엄격한 쪽으로
  const plan = FP.schedule(list, realRaw, target, { rule, cap: fpCap() });
  const keys = new Set(realRaw.map(f => `${f.x},${f.y}`));
  const keep = target.filter(f => keys.has(`${f.x},${f.y}`)).length;
  const must = plan.steps.filter(st => st.op === 'remove' && st.phase === 2).length + plan.left.remove.length;
  showFlagOrder(box, plan, [`편집 중 배치 기준 (${RULE_KO[rule]}) · 깃발 ${target.length}개 = 유지 ${keep} + 새로 설치 ${target.length - keep} · 꼭 철거 ${must}`, `작업 순서 · 깃발 수 상한 ${Number.isFinite(plan.cap) ? plan.cap + '개' : '없음'}`]);
};
})();
