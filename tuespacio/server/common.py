import contextlib
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
REGIONS = json.loads((ROOT / 'regions.json').read_text())
SERVICES = ['identity', 'inventory', 'payments', 'bookings', 'broker', 'gateway']


class Problem(Exception):
    def __init__(self, code, message, status=400, details=None):
        super().__init__(message)
        self.code, self.status, self.details = code, status, details or {}

    def payload(self):
        return {'error': {'code': self.code, 'message': str(self), 'details': self.details}}


def require(condition, message, code='VALIDATION', status=422):
    if not condition:
        raise Problem(code, message, status)


def now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def uid(prefix):
    return prefix + '-' + secrets.token_hex(10)


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def fingerprint(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 210000).hex()
    return salt + ':' + digest


def password_matches(password, stored):
    return hmac.compare_digest(password_hash(password, stored.split(':')[0]), stored)


class Store:
    def __init__(self, path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password TEXT, value TEXT);
                CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT, expires REAL);
                CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, space_id TEXT, vehicle TEXT,
                    state TEXT, expires REAL, user_id TEXT);
                CREATE INDEX IF NOT EXISTS slots_space ON slots(space_id,vehicle,state);
                CREATE TABLE IF NOT EXISTS payment_intents (id TEXT PRIMARY KEY, value TEXT NOT NULL, provider_id TEXT);
                CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS geocode_cache (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires REAL);
                CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, amount INTEGER, state TEXT, method TEXT);
                CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, user_id TEXT, idem TEXT,
                    fingerprint TEXT, value TEXT, UNIQUE(user_id,idem));
                CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, value TEXT, delivered INTEGER DEFAULT 0);
                CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    id TEXT UNIQUE, value TEXT);
            ''')
        # Serialize migration with ordinary writes; support databases from earlier builds.
        with self.connect(write=True) as db:
            columns = {row['name'] for row in db.execute('PRAGMA table_info(payment_intents)')}
            if 'provider_id' not in columns:
                db.execute('ALTER TABLE payment_intents ADD COLUMN provider_id TEXT')
            db.execute("UPDATE payment_intents SET provider_id=json_extract(value,'$.providerId') WHERE provider_id IS NULL AND json_valid(value)")
            db.execute('CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_provider ON payment_intents(provider_id) WHERE provider_id IS NOT NULL')

    @contextlib.contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def get(self, id, db=None):
        if db is None:
            with self.connect() as conn:
                return self.get(id, conn)
        row = db.execute('SELECT value FROM documents WHERE id=?', (id,)).fetchone()
        if not row:
            raise Problem('NOT_FOUND', 'El recurso no existe.', 404)
        return json.loads(row['value'])

    def put(self, id, value, db):
        db.execute('INSERT INTO documents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', (id, encode(value)))

    def all(self):
        with self.connect() as db:
            return [json.loads(row['value']) for row in db.execute('SELECT value FROM documents')]


class Config:
    def __init__(self, region, base_port, data_dir, key, host='127.0.0.1'):
        self.region = next(r for r in REGIONS if r['id'] == region)
        self.base_port, self.data_dir, self.key, self.host = base_port, Path(data_dir), key, host
        self.production = os.environ.get('APP_ENV') == 'production'
        self.payment_provider = os.environ.get('PAYMENT_PROVIDER', 'demo')
        require(self.payment_provider in ['demo', 'mercadopago'], 'PAYMENT_PROVIDER inválido.')
        if self.production:
            require(self.payment_provider == 'mercadopago', 'Producción requiere Mercado Pago; los pagos demo están desactivados.')

    def call(self, service, method, path, body=None, user=None, timeout=3):
        url = f'http://127.0.0.1:{self.base_port + SERVICES.index(service)}{path}'
        headers = {'Content-Type': 'application/json', 'X-Service-Key': self.key}
        if user:
            headers['X-User'] = encode(user).encode().hex()
        req = Request(url, data=encode(body).encode() if body is not None else None, method=method, headers=headers)
        try:
            with urlopen(req, timeout=timeout) as res:
                return json.load(res)['data']
        except HTTPError as err:
            payload = json.load(err).get('error', {})
            raise Problem(payload.get('code', 'UPSTREAM'), payload.get('message', 'Error del servicio.'), err.code, payload.get('details')) from err
        except (URLError, TimeoutError, ConnectionError, OSError) as err:
            raise Problem('SERVICE_UNAVAILABLE', f'El servicio {service} no responde. Reintenta con la misma solicitud.', 503, {'service': service}) from err


def amount_for(rate, minutes):
    return rate['price'] * (minutes if rate['unit'] == 'minute' else (minutes + 59) // 60)


def public_user(row):
    return json.loads(row['value'])


def check_role(user, *roles):
    require(user, 'Inicia sesión para continuar.', 'UNAUTHORIZED', 401)
    require(not roles or user['role'] in roles, 'Tu cuenta no tiene permiso para esta operación.', 'FORBIDDEN', 403)
