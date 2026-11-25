"""Ejecuta comprobaciones reproducibles y guarda logs sin instalar dependencias."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys
import time


def classify(code, log):
    if 'BLOQUEADO:' in log:
        return 'blocked'
    if code != 0:
        return 'failed'
    return 'skipped' if re.search(r'(?m)^# skipped [1-9]\d*\b|\bskipped=[1-9]\d*\b|\.\.\. skipped ',log) else 'passed'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--integration',action='store_true',help='Incluye sockets y 30 procesos temporales')
    parser.add_argument('--browser',action='store_true',help='Incluye Chrome real y capturas')
    parser.add_argument('--docker',action='store_true',help='Valida configuración Compose')
    parser.add_argument('--expo',action='store_true',help='Lint y exportación; requiere npm ci previo')
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    out=root/'artifacts/verification'
    out.mkdir(parents=True,exist_ok=True)
    commands=[
        ('python',[sys.executable,'-m','unittest','discover','-s','server/tests','-v']),
        ('localizacion',['node','server/tests/locale.test.mjs']),
        ('mock',['npm','run','test:mock','--prefix','app']),
        ('transporte-expo',['npm','run','test:transport','--prefix','app']),
        ('plantillas-cliente',['node','server/tests/views.test.mjs']),
    ]
    if args.integration: commands.append(('http-procesos',[sys.executable,'-m','unittest','server.tests.http_smoke','-v']))
    if args.browser: commands.append(('chrome',[sys.executable,'-m','server.tests.browser_check']))
    if args.docker: commands.append(('compose',['docker','compose','config','--quiet']))
    if args.expo:
        commands.extend([('expo-lint',['npm','run','lint','--prefix','app']),('expo-android',['npm','run','check','--prefix','app'])])
    report={'at':datetime.now(timezone.utc).isoformat(),'checks':[]}
    for name,command in commands:
        print('Comprobando '+name+'…',flush=True)
        start=time.monotonic()
        try:
            result=subprocess.run(command,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=240)
            log=result.stdout
            state=classify(result.returncode,log)
            code=result.returncode
        except (OSError,subprocess.TimeoutExpired) as err:
            log=str(err)
            state,code='blocked',None
        (out/(name+'.log')).write_text(log)
        item={'name':name,'status':state,'exitCode':code,'seconds':round(time.monotonic()-start,2),'command':command}
        for label,pattern in [('tests',r'Ran (\d+) tests'),('tests',r'# tests (\d+)'),('assertions',r'OK: (\d+) comprobaciones')]:
            found=re.search(pattern,log)
            if found:item[label]=int(found.group(1))
        report['checks'].append(item)
        print(f'{name}: {state} ({item["seconds"]} s)',flush=True)
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    report['completed']=all(c['status']=='passed' for c in report['checks'])
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('Evidencia: '+str(out/'report.json'))
    return 1 if any(c['status'] in ['failed','blocked'] for c in report['checks']) else 0


if __name__=='__main__':
    sys.exit(main())
