"""Listing cut-offs (case-level measures only) and authoritative monthly working days."""
import copy
import hashlib
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.components.types import Options
from app.config import district_configurations
from app.domain.context import CUTOFF_MEASURES, Context
from app.ingestion.raw import import_snapshot, validate_config
from app.ingestion.working_days import read_working_days
from app.main import create_app

BANKURA_XLSX = Path('Source_Data_For_Analysis/Bankura/Working_days_court_wise.xlsx')
PURBA_XLSX = Path('Source_Data_For_Analysis/Purba Medinipur/Working_days_court_wise.xlsx')


def with_cutoff(config, day='2017-01-01'):
    config = copy.deepcopy(config)
    config['listing_cutoffs'] = {'CJM': day}
    return config


def alpha(ctx, metric):
    return next(r for r in ctx.measure(metric) if r['code'] == '1')


# ---------------------------------------------------------------- cut-off scope

def test_cutoff_applies_only_to_case_level_listing_and_hearing_measures(source):
    repo, root, config, base, write = source
    # Fixture case OLD was filed 2016-12-31 and sits in code '1'.
    plain = Context(repo, base['snapshot'], 'CJM', '2016-12', '2017-01')
    cut = import_snapshot(repo, root, with_cutoff(config))
    assert cut['snapshot'] != base['snapshot']  # cut-off is part of the provenance digest
    c = Context(repo, cut['snapshot'], 'CJM', '2016-12', '2017-01')
    assert c.cutoff == '2017-01-01'
    assert set(CUTOFF_MEASURES) == {'gap', 'hearings', 'case_rate_wd', 'case_rate_mo'}
    for metric in CUTOFF_MEASURES:
        before, after = alpha(plain, metric), alpha(c, metric)
        assert after['n'] == before['n'] - 1, metric
        assert after['excluded']['before_listing_cutoff'] == 1, metric
        assert 'before_listing_cutoff' not in before['excluded'], metric
    # Not cut off: monthly throughput, disposal, arrivals and the filing count itself.
    assert alpha(c, 'monthly_rate')['values'] == alpha(plain, 'monthly_rate')['values']
    assert alpha(c, 'monthly_rate')['n'] == alpha(plain, 'monthly_rate')['n']
    assert alpha(c, 'disposal')['n'] == alpha(plain, 'disposal')['n']
    assert alpha(c, 'disposal')['excluded'] == alpha(plain, 'disposal')['excluded']
    assert [(a['code'], a['filings'], a['values']) for a in c.arrivals] == \
           [(a['code'], a['filings'], a['values']) for a in plain.arrivals]
    assert len(c.cases) == len(plain.cases)


def test_cutoff_boundary_day_is_included(source):
    repo, root, config, base, write = source
    # OLD was filed 2016-12-31; a cut-off of that very day keeps it.
    kept = import_snapshot(repo, root, with_cutoff(config, '2016-12-31'))
    c = Context(repo, kept['snapshot'], 'CJM', '2016-12', '2017-01')
    assert alpha(c, 'gap')['n'] == 3
    assert 'before_listing_cutoff' not in alpha(c, 'gap')['excluded']


def test_range_entirely_before_cutoff_gives_empty_not_zero(source):
    repo, root, config, base, write = source
    cut = import_snapshot(repo, root, with_cutoff(config, '2018-01-01'))
    c = Context(repo, cut['snapshot'], 'CJM', '2016-12', '2017-01')
    for metric in CUTOFF_MEASURES:
        row = alpha(c, metric)
        assert row['n'] == 0 and row['mean'] is None, metric


def test_cutoff_is_reported_in_metadata_summary_and_footnote_text(source):
    repo, root, config, base, write = source
    import_snapshot(repo, root, with_cutoff(config))
    with TestClient(create_app(repo.path)) as client:
        meta = client.get('/api/v1/metadata').json()
        assert meta['cutoffs_applied'] is True
        assert meta['listing_cutoffs'] == {'CJM': '2017-01-01'}
        assert meta['cutoff_measures'] == list(CUTOFF_MEASURES)
        p = {'court': 'CJM', 'start': '2016-12', 'end': '2017-01'}
        gap = client.get('/api/v1/components/gap', params=p).json()['meta']
        assert gap['listing_cutoff'] == '2017-01-01'
        assert '2017-01-01' in gap['cutoff_note']
        assert gap['filings_basis'] == 'filed in selected range'
        export = client.get('/api/v1/exports/gap', params={**p, 'format': 'json'}).json()
        assert export['meta']['listing_cutoff'] == '2017-01-01'


def test_without_cutoff_config_nothing_changes(source):
    repo, root, config, base, write = source
    c = Context(repo, base['snapshot'], 'CJM', '2016-12', '2017-01')
    assert c.cutoff is None
    s = c.summary()
    assert s['listing_cutoff'] is None and s['cutoff_measures'] == [] and s['cutoff_note'] is None


# ------------------------------------------------------ configuration validation

