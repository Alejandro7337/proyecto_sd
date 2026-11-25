"""Provider contract fixtures, deliberately no real bank/HTTP calls."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from server.common import Problem, encode
from server.locations import distance_m
from server.payments import Payments
from server.receipts import render
from server.tests.test_system import LocalNetwork


class CheckoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.net = LocalNetwork(cls.temp.name)
        cls.env = patch.dict('os.environ', {'PAYMENT_PROVIDER': 'mercadopago', 'MP_ACCESS_TOKEN': 'TEST-fixture-private-token',
                              'MP_WEBHOOK_SECRET': 'fixture-events-secret', 'MP_COLLECTOR_ID': '12345',
                              'APP_PUBLIC_URL': 'https://parking.example', 'MP_LIVE_MODE': 'false'})
        cls.env.start()
        cls.net.payment_provider = 'mercadopago'
        cls.payments = Payments(cls.net.engines['payments'].store, cls.net)
        cls.net.engines['payments'] = cls.payments
        cls.provider = cls.payments.provider
        cls.book = cls.net.engines['bookings']

    @classmethod
    def tearDownClass(cls):
        cls.env.stop()
        cls.temp.cleanup()

    def setUp(self):
        for engine in self.net.engines.values():
            with engine.store.connect(write=True) as db:
                for table in ['payment_intents', 'payments', 'bookings', 'slots', 'outbox', 'receipts']:
                    db.execute('DELETE FROM ' + table)
        self.orders, self.calls = {}, []
        self.provider.request = self.remote
        self.driver = {'id': 'u-driver', 'name': '<script>Prueba</script> 利用者', 'role': 'driver'}
        self.body = {'spaceId': 's-emp-4', 'vehicle': 'car', 'durationMin': 60,
                     'startAt': (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(), 'idempotencyKey': 'checkout-fixture-0001'}

    def remote(self, method, path, payload=None, key=None):
        self.calls.append((method, path, deepcopy(payload), key))
        if path == '/v1/orders':
            id = 'ORDTST' + payload['external_reference'].replace('-', '')
            self.orders.setdefault(id, {'id': id, 'external_reference': payload['external_reference'], 'total_amount': payload['total_amount'],
                                       'total_paid_amount': '0', 'status': 'created', 'status_detail': 'created', 'user_id': '12345', 'currency': 'COP',
                                       'checkout_url': 'https://www.mercadopago.com.co/checkout/v1/redirect?order_id=' + id})
            return deepcopy(self.orders[id])
        id = path.split('/')[3]
        order = self.orders[id]
        if path.endswith('/refund'):
            order.update(status='refunded', status_detail='refunded')
        elif path.endswith('/cancel'):
            order.update(status='canceled', status_detail='canceled')
        return deepcopy(order)

    def create(self):
        return self.book.create(self.driver, self.body)

    def approve(self, b):
        order = self.orders[b['payment']['providerId']]
        order.update(status='processed', status_detail='accredited', total_paid_amount=order['total_amount'])
        return order

    def event(self, b, **changes):
        id = b['payment']['providerId']
        signature = hmac.new(self.provider.secret.encode(), f'id:{id.lower()};request-id:req-1;ts:1742505638683;'.encode(), hashlib.sha256).hexdigest()
        return self.provider.webhook({'type': 'order', 'live_mode': False, 'data': {'id': id}, **changes}, {'data.id': id},
                                     {'X-Signature': 'ts=1742505638683,v1=' + signature, 'X-Request-Id': 'req-1'})

    def problem(self, code, fn):
        with self.assertRaises(Problem) as context:
            fn()
        self.assertEqual(context.exception.code, code)

    def test_payment_waits_for_verified_server_state_and_receipt(self):
        b = self.create()
        self.assertEqual(b['status'], 'awaiting_payment')
        self.problem('RECEIPT_UNAVAILABLE', lambda: self.book.dispatch('GET', '/reservations/' + b['id'] + '/receipt', {}, self.driver, {}, {}))
        self.assertEqual(self.create()['id'], b['id'])
        self.assertEqual(len([c for c in self.calls if c[1] == '/v1/orders']), 1)
        self.approve(b)
        self.assertEqual(self.create()['status'], 'awaiting_payment') # return-url input cannot mark paid
        self.event(b)
        self.book.tick()
        b = self.book.load(b['id'])
        self.assertEqual(b['status'], 'confirmed')
        receipt = self.book.dispatch('GET', '/reservations/' + b['id'] + '/receipt', {}, self.driver, {}, {})['receipt']
        self.assertFalse(receipt['live'])
        self.assertEqual(receipt['transactionId'], b['payment']['providerId'])
        html = render(receipt, b).decode()
        self.assertNotIn('<script>Prueba', html)
        self.assertIn('利用者', html)
        self.assertIn('no sustituye una factura', html)
        self.event(b)
        with self.book.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM receipts').fetchone()[0], 1)
        self.problem('FORBIDDEN', lambda: self.book.dispatch('GET', '/reservations/' + b['id'] + '/receipt', {}, {'id': 'other', 'role': 'driver'}, {}, {}))

    def test_explicit_lookup_reconciles_approved_payment_without_webhook(self):
        b = self.create()
        self.approve(b)
        result = self.book.dispatch('GET', '/reservations/' + b['id'], {}, self.driver, {}, {})
        self.assertEqual(result['status'], 'confirmed')
        self.assertEqual(result['payment']['status'], 'captured')
        self.assertFalse(any(call[1].endswith('/refund') for call in self.calls))

    def test_worker_forces_reconciliation_before_expiry_and_throttles_waiting(self):
        b = self.create()
        reads = len([call for call in self.calls if call[0] == 'GET'])
        self.book.tick(); self.book.tick()
        self.assertEqual(len([call for call in self.calls if call[0] == 'GET']), reads)
        self.approve(b)
        b['createdAt'] = (datetime.now(timezone.utc) - timedelta(seconds=601)).isoformat()
        self.book.save(b)
        # Keep the real inventory hold valid: age alone must not cause an approved order refund.
        self.book.tick()
        self.assertEqual(self.book.load(b['id'])['status'], 'confirmed')
        self.assertFalse(any(call[1].endswith('/refund') for call in self.calls))

    def test_forged_and_wrong_environment_webhooks_fail(self):
        b = self.create()
        self.problem('INVALID_SIGNATURE', lambda: self.provider.webhook({}, {'data.id': b['payment']['providerId']}, {}))
        self.problem('INVALID_SIGNATURE', lambda: self.event(b, live_mode=True))
        self.assertEqual(self.book.load(b['id'])['status'], 'awaiting_payment')

    def test_wrong_merchant_amount_currency_never_confirms(self):
        b = self.create()
        order = self.approve(b)
        for field, wrong in [('user_id', 'other'), ('total_amount', '1'), ('currency', 'USD'), ('external_reference', 'other')]:
            saved = order[field]
            order[field] = wrong
            self.problem('PAYMENT_MISMATCH', lambda: self.event(b))
            order[field] = saved
        self.assertEqual(self.book.load(b['id'])['status'], 'awaiting_payment')

    def test_late_payment_refunds_and_releases_without_receipt(self):
        b = self.create()
        with self.net.engines['inventory'].store.connect(write=True) as db:
            db.execute('UPDATE slots SET expires=? WHERE id=?', (time.time() - 1, b['id']))
        self.approve(b)
        self.event(b)
        self.book.tick()
        result = self.book.load(b['id'])
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['payment']['status'], 'refunded')
        self.assertEqual(len([c for c in self.calls if c[1].endswith('/refund')]), 1)
        self.problem('RECEIPT_UNAVAILABLE', lambda: self.book.dispatch('GET', '/reservations/' + b['id'] + '/receipt', {}, self.driver, {}, {}))

    def test_approved_cancel_refunds_idempotently_and_keeps_receipt(self):
        b = self.create()
        self.approve(b); self.event(b); self.book.tick()
        first = self.book.dispatch('GET', '/reservations/' + b['id'] + '/receipt', {}, self.driver, {}, {})['receipt']
        for _ in range(2):
            b = self.book.dispatch('POST', '/reservations/' + b['id'] + '/cancel', {}, self.driver, {}, {})
        self.assertEqual(b['payment']['status'], 'refunded')
        second = self.book.dispatch('GET', '/reservations/' + b['id'] + '/receipt', {}, self.driver, {}, {})['receipt']
        self.assertEqual(first, second)
        self.assertEqual(len([c for c in self.calls if c[1].endswith('/refund')]), 1)

    def test_unpaid_cancel_voids_without_false_refund(self):
        b = self.create()
        b = self.book.dispatch('POST', '/reservations/' + b['id'] + '/cancel', {}, self.driver, {}, {})
        self.assertEqual(b['status'], 'cancelled')
        self.assertEqual(b['payment']['status'], 'voided')
        self.assertFalse(any(c[1].endswith('/refund') for c in self.calls))

    def recover_lost_creation_after_hold_expiry(self, paid):
        from server.mercadopago import MercadoPago
        lost = False

        def remote_with_lost_response(method, path, payload=None, key=None):
            nonlocal lost
            result = self.remote(method, path, payload, key)
            if path == '/v1/orders' and not lost:
                lost = True
                raise Problem('PAYMENT_PROVIDER_ERROR', 'Respuesta perdida después del commit remoto', 503)
            return result

        self.provider.request = remote_with_lost_response
        self.problem('RESERVATION_PENDING', self.create)
        with self.book.store.connect() as db:
            booking = json.loads(db.execute('SELECT value FROM bookings').fetchone()['value'])
        original = self.provider.load(booking['id'])
        self.assertIsNone(original.get('providerId'))
        self.assertEqual(len(self.orders), 1)
        if paid:
            order = next(iter(self.orders.values()))
            order.update(status='processed', status_detail='accredited', total_paid_amount=order['total_amount'])
        with self.net.engines['inventory'].store.connect(write=True) as db:
            db.execute('UPDATE slots SET expires=? WHERE id=?', (time.time() - 1, booking['id']))

        # Recovery uses only persisted data after a payment-service restart.
        restarted = MercadoPago(self.payments.store, self.net)
        restarted.request = self.remote
        previous = self.payments.provider
        self.payments.provider = restarted
        try:
            for _ in range(3):
                self.book.tick()
            result = self.book.load(booking['id'])
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['payment']['status'], 'refunded' if paid else 'voided')
            self.assertTrue(restarted.load(booking['id'])['providerId'])
            creates = [call for call in self.calls if call[1] == '/v1/orders']
            self.assertEqual(len(creates), 2)
            self.assertEqual(creates[0][2:], creates[1][2:])
            self.assertEqual(len(self.orders), 1)
            reversals = [call for call in self.calls if call[1].endswith('/refund' if paid else '/cancel')]
            self.assertEqual(len(reversals), 1)
            space = self.net.engines['inventory'].dispatch('GET', '/spaces/' + booking['spaceId'], {}, None, {}, {})
            self.assertEqual(space['availability']['car']['free'], 1)
        finally:
            self.payments.provider = previous

    def test_lost_creation_response_expires_then_cancels_remote_order(self):
        self.recover_lost_creation_after_hold_expiry(paid=False)

    def test_lost_creation_response_expires_then_refunds_accredited_order(self):
        self.recover_lost_creation_after_hold_expiry(paid=True)

    def test_missing_credentials_cannot_fall_back_to_demo(self):
        self.provider.configured = False
        try:
            self.problem('PAYMENT_UNAVAILABLE', self.create)
            with self.payments.store.connect() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM payments').fetchone()[0], 0)
        finally:
            self.provider.configured = True

    def test_provider_transport_uses_stable_idempotency_and_server_token(self):
        from server.mercadopago import MercadoPago
        from io import BytesIO
        provider = MercadoPago(self.payments.store, self.net)
        requests = []
        def remote(req, **kwargs):
            requests.append(req)
            return BytesIO(b'{"id":"test"}')
        with patch('server.mercadopago.urlopen', remote):
            for _ in range(2): provider.request('POST', '/v1/orders', {'total_amount': '5000'}, 'stable')
        self.assertEqual(requests[0].get_header('X-idempotency-key'), requests[1].get_header('X-idempotency-key'))
        self.assertEqual(requests[0].get_header('Authorization'), 'Bearer TEST-fixture-private-token')


class LocationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.net = LocalNetwork(cls.temp.name)
        cls.inv = cls.net.engines['inventory']

    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def test_free_address_outside_three_zones_and_geographic_coverage(self):
        with self.inv.store.connect(write=True) as db:
            d = self.inv.locations.remember('Destino distinto de las tres zonas', 'Calle 100 Bogotá', {'lat': 4.656, 'lon': -74.060}, 'fixture', db)
            remote = self.inv.locations.remember('Otro país', 'Madrid', {'lat': 40.416, 'lon': -3.703}, 'fixture', db)
        near = self.inv.dispatch('GET', '/spaces', {}, None, {'destinationId': d['id']}, {})
        self.assertGreater(len(near), 0)
        self.assertTrue(all(s['distanceM'] <= 5000 for s in near))
        self.assertEqual(self.inv.dispatch('GET', '/spaces', {}, None, {'destinationId': remote['id']}, {}), [])

    def test_geocoder_results_are_cached_and_not_fabricated(self):
        from io import BytesIO
        fixture = {'features': [{'geometry': {'coordinates': [-74.06, 4.656]}, 'properties': {'name': 'Parque fixture', 'city': 'Bogotá', 'country': 'Colombia'}}]}
        with patch('server.locations.urlopen', return_value=BytesIO(json.dumps(fixture).encode())) as request:
            first = self.inv.locations.search('dirección fixture independiente', [])
            second = self.inv.locations.search('dirección fixture independiente', [])
        self.assertEqual(first, second)
        self.assertEqual(request.call_count, 1)
        from urllib.parse import parse_qs, urlsplit
        outgoing = request.call_args.args[0]
        self.assertNotIn('lang', parse_qs(urlsplit(outgoing.full_url).query))
        self.assertEqual(outgoing.get_header('Accept-language'), 'es,en;q=0.8')
        self.assertEqual(first[0]['source'], 'OpenStreetMap / Photon')
        self.assertEqual(self.inv.locations.get(first[0]['id']), first[0])
        self.assertEqual(distance_m(first[0]['location'], first[0]['location']), 0)

    def test_invalid_coordinates_fail(self):
        with self.assertRaises(Problem): distance_m({'lat': 100, 'lon': 0}, {'lat': 0, 'lon': 0})


class ProductionContractTests(unittest.TestCase):
    def test_payment_provider_index_migrates_previous_database(self):
        import sqlite3
        from server.common import Store
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'old-payments.sqlite'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE payment_intents(id TEXT PRIMARY KEY, value TEXT NOT NULL)')
                db.execute('INSERT INTO payment_intents VALUES (?,?)', ('r-existing', json.dumps({'id':'r-existing','providerId':'ORDTST-existing'})))
            store = Store(path)
            with store.connect() as db:
                row = db.execute('SELECT id FROM payment_intents WHERE provider_id=?', ('ORDTST-existing',)).fetchone()
                self.assertEqual(row['id'], 'r-existing')
                plan = db.execute('EXPLAIN QUERY PLAN SELECT value FROM payment_intents WHERE provider_id=?', ('ORDTST-existing',)).fetchone()['detail']
                self.assertIn('INDEX', plan)
            Store(path) # Migration is repeatable.

    def test_pending_production_publication_cannot_be_republished_or_listed(self):
        with tempfile.TemporaryDirectory() as root:
            net = LocalNetwork(root)
            inv = net.engines['inventory']
            template = inv.store.get('s-emp-4')
            host = {'id':'fixture-host','role':'host'}
            body = {k:template[k] for k in ['name','address','capacity','rates','schedule','conditions','location','destinationId']}
            body.update(status='published',identityConsent=True)
            net.production = True
            created = inv.dispatch('POST','/host/spaces',body,host,{}, {})
            self.assertEqual(created['status'],'paused')
            with self.assertRaises(Problem) as error:
                inv.dispatch('PATCH','/spaces/'+created['id'],{'status':'published'},host,{}, {})
            self.assertEqual(error.exception.code,'VERIFICATION_REQUIRED')
            # Defend legacy records that were previously marked published without approval.
            with inv.store.connect(write=True) as db:
                record = inv.store.get(created['id'],db)
                record['status'] = 'published'
                inv.store.put(record['id'],record,db)
            self.assertNotIn(created['id'],[s['id'] for s in inv.dispatch('GET','/spaces',{},None,{}, {})])
            with self.assertRaises(Problem): inv.dispatch('GET','/spaces/'+created['id'],{},None,{}, {})
            self.assertEqual(inv.dispatch('GET','/spaces/'+created['id'],{},host,{}, {})['id'],created['id'])

    def test_production_registration_explains_twelve_character_minimum(self):
        with tempfile.TemporaryDirectory() as root:
            net = LocalNetwork(root)
            net.production = True
            with self.assertRaises(Problem) as error:
                net.engines['identity'].dispatch('POST','/auth/register',{'email':'fixture@example.test','name':'Fixture User','password':'short123','role':'driver'},None,{}, {})
            self.assertIn('12',str(error.exception))
