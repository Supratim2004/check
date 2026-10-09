"""Cross-district comparison, built from the same per-court contexts the dashboard uses.

Nothing here re-implements a statistic: totals, medians and percentiles come from
Context.arrivals / Context.measure and domain.statistics.describe, so the comparison always
agrees with the single-court panels for the same filters.
"""
import json
from app.domain.statistics import describe

METRICS = [
    {'key': 'filings', 'label': 'Filings in range', 'unit': 'cases'},
    {'key': 'mean_monthly', 'label': 'Mean filings per month', 'unit': 'cases / month'},
    {'key': 'disposal_median', 'label': 'Median time to disposal', 'unit': 'working days'},
    {'key': 'disposal_p90', 'label': '90th percentile time to disposal', 'unit': 'working days'},
    {'key': 'hearings_median', 'label': 'Median hearings per disposed case', 'unit': 'hearings'},
    {'key': 'gap_median', 'label': 'Median filing-to-first-listing gap', 'unit': 'working days'},
]
CASE_TYPE_LIMIT = 8


def _pooled(ctx, metric):
    values = [v for row in ctx.measure(metric) for v in row['values'] if v is not None]
    return describe(values)


def _court_row(ctx):
    disposal, hearings, gap = _pooled(ctx, 'disposal'), _pooled(ctx, 'hearings'), _pooled(ctx, 'gap')
    filings = len(ctx.cases)
    return {
        'court': ctx.court, 'filings': filings, 'case_types': len(ctx.arrivals),
        'mean_monthly': filings / len(ctx.months) if ctx.months else None,
        'disposal_median': disposal['median'], 'disposal_p90': disposal['p90'], 'disposal_n': disposal['n'],
        'hearings_median': hearings['median'], 'hearings_n': hearings['n'],
        'gap_median': gap['median'], 'gap_n': gap['n'],
        'listing_cutoff': ctx.cutoff,
    }


def _case_type_rows(ctx):
    disposal = {r['code']: r for r in ctx.measure('disposal')}
    return {r['case_type']: {'case_type': r['case_type'], 'side': r['side'], 'filings': r['filings'], 'mean_monthly': r['filings'] / len(ctx.months),
                             'disposal_median': disposal[r['code']]['median'], 'disposal_p90': disposal[r['code']]['p90']}
            for r in ctx.arrivals}


def build(svc, start, end, court, districts=None):
    every = svc.repo.districts()
    districts = list(districts) if districts else every[:2]
    out = {'all_districts': every, 'metrics': METRICS, 'districts': [], 'courts': {}, 'case_types': [], 'court': court, 'notes': [], 'start': start, 'end': end}
    case_types = {}
    for district in districts:
        snap = svc.repo.active(district)
        config = json.loads(snap['config'])
        d_start, d_end = max(start, config['start']), min(end, config['end'])
        entry = {'district': district, 'start': d_start, 'end': d_end, 'extracted_on': config.get('extracted_on'), 'warnings': config.get('data_quality_warnings', [])}
        out['districts'].append(entry)
        if d_start > d_end:
            entry['available'] = False
            continue
        entry['available'] = True
        courts = []
        for meta in config['courts']:
            ctx = svc.context(snap['id'], meta['id'], d_start, d_end)
            row = _court_row(ctx)
            row['label'], row['name'] = meta['label'], meta['name']
            courts.append(row)
            if meta['id'] == court:
                case_types[district] = _case_type_rows(ctx)
        out['courts'][district] = courts
    # Case types are matched on their printed name; the codes are district-specific.
    names = set().union(*[set(v) for v in case_types.values()]) if case_types else set()
    rows = []
    for name in names:
        per = {d: case_types[d].get(name) for d in case_types}
        rows.append({'case_type': name, 'total': sum(p['filings'] for p in per.values() if p), 'by_district': per})
    rows.sort(key=lambda r: (-r['total'], r['case_type']))
    out['case_types'] = rows[:CASE_TYPE_LIMIT]
    out['case_types_matched'] = sum(all(r['by_district'].get(d) for d in case_types) for r in rows)
    cut = {e['district']: next((c['listing_cutoff'] for c in out['courts'].get(e['district'], []) if c['court'] == court), None) for e in out['districts']}
    if len(set(cut.values())) > 1:
        out['notes'].append('Hearings per case and first-listing gap exclude cases filed before each court\'s listing cut-off (' + '; '.join(f'{d}: {c or "none"}' for d, c in cut.items()) + '), so those two measures are not strictly like-for-like across districts.')
    for e in out['districts']:
        out['notes'].extend(e['warnings'])
        if e['available'] and (e['start'], e['end']) != (start, end):
            out['notes'].append(f'{e["district"]}: data available {e["start"]} to {e["end"]} only.')
    return out


