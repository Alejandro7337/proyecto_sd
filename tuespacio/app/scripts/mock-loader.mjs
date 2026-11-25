import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL) {
    const candidate = new URL(specifier, context.parentURL);
    if (!candidate.pathname.endsWith('.js') && existsSync(fileURLToPath(candidate) + '.js')) {
      return next(candidate.href + '.js', context);
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.includes('/app/src/') && url.endsWith('.js')) {
    return { format: 'module', source: await readFile(new URL(url), 'utf8'), shortCircuit: true };
  }
  return next(url, context);
}
