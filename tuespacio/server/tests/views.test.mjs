import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { icon } from '../../web/icons.js';
import { messages } from '../../web/i18n.js';
import { formatMoney, formatRegionalDate } from '../../web/format.js';
import { regionUrl } from '../../web/region-url.js';
import { safeStorage } from '../../web/storage.js';

// Prueba cliente, plantillas y contratos HTTP; el DOM mínimo no verifica CSS ni gestos.
const cwd = new URL('../../', import.meta.url);
const bridge = spawn('python3', ['-m', 'server.tests.ui_bridge'], { cwd, stdio:['pipe','pipe','inherit'] });
const pending = new Map();
let seq = 0;
const lines = createInterface({input:bridge.stdout});
lines.on('line', line => { const result=JSON.parse(line); pending.get(result.id)?.(result); pending.delete(result.id); });
bridge.on('exit', code => { for (const resolve of pending.values()) resolve({status:500,payload:{error:{message:'El adaptador terminó: '+code}}}); });
const rpc = (region,path,options={}) => new Promise(resolve => {
  const id=++seq;pending.set(id,resolve);
  bridge.stdin.write(JSON.stringify({id,region,path:path.replace(/^\/api/,''),method:options.method||'GET',
    body:options.body?JSON.parse(options.body):undefined,token:options.headers?.Authorization?.replace('Bearer ','')})+'\n');
});
const storage=()=>{const values=new Map();return{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)}};
const element=()=>({innerHTML:'',textContent:'',disabled:false,isConnected:true,dataset:{},classList:{add(){},remove(){}},setAttribute(){},removeAttribute(){},remove(){},addEventListener(){},querySelectorAll(){return[]},querySelector(){return element()}});
const timers=new Set();
const source=readFileSync(new URL('../../web/app.js',import.meta.url),'utf8').replace(/^import .+;\s*$/gm,'').replace(/void boot\(\);\s*$/,'');
let assertions=0;
const check=(condition,description)=>{assert.ok(condition,description);assertions++};

async function client(region='co'){
  const root=element(),dialog=element(),toast=element();dialog.open=false;dialog.showModal=()=>dialog.open=true;dialog.close=()=>dialog.open=false;
  const ctx=vm.createContext({icon,messages,formatMoney,formatRegionalDate,regionUrl,URL,URLSearchParams,Intl,Date,console,AbortController,FormData,Blob,
    crypto:{randomUUID},sessionStorage:storage(),localStorage:storage(),
    setInterval:()=>0, setTimeout:(fn,n)=>{const id=setTimeout(fn,n);timers.add(id);return id},clearTimeout:id=>{clearTimeout(id);timers.delete(id)},
    fetch:async(path,opts)=>{const r=await rpc(region,path,opts);return{ok:r.status<400,status:r.status,json:async()=>r.payload}},
    location:{hash:'',href:'http://localhost:8080',assign(){}},window:{addEventListener(){}},
    document:{documentElement:{dataset:{theme:'light'}},querySelector:selector=>selector==='#app'?root:selector==='#dialog'?dialog:selector==='#toast'?toast:element(),addEventListener(){},createElement:element}});
  vm.runInContext('const safeStorage = '+safeStorage.toString()+';\n'+source,ctx);
  const run=script=>vm.runInContext(script,ctx);
  await run('boot()');check(root.innerHTML.includes('data-form="auth"'),region+': pantalla de acceso');
  return {root,dialog,run};
}

