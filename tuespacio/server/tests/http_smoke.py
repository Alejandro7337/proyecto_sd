"""Integración real: ejecutar explícitamente fuera de sandboxes sin sockets."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from server.common import REGIONS, SERVICES


class HttpIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
        except PermissionError as err:
            raise unittest.SkipTest('El entorno no permite sockets locales: ' + str(err))
        cls.tmp = tempfile.TemporaryDirectory()
        cls.processes, cls.logs = {}, []
        cls.env = {**os.environ, 'SERVICE_KEY': secrets.token_urlsafe(36)}
        cls.ports = {'co': 18800, 'br': 18810, 'us': 18820, 'fr': 18830, 'jp': 18840}
        cls.env['PUBLIC_REGION_PORTS'] = json.dumps(cls.ports)
        try:
            for region in cls.ports:
                for service in SERVICES:
                    cls.start(region, service)
            deadline = time.monotonic() + 90
            for region in cls.ports:
                for service in SERVICES:
                    while True:
                        try:
                            port=cls.ports[region]-5+SERVICES.index(service)
                            req=Request(f'http://127.0.0.1:{port}/health',headers={'X-Service-Key':cls.env['SERVICE_KEY']})
                            with urlopen(req,timeout=1) as response:
                                json.load(response)
                            break
                        except (OSError, HTTPError):
                            if time.monotonic() > deadline:
                                raise RuntimeError('Los servicios no iniciaron. Revisa puertos 18795–18840 y procesos.')
                            time.sleep(.2)
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def start(cls, region, service):
        log = open(Path(cls.tmp.name) / (region + '-' + service + '.log'), 'a')
        cls.logs.append(log)
        proc = subprocess.Popen([sys.executable,'-m','server.service',service,'--region',region,'--base-port',str(cls.ports[region]-5),'--data',cls.tmp.name],
                                cwd=Path(__file__).resolve().parents[2], env=cls.env, stdout=log, stderr=log)
        cls.processes[(region,service)] = proc
        return proc

    @classmethod
    def tearDownClass(cls):
        for proc in cls.processes.values():
            if proc.poll() is None:
                proc.terminate()
        for proc in cls.processes.values():
            try:
                proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                proc.kill()
        for log in cls.logs:
            log.close()
        cls.tmp.cleanup()

    @classmethod
    def request(cls, region, path, method='GET', body=None, token=None):
        headers={'Content-Type':'application/json'}
        if token:
            headers['Authorization']='Bearer '+token
        req=Request(f'http://127.0.0.1:{cls.ports[region]}/api'+path, method=method, headers=headers,
                    data=json.dumps(body).encode() if body is not None else None)
        with urlopen(req,timeout=15) as res:
            return json.load(res)['data']

    def login(self, region='co', email='conductor@demo.test'):
        return self.request(region,'/auth/login','POST',{'email':email,'password':'demo123'})['token']

    def body(self, space='s-emp-4'):
        return {'spaceId':space,'vehicle':'car','durationMin':60,'startAt':(datetime.now(timezone.utc)+timedelta(minutes=15)).isoformat(),'idempotencyKey':secrets.token_hex(20)}

    def test_01_five_real_regional_flows(self):
        for profile in REGIONS:
            region=profile['id']
            with self.subTest(region=region):
                token=self.login(region)
                b=self.request(region,'/reservations','POST',self.body(),token)
                self.assertEqual(b['currency'],profile['currency'])
                self.assertEqual(b['status'],'confirmed')
                self.request(region,'/reservations/'+b['id']+'/check-in','POST',{},token)
                finished=self.request(region,'/reservations/'+b['id']+'/check-out','POST',{},token)
                self.assertEqual(finished['status'],'completed')

    def test_02_real_concurrency(self):
        token=self.login()
        def reserve(_):
            try:
                return self.request('co','/reservations','POST',self.body(),token)['status']
            except HTTPError as err:
                return json.load(err)['error']['code']
        with ThreadPoolExecutor(max_workers=10) as pool:
            results=list(pool.map(reserve,range(10)))
        self.assertEqual(results.count('confirmed'),1,results)
        self.assertEqual(results.count('SPACE_TAKEN'),9,results)

    def test_03_actual_payment_process_failure_and_recovery(self):
        token=self.login()
        payment=self.processes[('co','payments')]
        payment.kill();payment.wait()
        body=self.body('s-emp-1')
        try:
            with self.assertRaises(HTTPError) as raised:
                self.request('co','/reservations','POST',body,token)
            self.assertEqual(raised.exception.code,503)
            self.assertEqual(json.load(raised.exception)['error']['code'],'RESERVATION_PENDING')
        finally:
            self.start('co','payments')
        deadline=time.monotonic()+12
        while True:
            try:
                b=self.request('co','/reservations','POST',body,token)
                self.assertEqual(b['status'],'confirmed')
                break
            except HTTPError:
                if time.monotonic()>deadline:
                    raise
                time.sleep(.2)
        same=self.request('co','/reservations','POST',body,token)
        self.assertEqual(same['id'],b['id'])

    def test_04_gateway_rbac_and_expo_contract(self):
        token=self.login()
        with self.assertRaises(HTTPError) as raised:
            self.request('co','/ops/status',token=token)
        self.assertEqual(raised.exception.code,403)
        owner=self.login(email='parqueadero@demo.test')
        panel=self.request('co','/owner/space',token=owner)
        self.assertEqual(panel['space']['id'],'s-emp-1')
        self.assertEqual(len(panel['metrics']['views']),7)
        host=self.login(email='anfitrion@demo.test')
        self.assertIsInstance(self.request('co','/host/earnings',token=host)['items'],list)
        admin=self.login(email='admin@demo.test')
        self.assertEqual(len(self.request('co','/ops/status',token=admin)['services']),5)


if __name__=='__main__':
    unittest.main(verbosity=2)
