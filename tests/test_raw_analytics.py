import copy
import importlib
import json
from dataclasses import replace
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.domain.context import Context
from app.domain.statistics import percentile, moving_average
from app.ingestion.raw import allowed, import_snapshot
from app.processing.service import Analytics
from app.components.types import Options
from app.config import DEFINITION_VERSION

def ctx(source, start='2017-01', end='2017-01'):
    repo, root, config, result, write = source
    return Context(repo, result['snapshot'], 'CJM', start, end)

def test_cohort_and_duplicates(source):
    c = ctx(source)
    assert len(c.cases) == 5
    a = next((r for r in c.cases if r['cino'] == 'A'))
    assert a['status'] == 'disposed'
    assert c.hearings['A'] == ['2017-01-03', '2017-01-06']
    assert c.quality['duplicate_hearing_dates'] == 2
    assert c.quality['excluded_orphan_hearings'] == 1
    assert c.quality['invalid_date_of_filing'] == 1

def test_duration_and_censoring(source):
    c = ctx(source)
    d = {r['code']: r for r in c.measure('disposal')}
    assert d['1']['n'] == 1 and d['1']['mean'] == 4
    assert d['2']['n'] == 1 and d['2']['mean'] == 0
    assert c.measure('case_rate_wd')[1]['n'] == 0
    h = {r['code']: r for r in c.measure('hearings')}
    assert h['1']['mean'] == 2 and h['2']['mean'] == 0
    gap = {r['code']: r for r in c.measure('gap')}
    assert gap['1']['n'] == 2 and gap['1']['mean'] == 1
    assert ctx(source, '2016-12', '2017-01').measure('hearings')[0]['n'] == 2
    assert ctx(source, '2016-12', '2017-01').measure('gap')[0]['n'] == 3
    assert ctx(source, end='2017-02').measure('disposal')[0]['n'] == 2

def test_calendar_independent_of_cohort_and_type(source):
    c = ctx(source)
    assert '2017-01-09' in c.calendar
    assert c.working_months['2017-01'] == 7
    rate = c.measure('monthly_rate')[0]
    assert rate['mean'] == pytest.approx(3 / 7)
    assert allowed('2017-01-07')
    assert not allowed('2017-01-08')
    assert not allowed('2017-01-14')
    assert allowed('2017-01-21')
    assert not allowed('2017-01-28')
    assert c.duration('2017-01-03', '2017-01-03') == 0

def test_statistics():
    assert percentile([0, 10], 0.9) == 9
    assert percentile([], 0.5) is None
    assert moving_average([1] * 12) == [None] * 11 + [1]
    assert moving_average([1] * 11 + [None]) == [None] * 12

def test_zero_months_and_elapsed_months(source):
    c = ctx(source, '2017-01', '2017-02')
    a = c.arrivals[0]
    assert a['values'] == [3, 0] and a['mean'] == 1.5
    rate = ctx(source).measure('case_rate_mo')[0]
    assert rate['mean'] == pytest.approx(2 / (4 / 30.4375))

def test_atomic_failure_and_reimport(source):
    repo, root, config, result, write = source
    assert import_snapshot(repo, root, config)['status'] == 'unchanged'
    (root / 'cjm' / 'daily_proc_a.csv').write_text('wrong,columns\nx,y\n')
    with pytest.raises(ValueError):
        import_snapshot(repo, root, config)
    assert repo.active()['id'] == result['snapshot']
    assert repo.health()['status'] == 'degraded'
    with repo.connect() as db:
        assert db.execute('select count(*) from snapshots').fetchone()[0] == 1

def test_snapshot_cache_invalidation(source):
    repo, root, config, result, write = source
    svc = Analytics(repo)
    before = svc.result(result['snapshot'], config['definition_version'], 'kpis', 'CJM', '2017-01', '2017-01', Options())
    with (root / 'cjm' / 'civil_t.csv').open('a') as f:
        import csv
        w = csv.DictWriter(f, fieldnames=next(csv.reader((root / 'cjm' / 'civil_t.csv').open())))
        w.writerow(dict(cino='NEW', regcase_type='1', date_of_filing='2017-01-10', dt_regis='2017-01-10', date_first_list='', date_of_decision='', disp_nature=''))
    new = import_snapshot(repo, root, config)
    after = svc.result(new['snapshot'], config['definition_version'], 'kpis', 'CJM', '2017-01', '2017-01', Options())
    assert after['total'] == before['total'] + 1

@pytest.mark.parametrize('removed', list(json.loads(Path('app/components/registry.json').read_text())))
def test_each_component_removable(source, removed, monkeypatch):
    repo, root, config, result, write = source
    registry = json.loads(Path('app/components/registry.json').read_text())
    gone = registry.pop(removed)
    original = importlib.import_module

    def guarded(name, *args, **kwargs):
        if name == 'app.components.' + gone['module']:
            raise AssertionError('Removed module imported')
        return original(name, *args, **kwargs)
    monkeypatch.setattr(importlib, 'import_module', guarded)
    svc = Analytics(repo, registry)
    for key in registry:
        assert svc.result(result['snapshot'], config['definition_version'], key, 'CJM', '2017-01', '2017-01', Options())['meta']['end'] == '2017-01'

