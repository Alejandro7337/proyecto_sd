from copy import deepcopy
import json
import math
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from .common import ROOT, Problem, check_role, require, uid
from .locations import Locations, distance_m, coordinates, demo_location



class Inventory:
    def __init__(self, store, config):
        self.store, self.config = store, config
        self.locations = Locations(store, config)
        seed = json.loads((ROOT / 'data/seed.json').read_text())
        with store.connect(write=True) as db:
            if config.production:
                require(not any(json.loads(r['value']).get('demo', r['id'] in {s['id'] for s in seed['spaces']}) for r in db.execute('SELECT id,value FROM documents')), 'Usa datos de inventario reales en producción.')
                seed['spaces'] = []
            if not db.execute('SELECT 1 FROM documents LIMIT 1').fetchone():
                for index, s in enumerate(seed['spaces']):
                    for vehicle, rate in s['rates'].items():
                        if rate:
                            price = config.region['minutePrice'] if vehicle == 'car' else (config.region['minutePrice'] * 65 + 50) // 100
                            rate['price'] = price * (60 if rate['unit'] == 'hour' else 1)
                    district = config.region['districts'][['d-emp', 'd-uni', 'd-cli'].index(s['destinationId'])]
                    s['name'] = ['Central Parking', 'Urban Parking', 'Ágora Parking', 'Espacio privado'][index % 4] + f' · {index + 1:02d}'
                    s['address'] = district + ', ' + config.region['city']
                    s['demo'] = True
                    s['location'] = demo_location(config.region['id'], s['destinationId'], index)
                    s['metrics'] = {'views': [0] * 7, 'reservations': [0] * 7}
                    self.store.put(s['id'], s, db)

        if not config.production:
            seed_ids = {s['id'] for s in seed['spaces']}
            with store.connect(write=True) as db:
                for row in db.execute('SELECT id,value FROM documents').fetchall():
                    s = json.loads(row['value'])
                    if row['id'] in seed_ids and not s.get('location'):
                        s['location'] = demo_location(config.region['id'], s['destinationId'])
                        s['demo'] = True
                        self.store.put(s['id'], s, db)

    def destinations(self):
        return [{'id': id, 'name': name, 'hint': self.config.region['city']} for id, name in
                zip(['d-emp', 'd-uni', 'd-cli'], self.config.region['districts'])]

    def expire(self, db):
        db.execute("UPDATE slots SET state='expired' WHERE state='held' AND expires<?", (time.time(),))

    def dto(self, space, db):
        today = datetime.now(ZoneInfo(self.config.region['timeZone'])).date()
        previous = datetime.fromisoformat(space.get('viewsDay', today.isoformat())).date()
        elapsed = min(7, max(0, (today - previous).days))
        if elapsed:
            space['metrics']['views'] = space['metrics']['views'][elapsed:] + [0] * elapsed
        if space.get('viewsDay') != today.isoformat():
            space['viewsDay'] = today.isoformat()
            self.store.put(space['id'], space, db)
        s = deepcopy(space)
        s['availability'] = {}
        for vehicle in ['car', 'moto']:
            counts = dict(db.execute('SELECT state,COUNT(*) FROM slots WHERE space_id=? AND vehicle=? GROUP BY state', (s['id'], vehicle)).fetchall())
            capacity, occupied = s['capacity'][vehicle], s['occupied'][vehicle]
            held, reserved = counts.get('held', 0), counts.get('confirmed', 0)
            free = max(0, capacity - occupied - held - reserved)
            status = 'paused' if s['status'] != 'published' else 'unsupported' if not capacity else 'full' if not free else 'few' if free <= 3 else 'available'
            s['availability'][vehicle] = dict(free=free, capacity=capacity, occupied=occupied, held=held, reserved=reserved, status=status)
        s['region'] = self.config.region['id']
        s['currency'] = self.config.region['currency']
        s['host'] = {'name': 'Anfitrión' if self.config.production else 'Anfitrión de prueba', 'identity': s.get('verification', 'pending')} if s.get('hostId') else None
        return s

    def visible(self, space):
        return space['status'] == 'published' and (not self.config.production or space.get('verification') == 'approved')

    def owns(self, user, space):
        check_role(user)
        require(user['id'] in [space.get('ownerId'), space.get('hostId')] or user['role'] == 'admin', 'Este espacio pertenece a otra cuenta.', 'FORBIDDEN', 403)

    def validate(self, s):
        require(isinstance(s.get('name'), str) and 3 <= len(s['name']) <= 100, 'El nombre debe tener entre 3 y 100 caracteres.')
        require(isinstance(s.get('address'), str) and 3 <= len(s['address']) <= 160, 'Escribe una dirección válida.')
        require(s.get('status') in ['published', 'paused'], 'Estado de publicación inválido.')
        require(isinstance(s.get('destinationId'), str) and 1 <= len(s['destinationId']) <= 100, 'Elige un destino válido.')
        if s.get('location') is not None:
            coordinates(s['location'])
        if self.config.production:
            require(s.get('location') is not None, 'La publicación requiere coordenadas verificadas.')
        for vehicle in ['car', 'moto']:
            capacity = s.get('capacity', {}).get(vehicle)
            require(type(capacity) is int and 0 <= capacity <= 10000, 'La capacidad debe ser un entero entre 0 y 10000.')
            rate = s.get('rates', {}).get(vehicle)
            require((not capacity and rate is None) or (isinstance(rate, dict) and rate.get('unit') in ['minute', 'hour']
                    and type(rate.get('price')) is int and 0 < rate['price'] <= 100000000), 'Las tarifas deben ser enteros positivos en unidad menor.')
        require(sum(s['capacity'].values()) > 0, 'Publica al menos un cupo.')
        schedule = s.get('schedule', {})
        import re
        require(all(isinstance(schedule.get(k), str) and re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', schedule[k]) for k in ['open', 'close']), 'Revisa el horario.')
        height = s.get('conditions', {}).get('maxHeight')
        require(all(type(s.get('conditions', {}).get(k)) is bool for k in ['covered', 'keys']), 'Las condiciones deben ser valores booleanos.')
        require(height is None or (type(height) in [int, float] and math.isfinite(height) and .5 <= height <= 10), 'Revisa la altura máxima.')

    def dispatch(self, method, path, body, user, query, headers):
        if path == '/destinations' and method == 'GET':
            return self.locations.search(query.get('q', ''), self.destinations())
        if path.startswith('/destinations/') and method == 'GET':
            result = next((d for d in self.destinations() if d['id'] == path.split('/')[-1]), None)
            return result or self.locations.get(path.split('/')[-1])
        with self.store.connect(write=True) as db:
            self.expire(db)
            if path.startswith('/internal/slots/') and method == 'POST':
                id = path.split('/')[-1]
                slot = db.execute('SELECT * FROM slots WHERE id=?', (id,)).fetchone()
                action = body['action']
                if action == 'hold':
                    if slot:
                        require(slot['state'] in ['held', 'confirmed'], 'La retención venció o fue liberada.', 'HOLD_EXPIRED', 409)
                        return dict(slot)
                    s = self.store.get(body['spaceId'], db)
                    v = body['vehicle']
                    require(v in ['car', 'moto'] and s['rates'].get(v), 'Vehículo no admitido.')
                    require(self.visible(s) and self.dto(s, db)['availability'][v]['free'] > 0, 'El último cupo ya fue tomado. Elige otro espacio.', 'SPACE_TAKEN', 409)
                    db.execute('INSERT INTO slots VALUES (?,?,?,?,?,?)', (id, s['id'], v, 'held', time.time() + 600, body['userId']))
                    return {'id': id, 'state': 'held'}
                require(slot, 'Retención inexistente.', 'NOT_FOUND', 404)
                if action == 'confirm':
                    require(slot['state'] in ['held', 'confirmed'], 'La retención venció.', 'HOLD_EXPIRED', 409)
                    db.execute("UPDATE slots SET state='confirmed' WHERE id=?", (id,))
                elif action == 'release':
                    db.execute("UPDATE slots SET state='released' WHERE id=?", (id,))
                else:
                    raise Problem('VALIDATION', 'Acción inválida.', 422)
                return {'ok': True}
            if path == '/spaces' and method == 'GET':
                vehicle = query.get('vehicle', 'car')
                require(vehicle in ['car', 'moto'], 'Vehículo inválido.')
                spaces = [self.dto(json.loads(r['value']), db) for r in db.execute('SELECT value FROM documents')]
                spaces = [s for s in spaces if self.visible(s) and s['rates'].get(vehicle) and
                          (not query.get('destinationId') or query['destinationId'] not in ['d-emp', 'd-uni', 'd-cli'] or s['destinationId'] == query['destinationId']) and
                          (query.get('covered') != 'true' or s['conditions']['covered']) and
                          (query.get('noKeys') != 'true' or not s['conditions']['keys']) and
                          (not query.get('kind') or s['kind'] == query['kind'])]
                destination = query.get('destinationId', '')
                point = self.locations.get(destination)['location'] if destination and destination not in ['d-emp', 'd-uni', 'd-cli'] else None
                if point:
                    for s in spaces:
                        s['distanceM'] = distance_m(point, s['location']) if s.get('location') else None
                    spaces = [s for s in spaces if s['distanceM'] is not None and s['distanceM'] <= 5000]
                return sorted(spaces, key=lambda s: s['rates'][vehicle]['price'] * (60 if s['rates'][vehicle]['unit'] == 'minute' else 1) if query.get('sort') == 'price' else s['distanceM'])
            if path in ['/owner/space', '/host/spaces', '/internal/spaces'] and method == 'GET':
                check_role(user)
                all_spaces = [self.dto(json.loads(r['value']), db) for r in db.execute('SELECT value FROM documents')]
                if path == '/internal/spaces':
                    check_role(user, 'admin')
                    return all_spaces
                all_spaces = [s for s in all_spaces if user['id'] in [s.get('ownerId'), s.get('hostId')]]
                return (all_spaces[0] if all_spaces else None) if path == '/owner/space' else all_spaces
            if path == '/host/spaces' and method == 'POST':
                check_role(user, 'host')
                require(body.get('identityConsent') is True, 'Acepta solicitar la verificación de identidad y del espacio.')
            if path.startswith('/spaces/'):
                id = path.split('/')[2]
                s = self.store.get(id, db)
                if method == 'GET':
                    require(not self.config.production or self.visible(s) or user and (user['role'] == 'admin' or user['id'] in [s.get('hostId'), s.get('ownerId')]), 'Espacio no disponible.', 'NOT_FOUND', 404)
                    self.dto(s, db)
                    if query.get('track') == 'true':
                        s['metrics']['views'][-1] += 1
                        self.store.put(id, s, db)
                    return self.dto(s, db)
                self.owns(user, s)
                if method == 'PATCH':
                    for k in ['name', 'address', 'capacity', 'rates', 'schedule', 'conditions', 'status', 'destinationId', 'location']:
                        if k in body:
                            s[k] = body[k]
                    self.validate(s)
                    require(not self.config.production or s['status'] != 'published' or s.get('verification') == 'approved', 'El espacio requiere aprobación antes de publicarse.', 'VERIFICATION_REQUIRED', 409)
                    for v in ['car', 'moto']:
                        require(s['capacity'][v] >= s['occupied'][v] + db.execute("SELECT COUNT(*) FROM slots WHERE space_id=? AND vehicle=? AND state IN ('held','confirmed')", (id, v)).fetchone()[0], 'La capacidad no puede ser inferior a los cupos comprometidos.', 'CAPACITY_CONFLICT', 409)
                elif path.endswith('/occupancy') and method == 'POST':
                    v, delta = body.get('vehicle'), body.get('delta')
                    require(v in ['car', 'moto'] and type(delta) is int and delta in [-1, 1], 'Ajuste inválido.')
                    require(0 <= s['occupied'][v] + delta and (delta < 0 or self.dto(s, db)['availability'][v]['free'] > 0), 'No hay cupos o vehículos para ese ajuste.', 'CAPACITY_CONFLICT', 409)
                    s['occupied'][v] += delta
                else:
                    raise Problem('NOT_FOUND', 'Ruta no encontrada.', 404)
                self.store.put(id, s, db)
                return self.dto(s, db)
            if path == '/host/spaces' and method == 'POST':
                s = {**{k: body[k] for k in ['name','address','destinationId','capacity','rates','schedule','conditions','status','hostType','location'] if k in body}, 'id': uid('s'), 'hostId': user['id'], 'kind': 'particular', 'occupied': {'car': 0, 'moto': 0},
                     'distanceM': 300, 'pos': {'x': .2, 'y': .3}, 'verification': 'pending', 'metrics': {'views': [0] * 7, 'reservations': [0] * 7}}
                self.validate(s)
                if self.config.production:
                    s['status'] = 'paused'
                self.store.put(s['id'], s, db)
                return self.dto(s, db)
        raise Problem('NOT_FOUND', 'Ruta de inventario no encontrada.', 404)
