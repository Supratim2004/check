"""Streaming CSV validation with explicit, atomic import activation."""
import csv
import hashlib
import json
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from app.ingestion.working_days import read_working_days
CASE_COLUMNS = {'cino', 'regcase_type', 'date_of_filing', 'dt_regis', 'date_first_list', 'date_of_decision', 'disp_nature'}
SCHEMAS = {'civil_t.csv': CASE_COLUMNS, 'civil_t_a.csv': CASE_COLUMNS, 'daily_proc.csv': {'cino', 'todays_date'}, 'daily_proc_a.csv': {'cino', 'todays_date'}, 'case_type_t.csv': {'case_type', 'type_name', 'type_flag'}, 'disp_type_t.csv': {'disp_type', 'disp_name', 'national_code'}}

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def rows(path):
    with path.open(newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        missing = SCHEMAS[path.name] - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f'{path.name}: missing columns {sorted(missing)}')
        for line, row in enumerate(reader, 2):
            if None in row:
                raise ValueError(f'{path.name}:{line}: unexpected extra columns')
            yield (line, {k: (v or '').strip() for k, v in row.items()})

def valid_date(value, quality, field):
    if not value:
        quality['missing_' + field] += 1
        return None
    try:
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError()
        return value
    except ValueError:
        quality['invalid_' + field] += 1
        return None