# ---------------------------------------------------------------------------------------------
# Per-measure pair comparison: any court in any district against any other, case type by case type.
# Every row is a median / 90th percentile taken from the same Context.measure / Context.arrivals
# values the single-court panels use, so the numbers agree with those panels for the same filters.
# ---------------------------------------------------------------------------------------------
PAIR_METRICS = {
    'filings': {'label': 'Monthly filings', 'unit': 'filings / month', 'about': 'Median and 90th percentile of monthly filings'},
    'arrival_rate': {'label': 'Monthly arrival rate', 'unit': 'filings / working day', 'about': 'Median and 90th percentile of monthly filings per court working day'},
    'disposal': {'label': 'Time to disposal', 'unit': 'working days', 'about': 'Median and 90th percentile, filing to decision'},
    'gap': {'label': 'Filing-to-first-listing gap', 'unit': 'working days', 'about': 'Median and 90th percentile, filing to first listing'},
    'hearings': {'label': 'Hearings per disposed case', 'unit': 'hearings', 'about': 'Median and 90th percentile per disposed case'},
    'monthly_rate': {'label': 'Monthly hearing rate', 'unit': 'hearings / working day', 'about': 'Median and 90th percentile of the monthly hearing rate'},
    'case_rate_mo': {'label': 'Case-wise hearing rate', 'unit': 'hearings / case-month', 'about': 'Median and 90th percentile of hearings per case-month'},
}
HEARING_BASED = {'gap', 'hearings', 'monthly_rate', 'case_rate_mo'}
PAIR_ROW_LIMIT = 20


def _pair_rows(ctx, metric):
    filings = {r['code']: r['filings'] for r in ctx.arrivals}
    if metric == 'filings':
        source = ctx.arrivals
    elif metric == 'arrival_rate':
        den = ctx.monthly_denominators('arrival_rate')
        source = [dict(r, **describe([v / den[m] if den[m] else None for m, v in zip(ctx.months, r['values'])])) for r in ctx.arrivals]
    else:
        source = ctx.measure(metric)
    return [{'case_type': r['case_type'], 'side': r['side'], 'filings': filings[r['code']], 'n': r['n'], 'mean': r['mean'], 'median': r['median'], 'p75': r['p75'], 'p90': r['p90']} for r in source]


def _side(svc, spec, start, end, metric, side):
    district, court = spec
    snap = svc.repo.active(district)
    config = json.loads(snap['config'])
    meta = next((c for c in config['courts'] if c['id'] == court), None)
    out = {'district': district, 'court': court, 'court_label': meta['label'] if meta else court, 'court_name': meta['name'] if meta else court, 'available': False, 'rows': [], 'warnings': config.get('data_quality_warnings', []), 'cutoff': None}
    d_start, d_end = max(start, config['start']), min(end, config['end'])
    out.update(start=d_start, end=d_end)
    if d_start > d_end:
        return out
    ctx = svc.context(snap['id'], court, d_start, d_end)
    rows = _pair_rows(ctx, metric)
    if side != 'all':
        rows = [r for r in rows if r['side'].lower() == side]
    out.update(available=True, rows=rows, cutoff=ctx.cutoff, total_filings=sum(r['filings'] for r in rows), months=len(ctx.months))
    return out


def measure_pair(svc, metric, start, end, a, b, side='all', names=(), limit=6):
    """a and b are (district, court). Case types are matched on their printed name."""
    info = PAIR_METRICS[metric]
    sides = [_side(svc, spec, start, end, metric, side) for spec in (a, b)]
    by_name = [{r['case_type']: r for r in s['rows']} for s in sides]
    shared = [n for n in by_name[0] if n in by_name[1]]
    shared.sort(key=lambda n: (-(by_name[0][n]['filings'] + by_name[1][n]['filings']), n))
    union = {}
    for lookup in by_name:
        for n, r in lookup.items():
            union[n] = union.get(n, 0) + r['filings']
    options = [{'case_type': n, 'a_filings': by_name[0].get(n, {}).get('filings'), 'b_filings': by_name[1].get(n, {}).get('filings'), 'in_both': n in shared}
               for n in sorted(union, key=lambda n: (n not in shared, -union[n], n))][:60]
    notes, matched = [], True
    if names:
        chosen = [n for n in names if n in union][:PAIR_ROW_LIMIT]
        labels = [[n] for n in chosen]
    elif len(shared) >= 2:
        labels = [[n] for n in shared[:limit]]
    else:
        matched = False
        labels = []
        for lookup in by_name:
            labels.append(sorted(lookup, key=lambda n: (-lookup[n]['filings'], n))[:limit])
        notes.append('These two courts share fewer than two case types by name, so each side shows its own largest case types instead of matched ones.')
    for i, s in enumerate(sides):
        keys = labels[i] if not matched else [x[0] for x in labels]
        s['rows'] = [by_name[i].get(n) or {'case_type': n, 'side': None, 'filings': None, 'n': 0, 'mean': None, 'median': None, 'p75': None, 'p90': None} for n in keys]
        s['label'] = f"{s['district']} · {s['court_label']}"
        if not s['available']:
            notes.append(f"{s['district']}: no data in the selected months.")
        elif (s['start'], s['end']) != (start, end):
            notes.append(f"{s['district']}: data available {s['start']} to {s['end']} only.")
    if metric in HEARING_BASED and sides[0]['cutoff'] != sides[1]['cutoff']:
        notes.append(f"Listing cut-offs differ ({sides[0]['label']}: {sides[0]['cutoff'] or 'none'}; {sides[1]['label']}: {sides[1]['cutoff'] or 'none'}), so this measure is not strictly like-for-like.")
    for s in sides:
        if s['available'] and metric in HEARING_BASED:
            notes.extend(s['warnings'])
    notes = list(dict.fromkeys(notes))
    return {'metric': metric, **info, 'matched': matched, 'a': sides[0], 'b': sides[1], 'case_type_options': options, 'notes': notes, 'start': start, 'end': end, 'side': side}
