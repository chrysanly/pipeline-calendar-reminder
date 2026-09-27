// Lists top-level names declared in more than one js/ module. The flat
// dist bundle puts every module in one scope, where a duplicate `function`
// silently replaces the other one (and a duplicate `const` is a SyntaxError).
// Usage: node scripts/dup-names.mjs   (exit code 1 if any clash)

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const seen = new Map();
for (const file of readdirSync(dir).filter(f => f.endsWith('.js'))) {
  const source = readFileSync(join(dir, file), 'utf8');
  for (const m of source.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (!seen.has(m[1])) seen.set(m[1], []);
    seen.get(m[1]).push(file);
  }
}
const clashes = [...seen].filter(([, files]) => files.length > 1);
for (const [name, files] of clashes) console.log(`${name}: ${files.join(', ')}`);
console.log(clashes.length ? `${clashes.length} clash(es)` : 'no clashes');
process.exitCode = clashes.length ? 1 : 0;
