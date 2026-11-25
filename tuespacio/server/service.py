import argparse
from collections import defaultdict, deque
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import mimetypes
import os
from pathlib import Path
import threading
import time
from urllib.parse import parse_qs, unquote, urlsplit

from .bookings import Bookings
from .common import Config, Problem, REGIONS, ROOT, SERVICES, Store, check_role, encode, now, require
from .identity import Identity
from .inventory import Inventory
from .payments import Payments
from .receipts import render as render_receipt, STYLE_HASH


class Broker:
    def __init__(self, store, config):
        self.store, self.config = store, config

    def dispatch(self, method, path, body, user, query, headers):
        if path == '/internal/events' and method == 'POST':
            with self.store.connect(write=True) as db:
                db.execute('INSERT OR IGNORE INTO events(id,value) VALUES (?,?)', (body['id'], encode(body)))
            return {'accepted': body['id']}
        check_role(user)
        with self.store.connect() as db:
            rows = db.execute('SELECT seq,value FROM events ORDER BY seq DESC LIMIT 200').fetchall()
        events = [{**json.loads(r['value']), 'sequence': r['seq']} for r in rows]
        return [e for e in events if user['role'] == 'admin' or user['id'] in e.get('audience', [e['userId']])]


class Gateway:
    def __init__(self, config):
        self.config = config
        self.attempts = defaultdict(deque)
        self.lock = threading.Lock()

    def dispatch(self, method, path, body, user, query, headers):
        cfg = self.config
        # Never grant the service key to a client-controlled internal path.
        require(path.startswith('/') and '%' not in path and '\\' not in path and '//' not in path and
                not any(part.casefold() in ['internal', '.', '..'] for part in path.split('/')),
                'Ruta no encontrada.', 'NOT_FOUND', 404)
        if path == '/regions' and method == 'GET':
            ports = json.loads(os.environ.get('PUBLIC_REGION_PORTS', '{"co":8080,"br":8090,"us":8100,"fr":8110,"jp":8120}'))
            return [{**r, 'port': ports.get(r['id'], 8080 + i * 10)} for i, r in enumerate(REGIONS)]
        if path == '/region' and method == 'GET':
            return {**cfg.region, 'demo': not cfg.production, 'passwordMinLength': 12 if cfg.production else 6, 'payments': {'provider': cfg.payment_provider,
                    'available': cfg.payment_provider == 'demo' or cfg.region['id'] == 'co' and all(os.environ.get(k) for k in ['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'MP_COLLECTOR_ID', 'APP_PUBLIC_URL']),
                    'live': cfg.payment_provider == 'mercadopago' and os.environ.get('MP_LIVE_MODE') == 'true'}}
        if path == '/payments/webhook' and method == 'POST':
            return cfg.call('payments', 'POST', path, {'event': body, 'query': query, 'headers': {k: headers.get(k, '') for k in ['X-Signature', 'X-Request-Id']}})
        token = headers.get('Authorization', '').removeprefix('Bearer ')
        if path.startswith('/auth/'):
            require(path in ['/auth/login', '/auth/register', '/auth/logout'] and method == 'POST', 'Ruta no encontrada.', 'NOT_FOUND', 404)
            with self.lock:
                clock = time.monotonic()
                identity = headers.get('X-Client-IP', 'local')
                attempts = self.attempts[identity]
                while attempts and attempts[0] < clock - 60:
                    attempts.popleft()
                require(len(attempts) < 30, 'Demasiados intentos. Espera un minuto.', 'RATE_LIMITED', 429)
                attempts.append(clock)
                if len(self.attempts) > 10000:
                    self.attempts = defaultdict(deque, {k: v for k, v in self.attempts.items() if v and v[-1] > clock - 60})
            return cfg.call('identity', method, path, {**body, **({'token': token} if path.endswith('logout') else {})})
        public = method == 'GET' and (path.startswith('/spaces') and not path.endswith('/reservations') or path.startswith('/destinations'))
        user = None if public and not token else cfg.call('identity', 'POST', '/auth/resolve', {'token': token})
        if path.startswith('/ops/'):
            check_role(user, 'admin')
            if path == '/ops/status':
                status = []
                for service in SERVICES[:-1]:
                    start = time.monotonic()
                    try:
                        health = cfg.call(service, 'GET', '/health', timeout=.5)
                        status.append({**health, 'latencyMs': round((time.monotonic() - start) * 1000), 'status': 'online'})
                    except Problem:
                        status.append({'service': service, 'status': 'offline', 'region': cfg.region['id']})
                return {'services': status, 'region': cfg.region, 'at': now()}
            if path == '/ops/spaces':
                return cfg.call('inventory', 'GET', '/internal/spaces', user=user)
            if path == '/ops/reservations':
                return cfg.call('bookings', 'GET', '/internal/reservations', user=user)
        if path == '/notifications':
            return cfg.call('broker', 'GET', path, user=user)
        if path == '/owner/space' and method == 'GET':
            check_role(user, 'owner')
            space = cfg.call('inventory', 'GET', path, user=user)
            require(space, 'No tienes un parqueadero asignado.', 'NOT_FOUND', 404)
            bookings = cfg.call('bookings', 'GET', '/spaces/' + space['id'] + '/reservations', user=user)
            from datetime import datetime, timezone
            days = [0] * 7
            for b in bookings:
                age = (datetime.now(timezone.utc).date() - datetime.fromisoformat(b['createdAt'].replace('Z', '+00:00')).date()).days
                if 0 <= age <= 6 and b['status'] not in ['failed', 'pending', 'compensating']:
                    days[6 - age] += 1
            return {'space': space, 'plan': space.get('plan'), 'metrics': {'views': space['metrics']['views'], 'reservations': days}}
        if path == '/host/earnings':
            check_role(user, 'host')
            bookings = cfg.call('bookings', 'GET', '/host/reservations', user=user)
            items = [b for b in bookings if b['status'] in ['completed', 'active', 'confirmed']]
            settled = [b for b in items if b['status'] == 'completed']
            gross = sum(b['amount'] for b in settled)
            commission = sum(b['commission'] for b in settled)
            return {'gross': gross, 'pending': sum(b['amount'] for b in items if b['status'] != 'completed'),
                    'commission': commission, 'net': gross - commission, 'count': len(settled),
                    'commissionRate': cfg.region['commissionBps'] / 10000, 'items': items}
        target = 'bookings' if path.startswith('/reservations') or path in ['/me/reservations', '/host/reservations', '/demo/transactions'] or path.endswith('/reservations') else 'identity' if path == '/me' else 'inventory'
        return cfg.call(target, method, path + ('?' + headers['X-Query'] if headers.get('X-Query') else ''), body if method != 'GET' else None, user=user)


def make_handler(service, config):
    store = Store(config.data_dir / config.region['id'] / (service + '.sqlite')) if service != 'gateway' else None
    engine = {'identity': Identity, 'inventory': Inventory, 'payments': Payments, 'bookings': Bookings, 'broker': Broker}.get(service)
    engine = engine(store, config) if engine else Gateway(config)
    web = ROOT.parent / 'web'

    class Handler(BaseHTTPRequestHandler):
        server_version = 'TuEspacio/1'

        def log_message(self, fmt, *args):
            if os.environ.get('VERBOSE'):
                logging.info('%s %s', service, fmt % args)

        def send(self, status, payload, mime='application/json; charset=utf-8'):
            raw = payload if isinstance(payload, bytes) else encode(payload).encode()
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'same-origin')
            self.send_header('Cache-Control', 'no-store' if 'json' in mime or '/receipt' in urlsplit(self.path).path else 'no-cache')
            self.send_header('Content-Security-Policy', ("default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'").replace("style-src 'self'", "style-src 'self' 'sha256-" + STYLE_HASH + "'") if '/receipt' in urlsplit(self.path).path else "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
            origin = self.headers.get('Origin', '')
            allowed = os.environ.get('CORS_ORIGINS', 'http://localhost:8081,http://localhost:8082,http://localhost:19006').split(',')
            if origin in allowed:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type,Authorization')
            self.send_header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_OPTIONS(self):
            self.send(200, {})

        def handle_request(self):
            try:
                url = urlsplit(self.path)
                path = unquote(url.path).rstrip('/') or '/'
                if service == 'gateway' and not path.startswith('/api') and path != '/health':
                    relative = 'index.html' if path == '/' else path.lstrip('/')
                    file = (web / relative).resolve()
                    require(file.is_relative_to(web.resolve()) and file.is_file(), 'Archivo no encontrado.', 'NOT_FOUND', 404)
                    return self.send(200, file.read_bytes(), mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
                if service != 'gateway':
                    require(hmac.compare_digest(self.headers.get('X-Service-Key', ''), config.key), 'Acceso interno requerido.', 'FORBIDDEN', 403)
                if path == '/health':
                    return self.send(200, {'data': {'service': service, 'region': config.region['id'], 'at': now()}})
                if service == 'gateway':
                    require(path.startswith('/api/'), 'Ruta no encontrada.', 'NOT_FOUND', 404)
                    path = path[4:]
                length = int(self.headers.get('Content-Length', '0'))
                require(0 <= length <= 65536, 'La solicitud excede el tamaño permitido.', 'PAYLOAD_TOO_LARGE', 413)
                self.connection.settimeout(8)
                body = json.loads(self.rfile.read(length)) if length else {}
                require(isinstance(body, dict), 'El cuerpo debe ser un objeto JSON.')
                raw_user = self.headers.get('X-User', '') if service != 'gateway' else ''
                user = json.loads(bytes.fromhex(raw_user)) if raw_user else None
                query = {k: v[-1] for k, v in parse_qs(url.query).items()}
                headers = {'Authorization': self.headers.get('Authorization', ''), 'X-Query': url.query, 'X-Client-IP': self.client_address[0], 'X-Signature': self.headers.get('X-Signature', ''), 'X-Request-Id': self.headers.get('X-Request-Id', '')}
                result = engine.dispatch(self.command, path, body, user, query, headers)
                if service == 'gateway' and path.endswith('/receipt') and self.command == 'GET' and query.get('format') == 'html':
                    return self.send(200, render_receipt(result['receipt'], result['booking']), 'text/html; charset=utf-8')
                self.send(200, {'data': result})
            except Problem as err:
                self.send(err.status, err.payload())
            except (ValueError, TypeError, KeyError, AttributeError, OverflowError) as err:
                self.send(422, Problem('VALIDATION', 'Revisa el formato y los campos de la solicitud.', 422).payload())
            except Exception:
                logging.exception('Error en %s', service)
                self.send(500, Problem('INTERNAL', 'No se pudo completar la operación.', 500).payload())

        do_GET = do_POST = do_PATCH = handle_request

    return Handler, engine


def make_server(service, config):
    handler, engine = make_handler(service, config)
    server = ThreadingHTTPServer((config.host if service == 'gateway' else '127.0.0.1', config.base_port + SERVICES.index(service)), handler)
    server.daemon_threads = True
    if service == 'bookings':
        def recovery():
            while True:
                time.sleep(1)
                try:
                    engine.tick()
                except Exception:
                    logging.exception('La recuperación volverá a intentarse')
        threading.Thread(target=recovery, daemon=True).start()
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('service', choices=SERVICES)
    parser.add_argument('--region', default='co', choices=[r['id'] for r in REGIONS])
    parser.add_argument('--base-port', type=int, default=8075)
    parser.add_argument('--data', default='.runtime')
    parser.add_argument('--host', default='127.0.0.1')
    args = parser.parse_args()
    key = os.environ.get('SERVICE_KEY')
    require(key and len(key) >= 32, 'SERVICE_KEY debe contener al menos 32 caracteres.')
    cfg = Config(args.region, args.base_port, args.data, key, args.host)
    server = make_server(args.service, cfg)
    print(f'{args.region}/{args.service} escuchando en {server.server_address[1]}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
