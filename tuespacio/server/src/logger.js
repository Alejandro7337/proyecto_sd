// Logger JSON por línea. Redacta cualquier campo que parezca sensible: nunca escribe contraseñas,
// tokens, códigos de recuperación, cabeceras de autorización, correos ni datos de pago.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SENSITIVE = /pass|token|secret|authorization|cookie|code$|^code|otp|card|cvv|email|phone|plate/i;

export function redact(value, depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object' || value instanceof Error) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.test(k) ? '[redactado]' : redact(v, depth + 1);
  }
  return out;
}

export function createLogger(level = 'info', sink = (line) => process.stdout.write(line + '\n')) {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, msg, data = {}) => {
    if (LEVELS[lvl] < min) return;
    const { err, ...rest } = data;
    const entry = { t: new Date().toISOString(), level: lvl, msg, ...redact(rest) };
    if (err) {
      entry.err = { name: err.name, message: err.message, code: err.code };
      if (level === 'debug') entry.err.stack = err.stack;
    }
    sink(JSON.stringify(entry));
  };
  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}
