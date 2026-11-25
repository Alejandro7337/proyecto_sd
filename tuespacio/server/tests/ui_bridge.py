"""Adaptador JSON por stdin para probar el cliente sin sockets; solo se usa en pruebas."""
import json
import sys
from unittest.mock import patch

from .test_http_contract import HttpContractTests


def main():
    clients = {}
    try:
        for line in sys.stdin:
            request = json.loads(line)
            region = request.get('region', 'co')
            if region not in clients:
                cls = type('RegionContract', (HttpContractTests,), {'region': region})
                cls.setUpClass()
                clients[region] = cls('test_01_index_and_modules_served_with_csp')
            client = clients[region]
            try:
                with patch('server.common.urlopen', client.forward):
                    status, payload = client.api(request['method'], request['path'], request.get('body'), request.get('token'))
                result = {'id': request['id'], 'status': status, 'payload': payload}
            except Exception as err:
                result = {'id': request['id'], 'status': 500, 'payload': {'error': {'message': repr(err)}}}
            print(json.dumps(result, ensure_ascii=False), flush=True)
    finally:
        for client in clients.values():
            type(client).tearDownClass()


if __name__=='__main__':
    main()