def test_api_exports_filters_and_empty(source):
    repo, *_ = source
    with TestClient(create_app(repo.path)) as client:
        meta = client.get('/api/v1/metadata').json()
        for key in meta['components']:
            p = {'court': 'CJM', 'start': '2017-01', 'end': '2017-01'}
            r = client.get('/api/v1/components/' + key, params=p)
            assert r.status_code == 200, (key, r.text)
            for format in ['xlsx', 'csv', 'json']:
                ex = client.get('/api/v1/exports/' + key, params={**p, 'format': format})
                assert ex.status_code == 200
            empty = client.get('/api/v1/components/' + key, params={**p, 'start': '2020-01', 'end': '2020-02'})
            assert empty.status_code == 200, (key, empty.text)
        for start, end in [('bad', '2020-01'), ('2021-01', '2020-01'), ('2009-12', '2010-01'), ('2026-01', '2026-07')]:
            assert client.get('/api/v1/components/kpis', params={'court': 'CJM', 'start': start, 'end': end}).status_code == 422
            assert client.get('/api/v1/exports/kpis', params={'court': 'CJM', 'start': start, 'end': end}).status_code == 422
        assert client.get('/api/v1/components/kpis?court=missing').status_code == 404
        assert client.get('/api/v1/components/kpis?court=CJM&types=invalid').status_code == 422
        assert client.post('/api/ingest').status_code == 404
        assert client.get('/api/v1/exports/court?court=CJM').status_code == 200


def test_older_cases_in_all_hearing_and_listing_measures(source):
    repo, root, config, result, write = source
    with (root / 'cjm' / 'daily_proc_a.csv').open('a') as handle:
        handle.write('OLD,2016-12-31\nOLD,2017-01-03\n')
    imported = import_snapshot(repo, root, config)
    c = Context(repo, imported['snapshot'], 'CJM', '2016-12', '2017-01')
    alpha = next(r for r in c.measure('monthly_rate') if r['code'] == '1')
    assert alpha['values'] == [1, pytest.approx(4 / 7)]
    assert alpha['n'] == 2
    assert alpha['mean'] == pytest.approx((1 + 4 / 7) / 2)
    for metric in ['hearings', 'case_rate_wd', 'case_rate_mo']:
        row = next(r for r in c.measure(metric) if r['code'] == '1')
        assert row['n'] == 2
        assert not any('cutoff' in key for key in row['excluded'])
    assert c.measure('gap')[0]['n'] == 3
    with TestClient(create_app(repo.path)) as client:
        p = {'court': 'CJM', 'start': '2016-12', 'end': '2017-01', 'types': '1'}
        data = client.get('/api/v1/components/monthlyHearingRateTrend', params=p).json()
        assert data['series'][0]['values'][0] == 1
        exported = client.get('/api/v1/exports/monthlyHearingRateTrend', params={**p, 'format': 'json'}).json()
        assert exported['series'] == data['series']
        assert data['meta']['definition_version'] == DEFINITION_VERSION
        metadata = client.get('/api/v1/metadata').json()
        assert metadata['cutoffs_applied'] is False
        assert all('cutoff' not in court for court in metadata['courts'])


def test_district_isolation_exports_and_failure(source):
    repo, root, config, result, write = source
    bankura = {**config, 'district': 'Bankura', 'extracted_on': '2026-09-28',
               'data_quality_warnings': ['Recorded values retained; hearing coverage incomplete.']}
    # Same case IDs and court codes, but a genuinely different filing total.
    with (root / 'cjm' / 'civil_t.csv').open('a') as f:
        import csv
        fields = next(csv.reader((root / 'cjm' / 'civil_t.csv').open()))
        csv.DictWriter(f, fieldnames=fields).writerow(dict(cino='BANKURA_ONLY', regcase_type='1', date_of_filing='2017-01-10'))
    imported = import_snapshot(repo, root, bankura)
    assert repo.active()['id'] == result['snapshot']
    assert repo.active('Bankura')['id'] == imported['snapshot']
    with TestClient(create_app(repo.path)) as client:
        assert client.get('/api/v1/metadata').json()['districts'] == ['Purba Medinipur', 'Bankura']
        for district, expected in [('Bankura', 6), ('Purba Medinipur', 5), ('Bankura', 6)]:
            params = dict(district=district, court='CJM', start='2017-01', end='2017-01')
            data = client.get('/api/v1/components/kpis', params=params).json()
            assert data['total'] == expected
            assert data['meta']['district'] == district
            assert bool(data['meta']['data_quality_warnings']) == (district == 'Bankura')
            for key in client.get('/api/v1/metadata').json()['components']:
                component = client.get('/api/v1/components/' + key, params=params)
                assert component.status_code == 200
                exported = client.get('/api/v1/exports/' + key, params={**params, 'format': 'json'})
                assert exported.json() == component.json()
                assert component.json()['meta']['district'] == district
        assert client.get('/api/v1/metadata?district=Missing').status_code == 404
        assert client.get('/api/v1/components/kpis?district=Missing&court=CJM').status_code == 404
    (root / 'cjm' / 'daily_proc_a.csv').write_text('wrong,columns\nx,y\n')
    with pytest.raises(ValueError):
        import_snapshot(repo, root, bankura)
    assert repo.active('Bankura')['id'] == imported['snapshot']
    assert repo.active('Purba Medinipur')['id'] == result['snapshot']
    assert repo.health('Bankura')['status'] == 'degraded'
    assert repo.health('Purba Medinipur')['status'] == 'ok'


def test_legacy_snapshot_migration(source):
    from app.repository import Repository
    repo, root, config, result, write = source
    with repo.connect() as db:
        db.execute('DELETE FROM active_districts')
        db.execute('INSERT INTO active VALUES(1,?)', (result['snapshot'],))
    upgraded = Repository(repo.path)
    assert upgraded.active(config['district'])['id'] == result['snapshot']