mkdirSync(new URL('../../artifacts/templates/',import.meta.url),{recursive:true});
try{
  const co=await client();
  for(const role of ['driver','owner','host','admin']){
    const email={driver:'conductor',owner:'parqueadero',host:'anfitrion',admin:'admin'}[role]+'@demo.test';
    await co.run(`signIn(${JSON.stringify({email,password:'demo123',role})})`);
    for(const page of co.run('navItems().map(n=>n[0])')){
      co.run('s.page='+JSON.stringify(page));await co.run('loadPage()');
      check(!co.run('s.error'),role+'/'+page+': sin error de contrato');
      check(!/\b(?:undefined|NaN)\b/.test(co.root.innerHTML),role+'/'+page+': datos completos');
      check(co.root.innerHTML.includes('id="main"'),role+'/'+page+': contenido principal');
      writeFileSync(new URL(`../../artifacts/templates/${role}-${page}.html`,import.meta.url),co.root.innerHTML);
    }
    await co.run('handleAction({dataset:{action:"logout"}})');
  }
  for(const region of ['co','br','us','fr','jp']){
    const c=await client(region);
    await c.run('signIn({email:"conductor@demo.test",password:"demo123",role:"driver"})');
    await c.run('api("/spaces/s-emp-4").then(space=>reserveDialog(space))');
    check(c.dialog.innerHTML.includes('data-form="reserve"'),region+': formulario de reserva');
    c.run('checkout.body={spaceId:checkout.space.id,vehicle:"car",durationMin:120,startAt:new Date(Date.now()+900000).toISOString(),idempotencyKey:checkout.key,paymentMethod:s.region.paymentMethods[0],scenario:"none"}');
    await c.run('finishCheckout()');
    check(c.dialog.innerHTML.includes('ticket-code'),region+': comprobante');
    check(!/\b(?:undefined|NaN)\b/.test(c.dialog.innerHTML),region+': comprobante completo');
    check(c.run('s.bookings.length')===1,region+': reserva persistida');
    writeFileSync(new URL(`../../artifacts/templates/${region}-receipt.html`,import.meta.url),c.dialog.innerHTML);
    const b=c.run('s.bookings[0]');
    await c.run(`api('/reservations/${b.id}/check-in',{method:'POST'}).then(receiptView)`);
    check(c.dialog.innerHTML.includes('data-action="check-out"'),region+': llegada');
    await c.run(`api('/reservations/${b.id}/check-out',{method:'POST'}).then(receiptView)`);
    check(c.dialog.innerHTML.includes('badge completed'),region+': salida');
    c.run('s.page="bookings"');await c.run('loadPage()');
    check(c.root.innerHTML.includes(b.code),region+': historial');
  }
  const production=await client();
  production.run('s.region.demo=false;s.region.passwordMinLength=12;s.region.payments={provider:"mercadopago",available:true,live:true};s.registering=true;render()');
  check(!production.root.innerHTML.includes(messages.es.noCharges),'Acceso live no promete pagos de prueba');
  check(!production.root.innerHTML.includes(messages.es.demo),'Acceso live no presenta datos ficticios');
  check(production.root.innerHTML.includes(messages.es.liveCharges),'Acceso live avisa de cobros reales');
  check(production.root.innerHTML.includes('minlength="12"'),'Alta de producción exige mínimo 12 caracteres');
  production.run('s.user={id:"fixture-user",name:"Fixture User",role:"driver",email:"fixture@example.test"};s.loading=false;render()');
  check(!production.root.innerHTML.includes(messages.es.demo),'Navegación y pie live no anuncian demostración');
  const xss=await client();
  await xss.run('signIn({email:"conductor@demo.test",password:"demo123",role:"driver"})');
  xss.run('s.user.name="<img src=x onerror=alert(1)>";s.page="settings";render()');
  check(!xss.root.innerHTML.includes('<img src=x'), 'El nombre se escapa al renderizar');
  check(xss.root.innerHTML.includes('&lt;img'), 'El nombre conserva su contenido como texto');
  check(messages.ja.identityConsent.length>0&&messages.fr.errors.PAYMENT_DECLINED.length>0,'Consentimiento y errores localizados');
  console.log(`OK: ${assertions} comprobaciones de cliente, plantillas y contratos. No incluye validación visual en navegador.`);
}finally{
  for(const id of timers)clearTimeout(id);
  bridge.stdin.end();lines.close();
}
