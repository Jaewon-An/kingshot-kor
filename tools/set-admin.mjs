// Makes the ADMIN_HASH secret from the admin account — the password itself is never stored anywhere.
// Usage: node tools/set-admin.mjs            (reads admin.txt: "id / password")
//        node tools/set-admin.mjs <id> <password>
//        node tools/set-admin.mjs --castle   (reads castle/admin.txt → CASTLE_HASH, the /castle editor's own account; prints only)
// Writes .admin-secret (used by the local server.js) and prints the value to paste into
// Cloudflare Pages ▸ Settings ▸ Variables and Secrets ▸ ADMIN_HASH (type: Secret), or pipe the last line to
// `npx wrangler pages secret put CASTLE_HASH --project-name kingshot-kor`. The local server.js reads castle/admin.txt itself.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const castle = process.argv[2] === '--castle';
const file = castle ? path.join('castle', 'admin.txt') : 'admin.txt';

let [id, pw] = castle ? [] : process.argv.slice(2);
if (!id || !pw) {
  const line = (await readFile(path.join(ROOT, file), 'utf8')).trim();
  const sp = line.indexOf(' / '), i = sp >= 0 ? sp : line.indexOf('/');   // castle/admin.txt has no space after the slash
  if (i < 0) throw new Error(`${file} must look like: id / password`);
  id = line.slice(0, i).trim();
  pw = line.slice(i + (sp >= 0 ? 3 : 1)).trim();
}
const salt = randomBytes(16).toString('hex');
const value = `${salt}$${createHash('sha256').update(`${salt}:${id}:${pw}`).digest('hex')}`;
if (castle) console.log(`CASTLE_HASH for castle id "${id}":\n${value}`);
else {
  await writeFile(path.join(ROOT, '.admin-secret'), value + '\n');
  console.log(`ADMIN_HASH for admin id "${id}" (also saved to .admin-secret):\n${value}`);
}
