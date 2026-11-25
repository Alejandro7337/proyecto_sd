"""Valida identidad de entrega con un CLI fixture; nunca contacta a GitHub."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class DeliveryIdentityTests(unittest.TestCase):
    def run_identity(self, login='santyshark1', switch='yes', offline=False, account_id='12345'):
        with tempfile.TemporaryDirectory() as directory:
            cli = Path(directory) / 'gh'
            cli.write_text('''#!/usr/bin/env python3
import os, pathlib, sys
state = pathlib.Path(os.environ['TEST_GH_STATE'])
if sys.argv[1:3] == ['auth', 'switch']:
    state.write_text('switched')
    sys.exit(0 if os.environ['TEST_GH_SWITCH'] == 'yes' else 1)
if os.environ['TEST_GH_OFFLINE'] == 'yes': sys.exit(1)
login = 'santyshark1' if state.exists() else os.environ['TEST_GH_LOGIN']
print(login + '\\t' + os.environ['TEST_GH_ACCOUNT_ID'])
''')
            cli.chmod(0o755)
            state = Path(directory) / 'state'
            env = {**os.environ, 'PATH': directory + os.pathsep + os.environ['PATH'], 'TEST_GH_STATE':str(state),
                   'TEST_GH_LOGIN':login, 'TEST_GH_SWITCH':switch, 'TEST_GH_OFFLINE':'yes' if offline else 'no', 'TEST_GH_ACCOUNT_ID':account_id}
            result = subprocess.run(['bash','-c','source "$1"; institutional_identity','identity-check',str(ROOT/'scripts/github-account.sh')],env=env,text=True,capture_output=True)
            return result,state.exists()

    def test_valid_institutional_token_needs_no_account_switch(self):
        result,switched = self.run_identity(switch='no')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout.strip(),'santyshark1\t12345')
        self.assertFalse(switched)

    def test_other_account_switches_and_rechecks_identity(self):
        result,switched = self.run_identity(login='another-account')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(switched)
        self.assertEqual(result.stdout.strip(),'santyshark1\t12345')

    def test_wrong_account_or_invalid_id_fails_closed(self):
        for arguments in [{'login':'another-account','switch':'no'},{'account_id':'not-a-number'}]:
            with self.subTest(arguments=arguments):
                result,_ = self.run_identity(**arguments)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(result.stdout,'')

    def test_network_failure_does_not_switch_or_claim_identity(self):
        result,switched = self.run_identity(offline=True)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(switched)
        self.assertEqual(result.stdout,'')
