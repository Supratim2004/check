"""Independent filing reconciliation: CSV readers vs active API, without domain helpers."""
import csv
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.config import SOURCE_DATA_DIR,district_configurations
from app.main import create_app
from fastapi.testclient import TestClient

results=[]
with TestClient(create_app()) as client:
    for cfg in district_configurations():
      for court in cfg['courts']:
        folder=SOURCE_DATA_DIR/cfg['source_folder']/court['folder']
        cases={}
        for filename in ['civil_t.csv','civil_t_a.csv']:
            with (folder/filename).open(newline='',encoding='utf-8-sig') as f:
                for r in csv.DictReader(f):
                    if r['cino'].strip(): cases[r['cino'].strip()]=r
        for start,end in [('2010-01','2026-06'),('2026-01','2026-03')]:
            expected=sum(start<=r['date_of_filing'][:7]<=end for r in cases.values() if len(r['date_of_filing'])==10)
            response=client.get('/api/v1/components/kpis',params={'district':cfg['district'],'court':court['id'],'start':start,'end':end})
            assert response.status_code==200,response.text
            observed=response.json()['total']
            assert expected==observed,(court['id'],expected,observed)
            results.append({'district':cfg['district'],'court':court['id'],'start':start,'end':end,'csv_filings':expected,'api_filings':observed})
print(json.dumps(results,indent=2))
