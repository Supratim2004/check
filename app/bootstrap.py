"""Import the configured district CSV folders into a repository.

Used by the CLI (file mode) and by app startup (in-memory mode, where the database is rebuilt from
the CSVs on every start because nothing is persisted).
"""
import json
import sys
import time
from pathlib import Path
from app.config import SOURCE_DATA_DIR, district_configurations
from app.ingestion.raw import import_snapshot


def source_root(source_dir, config, single=False):
    root = Path(source_dir) / config.get('source_folder', config['district'])
    if single and not root.is_dir():
        root = Path(source_dir)
    return root


def load_districts(repo, source_dir=SOURCE_DATA_DIR, district=None, log=None):
    """Import every configured district (or just `district`). Returns True when all succeed.

    A failing district is logged and recorded in the imports table (so /health reports 'degraded')
    but does not stop the other districts from loading.
    """
    log = log or (lambda message: print(message, file=sys.stderr, flush=True))
    configs = [c for c in district_configurations() if not district or c['district'] == district]
    if not configs:
        raise ValueError(f'Unknown configured district: {district}')
    ok = True
    for config in configs:
        started = time.time()
        try:
            result = import_snapshot(repo, source_root(source_dir, config, bool(district)), config)
            log(json.dumps({'district': config['district'], 'status': result['status'], 'seconds': round(time.time() - started, 1)}))
        except Exception as exc:
            ok = False
            log(json.dumps({'district': config['district'], 'status': 'error', 'error': str(exc)}))
    return ok


def ensure_loaded(repo, source_dir=SOURCE_DATA_DIR, log=None):
    """In-memory repositories start empty: fill them from the CSVs. File repositories are left alone."""
    if repo.memory and not repo.districts():
        load_districts(repo, source_dir, log=log)
    return repo
