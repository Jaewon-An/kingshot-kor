// Makes the ADMIN_HASH secret from the admin account — the password itself is never stored anywhere.
// Usage: node tools/set-admin.mjs            (reads admin.txt: "id / password")
//        node tools/set-admin.mjs <id> <password>
// Writes .admin-secret (used by the local server.js) and prints the value to paste into
// Cloudflare Pages ▸ Settings ▸ Variables and Secrets ▸ ADMIN_HASH (type: Secret).
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let [id, pw] = process.argv.slice(2);
if (!id || !pw) {
  const line = (await readFile(path.join(ROOT, 'admin.txt'), 'utf8')).trim();
  const i = line.indexOf(' / ');
  if (i < 0) throw new Error('admin.txt must look like: id / password');
  id = line.slice(0, i).trim();
  pw = line.slice(i + 3).trim();
}
const salt = randomBytes(16).toString('hex');
const value = `${salt}$${createHash('sha256').update(`${salt}:${id}:${pw}`).digest('hex')}`;
await writeFile(path.join(ROOT, '.admin-secret'), value + '\n');
console.log(`ADMIN_HASH for admin id "${id}" (also saved to .admin-secret):\n${value}`);
