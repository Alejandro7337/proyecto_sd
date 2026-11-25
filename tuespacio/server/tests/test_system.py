from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

from server.bookings import Bookings
from server.common import Config, Problem, REGIONS, Store, encode
from server.identity import Identity
from server.inventory import Inventory
from server.payments import Payments
from server.service import Broker, Gateway


class LocalNetwork(Config):
    """Solo arnés de prueba: simula transporte, no prueba procesos ni HTTP."""
    def __init__(self, root, region='co'):
        super().__init__(region, 18075, root, 'test-service-key-with-at-least-32-characters')
        self.offline, self.lose_after, self.calls = set(), None, []
        self.engines = {name: factory(Store(Path(root) / region / (name + '.sqlite')), self)
                        for name, factory in [('identity', Identity), ('inventory', Inventory), ('payments', Payments), ('bookings', Bookings), ('broker', Broker)]}

    def call(self, service, method, path, body=None, user=None, timeout=3):
        self.calls.append((service, method, path))
        if service in self.offline:
            raise Problem('SERVICE_UNAVAILABLE', service, 503)
        url = urlsplit(path)
        query = {k: v[-1] for k,v in parse_qs(url.query).items()}
        result = self.engines[service].dispatch(method, url.path, deepcopy(body or {}), deepcopy(user), query, {})
        if self.lose_after and self.lose_after == (service, body.get('action') if body else None):
            self.lose_after = None
            raise Problem('SERVICE_UNAVAILABLE', 'Respuesta perdida después del commit remoto', 503)
        return json.loads(encode(result))


class SystemTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.net = LocalNetwork(cls.temp.name)
        cls.identity, cls.inv, cls.pay, cls.book = [cls.net.engines[k] for k in ['identity','inventory','payments','bookings']]

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.net.offline.clear()
        self.net.lose_after = None
        for engine in [self.inv, self.pay, self.book, self.net.engines['broker']]:
            with engine.store.connect(write=True) as db:
                for table in ['slots','bookings','payments','outbox','events']:
                    db.execute('DELETE FROM ' + table)
        self.driver = {'id':'u-driver','name':'Laura Gómez','role':'driver'}
        self.owner = {'id':'u-owner','name':'Carlos Pérez','role':'owner'}
        self.admin = {'id':'u-admin','name':'Admin','role':'admin'}

    def body(self, key='idempotency-test-0001', **patch):
        return {'spaceId':'s-emp-4','vehicle':'car','startAt':(datetime.now(timezone.utc)+timedelta(minutes=15)).isoformat(),
                'durationMin':60,'idempotencyKey':key, **patch}

    def create(self, body=None, user=None):
        return self.book.create(user or self.driver, body or self.body())

    def assertProblem(self, code, fn):
        with self.assertRaises(Problem) as raised:
            fn()
        self.assertEqual(raised.exception.code, code)

    def test_01_full_lifecycle_releases_capacity(self):
        b = self.create()
        self.assertEqual(b['status'], 'confirmed')
        self.assertEqual(b['payment']['status'], 'captured')
        self.assertEqual(self.inv.dispatch('GET','/spaces/s-emp-4',{},None,{}, {})['availability']['car']['free'], 0)
        b = self.book.dispatch('POST','/reservations/'+b['id']+'/check-in',{},self.driver,{}, {})
        self.assertEqual(b['status'], 'active')
        b = self.book.dispatch('POST','/reservations/'+b['id']+'/check-out',{},self.driver,{}, {})
        self.assertEqual(b['status'], 'completed')
        self.assertEqual(self.inv.dispatch('GET','/spaces/s-emp-4',{},None,{}, {})['availability']['car']['free'], 1)

    def test_02_last_spot_concurrent_requests(self):
        def attempt(index):
            try:
                return self.create(self.body('concurrency-'+str(index)))['status']
            except Problem as e:
                return e.code
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(attempt, range(12)))
        self.assertEqual(results.count('confirmed'), 1, results)
        self.assertEqual(results.count('SPACE_TAKEN'), 11, results)
        with self.pay.store.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM payments WHERE state='captured'").fetchone()[0], 1)

    def test_03_same_key_concurrent_retries(self):
        body = self.body()
        with ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(lambda _: self.create(body), range(10)))
        self.assertEqual(len({r['id'] for r in results}), 1)
        with self.pay.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM payments').fetchone()[0], 1)

    def test_04_key_payload_conflict(self):
        body = self.body()
        self.create(body)
        self.assertProblem('IDEMPOTENCY_CONFLICT', lambda: self.create({**body,'durationMin':120}))

    def test_05_key_is_scoped_to_driver(self):
        body = self.body(spaceId='s-emp-1')
        a = self.create(body)
        b = self.create(body, {'id':'other-driver','name':'Other','role':'driver'})
        self.assertNotEqual(a['id'], b['id'])

    def test_06_payment_decline_compensates(self):
        self.assertProblem('PAYMENT_DECLINED',lambda:self.create(self.body(scenario='declined')))
        self.assertEqual(self.inv.dispatch('GET','/spaces/s-emp-4',{},None,{}, {})['availability']['car']['free'], 1)
        b = self.create(self.body('retry-after-decline'))
        self.assertEqual(b['status'],'confirmed')

    def test_07_lost_capture_response_recovers_without_second_charge(self):
        body=self.body()
        self.net.lose_after=('payments','capture')
        self.assertProblem('RESERVATION_PENDING',lambda:self.create(body))
        self.net.engines['bookings']=Bookings(self.book.store,self.net)
        recovered=self.net.engines['bookings'].create(self.driver,body)
        self.assertEqual(recovered['status'],'confirmed')
        with self.pay.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM payments').fetchone()[0],1)

    def test_08_payment_process_down_and_restored(self):
        body=self.body()
        self.net.offline.add('payments')
        self.assertProblem('RESERVATION_PENDING',lambda:self.create(body))
        self.net.offline.clear()
        self.book.tick()
        self.assertEqual(self.create(body)['status'],'confirmed')

    def test_09_cancel_is_idempotent_and_refunds(self):
        b=self.create()
        for _ in range(2):
            result=self.book.dispatch('POST','/reservations/'+b['id']+'/cancel',{},self.driver,{}, {})
            self.assertEqual(result['status'],'cancelled')
            self.assertEqual(result['payment']['status'],'refunded')
        self.assertEqual(self.net.call('payments','GET','/internal/payments/'+b['id'])['state'],'refunded')

    def test_10_cancel_recovers_after_inventory_down(self):
        b=self.create()
        self.net.offline.add('inventory')
        self.assertProblem('SERVICE_UNAVAILABLE',lambda:self.book.dispatch('POST','/reservations/'+b['id']+'/cancel',{},self.driver,{}, {}))
        self.assertEqual(self.book.load(b['id'])['status'],'cancelling')
        self.net.offline.clear()
        self.book.tick()
        self.assertEqual(self.book.load(b['id'])['status'],'cancelled')

    def test_11_expired_hold_after_capture_refunds(self):
        self.net.lose_after=('payments','capture')
        body=self.body()
        self.assertProblem('RESERVATION_PENDING',lambda:self.create(body))
        with self.inv.store.connect(write=True) as db:
            db.execute('UPDATE slots SET expires=0')
        self.assertProblem('HOLD_EXPIRED',lambda:self.create(body))
        with self.pay.store.connect() as db:
            self.assertEqual(db.execute('SELECT state FROM payments').fetchone()[0],'refunded')

    def test_12_outbox_survives_broker_failure_and_deduplicates(self):
        self.create()
        self.net.offline.add('broker')
        self.book.tick()
        with self.book.store.connect() as db:
            self.assertEqual(db.execute('SELECT delivered FROM outbox').fetchone()[0],0)
        self.net.offline.clear()
        self.net.lose_after=('broker',None)
        self.book.tick()
        self.book.tick()
        with self.net.engines['broker'].store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM events').fetchone()[0],1)

    def test_13_rbac_blocks_another_driver(self):
        b=self.create()
        self.assertProblem('FORBIDDEN',lambda:self.book.dispatch('GET','/reservations/'+b['id'],{}, {'id':'stranger','role':'driver'}, {}, {}))
        self.assertProblem('FORBIDDEN',lambda:self.create(self.body(),self.owner))
        self.assertProblem('FORBIDDEN',lambda:self.inv.dispatch('PATCH','/spaces/s-emp-4',{'status':'paused'},self.driver,{}, {}))

    def test_14_no_capacity_reduction_below_committed(self):
        self.create()
        self.assertProblem('VALIDATION',lambda:self.inv.dispatch('PATCH','/spaces/s-emp-4',{'capacity':{'car':0,'moto':0}}, {'id':'u-host','role':'host'}, {}, {}))
        p=self.inv.store.get('s-emp-1')
        self.assertProblem('CAPACITY_CONFLICT',lambda:self.inv.dispatch('PATCH','/spaces/s-emp-1',{'capacity':{'car':1,'moto':12}},self.owner,{}, {}))

    def test_15_input_validation(self):
        for patch in [{'durationMin':-1},{'durationMin':1.5},{'durationMin':True},{'startAt':'bad'},{'startAt':'2026-01-01T12:00:00'},{'vehicle':'plane'},{'paymentMethod':'unknown'}]:
            with self.subTest(patch=patch):
                self.assertProblem('VALIDATION',lambda:self.create(self.body(**patch)))

    def test_16_passwords_hashed_and_sessions_revoked(self):
        result=self.identity.dispatch('POST','/auth/login',{'email':'conductor@demo.test','password':'demo123'},None,{}, {})
        with self.identity.store.connect() as db:
            row=db.execute('SELECT password FROM users WHERE id=?',('u-driver',)).fetchone()
            self.assertNotIn('demo123',row['password'])
        token=result['token']
        self.assertEqual(self.identity.dispatch('POST','/auth/resolve',{'token':token},None,{}, {})['id'],'u-driver')
        self.identity.dispatch('POST','/auth/logout',{'token':token},None,{}, {})
        self.assertProblem('UNAUTHORIZED',lambda:self.identity.dispatch('POST','/auth/resolve',{'token':token},None,{}, {}))

    def test_17_registration_cannot_elevate_role(self):
        self.assertProblem('VALIDATION',lambda:self.identity.dispatch('POST','/auth/register',{'email':'new@demo.test','password':'demo123','name':'New User','role':'admin'},None,{}, {}))

    def test_18_storage_survives_engine_restart(self):
        b=self.create()
        restarted=Bookings(Store(Path(self.temp.name)/'co/bookings.sqlite'),self.net)
        self.assertEqual(restarted.load(b['id'])['code'],b['code'])

    def test_19_independent_inventory_connections_enforce_mutex(self):
        def hold(index):
            inv=Inventory(Store(Path(self.temp.name)/'co/inventory.sqlite'),self.net)
            try:
                inv.dispatch('POST','/internal/slots/'+str(index),{'action':'hold','spaceId':'s-emp-4','vehicle':'car','userId':str(index)},None,{}, {})
                return True
            except Problem:
                return False
        with ThreadPoolExecutor(max_workers=10) as pool:
            self.assertEqual(sum(pool.map(hold,range(10))),1)

    def test_20_operator_can_manage_only_own_bookings(self):
        b=self.create(self.body(spaceId='s-emp-1'))
        self.assertEqual(self.book.dispatch('GET','/reservations/'+b['id'],{},self.owner,{}, {})['id'],b['id'])
        self.assertProblem('FORBIDDEN',lambda:self.book.dispatch('GET','/reservations/'+b['id'],{}, {'id':'u-other','role':'owner'}, {}, {}))

    def test_21_quote_changes_are_rejected_before_payment(self):
        self.assertProblem('PRICE_CHANGED',lambda:self.create(self.body(expectedAmount=1)))
        with self.pay.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM payments').fetchone()[0],0)
        with self.inv.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM slots').fetchone()[0],0)

    def test_22_replay_after_arrival_time_passed(self):
        from unittest.mock import patch
        body=self.body()
        first=self.create(body)
        original=datetime
        class Later(original):
            @classmethod
            def now(cls,tz=None):
                return original.now(tz)+timedelta(days=10)
        with patch('server.bookings.datetime',Later):
            self.assertEqual(self.create(body)['id'],first['id'])

    def test_23_checkout_retry_recovers_release(self):
        b=self.create()
        self.book.dispatch('POST','/reservations/'+b['id']+'/check-in',{},self.driver,{}, {})
        self.net.offline.add('inventory')
        self.assertProblem('SERVICE_UNAVAILABLE',lambda:self.book.dispatch('POST','/reservations/'+b['id']+'/check-out',{},self.driver,{}, {}))
        self.assertEqual(self.book.load(b['id'])['status'],'checking_out')
        self.net.offline.clear()
        finished=self.book.dispatch('POST','/reservations/'+b['id']+'/check-out',{},self.driver,{}, {})
        self.assertEqual(finished['status'],'completed')

    def test_24_seven_day_views_roll_over(self):
        from datetime import date
        s=self.inv.store.get('s-emp-1')
        s['viewsDay']=(date.today()-timedelta(days=9)).isoformat()
        s['metrics']['views']=[10]*7
        with self.inv.store.connect(write=True) as db:
            self.inv.store.put(s['id'],s,db)
        result=self.inv.dispatch('GET','/spaces/s-emp-1',{},None,{'track':'true'}, {})
        self.assertEqual(result['metrics']['views'],[0,0,0,0,0,0,1])


class RegionalTests(unittest.TestCase):
    def test_five_regions_same_flow_and_separate_storage(self):
        with tempfile.TemporaryDirectory() as root:
            ids=[]
            for r in REGIONS:
                with self.subTest(region=r['id']):
                    net=LocalNetwork(root,r['id'])
                    b=net.engines['bookings'].create({'id':'u-driver','name':'利用者 Ç œ ñ','role':'driver'}, {
                        'spaceId':'s-emp-4','vehicle':'car','durationMin':60,'startAt':(datetime.now(timezone.utc)+timedelta(minutes=15)).isoformat(), 'idempotencyKey':'same-key-every-region'})
                    ids.append(b['id'])
                    self.assertEqual(b['currency'],r['currency'])
                    self.assertIs(type(b['amount']),int)
                    self.assertEqual(b['subtotal']+b['tax'],b['amount'])
                    self.assertEqual(b['region'],r['id'])
                    self.assertEqual(b['driverName'],'利用者 Ç œ ñ')
                    self.assertTrue(b['startAt'].endswith('+00:00'))
            self.assertEqual(len(set(ids)),5)


if __name__=='__main__':
    unittest.main()
