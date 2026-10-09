"""Only explicitly Civil/Criminal cases enter dashboard cohorts and exports."""
import json

import pytest
from fastapi.testclient import TestClient

from app.components.types import Options
from app.domain.context import Context
from app.main import create_app
from app.processing.service import Analytics


@pytest.fixture
def mixed_source(source):
    repo, _, _, result, _ = source
    snapshot = result['snapshot']
    with repo.connect() as db:
        n = db.execute('SELECT n FROM snapshots WHERE id=?', (snapshot,)).fetchone()[0]
        for code, side in [('90', 'Unknown'), ('91', 'Other'), ('92', '')]:
            db.execute('INSERT INTO types VALUES(?,?,?,?,?)',
                       (snapshot, 'CJM', code, 'Excluded type ' + code, side))
            db.execute('INSERT INTO cases SELECT snapshot,court,?, ?,filing,registered,listing,decision,status,disposition,source_file,source_row FROM cases WHERE snapshot=? AND court=? AND cino=?',
                       ('EXCLUDED' + code, code, n, 'CJM', 'A'))
            db.execute('INSERT INTO hearings VALUES(?,?,?,?,?,?)',
                       (n, 'CJM', 'EXCLUDED' + code, '2017-01-03', 'test', 1))
    return repo, snapshot


def test_classification_applies_to_cases_hearings_and_all_components(mixed_source):
    repo, snapshot = mixed_source
    ctx = Context(repo, snapshot, 'CJM', '2017-01', '2017-01')
    assert len(ctx.cases) == 5
    assert {c['side'] for c in ctx.cases} == {'Civil', 'Criminal'}
    assert set(ctx.groups) == {'1', '2'}
    assert not any(cino.startswith('EXCLUDED') for cino in ctx.hearings)
    assert ctx.working_months['2017-01'] == 7  # Calendar is independent of the cohort.
    svc = Analytics(repo)
    for key in svc.registry:
        data = svc.result(snapshot, 'test', key, 'CJM', '2017-01', '2017-01', Options())
        assert data['meta']['filing_cohort_n'] == 5
        assert 'Excluded type' not in json.dumps(data)
    with repo.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM cases WHERE cino LIKE 'EXCLUDED%'").fetchone()[0] == 3


def test_options_exports_and_comparison_exclude_other_classifications(mixed_source):
    repo, _ = mixed_source
    params = {'court': 'CJM', 'start': '2017-01', 'end': '2017-01'}
    with TestClient(create_app(repo.path)) as client:
        options = client.get('/api/v1/options', params=params).json()
        assert {r['code'] for r in options['types']} == {'1', '2'}
        assert client.get('/api/v1/components/kpis', params=params).json()['total'] == 5
        assert client.get('/api/v1/components/kpis', params={**params, 'types': '90'}).status_code == 422
        exported = client.get('/api/v1/exports/register', params={**params, 'format': 'csv'})
        assert exported.status_code == 200
        assert 'Excluded type' not in exported.text
        assert 'Alpha' in exported.text and 'Beta' in exported.text
        district = client.get('/api/v1/metadata').json()['district']
        pair = client.get('/api/v1/compare/measure', params={
            'metric': 'filings', 'start': '2017-01', 'end': '2017-01',
            'a_district': district, 'a_court': 'CJM',
            'b_district': district, 'b_court': 'CJM',
        })
        assert pair.status_code == 200
        assert 'Excluded type' not in pair.text
        assert pair.json()['a']['total_filings'] == 5


def test_only_unknown_cases_produce_empty_components(mixed_source):
    repo, snapshot = mixed_source
    with repo.connect() as db:
        db.execute('UPDATE types SET side=? WHERE snapshot=?', ('Unknown', snapshot))
    svc = Analytics(repo)
    for key in svc.registry:
        data = svc.result(snapshot, 'test', key, 'CJM', '2017-01', '2017-01', Options())
        assert data['meta']['filing_cohort_n'] == 0
