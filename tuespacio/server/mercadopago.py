"""Mercado Pago Checkout Pro / Orders API. No card data enters this server."""
from decimal import Decimal, InvalidOperation
import hashlib
import hmac
import json
import os
import re
import threading
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import uuid

from .common import Problem, encode, now, require


class MercadoPago:
    def __init__(self, store, config):
        self.store, self.config = store, config
        self.locks = [threading.RLock() for _ in range(64)]
        self.token = os.environ.get('MP_ACCESS_TOKEN', '')
        self.secret = os.environ.get('MP_WEBHOOK_SECRET', '')
        self.collector = os.environ.get('MP_COLLECTOR_ID', '')
        self.public_url = os.environ.get('APP_PUBLIC_URL', '').rstrip('/')
        self.live = os.environ.get('MP_LIVE_MODE', 'false') == 'true'
        self.configured = bool(self.token and self.secret and self.collector and self.public_url)
        if self.configured:
            require(self.token.startswith('APP_USR-' if self.live else 'TEST-'), 'El token no corresponde al modo configurado (TEST- / APP_USR-).')
            require(not self.live or config.production, 'Los cobros reales requieren APP_ENV=production y datos reales.')
            url = urlsplit(self.public_url)
            require(url.scheme == 'https' and url.hostname not in ['localhost', '127.0.0.1'] and url.netloc and not url.username and not url.query and not url.fragment and url.path in ['', '/'], 'APP_PUBLIC_URL debe ser un origen HTTPS público.')
        if config.production and config.region['id'] == 'co':
            require(self.configured and self.live and os.environ.get('RECEIPT_SELLER_NAME') and os.environ.get('RECEIPT_SELLER_TAX_ID'), 'Configura Mercado Pago de producción y APP_PUBLIC_URL antes de iniciar.')

    def ready(self):
        require(self.config.region['id'] == 'co', 'La cuenta Mercado Pago configurada cobra únicamente en Colombia.', 'PAYMENT_UNAVAILABLE', 503)
        require(self.configured, 'Falta configurar Mercado Pago en el servidor. No se realizó ningún cobro.', 'PAYMENT_UNAVAILABLE', 503)

    def request(self, method, path, payload=None, key=None):
        headers = {'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json', 'Content-Type': 'application/json'}
        if key:
            headers['X-Idempotency-Key'] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'tuespacio:' + key))
        req = Request('https://api.mercadopago.com' + path, data=encode(payload).encode() if payload is not None else None, headers=headers, method=method)
        try:
            with urlopen(req, timeout=8) as response:
                raw = response.read(262145)
                require(len(raw) <= 262144, 'Respuesta de pago inválida.', 'PAYMENT_PROVIDER_ERROR', 502)
                return json.loads(raw)
        except (HTTPError, URLError, OSError, ValueError) as err:
            # No exponemos respuestas que puedan contener datos personales o credenciales.
            raise Problem('PAYMENT_PROVIDER_ERROR', 'Mercado Pago no pudo confirmar la operación. Reintenta con la misma reserva.', 503) from err

    def load(self, id):
        with self.store.connect() as db:
            row = db.execute('SELECT value FROM payment_intents WHERE id=?', (id,)).fetchone()
        return json.loads(row['value']) if row else None

    def save(self, payment):
        with self.store.connect(write=True) as db:
            db.execute('INSERT INTO payment_intents(id,value,provider_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,provider_id=excluded.provider_id', (payment['id'], encode(payment), payment.get('providerId')))
        return payment

    def checked(self, payment, order):
        require(str(order.get('id')) == payment['providerId'] and order.get('external_reference') == payment['id'] and
                str(order.get('user_id')) == self.collector and order.get('currency') == 'COP', 'La orden no corresponde a esta reserva o comercio.', 'PAYMENT_MISMATCH', 409)
        try:
            amount = Decimal(str(order['total_amount']))
            paid = Decimal(str(order.get('total_paid_amount', '0')))
            require(amount.is_finite() and paid.is_finite() and amount == Decimal(payment['amount']), 'El importe no coincide con la reserva.', 'PAYMENT_MISMATCH', 409)
        except (InvalidOperation, KeyError):
            raise Problem('PAYMENT_MISMATCH', 'Importe de pago inválido.', 409)
        status = order.get('status')
        if status == 'processed' and order.get('status_detail') == 'accredited':
            require(paid == amount, 'El cobro no está completo.', 'PAYMENT_MISMATCH', 409)
            state = 'captured'
        else:
            state = {'refunded': 'refunded', 'canceled': 'voided', 'failed': 'declined'}.get(status, 'awaiting')
        # Un callback retrasado nunca resucita una orden reembolsada o anulada.
        if payment['state'] in ['refunded', 'voided'] and state not in ['refunded', 'voided']:
            return payment
        payment.update(state=state, verifiedAt=now())
        if state == 'captured':
            payment.setdefault('paidAt', now())
        return self.save(payment)

    def recover_order(self, payment):
        if payment.get('providerId'):
            return payment
        # Replay the persisted request and key even when the hold has expired.
        # The first POST may have committed remotely before its response was lost.
        order = self.request('POST', '/v1/orders', payment['request'], payment['id'] + ':create')
        provider_id, checkout_url = order.get('id', ''), order.get('checkout_url', '')
        require(isinstance(provider_id, str) and re.fullmatch(r'[A-Za-z0-9-]{1,80}', provider_id), 'Identificador de orden inválido.', 'PAYMENT_PROVIDER_ERROR', 502)
        require(not self.live or not provider_id.startswith('ORDTST'), 'La orden corresponde a pruebas.', 'PAYMENT_MISMATCH', 409)
        url = urlsplit(checkout_url)
        require(url.scheme == 'https' and url.hostname == 'www.mercadopago.com.co' and not url.username, 'URL de pago inválida.', 'PAYMENT_PROVIDER_ERROR', 502)
        payment.update(providerId=provider_id, checkoutUrl=checkout_url)
        return self.checked(payment, order)

    def operate(self, id, action, body):
        self.ready()
        with self.locks[hash(id) % len(self.locks)]:
            payment = self.load(id)
            if action == 'checkout':
                require(type(body.get('amount')) is int and body['amount'] > 0 and body.get('currency') == 'COP', 'Importe o moneda inválidos.')
                if payment:
                    require(payment['amount'] == body['amount'], 'El importe de la orden cambió.', 'IDEMPOTENCY_CONFLICT', 409)
                else:
                    return_url = self.public_url + '/?' + urlencode({'booking': id})
                    payload = {'type': 'online', 'processing_mode': 'manual', 'capture_mode': 'automatic_async', 'total_amount': str(body['amount']),
                               'external_reference': id, 'expiration_time': 'PT10M',
                               'items': [{'title': str(body.get('description', 'Reserva Tu Espacio'))[:100], 'unit_price': str(body['amount']), 'quantity': 1}],
                               'config': {'online': {'success_url': return_url, 'failure_url': return_url, 'pending_url': return_url, 'auto_return': 'approved', 'retries': {'allowed': False}}}}
                    payment = self.save({'id': id, 'amount': body['amount'], 'currency': 'COP', 'state': 'creating', 'provider': 'mercadopago', 'live': self.live, 'createdAt': now(), 'request': payload})
                payment = self.recover_order(payment)
                return self.public(payment)
            require(payment, 'Pago no encontrado.', 'NOT_FOUND', 404)
            if action == 'status':
                return self.public(payment)
            if action in ['refund', 'void']:
                payment = self.recover_order(payment)
            require(payment.get('providerId'), 'La orden se está recuperando.', 'PAYMENT_PROVIDER_ERROR', 503)
            if action == 'sync':
                interval = body.get('minInterval', 0)
                require(type(interval) is int and 0 <= interval <= 300, 'Intervalo de consulta inválido.')
                if time.time() - payment.get('lastSyncAttemptAt', 0) < interval:
                    return self.public(payment)
                payment['lastSyncAttemptAt'] = time.time()
                self.save(payment)
                payment = self.checked(payment, self.request('GET', '/v1/orders/' + payment['providerId']))
            elif action in ['refund', 'void']:
                payment = self.checked(payment, self.request('GET', '/v1/orders/' + payment['providerId']))
                if payment['state'] == 'captured':
                    self.request('POST', '/v1/orders/' + payment['providerId'] + '/refund', {}, id + ':refund')
                elif payment['state'] not in ['refunded', 'voided', 'declined']:
                    self.request('POST', '/v1/orders/' + payment['providerId'] + '/cancel', {}, id + ':cancel')
                payment = self.checked(payment, self.request('GET', '/v1/orders/' + payment['providerId']))
                require(payment['state'] in ['refunded', 'voided', 'declined'], 'La reversión sigue en proceso. Conservamos la solicitud.', 'REFUND_PENDING', 503)
            else:
                raise Problem('VALIDATION', 'Acción de pago inválida.', 422)
            return self.public(payment)

    def public(self, p):
        return {k: p[k] for k in ['id', 'state', 'amount', 'currency', 'provider', 'live', 'providerId', 'checkoutUrl', 'createdAt', 'verifiedAt', 'paidAt'] if k in p}

    def webhook(self, body, query, headers):
        self.ready()
        id = query.get('data.id', '')
        require(isinstance(id, str) and re.fullmatch(r'[A-Za-z0-9-]{1,80}', id), 'Evento inválido.', 'INVALID_SIGNATURE', 401)
        signature = dict(part.strip().split('=', 1) for part in headers.get('X-Signature', '').split(',') if '=' in part)
        ts, signature_hash = signature.get('ts', ''), signature.get('v1', '')
        request_id = headers.get('X-Request-Id', '')
        require(ts.isdigit() and len(ts) <= 16 and request_id and len(request_id) <= 160, 'Firma ausente.', 'INVALID_SIGNATURE', 401)
        manifest = f'id:{id.lower()};request-id:{request_id};ts:{ts};'
        expected = hmac.new(self.secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
        require(hmac.compare_digest(expected, signature_hash), 'Firma inválida.', 'INVALID_SIGNATURE', 401)
        require(body.get('type') == 'order' and body.get('data', {}).get('id') == id and body.get('live_mode') is self.live, 'Evento de otro entorno.', 'INVALID_SIGNATURE', 401)
        with self.store.connect() as db:
            # Sólo consultamos órdenes que pertenecen a este servidor.
            row = db.execute('SELECT value FROM payment_intents WHERE provider_id=?', (id,)).fetchone()
        payment = json.loads(row['value']) if row else None
        require(payment, 'Orden aún no registrada; reintenta la notificación.', 'PAYMENT_PENDING', 503)
        self.operate(payment['id'], 'sync', {})
        return {'accepted': True}
