import copy
import json

import pytest
from fastapi.testclient import TestClient

from app.components.calculations import calculate_filing_comparison
from app.ingestion.raw import import_snapshot
from app.main import create_app


@pytest.fixture
def pair_source(source):
    repo, root, config, result, write = source
    other = copy.deepcopy(config)
    other['district'] = 'Other district'
    write('case_type_t.csv', [
        dict(case_type='10', type_name='Alpha', type_flag='2'),
        dict(case_type='11', type_name='Alpha', type_flag='2'),
        dict(case_type='20', type_name='Beta', type_flag='1'),
        dict(case_type='30', type_name='Gamma', type_flag='1'),
        dict(case_type='40', type_name='Disposal only', type_flag='1'),
        dict(case_type='99', type_name='Unknown type', type_flag='0'),
    ])
    def case(cino, code, filing, decision=''):
        return dict(cino=cino, regcase_type=code, date_of_filing=filing,
                    dt_regis=filing, date_first_list='', date_of_decision=decision, disp_nature='1')
    write('civil_t.csv', [case('DUPNAME', '11', '2017-01-06')])
    write('civil_t_a.csv', [
        case('NEW', '10', '2017-01-04', '2017-01-20'),
        case('OLDER', '10', '2016-01-01', '2017-01-21'),
        case('ONE_SIDE', '30', '2017-01-05', '2017-02-02'),
        case('DISPOSAL_ONLY', '40', '2016-01-01', '2017-01-21'),
        case('UNKNOWN', '99', '2017-01-06', '2017-01-22'),
    ])
    import_snapshot(repo, root, other)
    return repo, (config['district'], 'CJM'), (other['district'], 'CJM')


def test_monthly_events_and_zero_baseline_cumulative_case_load(pair_source):
    repo, a, b = pair_source
    d = calculate_filing_comparison(repo, '2017-01', '2017-02', a, b, ('Alpha', 'Beta', 'Gamma'))
    assert d['labels'] == ['2017-01', '2017-02']
    alpha = d['a']['series'][0]
    assert alpha['filings'] == [3, 0]
    assert alpha['disposals'] == [2, 1]  # A + OLD in Jan, L in Feb.
    assert alpha['net_change'] == [1, -1]
    assert alpha['baseline'] == 0
    assert alpha['cumulative_load'] == [1, 0]
    assert d['a']['series'][1]['disposals'] == [1, 0]  # Invalid NEG decision excluded.
    assert d['b']['series'][0]['filings'] == [2, 0]  # Same name, two local codes.
    assert d['b']['series'][0]['disposals'] == [2, 0]  # Includes OLDER.
    assert d['b']['series'][0]['net_change'] == [0, 0]
    assert d['b']['series'][0]['baseline'] == 0
    assert d['b']['series'][0]['cumulative_load'] == [0, 0]
    assert d['a']['series'][2]['filings'] == [None, None]  # Type does not exist here.
    assert d['b']['series'][1]['filings'] == [0, 0]  # Known type, no events.
    assert d['b']['series'][2]['cumulative_load'] == [1, 0]
    disposal_only = calculate_filing_comparison(repo, '2017-01', '2017-02', a, b, ('Disposal only',))
    assert disposal_only['b']['series'][0]['cumulative_load'] == [-1, -1]
    assert 'Unknown type' not in json.dumps(d)
    assert 'Disposal only' in [row['case_type'] for row in d['case_type_options']]


def test_unavailable_months_are_null_not_zero(pair_source):
    repo, a, b = pair_source
    snapshot = repo.active(b[0])
    config = json.loads(snapshot['config'])
    config.update(start='2017-02', end='2017-02')
    with repo.connect() as db:
        db.execute('UPDATE snapshots SET config=? WHERE id=?', (json.dumps(config), snapshot['id']))
    d = calculate_filing_comparison(repo, '2017-01', '2017-03', a, b, ('Alpha',))
    assert d['b']['series'][0]['filings'] == [None, 0, None]
    assert d['b']['series'][0]['cumulative_load'] == [None, 0, None]
    assert any('available months' in note for note in d['notes'])
    empty = calculate_filing_comparison(repo, '2017-01', '2017-01', a, b, ('Alpha',))
    assert empty['b']['series'][0]['filings'] == [None]


def test_default_selection_and_empty_period(pair_source):
    repo, a, b = pair_source
    d = calculate_filing_comparison(repo, '2017-01', '2017-02', a, b)
    assert len(d['selected']) == 3
    assert d['selected'][:2] == ['Alpha', 'Beta']
    assert calculate_filing_comparison(repo, '2009-01', '2009-02', a, b)['selected'] == []
    assert calculate_filing_comparison(repo, '2020-01', '2020-02', a, b)['selected'] == []


def test_cumulative_baseline_resets_when_date_range_changes(pair_source):
    repo, a, b = pair_source
    wide = calculate_filing_comparison(repo, '2017-01', '2017-02', a, b, ('Alpha', 'Beta'))
    narrow = calculate_filing_comparison(repo, '2017-02', '2017-02', a, b, ('Alpha', 'Beta'))
    assert wide['a']['series'][0]['cumulative_load'] == [1, 0]
    assert narrow['a']['series'][0]['baseline'] == 0
    assert narrow['a']['series'][0]['cumulative_load'] == [-1]


def test_filing_flow_api_validates_selection(pair_source):
    repo, a, b = pair_source
    params = {'start':'2017-01', 'end':'2017-02', 'a_district':a[0], 'a_court':a[1], 'b_district':b[0], 'b_court':b[1]}
    with TestClient(create_app(repo.path)) as client:
        response = client.get('/api/v1/compare/filing-flow', params={**params, 'type':['Alpha', 'Gamma']})
        assert response.status_code == 200
        assert response.json()['selected'] == ['Alpha', 'Gamma']
        assert client.get('/api/v1/compare/filing-flow', params={**params, 'type':['Alpha','Beta','Gamma','Disposal only']}).status_code == 422
        for changes in ({'start':'2017-13'}, {'start':'0000-01'}, {'start':'2018-01'}, {'end':'2099-01'}):
            assert client.get('/api/v1/compare/filing-flow', params={**params, **changes}).status_code == 422
        for changes in ({'a_district':'missing'}, {'b_court':'missing'}):
            assert client.get('/api/v1/compare/filing-flow', params={**params, **changes}).status_code == 404
