// fetch mínimo sobre el módulo http de Node, para que las pruebas del modo HTTP usen sockets
// reales (jest-expo reemplaza fetch por un simulacro sin red). Soporta AbortSignal.
import http from 'http';

export function nodeFetch(url, { method = 'GET', headers = {}, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    const abortError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
    if (signal?.aborted) return reject(abortError());
    const req = http.request(url, { method, headers }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (raw += c));
      res.on('end', () =>
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(raw) })
      );
    });
    req.on('error', (e) => reject(signal?.aborted ? abortError() : Object.assign(new TypeError('Network request failed'), { cause: e })));
    signal?.addEventListener('abort', () => req.destroy());
    if (body) req.write(body);
    req.end();
  });
}
