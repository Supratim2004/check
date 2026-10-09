"""Explicit per-district imports with independent atomic activation.

With the default in-memory database this is a *dry run*: it proves the CSVs import cleanly and then
discards the result. To write a database file, pass --db var/raw-courts.sqlite3 (or set COURTS_DB_PATH).
"""
import argparse
import json
import sys
from pathlib import Path
from app.bootstrap import source_root
from app.config import DB_PATH, SOURCE_DATA_DIR, district_configurations
from app.ingestion.raw import import_snapshot
from app.repository import Repository

def main():
    parser = argparse.ArgumentParser(description='Import configured district CSV folders')
    parser.add_argument('--source-dir', type=Path, default=SOURCE_DATA_DIR)
    parser.add_argument('--db', default=DB_PATH, help="database file, or ':memory:' (default) for a validate-only dry run")
    parser.add_argument('--district', help='Import only this district; default imports all configured districts')
    args = parser.parse_args()
    configs = [c for c in district_configurations() if not args.district or c['district'] == args.district]
    if not configs:
        parser.error('Unknown configured district')
    repo = Repository(args.db)
    if repo.memory:
        print('In-memory database: validating the CSVs only; nothing is saved. '
              'The web app rebuilds its own in-memory copy at startup.', file=sys.stderr)
    failed = False
    for config in configs:
        root = source_root(args.source_dir, config, bool(args.district))
        try:
            result = import_snapshot(repo, root, config)
            print(json.dumps({'district': config['district'], **result}), flush=True)
        except Exception as exc:
            failed = True
            print(json.dumps({'district': config['district'], 'status': 'error', 'error': str(exc)}), flush=True)
    return int(failed)

if __name__ == '__main__':
    raise SystemExit(main())
