import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_API_MODE = 'http';
process.env.EXPO_PUBLIC_API_URL = 'http://localhost:8080/api/';
const { request, setSessionToken } = await import('../src/api/transport.js');
const { faults } = await import('../src/api/mock/demoControls.js');
const originalFetch = globalThis.fetch;

test.after(() => { globalThis.fetch = originalFetch; faults.offline = false; });

test('envía el token y normaliza la URL del gateway', async () => {
  setSessionToken('test-token');
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'http://localhost:8080/api/me');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { ok:true, json:async()=>({data:{id:'u-driver'}}) };
  };
  assert.equal((await request('GET','/me')).id,'u-driver');
});

test('conserva códigos y detalles de los errores de negocio', async () => {
  globalThis.fetch = async () => ({ok:false,status:409,json:async()=>({error:{code:'SPACE_TAKEN',message:'Cupo tomado',details:{retry:false}}})});
  await assert.rejects(()=>request('POST','/reservations',{}),error=>error.code==='SPACE_TAKEN'&&error.status===409&&error.details.retry===false);
});

test('una respuesta no JSON no se presenta como éxito', async () => {
  globalThis.fetch = async () => ({ok:true,json:async()=>{throw new SyntaxError('not JSON')}});
  await assert.rejects(()=>request('GET','/me'),{code:'INVALID_RESPONSE'});
});

test('una falla de conexión se puede distinguir de un error de negocio', async () => {
  globalThis.fetch = async () => {throw new TypeError('network unavailable')};
  await assert.rejects(()=>request('GET','/me'),{code:'NETWORK'});
});

test('el timeout también protege la lectura del cuerpo', async () => {
  const savedTimer=globalThis.setTimeout;
  let expire;
  globalThis.setTimeout=callback=>{expire=callback;return 0};
  globalThis.fetch=async(_url,options)=>({ok:true,json:async()=>{expire();assert.equal(options.signal.aborted,true);throw new DOMException('Timeout','AbortError')}});
  try { await assert.rejects(()=>request('GET','/me'),{code:'REQUEST_TIMEOUT'}); }
  finally { globalThis.setTimeout=savedTimer; }
});

test('la simulación offline se aplica también al cliente HTTP', async () => {
  faults.offline=true;
  globalThis.fetch=async()=>{assert.fail('No debe enviar datos sin conexión simulada')};
  try { await assert.rejects(()=>request('GET','/me'),{code:'NETWORK'}); }
  finally { faults.offline=false; }
});

test('logout captura el token antes de cerrar la sesión local', async () => {
  let sent;
  setSessionToken('token-to-revoke');
  globalThis.fetch=async(_url,options)=>{sent=options.headers.Authorization;return{ok:true,json:async()=>({data:{ok:true}})}};
  const result=request('POST','/auth/logout');
  setSessionToken(null);
  await result;
  assert.equal(sent,'Bearer token-to-revoke');
});
