from datetime import datetime, timedelta, timezone
import json
import threading
import time

from .receipts import snapshot
from .common import Problem, amount_for, check_role, encode, fingerprint, now, require, uid


class Bookings:
    def __init__(self, store, config):
        self.store, self.config = store, config
        self.locks = [threading.RLock() for _ in range(64)]
        self.request_locks = [threading.RLock() for _ in range(64)]

    def lock(self, key):
        return self.locks[hash(key) % len(self.locks)]

    def load(self, id):
        with self.store.connect() as db:
            row = db.execute('SELECT value FROM bookings WHERE id=?', (id,)).fetchone()
            require(row, 'Reserva no encontrada.', 'NOT_FOUND', 404)
            return json.loads(row['value'])

    def save(self, booking, event=None):
        with self.store.connect(write=True) as db:
            if event == 'reservation.confirmed':
                booking['receiptId'] = 'REC-' + booking['id'].removeprefix('r-').upper()
            db.execute('UPDATE bookings SET value=? WHERE id=?', (encode(booking), booking['id']))
            if event == 'reservation.confirmed':
                receipt = snapshot(booking, booking['payment'])
                db.execute('INSERT OR IGNORE INTO receipts VALUES (?,?)', (booking['id'], encode(receipt)))
            if event:
                data = {'id': booking['id'] + ':' + event, 'type': event, 'at': now(), 'region': self.config.region['id'],
                        'userId': booking['driverId'], 'bookingId': booking['id'], 'code': booking['code'], 'space': booking['space']['name']}
                data['audience'] = list(dict.fromkeys(id for id in [booking['driverId'], booking['space'].get('ownerId'), booking['space'].get('hostId')] if id))
                db.execute('INSERT OR IGNORE INTO outbox(id,value) VALUES (?,?)', (data['id'], encode(data)))

    def step(self, b, step, status='ok', detail=''):
        b['steps'].append({'step': step, 'status': status, 'detail': detail, 'at': now()})
        b['steps'] = b['steps'][-128:]
        self.save(b)

    def payment(self, b, action, **options):
        return self.config.call('payments', 'POST', '/internal/payments/' + b['id'],
                                {'action': action, 'amount': b['amount'], 'currency': b['currency'], 'description': b['space']['name'], 'method': b['payment']['method'], 'scenario': b.get('scenario', 'none'), **options})

    def slot(self, b, action):
        return self.config.call('inventory', 'POST', '/internal/slots/' + b['id'],
                                {'action': action, 'spaceId': b['spaceId'], 'vehicle': b['vehicle'], 'userId': b['driverId']})

    def compensate(self, b):
        payment = self.config.call('payments', 'GET', '/internal/payments/' + b['id'])
        if payment:
            result = self.payment(b, 'refund' if payment['state'] == 'captured' else 'void')
            b['payment']['status'] = result['state']
            self.step(b, 'C21', 'comp', 'Pago revertido de forma idempotente')
        try:
            self.slot(b, 'release')
        except Problem as e:
            if e.status != 404:
                raise
        self.step(b, 'C12', 'comp', 'Retención liberada')
        b['status'] = 'failed'
        self.save(b, 'reservation.failed')

    def resume(self, b):
        if b['status'] == 'compensating':
            self.compensate(b)
        if b['status'] == 'failed':
            err = b['failure']
            raise Problem(err['code'], err['message'], err['status'])
        if b['status'] not in ['pending', 'awaiting_payment']:
            return b
        try:
            if b['payment'].get('provider') == 'mercadopago':
                return self.resume_hosted(b)
            self.slot(b, 'hold')
            self.step(b, 'T12', detail='Cupo retenido mediante transacción atómica')
            authorized = self.payment(b, 'authorize')
            require(authorized['state'] in ['authorized', 'captured'], 'El pago ya fue revertido.', 'PAYMENT_REVERSED', 409)
            self.step(b, 'T21', detail='Pago de prueba preautorizado')
            captured = self.payment(b, 'capture')
            b['payment']['status'] = captured['state']
            self.step(b, 'T23', detail='Pago de prueba capturado una sola vez')
            self.slot(b, 'confirm')
            b['status'] = 'confirmed'
            b['steps'].append({'step': 'T13', 'status': 'ok', 'detail': 'Reserva confirmada', 'at': now()})
            self.save(b, 'reservation.confirmed')
            return b
        except Problem as e:
            if e.status >= 500:
                self.step(b, 'retry', 'info', str(e))
                raise Problem('RESERVATION_PENDING', 'La reserva se está recuperando. Reintenta con la misma llave para consultar el resultado.', 503, {'reservationId': b['id']}) from e
            b['failure'] = {'code': e.code, 'message': str(e), 'status': e.status}
            b['status'] = 'compensating'
            self.step(b, 'T0', 'fail', str(e))
            self.compensate(b)
            raise

    def resume_hosted(self, b):
        if b['status'] == 'pending':
            self.slot(b, 'hold')
            result = self.payment(b, 'checkout')
            b['payment'].update(result)
            b['payment']['status'] = result['state']
            b['status'] = 'awaiting_payment'
            self.save(b)
        result = self.config.call('payments', 'GET', '/internal/payments/' + b['id'])
        expired = (datetime.now(timezone.utc) - datetime.fromisoformat(b['createdAt'].replace('Z', '+00:00'))).total_seconds() >= 600
        if result['state'] in ['awaiting', 'creating']:
            result = self.payment(b, 'sync', minInterval=0 if expired else 30)
        b['payment'].update(result)
        b['payment']['status'] = result['state']
        if result['state'] == 'captured':
            # Expired holds never turn into confirmed spots; compensation refunds the charge.
            self.slot(b, 'confirm')
            b['status'] = 'confirmed'
            self.save(b, 'reservation.confirmed')
        elif result['state'] in ['declined', 'voided', 'refunded']:
            self.slot(b, 'release')
            b['status'] = 'failed'
            b['failure'] = {'code': 'PAYMENT_DECLINED', 'message': 'El pago no se completó.', 'status': 402}
            self.save(b, 'reservation.failed')
        elif (datetime.now(timezone.utc) - datetime.fromisoformat(b['createdAt'].replace('Z', '+00:00'))).total_seconds() >= 600:
            # Persist intent before a fallible remote operation; worker retries after restarts.
            b['status'] = 'cancelling'
            self.save(b)
            return self.cancel(b)
        else:
            self.save(b)
        return b

    def create(self, user, body):
        check_role(user, 'driver')
        key = body.get('idempotencyKey', '')
        require(isinstance(key, str) and 8 <= len(key) <= 160, 'Falta una llave de idempotencia válida.')
        clean = {k: body.get(k) for k in ['spaceId', 'vehicle', 'durationMin', 'startAt', 'paymentMethod', 'scenario', 'expectedAmount']}
        signature = fingerprint(clean)
        # Orden fijo: llave de solicitud y después reserva; recuperación solo toma la segunda.
        with self.request_locks[hash(user['id'] + key) % len(self.request_locks)]:
            with self.store.connect() as db:
                existing = db.execute('SELECT * FROM bookings WHERE user_id=? AND idem=?', (user['id'], key)).fetchone()
            if existing:
                require(existing['fingerprint'] == signature, 'La llave ya fue usada con otros datos.', 'IDEMPOTENCY_CONFLICT', 409)
                existing_b = json.loads(existing['value'])
                with self.lock(existing_b['id']):
                    return self.resume(self.load(existing_b['id']))
            vehicle, minutes = body.get('vehicle'), body.get('durationMin')
            require(vehicle in ['car', 'moto'] and type(minutes) is int and 15 <= minutes <= 480, 'Vehículo o duración inválidos (15–480 min).')
            try:
                start = datetime.fromisoformat(body.get('startAt', '').replace('Z', '+00:00'))
                require(start.tzinfo is not None, 'La fecha debe incluir zona horaria.')
                require(datetime.now(timezone.utc) - timedelta(minutes=5) <= start <= datetime.now(timezone.utc) + timedelta(days=7), 'Elige una llegada dentro de los próximos 7 días.')
            except (ValueError, TypeError, AttributeError):
                raise Problem('VALIDATION', 'Fecha de llegada inválida.', 422)
            space = self.config.call('inventory', 'GET', '/spaces/' + str(body.get('spaceId', '')))
            space['rate'] = space['rates'].get(vehicle)
            require(space['status'] == 'published' and space['rates'].get(vehicle), 'El espacio no recibe ese vehículo.', 'SPACE_UNAVAILABLE', 409)
            hosted = self.config.payment_provider == 'mercadopago'
            if hosted:
                self.config.call('payments', 'GET', '/internal/payment-readiness')
                require(self.config.region['id'] == 'co', 'Los cobros con Mercado Pago están disponibles en Colombia.', 'PAYMENT_UNAVAILABLE', 503)
                require(body.get('scenario', 'none') == 'none', 'Los escenarios demo están desactivados en la pasarela real.')
            if self.config.production:
                require(not space.get('demo') and (space.get('verification') == 'approved' or space['kind'] == 'formal'), 'Este espacio aún no está habilitado para reservas.', 'SPACE_UNAVAILABLE', 409)
            method = body.get('paymentMethod') or self.config.region['paymentMethods'][0]
            require(method in self.config.region['paymentMethods'], 'Elige un medio de pago de esta región.')
            require(body.get('scenario', 'none') in ['none', 'declined'], 'Escenario inválido.')
            total = amount_for(space['rates'][vehicle], minutes)
            if body.get('expectedAmount') is not None:
                require(type(body['expectedAmount']) is int and body['expectedAmount'] == total, 'La tarifa cambió. Actualiza el espacio y revisa el nuevo total antes de reservar.', 'PRICE_CHANGED', 409)
            tax = (total * self.config.region['taxBps'] + (10000 + self.config.region['taxBps']) // 2) // (10000 + self.config.region['taxBps'])
            b = {'id': uid('r'), 'code': 'TE-' + uid('')[1:7].upper(), 'driverId': user['id'], 'driverName': user['name'],
                 'spaceId': space['id'], 'space': space, 'vehicle': vehicle, 'durationMin': minutes,
                 'status': 'pending', 'startAt': start.astimezone(timezone.utc).isoformat(),
                 'endAt': (start + timedelta(minutes=minutes)).astimezone(timezone.utc).isoformat(), 'createdAt': now(),
                 'amount': total, 'tax': tax, 'subtotal': total - tax, 'currency': self.config.region['currency'],
                 'commission': (total * self.config.region['commissionBps'] + 5000) // 10000 if space['kind'] == 'particular' else 0,
                 'payment': {'method': 'Mercado Pago' if hosted else method, 'status': 'pending', 'provider': 'mercadopago' if hosted else 'demo'}, 'region': self.config.region['id'], 'steps': [], 'scenario': body.get('scenario', 'none'), 'idempotencyKey': key}
            with self.lock(b['id']):
                with self.store.connect(write=True) as db:
                    db.execute('INSERT INTO bookings VALUES (?,?,?,?,?)', (b['id'], user['id'], key, signature, encode(b)))
                return self.resume(b)

    def accessible(self, user, b):
        check_role(user)
        s = b['space']
        return user['role'] == 'admin' or user['id'] in [b['driverId'], s.get('ownerId'), s.get('hostId')]

    def cancel(self, b):
        result = self.payment(b, 'refund')
        b['payment']['status'] = result['state']
        self.slot(b, 'release')
        b['status'] = 'cancelled'
        b['steps'].append({'step': 'C0', 'status': 'comp', 'detail': 'Reembolso y liberación completados', 'at': now()})
        self.save(b, 'reservation.cancelled')
        return b

    def dispatch(self, method, path, body, user, query, headers):
        check_role(user)
        if path == '/reservations' and method == 'POST':
            return self.create(user, body)
        if method == 'GET' and (path in ['/me/reservations', '/host/reservations', '/internal/reservations', '/demo/transactions'] or (path.startswith('/spaces/') and path.endswith('/reservations'))):
            with self.store.connect() as db:
                all_b = [json.loads(r['value']) for r in db.execute('SELECT value FROM bookings ORDER BY rowid DESC')]
            if path == '/internal/reservations':
                check_role(user, 'admin')
            else:
                all_b = [b for b in all_b if self.accessible(user, b)]
                if path.startswith('/spaces/'):
                    all_b = [b for b in all_b if b['spaceId'] == path.split('/')[2]]
            if path == '/demo/transactions':
                return [{'id': b['id'], 'startedAt': b['createdAt'], 'outcome': {'confirmed': 'committed', 'failed': 'aborted'}.get(b['status'], b['status']),
                         'meta': {'space': b['space']['name'], 'idempotencyKey': b.get('idempotencyKey', b['id'])}, 'steps': b['steps']} for b in all_b]
            return all_b
        if path.startswith('/reservations/'):
            id = path.split('/')[2]
            with self.lock(id):
                b = self.load(id)
                require(self.accessible(user, b), 'No tienes acceso a esta reserva.', 'FORBIDDEN', 403)
                if method == 'GET':
                    if b['payment'].get('provider') == 'mercadopago' and b['status'] == 'awaiting_payment':
                        self.payment(b, 'sync', minInterval=0)
                        b = self.resume(b)
                    if path.endswith('/receipt'):
                        with self.store.connect() as db:
                            row = db.execute('SELECT value FROM receipts WHERE id=?', (b['id'],)).fetchone()
                        require(row, 'El recibo estará disponible cuando se confirme el pago.', 'RECEIPT_UNAVAILABLE', 409)
                        return {'receipt': json.loads(row['value']), 'booking': b}
                    return b
                action = path.split('/')[-1]
                if action == 'cancel' and method == 'POST':
                    require(b['status'] in ['confirmed', 'awaiting_payment', 'cancelling', 'cancelled'], 'La reserva ya inició o no está confirmada.', 'INVALID_STATE', 409)
                    if b['status'] != 'cancelled':
                        b['status'] = 'cancelling'
                        self.save(b)
                        return self.cancel(b)
                    return b
                transitions = {'check-in': ('confirmed', 'active', 'checkInAt'), 'check-out': ('active', 'completed', 'checkOutAt')}
                require(action in transitions and method == 'POST', 'Acción no encontrada.', 'NOT_FOUND', 404)
                before, after, stamp = transitions[action]
                if action == 'check-in' and b['payment'].get('provider') == 'mercadopago':
                    payment = self.config.call('payments', 'GET', '/internal/payments/' + b['id'])
                    require(payment and payment['state'] == 'captured', 'El pago ya no está confirmado. Consulta a administración.', 'PAYMENT_REVERSED', 409)
                if b['status'] == after:
                    return b
                require(b['status'] == before or (action == 'check-out' and b['status'] == 'checking_out'), 'La reserva no está en el estado requerido.', 'INVALID_STATE', 409)
                if after == 'completed':
                    b['status'] = 'checking_out'
                    self.save(b)
                    self.slot(b, 'release')
                b['status'], b[stamp] = after, now()
                self.save(b, 'reservation.' + after)
                return b
        raise Problem('NOT_FOUND', 'Ruta de reservas no encontrada.', 404)

    def tick(self):
        with self.store.connect() as db:
            pending = [json.loads(r['value']) for r in db.execute('SELECT value FROM bookings')]
        for b in pending:
            if b['payment'].get('provider') == 'mercadopago' and b['status'] in ['confirmed', 'active', 'completed']:
                with self.lock(b['id']):
                    try:
                        b = self.load(b['id'])
                        payment = self.config.call('payments', 'GET', '/internal/payments/' + b['id'])
                        if payment and payment['state'] != b['payment']['status']:
                            b['payment'].update(payment)
                            b['payment']['status'] = payment['state']
                            if b['status'] == 'confirmed' and payment['state'] != 'captured':
                                b['status'] = 'cancelling'
                                self.save(b)
                                self.cancel(b)
                            else:
                                self.save(b, 'payment.updated')
                    except Problem:
                        pass
                continue
            if b['status'] not in ['pending', 'awaiting_payment', 'compensating', 'cancelling', 'checking_out']:
                continue
            with self.lock(b['id']):
                try:
                    b = self.load(b['id'])
                    if b['status'] == 'cancelling':
                        self.cancel(b)
                    elif b['status'] == 'checking_out':
                        self.slot(b, 'release')
                        b['status'], b['checkOutAt'] = 'completed', now()
                        self.save(b, 'reservation.completed')
                    elif b['status'] in ['pending', 'awaiting_payment', 'compensating']:
                        self.resume(b)
                except Problem:
                    pass
        with self.store.connect() as db:
            events = db.execute('SELECT * FROM outbox WHERE delivered=0').fetchall()
        for event in events:
            try:
                self.config.call('broker', 'POST', '/internal/events', json.loads(event['value']))
                with self.store.connect(write=True) as db:
                    db.execute('UPDATE outbox SET delivered=1 WHERE id=?', (event['id'],))
            except Problem:
                break
