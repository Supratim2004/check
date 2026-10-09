import json
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SOURCE_DATA_DIR = Path(os.getenv('COURTS_SOURCE_DIR', ROOT / 'Source_Data_For_Analysis'))

# Database location. Default is an in-memory SQLite database: nothing is written to disk and the
# data is rebuilt from the CSVs in Source_Data_For_Analysis/ every time the app starts.
# To keep a file on disk instead, set COURTS_DB_PATH, e.g. COURTS_DB_PATH=var/raw-courts.sqlite3
MEMORY_DB = ':memory:'
_db = os.getenv('COURTS_DB_PATH', MEMORY_DB).strip()
DB_PATH = MEMORY_DB if _db.lower() in ('', ':memory:', 'memory') else Path(_db)
CONFIG_PATH = Path(os.getenv('COURTS_CONFIG', ROOT / 'config' / 'courts.json'))
REPORT_PATH = ROOT / 'Purba_Medinipur_Courts_Monthly_Report_v2.pdf'

def configuration():
    return json.loads(CONFIG_PATH.read_text())

# Effective calculation version is independent of the imported source snapshot.
DEFINITION_VERSION = 'draft-2026-10-09-v6-civil-criminal-only'

def district_configurations():
    primary = configuration()
    districts_path = CONFIG_PATH.with_name('districts.json')
    if not districts_path.exists():
        return [primary]
    return [{**primary, **item} for item in json.loads(districts_path.read_text())]
