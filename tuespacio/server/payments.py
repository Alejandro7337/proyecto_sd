from .common import Problem, require
from .mercadopago import MercadoPago


class Payments:
    def __init__(self, store, config):
        self.store, self.config = store, config
        self.provider = MercadoPago(store, config) if config.payment_provider == "mercadopago" else None

    def dispatch(self, method, path, body, user, query, headers):
        if path == '/internal/payment-readiness' and method == 'GET':
            if self.provider:
                self.provider.ready()
            return {'ready': True}
        if path == '/payments/webhook' and method == 'POST':
            require(self.provider, 'Pasarela no disponible.', 'NOT_FOUND', 404)
            return self.provider.webhook(body['event'], body['query'], body['headers'])
        require(path.startswith('/internal/payments/') and method in ['GET', 'POST'], 'Ruta de pagos no encontrada.', 'NOT_FOUND', 404)
        id = path.split('/')[-1]
        if self.provider:
            action = body.get('action') if method == 'POST' else 'status'
            if method == 'GET' and not self.provider.load(id):
                return None
            return self.provider.operate(id, action, body)
        with self.store.connect(write=True) as db:
            row = db.execute('SELECT * FROM payments WHERE id=?', (id,)).fetchone()
            if method == 'GET':
                return dict(row) if row else None
            action = body.get('action')
            if action == 'authorize':
                if row:
                    require(row['amount'] == body['amount'] and row['method'] == body['method'], 'La autorización ya existe con otros datos.', 'IDEMPOTENCY_CONFLICT', 409)
                    return dict(row)
                require(type(body.get('amount')) is int and body['amount'] > 0, 'Importe inválido.')
                require(body.get('method') in self.config.region['paymentMethods'], 'Medio de pago no disponible en esta región.')
                if body.get('scenario') == 'declined':
                    raise Problem('PAYMENT_DECLINED', 'El pago de prueba fue rechazado. El cupo se liberó.', 402)
                db.execute('INSERT INTO payments VALUES (?,?,?,?)', (id, body['amount'], 'authorized', body['method']))
            else:
                require(row, 'Pago no encontrado.', 'NOT_FOUND', 404)
                target = {'capture': 'captured', 'refund': 'refunded', 'void': 'voided'}.get(action)
                require(target, 'Operación de pago inválida.')
                if action == 'capture':
                    require(row['state'] in ['authorized', 'captured'], 'El pago ya fue revertido.', 'INVALID_STATE', 409)
                if row['state'] not in ['refunded', 'voided']:
                    db.execute('UPDATE payments SET state=? WHERE id=?', (target, id))
            return dict(db.execute('SELECT * FROM payments WHERE id=?', (id,)).fetchone())