@pytest.mark.parametrize('mutate, message', [
    (lambda c: c.update(listing_cutoffs={'CJM': '2017-13-01'}), 'ISO date'),
    (lambda c: c.update(listing_cutoffs={'CJM': '2017-1-1'}), 'ISO date'),
    (lambda c: c.update(listing_cutoffs={'CJM': None}), 'ISO date'),
    (lambda c: c.update(listing_cutoffs={'NOPE': '2017-01-01'}), 'unknown court'),
    (lambda c: c.update(listing_cutoffs=['CJM']), 'must map'),
    (lambda c: c.update(require_monthly_working_days=True), 'required'),
    (lambda c: c.update(require_monthly_working_days=True,
                        monthly_working_days={'file': 'x.xlsx', 'sheets': {'CJM': 'CJM'}, 'uses': ['arrival_rate']}),
     'hearing_rate'),
    (lambda c: c.update(require_monthly_working_days=True,
                        monthly_working_days={'file': 'x.xlsx', 'sheets': {}, 'uses': ['arrival_rate', 'hearing_rate']}),
     'no sheet configured'),
])
def test_invalid_cutoff_or_working_day_policy_fails_import_and_keeps_snapshot(source, mutate, message):
    repo, root, config, base, write = source
    bad = copy.deepcopy(config)
    mutate(bad)
    with pytest.raises(ValueError, match=message):
        validate_config(bad)
    with pytest.raises(ValueError, match=message):
        import_snapshot(repo, root, bad)
    assert repo.active()['id'] == base['snapshot']
    assert repo.health()['status'] == 'degraded'


def test_required_working_days_never_fall_back_to_activity_dates(source):
    repo, root, config, base, write = source
    c = Context(repo, base['snapshot'], 'CJM', '2017-01', '2017-01')
    assert c.monthly_denominators('hearing_rate') == {'2017-01': 7}  # legacy fallback still exists...
    c.config['require_monthly_working_days'] = True  # ...but not when the district requires a workbook
    c.config['monthly_working_days'] = {'file': 'x.xlsx', 'sheets': {'CJM': 'CJM'}, 'uses': ['arrival_rate']}
    assert c.monthly_denominators('arrival_rate') == {'2017-01': None}  # configured source, missing month -> null
    with pytest.raises(ValueError, match='refusing to infer'):
        c.monthly_denominators('hearing_rate')


def test_workbook_copied_from_another_district_is_rejected(source):
    repo, root, config, base, write = source
    wb = {'file': 'Working_days_court_wise.xlsx', 'sheets': {'CJM': 'CJM'}, 'uses': ['arrival_rate', 'hearing_rate']}
    shutil.copyfile(BANKURA_XLSX, root / wb['file'])
    bankura = {**copy.deepcopy(config), 'district': 'Bankura', 'monthly_working_days': wb,
               'require_monthly_working_days': True}
    ok = import_snapshot(repo, root, bankura)
    purba = {**copy.deepcopy(config), 'monthly_working_days': wb, 'require_monthly_working_days': True}
    with pytest.raises(ValueError, match="byte-identical to Bankura"):
        import_snapshot(repo, root, purba)
    assert repo.active('Bankura')['id'] == ok['snapshot']
    assert repo.active('Purba Medinipur')['id'] == base['snapshot']  # previous usable snapshot retained
    # Re-importing the same district's own unchanged workbook is not a "copy".
    assert import_snapshot(repo, root, bankura)['status'] == 'unchanged'
    # A genuinely different workbook is accepted.
    shutil.copyfile(PURBA_XLSX, root / wb['file'])
    assert import_snapshot(repo, root, purba)['status'] == 'imported'


# -------------------------------------------------- shipped district configuration

def district(name):
    return next(d for d in district_configurations() if d['district'] == name)


def test_shipped_purba_config_has_per_court_cutoffs_and_authoritative_workbook():
    purba, bankura = district('Purba Medinipur'), district('Bankura')
    assert purba['listing_cutoffs'] == {'CJM': '2017-01-01', 'CJ_JR': '2015-01-01',
                                        'CJ_SR': '2015-01-01', 'DJ': '2015-01-01'}
    assert bankura.get('listing_cutoffs') in (None, {})  # no source-defined cut-off for Bankura
    for d in (purba, bankura):
        validate_config(d)
        assert d['require_monthly_working_days'] is True
        assert d['monthly_working_days']['uses'] == ['arrival_rate', 'hearing_rate']
    assert not any('CSV' in w for w in purba['data_quality_warnings'])
    assert bankura['data_quality_warnings']  # Bankura coverage warning preserved


def test_purba_workbook_is_its_own_not_a_bankura_copy():
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    assert sha(PURBA_XLSX) != sha(BANKURA_XLSX)
    purba = read_working_days(PURBA_XLSX, district('Purba Medinipur'))
    bankura = read_working_days(BANKURA_XLSX, district('Bankura'))
    for court, rows in purba.items():
        assert len(rows) == 198 and all(days is not None for _, days, _ in rows), court
        assert rows[0][0] == '2010-01' and rows[-1][0] == '2026-06'
    differing = sum(p[1] != b[1] for court in purba for p, b in zip(purba[court], bankura[court]))
    assert differing > 300  # clearly different calendars, not a duplicate
    # Spot values taken from the district's Monthly_<court>.xlsx working-day sheets.
    assert purba['CJM'][0][:2] == ('2010-01', 22)
    assert purba['CJ_SR'][0][:2] == ('2010-01', 14)
    assert purba['CJ_JR'][0][:2] == ('2010-01', 9)
    assert purba['DJ'][0][:2] == ('2010-01', 17)


def test_courts_json_is_untouched_by_district_policy():
    from app.config import configuration
    base = configuration()
    assert 'listing_cutoffs' not in base and 'require_monthly_working_days' not in base
