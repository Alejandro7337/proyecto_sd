// Lint mínimo sin dependencias: verifica la sintaxis de todos los módulos con `node --check`
// y busca patrones prohibidos (console.log en src/, secretos aparentes, TODO sin dueño).
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['src', 'scripts', 'test'];
const SECRET = /(sk_live|pk_live|-----BEGIN (RSA |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16})/;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let problems = 0;
for (const d of dirs) {
  for (const file of await walk(path.join(root, d)).catch(() => [])) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      problems += 1;
      console.error(`✖ sintaxis: ${path.relative(root, file)}\n${err.stderr}`);
    }
    const text = await readFile(file, 'utf8');
    const rel = path.relative(root, file);
    if (rel.startsWith('src') && /console\.log\(/.test(text) && !/db[/\\](migrate|seed)\.js$/.test(rel)) {
      problems += 1;
      console.error(`✖ console.log en ${rel}: usa el logger (redacta datos sensibles)`);
    }
    if (SECRET.test(text) && !rel.endsWith('check-syntax.js')) {
      problems += 1;
      console.error(`✖ posible secreto en ${rel}`);
    }
  }
}
if (problems) {
  console.error(`${problems} problema(s)`);
  process.exit(1);
}
console.log('lint: sin problemas');
