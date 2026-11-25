"""Prueba el protocolo HTTP y los handlers reales usando streams en memoria.

No abre sockets ni sustituye las pruebas de despliegue entre procesos.
"""
from datetime import datetime, timedelta, timezone
from http.client import HTTPResponse
from io import BytesIO
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import urlsplit

from server.common import Config, SERVICES
from server.service import make_handler


class MemoryConnection:
    def __init__(self, raw=b''):
        self.input = BytesIO(raw)
        self.output = BytesIO()

    def makefile(self, *_):
        return self.input

    def sendall(self, data):
        self.output.write(data)

    def settimeout(self, _):
        pass


class HttpContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.config = Config(getattr(cls, 'region', 'co'), 18075, cls.temp.name, 'test-internal-key-with-32-characters')
        cls.handlers, cls.engines = {}, {}
        for name in SERVICES:
            cls.handlers[name], cls.engines[name] = make_handler(name, cls.config)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.patch = patch('server.common.urlopen', self.forward)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.engines['gateway'].attempts.clear()
        for name in ['bookings','payments','inventory','broker']:
            with self.engines[name].store.connect(write=True) as db:
                for table in ['bookings','slots','payments','outbox','events']:
                    db.execute('DELETE FROM '+table)

    def wire(self, service, method, path, body=None, headers=None, raw_body=None):
        data = raw_body if raw_body is not None else json.dumps(body, ensure_ascii=False).encode() if body is not None else b''
        headers = {'Host':'localhost','Content-Length':str(len(data)), 'Connection':'close', **(headers or {})}
        raw = f'{method} {path} HTTP/1.1\r\n'.encode() + ''.join(f'{k}: {v}\r\n' for k,v in headers.items()).encode() + b'\r\n' + data
        connection = MemoryConnection(raw)
        self.handlers[service](connection, ('127.0.0.1', 1234), SimpleNamespace(server_name='localhost', server_port=18080))
        response = HTTPResponse(MemoryConnection(connection.output.getvalue()))
        response.begin()
        return response

    def forward(self, request, timeout=None):
        url = urlsplit(request.full_url)
        service = SERVICES[url.port - self.config.base_port]
        response = self.wire(service, request.method, url.path+('?' + url.query if url.query else ''),
                             raw_body=request.data or b'', headers=dict(request.header_items()))
        if response.status >= 400:
            raise HTTPError(request.full_url, response.status, response.reason, response.headers, BytesIO(response.read()))
        return response

    def api(self, method, path, body=None, token=None, **headers):
        if token:
            headers['authorization'] = 'Bearer '+token
        response = self.wire('gateway', method, '/api'+path, body, headers)
        return response.status, json.loads(response.read())

    def login(self, role='driver'):
        email = {'driver':'conductor','owner':'parqueadero','host':'anfitrion','admin':'admin'}[role]+'@demo.test'
        status, payload = self.api('POST','/auth/login',{'email':email,'password':'demo123','role':role})
        self.assertEqual(status,200,payload)
        return payload['data']['token']

    def request_body(self, **extra):
        return {'spaceId':'s-emp-4','vehicle':'car','durationMin':60,'startAt':(datetime.now(timezone.utc)+timedelta(minutes=15)).isoformat(),'idempotencyKey':'http-test-0001', **extra}

    def test_01_index_and_modules_served_with_csp(self):
        for path, expected in [('/',b'<!doctype html>'),('/app.js',b'import'),('/styles.css',b'@layer'),('/format.js',b'export')]:
            response = self.wire('gateway','GET',path)
            self.assertEqual(response.status,200,path)
            self.assertIn(expected.lower(),response.read().lower())
            self.assertIn("script-src 'self'",response.getheader('Content-Security-Policy'))

    def test_02_token_and_internal_headers_cannot_be_forged(self):
        self.assertEqual(self.api('GET','/me')[0],401)
        self.assertEqual(self.api('GET','/me',token='mock.u-admin')[0],401)
        result = self.wire('identity','POST','/auth/resolve',{'token':'mock.u-admin'})
        self.assertEqual(result.status,403)
        fake = json.dumps({'id':'u-admin','role':'admin'}).encode().hex()
        self.assertEqual(self.api('GET','/ops/status',token=self.login(),**{'X-User':fake,'X-Service-Key':self.config.key})[0],403)

    def test_03_actual_http_contract_reservation_and_refund(self):
        token = self.login()
        body = self.request_body()
        status, result = self.api('POST','/reservations',body,token)
        self.assertEqual(status,200,result)
        booking = result['data']
        self.assertEqual(booking['status'],'confirmed')
        self.assertEqual(booking['space']['rate'],booking['space']['rates']['car'])
        self.assertEqual(self.api('POST','/reservations',body,token)[1]['data']['id'],booking['id'])
        status,result = self.api('POST','/reservations/'+booking['id']+'/cancel',{},token)
        self.assertEqual(result['data']['payment']['status'],'refunded')

    def test_04_expo_owner_and_host_contracts(self):
        status,payload = self.api('GET','/owner/space',token=self.login('owner'))
        self.assertEqual(status,200,payload)
        self.assertEqual(payload['data']['space']['id'],'s-emp-1')
        self.assertEqual(len(payload['data']['metrics']['views']),7)
        status,payload = self.api('GET','/host/earnings',token=self.login('host'))
        self.assertEqual(status,200,payload)
        self.assertEqual(payload['data']['items'],[])
        self.assertEqual(payload['data']['net'],0)

    def test_05_host_publication_and_edit(self):
        host = self.login('host')
        body = {'name':'Garaje de prueba','address':'Dirección de prueba','destinationId':'d-emp','status':'published',
                'capacity':{'car':2,'moto':0},'rates':{'car':{'price':5000,'unit':'hour'},'moto':None},
                'conditions':{'covered':True,'keys':False,'maxHeight':2},'schedule':{'open':'06:00','close':'22:00','days':'Todos los días'}}
        self.assertEqual(self.api('POST','/host/spaces',body,host)[0],422)
        status,result = self.api('POST','/host/spaces',{**body,'identityConsent':True,'ownerId':'u-admin','metrics':{'views':[999]*7}},host)
        self.assertEqual(status,200,result)
        space = result['data']
        self.assertNotIn('ownerId',space)
        self.assertEqual(space['metrics']['views'],[0]*7)
        self.assertEqual(self.api('PATCH','/spaces/'+space['id'],{'status':'paused'},host)[1]['data']['status'],'paused')
        self.assertEqual(self.api('PATCH','/spaces/'+space['id'],{'status':'published'},self.login())[0],403)

    def test_06_filters_forwarded_through_http(self):
        status,result = self.api('GET','/spaces?destinationId=d-emp&vehicle=moto&covered=true&noKeys=true&sort=price')
        self.assertEqual(status,200,result)
        self.assertTrue(result['data'])
        self.assertTrue(all(s['conditions']['covered'] and not s['conditions']['keys'] and s['rates']['moto'] for s in result['data']))

    def test_07_gateway_body_validation_and_path_traversal(self):
        for body in [b'{',b'[]',b'null']:
            self.assertEqual(self.wire('gateway','POST','/api/auth/login',raw_body=body).status,422)
        self.assertEqual(self.wire('gateway','GET','/%2e%2e/server/common.py').status,404)
        self.assertEqual(self.wire('gateway','POST','/api/auth/login',headers={'Content-Length':'65537'}).status,413)

    def test_08_cors_uses_explicit_allowlist(self):
        allowed = self.wire('gateway','OPTIONS','/api/me',headers={'Origin':'http://localhost:8081'})
        self.assertEqual(allowed.getheader('Access-Control-Allow-Origin'),'http://localhost:8081')
        denied = self.wire('gateway','OPTIONS','/api/me',headers={'Origin':'https://untrusted.example'})
        self.assertIsNone(denied.getheader('Access-Control-Allow-Origin'))

    def test_09_notifications_reach_driver_and_host(self):
        driver = self.login()
        self.assertEqual(self.api('POST','/reservations',self.request_body(),driver)[0],200)
        self.engines['bookings'].tick()
        self.assertEqual(len(self.api('GET','/notifications',token=driver)[1]['data']),1)
        self.assertEqual(len(self.api('GET','/notifications',token=self.login('host'))[1]['data']),1)
        self.assertEqual(len(self.api('GET','/notifications',token=self.login('owner'))[1]['data']),0)

    def test_10_admin_sees_all_service_health(self):
        status,result = self.api('GET','/ops/status',token=self.login('admin'))
        self.assertEqual(status,200,result)
        self.assertEqual(len(result['data']['services']),5)
        self.assertTrue(all(s['status']=='online' for s in result['data']['services']))


    def test_11_receipt_download_is_authenticated_immutable_and_escaped(self):
        token = self.login()
        status, payload = self.api('POST', '/reservations', self.request_body(), token)
        self.assertEqual(status, 200)
        id = payload['data']['id']
        response = self.wire('gateway', 'GET', '/api/reservations/' + id + '/receipt?format=html', headers={'Authorization': 'Bearer ' + token})
        self.assertEqual(response.status, 200)
        self.assertIn('text/html', response.getheader('Content-Type'))
        self.assertEqual(response.getheader('Cache-Control'), 'no-store')
        self.assertIn("'sha256-", response.getheader('Content-Security-Policy'))
        self.assertIn('DEMOSTRACIÓN'.encode(), response.read())
        self.assertEqual(self.api('GET', '/reservations/' + id + '/receipt')[0], 401)

    def test_12_webhook_rejects_without_provider_or_valid_signature(self):
        status, payload = self.api('POST', '/payments/webhook', {'type': 'order'})
        self.assertEqual(status, 404)
        self.assertEqual(payload['error']['code'], 'NOT_FOUND')

    def test_13_public_internal_routes_and_encoded_variants_cannot_release_slots(self):
        token = self.login()
        status, payload = self.api('POST', '/reservations', self.request_body(), token)
        self.assertEqual(status, 200)
        id = payload['data']['id']
        for prefix in ['/internal', '/%69nternal', '/%2569nternal', '//internal', '/%2Finternal', '/INTERNAL', '/spaces/../internal']:
            with self.subTest(prefix=prefix):
                status, _ = self.api('POST', prefix + '/slots/' + id, {'action': 'release'}, token)
                self.assertEqual(status, 404)
        with self.engines['inventory'].store.connect() as db:
            self.assertEqual(db.execute('SELECT state FROM slots WHERE id=?', (id,)).fetchone()['state'], 'confirmed')
        self.assertEqual(self.api('GET', '/reservations/' + id, token=token)[1]['data']['status'], 'confirmed')

    def test_14_pending_production_space_is_private_but_owner_can_edit(self):
        host = self.login('host')
        driver = self.login('driver')
        previous = self.config.production
        self.config.production = True
        try:
            self.assertEqual(self.api('GET','/spaces/s-emp-4',token=host)[0],200)
            self.assertEqual(self.api('GET','/spaces/s-emp-4',token=driver)[0],404)
            self.assertEqual(self.api('GET','/spaces/s-emp-4')[0],404)
        finally:
            self.config.production = previous

if __name__=='__main__':
    unittest.main()

