"""In-memory SQLite mode: shared connection, transactions, startup load, and no files on disk."""
import os
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from app.config import MEMORY_DB
from app.main import create_app
from app.repository import Repository


def test_memory_connections_share_one_database():
    repo = Repository(MEMORY_DB)
    assert repo.memory
    with repo.connect() as db:
        db.execute("INSERT INTO imports(at,status,detail,district) VALUES('t','imported','x','D')")
    # A naive sqlite3.connect(':memory:') per call would see an empty database here.
    with repo.connect() as db:
        assert db.execute('SELECT count(*) FROM imports').fetchone()[0] == 1


def test_memory_rollback_on_error_and_nested_connect():
    repo = Repository(MEMORY_DB)
    with pytest.raises(RuntimeError):
        with repo.connect() as db:
            db.execute("INSERT INTO imports(at,status,detail,district) VALUES('t','x','x','D')")
            raise RuntimeError('boom')
    with repo.connect() as db:
        assert db.execute('SELECT count(*) FROM imports').fetchone()[0] == 0
    with repo.connect() as outer:
        outer.execute("INSERT INTO imports(at,status,detail,district) VALUES('t','x','x','D')")
        with repo.connect():  # nested use must not commit/close the outer transaction
            pass
        outer.rollback()
    with repo.connect() as db:
        assert db.execute('SELECT count(*) FROM imports').fetchone()[0] == 0


def test_memory_repositories_are_isolated():
    a, b = Repository(MEMORY_DB), Repository(MEMORY_DB)
    with a.connect() as db:
        db.execute("INSERT INTO imports(at,status,detail,district) VALUES('t','x','x','D')")
    with b.connect() as db:
        assert db.execute('SELECT count(*) FROM imports').fetchone()[0] == 0


def test_app_builds_in_memory_database_from_csvs_and_writes_no_files(source, monkeypatch, tmp_path):
    repo, root, config, result, write = source
    monkeypatch.setattr('app.bootstrap.district_configurations', lambda: [{**config, 'source_folder': '.'}])
    monkeypatch.chdir(tmp_path)
    with TestClient(create_app(repo.path)) as file_client:
        expected = file_client.get('/api/v1/components/kpis', params={'court': 'CJM', 'start': '2017-01', 'end': '2017-01'}).json()['total']
    before = set(os.listdir(tmp_path))
    with TestClient(create_app(MEMORY_DB, source_dir=root)) as client:
        health = client.get('/api/v1/health').json()
        assert health['status'] == 'ok' and health['snapshot']
        p = {'court': 'CJM', 'start': '2017-01', 'end': '2017-01'}
        assert client.get('/api/v1/components/kpis', params=p).json()['total'] == expected
        # Requests arrive on worker threads; the shared connection must serve them concurrently.
        with ThreadPoolExecutor(8) as pool:
            codes = list(pool.map(lambda _: client.get('/api/v1/components/kpis', params=p).status_code, range(24)))
        assert codes == [200] * 24
    assert set(os.listdir(tmp_path)) == before


def test_bad_district_in_memory_mode_degrades_instead_of_crashing(source, monkeypatch):
    repo, root, config, result, write = source
    (root / 'cjm' / 'daily_proc_a.csv').write_text('wrong,columns\nx,y\n')
    monkeypatch.setattr('app.bootstrap.district_configurations', lambda: [{**config, 'source_folder': '.'}])
    with TestClient(create_app(MEMORY_DB, source_dir=root)) as client:
        assert client.get('/api/v1/health').json()['status'] in ('degraded', 'not_imported')


def test_old_layout_database_file_is_rejected_not_silently_misread(tmp_path):
    import sqlite3
    old = tmp_path / 'old.sqlite3'
    db = sqlite3.connect(old)
    db.execute('CREATE TABLE cases(snapshot TEXT, court TEXT, cino TEXT)')  # v1 layout, user_version 0
    db.commit(); db.close()
    with pytest.raises(RuntimeError, match='older version'):
        Repository(old)


def test_big_tables_are_keyed_by_small_integer_not_the_hash(source):
    repo, root, config, result, write = source
    with repo.connect() as db:
        assert db.execute('SELECT typeof(snapshot) FROM hearings LIMIT 1').fetchone()[0] == 'integer'
        assert db.execute('SELECT typeof(snapshot) FROM cases LIMIT 1').fetchone()[0] == 'integer'
        assert db.execute('SELECT id FROM snapshots').fetchone()[0] == result['snapshot']  # hash kept for provenance
