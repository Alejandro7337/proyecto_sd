"""Prueba web y capturas reales mediante Chrome DevTools; no usa npm."""
import base64
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.request import urlopen

from .http_smoke import HttpIntegration


class Chrome:
    def __init__(self, port, profile):
        try:
            import websocket
        except ImportError:
            raise SystemExit('Esta prueba opcional requiere websocket-client: python3 -m pip install websocket-client')
        binary = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser')
        if not binary:
            raise SystemExit('No se encontró Chrome/Chromium. El backend no requiere navegador instalado.')
        self.proc = subprocess.Popen([binary,'--headless=new','--disable-gpu','--no-first-run','--disable-dev-shm-usage',
            '--remote-debugging-address=127.0.0.1',f'--remote-debugging-port={port}',f'--remote-allow-origins=http://localhost:{port}',
            '--user-data-dir='+profile,'about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        self.seq=0
        try:
            deadline=time.monotonic()+20
            while True:
                try:
                    targets=json.load(urlopen(f'http://127.0.0.1:{port}/json/list',timeout=1))
                    target=next(t for t in targets if t['type']=='page')
                    self.ws=websocket.create_connection(target['webSocketDebuggerUrl'],timeout=15,origin=f'http://localhost:{port}')
                    break
                except Exception:
                    if time.monotonic()>deadline:
                        raise RuntimeError('Chrome no pudo iniciar; revisa los permisos del navegador.')
                    time.sleep(.1)
        except Exception:
            self.proc.terminate();self.proc.wait(timeout=5)
            raise
        self.call('Page.enable')
        self.call('Runtime.enable')

    def call(self, method, params=None):
        self.seq+=1
        self.ws.send(json.dumps({'id':self.seq,'method':method,'params':params or {}}))
        while True:
            result=json.loads(self.ws.recv())
            if result.get('id')==self.seq:
                if 'error' in result:
                    raise RuntimeError(result['error'])
                return result.get('result',{})

    def js(self, expression):
        result=self.call('Runtime.evaluate',{'expression':expression,'returnByValue':True,'awaitPromise':True})
        if result.get('exceptionDetails'):
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result',{}).get('value')

    def wait(self, expression, timeout=20):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            try:
                if self.js(expression):
                    return
            except RuntimeError:
                # La navegación puede destruir temporalmente el contexto de JavaScript.
                pass
            time.sleep(.1)
        raise AssertionError('Tiempo agotado: '+expression)

    def click(self, selector):
        self.wait('!!document.querySelector('+json.dumps(selector)+')')
        self.js('document.querySelector('+json.dumps(selector)+').click()')

    def visit(self, port):
        url=f'http://127.0.0.1:{port}/?check={time.time_ns()}'
        self.call('Page.navigate',{'url':url})
        self.wait('location.href==='+json.dumps(url)+" && document.readyState==='complete' && !!document.querySelector('[data-form=auth]')")
        self.js("window.testErrors=[];window.addEventListener('error',e=>window.testErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.testErrors.push(String(e.reason)))")

    def login(self, role):
        self.click('[data-action=role][data-id='+role+']')
        self.click('[data-action=demo-login]')
        self.wait("!!document.querySelector('.app-shell') && !document.querySelector('.skeleton')")
        assert not self.js("!!document.querySelector('.error-state')"), 'La vista mostró un error'

    def capture(self, file, width=1440, height=1000, dark=False):
        self.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<760})
        self.js("document.documentElement.dataset.theme="+json.dumps('dark' if dark else 'light'))
        time.sleep(.2)
        measurements=self.js("({width:innerWidth,body:document.documentElement.scrollWidth,errors:window.testErrors||[],dialog:!!document.querySelector('dialog[open]')})")
        assert measurements['body']<=measurements['width']+1, f'Overflow horizontal {file}: {measurements}'
        assert not measurements['errors'], f'Errores JS {file}: {measurements}'
        shot=self.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
        file.write_bytes(base64.b64decode(shot['data']))
        print('OK',file.name,measurements,flush=True)

    def close(self):
        self.ws.close()
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def main():
    import unittest
    try:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1',0))
    except PermissionError:
        raise SystemExit('BLOQUEADO: este entorno no permite sockets. Ejecuta esta prueba desde tu terminal local.')
    out=Path('artifacts/screenshots')
    out.mkdir(parents=True,exist_ok=True)
    HttpIntegration.setUpClass()
    chrome=None
    try:
        profile=tempfile.TemporaryDirectory()
        try:
            chrome=Chrome(18999,profile.name)
            for role in ['driver','owner','host','admin']:
                chrome.visit(18800)
                chrome.login(role)
                for width in [1440,768,390,320]:
                    chrome.capture(out/f'{role}-{width}.png',width)
                chrome.capture(out/f'{role}-dark.png',390,dark=True)
                chrome.click('[data-action=logout]') if role=='driver' else chrome.js("location.hash='settings'")
                if role!='driver':
                    chrome.wait("!!document.querySelector('.settings-form')")
                    chrome.click('[data-action=logout]')
            for index, region in enumerate(REGIONS_IDS):
                chrome.visit(18800+index*10)
                chrome.login('driver')
                chrome.click('[data-action=reserve][data-id=s-emp-4]')
                chrome.wait("!!document.querySelector('dialog[open] [data-form=reserve]')")
                chrome.capture(out/f'{region}-checkout.png',390)
                chrome.click('[data-form=reserve] [type=submit]')
                chrome.wait("!!document.querySelector('.ticket-code')")
                chrome.capture(out/f'{region}-receipt.png',390)
                chrome.click('[data-action=check-in]')
                chrome.wait("!!document.querySelector('dialog [data-action=check-out]')")
                chrome.click('[data-action=check-out]')
                chrome.wait("!!document.querySelector('dialog .badge.completed')")
                chrome.click('[data-action=close]')
                chrome.js("location.hash='bookings'")
                chrome.wait("!!document.querySelector('.booking-row') && !document.querySelector('.skeleton')")
                chrome.capture(out/f'{region}-history.png',390)
                chrome.js("location.hash='settings'")
                chrome.wait("!!document.querySelector('.settings-form')")
                chrome.click('[data-action=logout]')
            print('Comprobación web terminada. Revisar visualmente las 35 capturas de artifacts/screenshots/.')
        finally:
            if chrome:
                chrome.close()
                chrome=None
            profile.cleanup()
    finally:
        if chrome:
            chrome.close()
        HttpIntegration.tearDownClass()


REGIONS_IDS=['co','br','us','fr','jp']
if __name__=='__main__':
    main()
