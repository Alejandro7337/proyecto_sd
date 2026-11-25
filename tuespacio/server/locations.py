"""Address lookup: local catalogue plus replaceable Photon-compatible geocoder."""
import hashlib
import json
import math
import os
import threading
import time
import unicodedata
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from urllib.error import URLError

from .common import Problem, encode, require

CENTRES = {'co': (4.656, -74.060), 'br': (-23.562, -46.654), 'us': (40.754, -73.984), 'fr': (48.889, 2.242), 'jp': (35.682, 139.766)}


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.casefold()) if not unicodedata.combining(c))


def coordinates(point):
    require(isinstance(point, dict) and all(type(point.get(k)) in [int, float] and math.isfinite(point[k]) for k in ['lat', 'lon']), 'Coordenadas inválidas.')
    require(-90 <= point['lat'] <= 90 and -180 <= point['lon'] <= 180, 'Coordenadas fuera de rango.')
    return point


def demo_location(region, destination, index=0):
    lat, lon = CENTRES[region]
    zone = ['d-emp', 'd-uni', 'd-cli'].index(destination)
    return {'lat': lat + zone * .025 + index * .0003, 'lon': lon + zone * .012 + index * .0003}


def distance_m(a, b):
    a, b = coordinates(a), coordinates(b)
    lat1, lat2 = math.radians(a['lat']), math.radians(b['lat'])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(math.radians(b['lon'] - a['lon']) / 2) ** 2
    return round(12742000 * math.asin(min(1, math.sqrt(h))))


class Locations:
    def __init__(self, store, config):
        self.store, self.config = store, config
        self.lock = threading.Lock()
        self.last_request = 0
        self.endpoint = os.environ.get('GEOCODER_URL', '' if config.production else 'https://photon.komoot.io/api/')
        if self.endpoint:
            parsed = urlsplit(self.endpoint)
            require(parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.query, 'GEOCODER_URL debe ser HTTPS sin credenciales ni query.')
        if config.production:
            require(self.endpoint and urlsplit(self.endpoint).hostname != 'photon.komoot.io', 'Producción requiere un geocodificador propio o con garantía de servicio.')

    def remember(self, name, hint, point, source, db):
        coordinates(point)
        id = 'geo-' + hashlib.sha256(encode([name, hint, point]).encode()).hexdigest()[:24]
        value = dict(id=id, name=str(name)[:160], hint=str(hint)[:240], location=point, source=source)
        db.execute('INSERT INTO locations VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', (id, encode(value)))
        return value

    def get(self, id):
        with self.store.connect() as db:
            row = db.execute('SELECT value FROM locations WHERE id=?', (id,)).fetchone()
        require(row, 'Selecciona nuevamente el destino.', 'NOT_FOUND', 404)
        return json.loads(row['value'])

    def search(self, query, suggestions):
        require(isinstance(query, str) and len(query) <= 180, 'Escribe una búsqueda de hasta 180 caracteres.')
        query = query.strip()
        if not query:
            return suggestions
        require(len(query) >= 3, 'Escribe al menos 3 caracteres.')
        key = normalized(query)
        local = [d for d in suggestions if key in normalized(d['name'] + ' ' + d['hint'])]
        with self.store.connect(write=True) as db:
            for row in db.execute('SELECT value FROM documents').fetchall():
                s = json.loads(row['value'])
                if s['status'] == 'published' and (not self.config.production or s.get('verification') == 'approved') and s.get('location') and key in normalized(s['name'] + ' ' + s['address']):
                    local.append(self.remember(s['name'], s['address'], s['location'], 'catalogue', db))
        if local:
            return local[:12]
        require(self.endpoint, 'La búsqueda de direcciones no está configurada. Contacta a administración.', 'GEOCODER_UNAVAILABLE', 503)
        with self.lock:
            with self.store.connect() as db:
                row = db.execute('SELECT value FROM geocode_cache WHERE id=? AND expires>?', (key, time.time())).fetchone()
            if row:
                return json.loads(row['value'])
            require(time.monotonic() - self.last_request >= 1, 'Espera un segundo antes de buscar de nuevo.', 'RATE_LIMITED', 429)
            self.last_request = time.monotonic()
            lat, lon = CENTRES[self.config.region['id']]
            url = self.endpoint + '?' + urlencode({'q': query, 'limit': 8, 'lat': lat, 'lon': lon})
            try:
                with urlopen(Request(url, headers={'User-Agent': 'TuEspacio/1.0 address-search', 'Accept': 'application/json', 'Accept-Language': self.config.region['language'] + ',en;q=0.8'}), timeout=6) as response:
                    raw = response.read(262145)
                    require(len(raw) <= 262144, 'Respuesta de direcciones demasiado grande.', 'GEOCODER_UNAVAILABLE', 502)
                    features = json.loads(raw)['features']
                results = []
                with self.store.connect(write=True) as db:
                    for f in features[:8]:
                        props = f['properties']
                        lon, lat = f['geometry']['coordinates'][:2]
                        name = props.get('name') or ' '.join(str(props[k]) for k in ['street', 'housenumber'] if props.get(k))
                        hint = ', '.join(str(props[k]) for k in ['street', 'housenumber', 'city', 'state', 'country'] if props.get(k))
                        if name:
                            results.append(self.remember(name, hint, {'lat': lat, 'lon': lon}, 'OpenStreetMap / Photon', db))
                    db.execute('DELETE FROM geocode_cache WHERE expires<?', (time.time(),))
                    db.execute('INSERT OR REPLACE INTO geocode_cache VALUES (?,?,?)', (key, encode(results), time.time() + 86400))
                return results
            except (URLError, OSError, ValueError, KeyError, TypeError) as err:
                raise Problem('GEOCODER_UNAVAILABLE', 'No pudimos consultar las direcciones. Conservamos tu búsqueda; reintenta.', 503) from err
