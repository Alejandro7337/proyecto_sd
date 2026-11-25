import hashlib
import json
import re
import secrets
import sqlite3
import time

from .common import ROOT, Problem, check_role, encode, password_hash, password_matches, public_user, require, uid


class Identity:
    def __init__(self, store, config):
        self.store, self.config = store, config
        self.dummy_hash = password_hash('invalid-password')
        seed = json.loads((ROOT / 'data/seed.json').read_text())['users']
        seed.append({'id': 'u-admin', 'role': 'admin', 'name': 'Administración Demo', 'email': 'admin@demo.test', 'password': 'demo123'})
        with store.connect(write=True) as db:
            if config.production:
                require(not db.execute("SELECT 1 FROM users WHERE email LIKE '%@demo.test'").fetchone(), 'Usa un directorio de datos vacío para producción; contiene cuentas demo.')
                seed = []
            for u in seed:
                if db.execute('SELECT 1 FROM users WHERE id=?', (u['id'],)).fetchone():
                    continue
                value = {k: v for k, v in u.items() if k != 'password'}
                value['region'] = config.region['id']
                db.execute('INSERT INTO users VALUES (?,?,?,?)', (u['id'], u['email'], password_hash(u['password']), encode(value)))

    def dispatch(self, method, path, body, user, query, headers):
        if path == '/auth/resolve':
            token = body.get('token', '')
            with self.store.connect() as db:
                row = db.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',
                                 (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
                require(row, 'La sesión venció. Vuelve a iniciar sesión.', 'UNAUTHORIZED', 401)
                return public_user(row)
        if path == '/auth/logout' and method == 'POST':
            with self.store.connect(write=True) as db:
                db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(body.get('token', '').encode()).hexdigest(),))
            return {'ok': True}
        if path in ['/auth/login', '/auth/register'] and method == 'POST':
            email = str(body.get('email', '')).strip().lower()
            password = body.get('password', '')
            require(isinstance(password, str) and len(password) <= 128, 'La contraseña no es válida.')
            with self.store.connect(write=True) as db:
                if path.endswith('register'):
                    require(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email), 'Escribe un correo válido.')
                    require((12 if self.config.production else 6) <= len(password) <= 128, f'La contraseña debe tener entre {12 if self.config.production else 6} y 128 caracteres.')
                    require(body.get('role') in ['driver', 'host'], 'Este perfil requiere alta por administración.')
                    require(3 <= len(str(body.get('name', '')).strip()) <= 100, 'Escribe un nombre de 3 a 100 caracteres.')
                    require(body.get('vehicle', 'car') in ['car', 'moto'], 'El vehículo no es válido.')
                    value = {'id': uid('u'), 'name': body['name'].strip(), 'email': email, 'role': body['role'],
                             'vehicle': body.get('vehicle', 'car'), 'identity': 'pending', 'region': self.config.region['id']}
                    try:
                        db.execute('INSERT INTO users VALUES (?,?,?,?)', (value['id'], email, password_hash(password), encode(value)))
                    except sqlite3.IntegrityError:
                        raise Problem('EMAIL_IN_USE', 'Ya existe una cuenta con ese correo.', 409)
                row = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
                # El hash de respaldo evita una salida rápida para correos inexistentes.
                valid = password_matches(password, row['password'] if row else self.dummy_hash)
                require(row and valid, 'Correo o contraseña incorrectos.', 'INVALID_CREDENTIALS', 401)
                value = public_user(row)
                require(not body.get('role') or value['role'] == body['role'], 'La cuenta pertenece a otro perfil.', 'ROLE_MISMATCH', 403)
                token = secrets.token_urlsafe(32)
                db.execute('DELETE FROM sessions WHERE expires<=?', (time.time(),))
                db.execute('INSERT INTO sessions VALUES (?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), value['id'], time.time() + 43200))
                return {'token': token, 'user': value}
        check_role(user)
        if path == '/me':
            if method == 'PATCH':
                with self.store.connect(write=True) as db:
                    value = public_user(db.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone())
                    for field in ['name', 'vehicle']:
                        if field in body:
                            require((field == 'vehicle' and body[field] in ['car', 'moto']) or
                                    (field == 'name' and isinstance(body[field], str) and 3 <= len(body[field].strip()) <= 100), 'Revisa los datos del perfil.')
                            value[field] = body[field].strip()
                    db.execute('UPDATE users SET value=? WHERE id=?', (encode(value), user['id']))
                    return value
            if method == 'GET':
                return user
        raise Problem('NOT_FOUND', 'Ruta de identidad no encontrada.', 404)
