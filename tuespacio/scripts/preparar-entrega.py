"""Genera un parche comprobado contra el ZIP original y un respaldo sin datos de sesión."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

EXCLUDED={'.git','node_modules','.runtime','__pycache__','artifacts','.expo','dist','.env','.env.local'}


def excluded(name):
    return name in EXCLUDED or (name.startswith('.env') and name != '.env.example')


def git(folder,*args):
    return subprocess.run(['git','-C',str(folder),*args],check=True,capture_output=True).stdout


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    root=Path(__file__).resolve().parents[2]
    parser.add_argument('--base-zip',type=Path,default=root.parent/'proyecto_sd-main.zip')
    args=parser.parse_args()
    if not args.base_zip.is_file():
        parser.error('Se requiere el ZIP original para preparar un parche sin inventar historial Git.')
    out=root/'artifacts';out.mkdir(exist_ok=True)
    patch=out/'tu-espacio-avance.patch'
    manifest={'at':datetime.now(timezone.utc).isoformat(),'repository':'Alejandro7337/proyecto_sd',
              'baseZipSHA256':hashlib.sha256(args.base_zip.read_bytes()).hexdigest()}
    with tempfile.TemporaryDirectory(prefix='tu-espacio-entrega-') as temp:
        checkout=Path(temp)
        with zipfile.ZipFile(args.base_zip) as z:
            prefix=z.namelist()[0].split('/')[0]+'/'
            for info in z.infolist():
                relative=info.filename.removeprefix(prefix)
                if not relative or info.is_dir():continue
                target=(checkout/relative).resolve()
                if not target.is_relative_to(checkout):raise SystemExit('Ruta inválida en el ZIP')
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(z.read(info))
        git(checkout,'init','--quiet')
        git(checkout,'add','--force','--all')
        tree=git(checkout,'write-tree').decode().strip()
        shutil.copytree(root,checkout,dirs_exist_ok=True,ignore=lambda p,n:[x for x in n if excluded(x) or x.endswith(('.pyc','.log'))])
        git(checkout,'add','--all')
        patch.write_bytes(git(checkout,'diff','--cached','--binary','--full-index',tree))
        files=git(checkout,'diff','--cached','--name-only',tree).decode().splitlines()
        git(checkout,'read-tree','--reset','-u',tree)
        git(checkout,'apply','--check',str(patch))
        git(checkout,'apply',str(patch))
        manifest['changedFiles']={}
        for name in files:
            source=root/name
            if source.is_file():
                if source.read_bytes()!=(checkout/name).read_bytes():raise SystemExit('El parche no reprodujo '+name)
                manifest['changedFiles'][name]=hashlib.sha256(source.read_bytes()).hexdigest()
        manifest['patchSHA256']=hashlib.sha256(patch.read_bytes()).hexdigest()
        manifest['patchVerified']=True
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    archive=root.parent/'tu-espacio-avance-respaldo.zip'
    temporary=archive.with_suffix('.zip.tmp')
    with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED) as z:
        for p in root.rglob('*'):
            relative=p.relative_to(root)
            if p.is_file() and not any(excluded(part) for part in relative.parts) and p.suffix not in ['.pyc','.log']:
                z.write(p,Path(root.name)/relative)
        for folder in [out,root/'tuespacio/artifacts/verification']:
            for p in folder.rglob('*'):
                if p.is_file() and not any(excluded(part) for part in p.relative_to(root).parts if part != 'artifacts'):z.write(p,Path(root.name)/p.relative_to(root))
    temporary.replace(archive)
    print(f'Parche verificado: {len(files)} archivos ({patch.stat().st_size:,} bytes)')
    print(f'Respaldo: {archive} ({archive.stat().st_size:,} bytes)')
    print(f'Manifiesto: {out / "manifest.json"}')


if __name__=='__main__':
    main()
