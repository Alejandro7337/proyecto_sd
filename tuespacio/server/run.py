"""Lanza procesos independientes; Ctrl+C termina únicamente sus procesos hijos."""
import argparse
import json
import os
import re
import shlex
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time

from .common import REGIONS, SERVICES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--regions', default='co', help='co,br,us,fr,jp o all')
    parser.add_argument('--port', type=int, default=8080, help='Puerto del primer gateway; siguientes regiones +10')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--data', default='.runtime')
    parser.add_argument('--env-file', help='Archivo de configuración local (no se imprime ni se evalúa como shell)')
    args = parser.parse_args()
    if args.env_file:
        for number, line in enumerate(Path(args.env_file).read_text().splitlines(), 1):
            parts = shlex.split(line, comments=True)
            if not parts:
                continue
            if len(parts) != 1 or not re.fullmatch(r'[A-Z][A-Z0-9_]*=.*', parts[0]):
                parser.error(f'Configuración inválida en línea {number}. Usa CLAVE=valor; comillas para espacios.')
            key, value = parts[0].split('=', 1)
            os.environ[key] = value
    ids = [r['id'] for r in REGIONS] if args.regions == 'all' else args.regions.split(',')
    if any(id not in [r['id'] for r in REGIONS] for id in ids):
        parser.error('Región inválida')
    children = []
    env = {**os.environ, 'SERVICE_KEY': os.environ.get('SERVICE_KEY') or secrets.token_urlsafe(36), 'PYTHONUNBUFFERED': '1'}
    env['PUBLIC_REGION_PORTS'] = os.environ.get('PUBLIC_REGION_PORTS') or json.dumps({region: args.port + i * 10 for i, region in enumerate(ids)})
    root = Path(__file__).resolve().parent.parent
    data = str(Path(args.data).resolve())
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        for index, region in enumerate(ids):
            port = args.port + index * 10
            for service in SERVICES:
                cmd = [sys.executable, '-m', 'server.service', service, '--region', region, '--base-port', str(port - 5), '--data', data, '--host', args.host]
                proc = subprocess.Popen(cmd, cwd=root, env=env)
                children.append((region, service, proc))
                print(f'PID {proc.pid}: {region}/{service}', flush=True)
            print(f'\n{region.upper()}: http://{args.host}:{port}\n', flush=True)
        while not stopping:
            for region, service, proc in list(children):
                if proc.poll() is not None:
                    if os.environ.get('APP_ENV') == 'production':
                        raise SystemExit(f'{region}/{service} terminó; se detiene la región para evitar una instancia parcialmente disponible.')
                    print(f'{region}/{service} terminó ({proc.returncode}); los demás servicios continúan.', flush=True)
                    children.remove((region, service, proc))
            if not children:
                raise SystemExit('Ningún servicio pudo iniciarse. Revisa puertos y permisos de red.')
            time.sleep(.5)
    finally:
        for _, _, proc in children:
            proc.terminate()
        for _, _, proc in children:
            try:
                proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == '__main__':
    main()
