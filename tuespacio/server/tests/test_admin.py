from pathlib import Path
import tempfile
import unittest

from server.admin import approve_space, create_admin
from server.common import Problem, Store, password_matches


class AdminTests(unittest.TestCase):
    def test_admin_bootstrap_hashes_password_and_rejects_overwrite(self):
        with tempfile.TemporaryDirectory() as data:
            id = create_admin(data, 'co', 'admin@example.org', 'Admin real', 'long-fixture-password')
            with Store(Path(data) / 'co/identity.sqlite').connect() as db:
                row = db.execute('SELECT * FROM users WHERE id=?', (id,)).fetchone()
                self.assertTrue(password_matches('long-fixture-password', row['password']))
                self.assertNotEqual(row['password'], 'long-fixture-password')
            with self.assertRaises(Problem):
                create_admin(data, 'co', 'admin@example.org', 'Admin real', 'another-password')

    def test_approval_requires_real_coordinates_and_records_audit(self):
        with tempfile.TemporaryDirectory() as data:
            store = Store(Path(data) / 'co/inventory.sqlite')
            with store.connect(write=True) as db:
                store.put('real-space', {'id': 'real-space', 'verification': 'pending', 'location': {'lat': 4.65, 'lon': -74.06}}, db)
                store.put('demo-space', {'id': 'demo-space', 'demo': True, 'location': {'lat': 4.65, 'lon': -74.06}}, db)
                store.put('bad-space', {'id': 'bad-space'}, db)
            approve_space(data, 'co', 'real-space')
            self.assertEqual(store.get('real-space')['verification'], 'approved')
            with store.connect() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 1)
            for id in ['demo-space', 'bad-space']:
                with self.assertRaises(Problem): approve_space(data, 'co', id)

    def test_production_supervisor_stops_all_children_on_service_failure(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest.mock import Mock, patch
        from server.run import main
        processes = []
        def start(*args, **kwargs):
            child = Mock(pid=100 + len(processes))
            child.poll.return_value = 1
            processes.append(child)
            return child
        with patch.dict('os.environ', {'APP_ENV': 'production'}), patch('sys.argv', ['server.run', '--regions', 'co']), patch('server.run.subprocess.Popen', start), patch('server.run.signal.signal'), redirect_stdout(StringIO()):
            with self.assertRaises(SystemExit): main()
        self.assertEqual(len(processes), 6)
        for child in processes:
            child.terminate.assert_called_once()
            child.wait.assert_called_once()
