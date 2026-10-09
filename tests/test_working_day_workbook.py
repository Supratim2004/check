import copy
import json
import shutil
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from app.components.types import Options
from app.domain.context import Context
from app.ingestion.raw import import_snapshot
from app.ingestion.working_days import parse_sheet, read_working_days
from app.main import create_app
from app.processing.service import Analytics

WORKBOOK = Path('Source_Data_For_Analysis/Bankura/Working_days_court_wise.xlsx')


def test_monthly_rows_do_not_use_annual_totals():
    rows = [('title',), ('Month', 'Working days', None, 'Year', 'Working days (yr)'),
            ('2017-01', 20, None, 2017, 240), ('2017-02', 0), ('2017-03', None)]
    assert parse_sheet(rows, 'CJM', '2017-01', '2017-04') == [
        ('2017-01', 20, 3), ('2017-02', 0, 4), ('2017-03', None, 5), ('2017-04', None, None)]


@pytest.mark.parametrize('rows', [
    [('Month', 'Working days'), ('2017-01', -1)],
    [('Month', 'Working days'), ('2017-01', 1.5)],
    [('Month', 'Working days'), ('2017-02', 29)],
    [('Month', 'Working days'), ('2017-01', 'bad')],
    [('Month', 'Working days'), ('2017-13', 20)],
    [('Month', 'Working days'), ('2017-01', 20), ('2017-01', 21)],
    [('Month', 'Wrong header'), ('2017-01', 20)],
])
def test_invalid_workbook_rows_are_rejected(rows):
    with pytest.raises(ValueError):
        parse_sheet(rows, 'CJM', '2017-01', '2017-02')


def test_workbook_import_denominators_exports_and_recovery(source):
    repo, root, config, old, write = source
    config = copy.deepcopy(config)
    config['monthly_working_days'] = {'file': WORKBOOK.name,
        'sheets': {'CJM': 'CJM'}, 'uses': ['arrival_rate', 'hearing_rate']}
    path = root / WORKBOOK.name
    shutil.copyfile(WORKBOOK, path)
    imported = import_snapshot(repo, root, config)
    entries = read_working_days(path, config)['CJM']
    expected = next(days for month, days, line in entries if month == '2017-01')
    c = Context(repo, imported['snapshot'], 'CJM', '2017-01', '2017-01')
    assert c.monthly_denominators('arrival_rate') == {'2017-01': expected}
    assert c.monthly_denominators('hearing_rate') == {'2017-01': expected}
    assert c.working_months['2017-01'] == 7
    assert c.duration('2017-01-02', '2017-01-06') == 4
    svc = Analytics(repo)
    rate = svc.result(imported['snapshot'], 'test', 'arrivalRate', 'CJM', '2017-01', '2017-01', Options(('1',)))
    assert rate['series'][0]['values'] == [3 / expected]
    assert c.measure('monthly_rate')[0]['mean'] == 3 / expected
    with TestClient(create_app(repo.path)) as client:
        p = dict(court='CJM', start='2017-01', end='2017-01', types='1')
        r = client.get('/api/v1/components/arrivalRate', params=p).json()
        ex = client.get('/api/v1/exports/arrivalRate', params={**p, 'format':'json'}).json()
        assert r == ex
        assert r['meta']['monthly_rate_denominators']['arrival_rate']['working_days'] == [expected]
        assert client.get('/api/v1/exports/arrivalRate',params=p).status_code == 200
    # Valid workbook byte changes invalidate the source snapshot/cache.
    with zipfile.ZipFile(path, 'a') as archive:
        archive.comment = b'changed source snapshot'
    revised = import_snapshot(repo, root, config)
    assert revised['snapshot'] != imported['snapshot']
    assert import_snapshot(repo, root, config)['status'] == 'unchanged'
    path.write_bytes(b'invalid workbook')
    with pytest.raises(zipfile.BadZipFile):
        import_snapshot(repo, root, config)
    assert repo.active()['id'] == revised['snapshot']
    assert repo.health()['status'] == 'degraded'
    with repo.connect() as db:
        assert db.execute('SELECT rows FROM files WHERE snapshot=? AND name=?',
                          (revised['snapshot'], WORKBOOK.name)).fetchone()[0] == 198


def test_monthly_missing_and_zero_are_gaps_without_raw_fallback(source):
    from app.components.arrival_rate import calculate
    from app.components.filing_observations import calculate as observations
    repo, root, config, result, write = source
    c = Context(repo, result['snapshot'], 'CJM', '2017-01', '2017-12')
    c.config['monthly_working_days'] = {'file':'test.xlsx','sheets':{'CJM':'CJM'},'uses':['arrival_rate']}
    c.workbook_working_months = {'2017-01': 0, '2017-02': 20}
    assert calculate(c, Options(('1',)))['series'][0]['values'] == [None, 0] + [None] * 10
    assert calculate(c, Options(('1',), 'ma12'))['series'][0]['values'] == [None] * 12
    assert c.monthly_denominators('hearing_rate')['2017-01'] == 7
    obs = observations(c, Options(('1',)))['observations']
    assert next(o['text'] for o in obs if o['title']=='Highest unsmoothed daily filing rate').endswith('0.00 filings per working day in 2017-02.')
    info = c.monthly_denominator_info('arrival_rate')
    assert info['zero_months'] == ['2017-01']
    assert info['missing_months'] == c.months[2:]