def allowed(day):
    d = date.fromisoformat(day)
    return d.weekday() != 6 and (not (d.weekday() == 5 and (d.day - 1) // 7 in (1, 3)))

REQUIRED_RATE_PURPOSES = {'arrival_rate', 'hearing_rate'}

def validate_config(config):
    """Fail loudly on configuration that would silently change what the numbers mean."""
    court_ids = {c['id'] for c in config['courts']}
    cutoffs = config.get('listing_cutoffs') or {}
    if not isinstance(cutoffs, dict):
        raise ValueError('listing_cutoffs must map court id to an ISO date')
    for court, day in cutoffs.items():
        if court not in court_ids:
            raise ValueError(f'listing_cutoffs: unknown court {court!r}')
        try:
            if date.fromisoformat(day).isoformat() != day:
                raise ValueError()
        except (TypeError, ValueError):
            raise ValueError(f'listing_cutoffs[{court}]: {day!r} is not an ISO date (YYYY-MM-DD)') from None
    if config.get('require_monthly_working_days'):
        source = config.get('monthly_working_days')
        where = config['district']
        if not source:
            raise ValueError(f'{where}: monthly_working_days workbook is required; refusing to infer working days from activity dates')
        missing = REQUIRED_RATE_PURPOSES - set(source.get('uses', []))
        if missing:
            raise ValueError(f'{where}: monthly_working_days must be used for {sorted(missing)}')
        absent = sorted(court_ids - set(source.get('sheets', {})))
        if absent:
            raise ValueError(f'{where}: monthly_working_days has no sheet configured for {absent}')

def reject_copied_workbook(db, config, digest):
    """A district's working-day workbook must not be byte-identical to another district's."""
    for row in db.execute("SELECT s.config FROM files f JOIN snapshots s ON s.id=f.snapshot WHERE f.court='__district__' AND f.sha256=?", (digest,)):
        other = json.loads(row['config'])['district']
        if other != config['district']:
            raise ValueError(f"{config['district']}: working-day workbook is byte-identical to {other}'s; supply this district's own counts")

def import_snapshot(repo, root, config):
    now = datetime.now(timezone.utc).isoformat()
    try:
        validate_config(config)
        inventory = []
        for court in config['courts']:
            for name in SCHEMAS:
                path = Path(root) / court['folder'] / name
                inventory.append((court['id'], name, path, sha(path), path.stat().st_size))
        workbook = config.get('monthly_working_days')
        monthly = {}
        if workbook:
            path = Path(root) / workbook['file']
            inventory.append(('__district__', workbook['file'], path, sha(path), path.stat().st_size))
            monthly = read_working_days(path, config)
        digest = hashlib.sha256(json.dumps([config, [(c, n, h) for c, n, p, h, b in inventory]], sort_keys=True).encode()).hexdigest()
        quality = {}
        with repo.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            # Small integer used as the snapshot key in the big tables (see repository.SCHEMA_VERSION).
            snap_no = db.execute('SELECT COALESCE(MAX(n),0)+1 FROM snapshots').fetchone()[0]
            if workbook:
                reject_copied_workbook(db, config, inventory[-1][3])
            if db.execute('SELECT 1 FROM snapshots WHERE id=?', (digest,)).fetchone():
                db.execute('INSERT OR REPLACE INTO active_districts VALUES(?,?)', (config['district'], digest))
                db.execute('INSERT INTO imports(at,status,detail,district) VALUES(?,?,?,?)', (now, 'unchanged', digest, config['district']))
                return {'status': 'unchanged', 'snapshot': digest}
            for court in config['courts']:
                cid = court['id']
                q = Counter()
                activity = set()
                counts = {}
                folder = Path(root) / court['folder']
                lookup = {}
                for line, r in rows(folder / 'case_type_t.csv'):
                    counts['case_type_t.csv'] = line - 1
                    code = r['case_type'] or 'UNKNOWN'
                    if code in lookup:
                        q['duplicate_type_codes'] += 1
                    lookup[code] = (r['type_name'] or f'Type {code}', {'1': 'Civil', '2': 'Criminal'}.get(r['type_flag'], 'Unknown'))
                for line, r in rows(folder / 'disp_type_t.csv'):
                    counts['disp_type_t.csv'] = line - 1
                    db.execute('INSERT OR REPLACE INTO dispositions VALUES(?,?,?,?)', (digest, cid, r['disp_type'], json.dumps(r)))
                cases = {}
                for filename, status in [('civil_t.csv', 'pending'), ('civil_t_a.csv', 'disposed')]:
                    for line, r in rows(folder / filename):
                        counts[filename] = line - 1
                        cino = r['cino']
                        if not cino:
                            q['excluded_missing_case_id'] += 1
                            continue
                        if cino in cases:
                            q['duplicate_case_ids'] += 1
                        code = r['regcase_type'] or 'UNKNOWN'
                        if code not in lookup:
                            lookup[code] = (f'Type {code}' if code != 'UNKNOWN' else 'Unclassified', 'Unknown')
                            q['unknown_type_codes'] += 1
                        dates = [valid_date(r[k], q, k) for k in ['date_of_filing', 'dt_regis', 'date_first_list', 'date_of_decision']]
                        if cino in cases and cases[cino][2:6] != dates:
                            q['conflicting_case_dates'] += 1
                        cases[cino] = [cino, code, *dates, status, r['disp_nature'], filename, line]
                for c in cases.values():
                    activity.update((d for d in (c[2], c[3], c[5]) if d))
                db.executemany('INSERT INTO cases VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [(snap_no, cid, *c) for c in cases.values()])
                db.executemany('INSERT INTO types VALUES(?,?,?,?,?)', [(digest, cid, code, *v) for code, v in lookup.items()])
                batch = []

                def flush():
                    if not batch:
                        return
                    before = db.total_changes
                    db.executemany('INSERT OR IGNORE INTO hearings VALUES(?,?,?,?,?,?)', batch)
                    q['duplicate_hearing_dates'] += len(batch) - (db.total_changes - before)
                    batch.clear()
                for filename in ['daily_proc.csv', 'daily_proc_a.csv']:
                    for line, r in rows(folder / filename):
                        counts[filename] = line - 1
                        day = valid_date(r['todays_date'], q, 'hearing_date')
                        if day:
                            activity.add(day)
                        if r['cino'] not in cases:
                            q['excluded_orphan_hearings'] += 1
                            continue
                        if day:
                            batch.append((snap_no, cid, r['cino'], day, filename, line))
                        if len(batch) >= 10000:
                            flush()
                flush()
                db.executemany('INSERT INTO working_days VALUES(?,?,?)', [(snap_no, cid, d) for d in sorted(activity) if allowed(d)])
                if workbook:
                    entries = monthly[cid]
                    db.executemany('INSERT INTO monthly_working_days VALUES(?,?,?,?,?,?,?)', [(digest, cid, month, days, workbook['file'], workbook['sheets'][cid], line) for month, days, line in entries])
                    q['missing_monthly_working_days'] = sum(days is None for month, days, line in entries)
                    q['zero_monthly_working_days'] = sum(days == 0 for month, days, line in entries)
                q['case_records'] = len(cases)
                quality[cid] = dict(q)
                for c, n, p, h, b in inventory:
                    if c == cid:
                        if sha(p) != h:
                            raise ValueError(f'{cid}/{n}: source changed during import')
                        db.execute('INSERT INTO files VALUES(?,?,?,?,?,?)', (digest, cid, n, h, counts.get(n, 0), b))
            if workbook:
                c, n, p, h, b = inventory[-1]
                if sha(p) != h:
                    raise ValueError(f'{n}: source changed during import')
                db.execute('INSERT INTO files VALUES(?,?,?,?,?,?)', (digest, c, n, h, sum(len(rows) for rows in monthly.values()), b))
            db.execute('INSERT INTO snapshots(id,created_at,config,quality,n) VALUES(?,?,?,?,?)', (digest, now, json.dumps(config), json.dumps(quality), snap_no))
            db.execute('INSERT OR REPLACE INTO active_districts VALUES(?,?)', (config['district'], digest))
            db.execute('INSERT INTO imports(at,status,detail,district) VALUES(?,?,?,?)', (now, 'imported', digest, config['district']))
        return {'status': 'imported', 'snapshot': digest, 'quality': quality}
    except Exception as exc:
        with repo.connect() as db:
            db.execute('INSERT INTO imports(at,status,detail,district) VALUES(?,?,?,?)', (now, 'error', str(exc), config['district']))
        raise
