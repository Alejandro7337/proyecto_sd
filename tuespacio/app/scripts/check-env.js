#!/usr/bin/env node
// Valida las variables públicas de la app antes de iniciar, exportar o compilar.
// Uso: npm run env:check   (lee el entorno del proceso y, si existen, .env y .env.local)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fromFiles = {};
for (const file of ['.env', '.env.local']) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) fromFiles[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const env = { ...fromFiles, ...process.env };
const errors = [];
const warnings = [];

const mode = env.EXPO_PUBLIC_API_MODE || 'mock';
const url = env.EXPO_PUBLIC_API_URL || '';
const timeout = env.EXPO_PUBLIC_API_TIMEOUT_MS;

if (!['mock', 'http'].includes(mode)) errors.push(`EXPO_PUBLIC_API_MODE="${mode}" debe ser "mock" o "http".`);
if (mode === 'http') {
  if (!/^https?:\/\/[^\s]+$/.test(url)) errors.push('Modo http: EXPO_PUBLIC_API_URL debe ser una URL http(s)://');
  else if (/PENDIENTE|example/i.test(url)) errors.push(`EXPO_PUBLIC_API_URL="${url}" es un marcador: falta el dominio real del cliente.`);
  else if (url.startsWith('http://') && !/localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.|10\.\d+\./.test(url)) {
    errors.push('Una URL pública debe usar https://');
  }
  if (/localhost|127\.0\.0\.1/.test(url)) warnings.push('localhost no funciona desde un teléfono físico; usa la IP LAN del computador.');
}
if (timeout !== undefined && timeout !== '' && !(Number(timeout) >= 1000 && Number(timeout) <= 120000)) {
  errors.push('EXPO_PUBLIC_API_TIMEOUT_MS debe estar entre 1000 y 120000.');
}

// Un secreto con prefijo público terminaría dentro del paquete instalado.
const suspicious = Object.keys(env).filter((k) => k.startsWith('EXPO_PUBLIC_') && /SECRET|PASSWORD|PRIVATE|TOKEN|KEY(?!_ID)/.test(k));
if (suspicious.length) errors.push(`Variables públicas con nombre de secreto: ${suspicious.join(', ')}. Muévelas al servidor.`);

console.log(`Modo: ${mode}${mode === 'http' ? ` · URL: ${url || '(vacía)'}` : ' (demo, datos ficticios)'}`);
warnings.forEach((w) => console.warn('Aviso: ' + w));
if (errors.length) {
  errors.forEach((e) => console.error('Error: ' + e));
  process.exit(1);
}
console.log('Variables de entorno: OK');
