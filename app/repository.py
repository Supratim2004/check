"""Normalized snapshots. An import activates all courts in one transaction."""
import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

MEMORY = ':memory:'
# v2: cases/hearings/working_days are keyed by a small integer snapshots.n instead of repeating the
# 64-character snapshot hash on every row (about 40% smaller). The hash stays in snapshots.id.
SCHEMA_VERSION = 2

class Repository:
    """SQLite persistence, either file-backed or fully in memory (path=':memory:').

    A plain sqlite3.connect(':memory:') creates a *separate empty database* per connection, so the
    in-memory mode keeps ONE shared connection and serialises access to it with a re-entrant lock.
    File mode is unchanged: one short-lived connection per connect().
    """

    def __init__(self, path=MEMORY):
        self.memory = str(path) == MEMORY
        self.path = MEMORY if self.memory else Path(path)
        if self.memory:
            self._lock = threading.RLock()
            self._depth = 0
            self._shared = sqlite3.connect(MEMORY, check_same_thread=False)
            self._shared.row_factory = sqlite3.Row
        else:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            if not self.memory:
                db.execute('PRAGMA journal_mode=WAL')
            has_tables = db.execute("SELECT 1 FROM sqlite_master WHERE name='cases'").fetchone()
            if has_tables and db.execute('PRAGMA user_version').fetchone()[0] != SCHEMA_VERSION:
                raise RuntimeError(f'{self.path} was created by an older version with an incompatible layout. '
                                   'Delete the file and re-import (python -m app.cli --db <file>), or use the default in-memory database.')
            db.executescript('\n            CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, created_at TEXT, config TEXT, quality TEXT, n INTEGER UNIQUE);\n            CREATE TABLE IF NOT EXISTS active(singleton INTEGER PRIMARY KEY CHECK(singleton=1), snapshot TEXT);\n            CREATE TABLE IF NOT EXISTS imports(id INTEGER PRIMARY KEY, at TEXT, status TEXT, detail TEXT);\n            CREATE TABLE IF NOT EXISTS cases(snapshot INTEGER, court TEXT, cino TEXT, type_code TEXT,\n              filing TEXT, registered TEXT, listing TEXT, decision TEXT, status TEXT, disposition TEXT,\n              source_file TEXT, source_row INTEGER, PRIMARY KEY(snapshot,court,cino)) WITHOUT ROWID;\n            CREATE INDEX IF NOT EXISTS cohort ON cases(snapshot,court,filing);\n            CREATE TABLE IF NOT EXISTS hearings(snapshot INTEGER,court TEXT,cino TEXT,day TEXT,\n              source_file TEXT, source_row INTEGER,PRIMARY KEY(snapshot,court,cino,day)) WITHOUT ROWID;\n            CREATE TABLE IF NOT EXISTS types(snapshot TEXT,court TEXT,code TEXT,name TEXT,side TEXT,PRIMARY KEY(snapshot,court,code));\n            CREATE TABLE IF NOT EXISTS dispositions(snapshot TEXT,court TEXT,code TEXT,data TEXT,PRIMARY KEY(snapshot,court,code));\n            CREATE TABLE IF NOT EXISTS working_days(snapshot INTEGER,court TEXT,day TEXT,PRIMARY KEY(snapshot,court,day)) WITHOUT ROWID;\n            CREATE TABLE IF NOT EXISTS files(snapshot TEXT,court TEXT,name TEXT,sha256 TEXT,rows INTEGER,bytes INTEGER,\n              PRIMARY KEY(snapshot,court,name));\n            ')

            db.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
            db.execute('CREATE TABLE IF NOT EXISTS monthly_working_days(snapshot TEXT, court TEXT, month TEXT, days INTEGER, source_file TEXT, source_sheet TEXT, source_row INTEGER, PRIMARY KEY(snapshot,court,month))')
            db.execute('CREATE TABLE IF NOT EXISTS active_districts(district TEXT PRIMARY KEY, snapshot TEXT NOT NULL)')
            legacy = db.execute('SELECT s.id,s.config FROM snapshots s JOIN active a ON a.snapshot=s.id').fetchone()
            if legacy:
                db.execute('INSERT OR IGNORE INTO active_districts VALUES(?,?)', (json.loads(legacy['config'])['district'], legacy['id']))
            columns = {row['name'] for row in db.execute('PRAGMA table_info(imports)')}
            if 'district' not in columns:
                db.execute('ALTER TABLE imports ADD COLUMN district TEXT')

    @contextmanager
    def connect(self):
        if self.memory:
            with self._lock:
                self._depth += 1
                try:
                    yield self._shared
                except BaseException:
                    if self._depth == 1:
                        self._shared.rollback()
                    raise
                else:
                    if self._depth == 1:
                        self._shared.commit()
                finally:
                    self._depth -= 1
            return
        db = sqlite3.connect(self.path, timeout=60)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def districts(self):
        with self.connect() as db:
            return [row[0] for row in db.execute("SELECT district FROM active_districts ORDER BY CASE WHEN district='Purba Medinipur' THEN 0 ELSE 1 END,district")]

    def active(self, district=None):
        if district is None:
            districts = self.districts()
            district = districts[0] if districts else None
        with self.connect() as db:
            row = db.execute('SELECT s.* FROM snapshots s JOIN active_districts a ON a.snapshot=s.id WHERE a.district=?', (district,)).fetchone()
        return dict(row) if row else None

    def health(self, district=None):
        district = district or next(iter(self.districts()), None)
        with self.connect() as db:
            last = db.execute('SELECT * FROM imports WHERE district=? OR district IS NULL ORDER BY id DESC LIMIT 1', (district,)).fetchone()
        active = self.active(district)
        return {'status': 'degraded' if last and last['status'] == 'error' else 'ok' if active else 'not_imported', 'district': district, 'districts': self.districts(), 'snapshot': active['id'] if active else None, 'last_import': dict(last) if last else None, 'quality': json.loads(active['quality']) if active else {}}
