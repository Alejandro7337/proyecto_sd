"""Operaciones administrativas locales; requieren acceso al volumen de datos."""
import argparse
import getpass
import json
from pathlib import Path
import re

from .common import REGIONS, Store, encode, now, password_hash, require, uid
from .locations import coordinates


def create_admin(data, region, email, name, password):
    require(region in [r['id'] for r in REGIONS], 'Región inválida.')
    email = email.strip().lower()
    require(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email) and not email.endswith('@demo.test'), 'Usa un correo real del administrador.')
    require(3 <= len(name.strip()) <= 100 and 12 <= len(password) <= 128, 'Nombre de 3–100 caracteres y contraseña de 12–128.')
    store = Store(Path(data) / region / 'identity.sqlite')
    value = {'id': uid('u'), 'email': email, 'name': name.strip(), 'role': 'admin', 'region': region}
    with store.connect(write=True) as db:
        require(not db.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone(), 'El correo ya existe; no se sobrescribe la cuenta.')
        db.execute('INSERT INTO users VALUES (?,?,?,?)', (value['id'], email, password_hash(password), encode(value)))
    return value['id']


def approve_space(data, region, id):
    require(region in [r['id'] for r in REGIONS], 'Región inválida.')
    store = Store(Path(data) / region / 'inventory.sqlite')
    with store.connect(write=True) as db:
        space = store.get(id, db)
        require(not space.get('demo') and not id.startswith(('s-emp-', 's-uni-', 's-cli-')), 'No se aprueban espacios demo para cobros reales.')
        coordinates(space.get('location'))
        space.update(verification='approved', status='published', approvedAt=now())
        store.put(id, space, db)
        event = {'id': uid('audit'), 'type': 'space.approved', 'spaceId': id, 'at': now(), 'actor': 'local-administrator'}
        db.execute('INSERT INTO events(id,value) VALUES (?,?)', (event['id'], encode(event)))
    return id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', required=True)
    parser.add_argument('--region', default='co', choices=[r['id'] for r in REGIONS])
    commands = parser.add_subparsers(dest='command', required=True)
    admin = commands.add_parser('create-admin')
    admin.add_argument('--email', required=True)
    admin.add_argument('--name', required=True)
    approve = commands.add_parser('approve-space')
    approve.add_argument('--id', required=True)
    args = parser.parse_args()
    if args.command == 'create-admin':
        password = getpass.getpass('Contraseña (mínimo 12): ')
        require(password == getpass.getpass('Repetir contraseña: '), 'Las contraseñas no coinciden.')
        result = create_admin(args.data, args.region, args.email, args.name, password)
    else:
        result = approve_space(args.data, args.region, args.id)
    print('Operación completada:', result)


if __name__ == '__main__':
    main()
