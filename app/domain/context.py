"""Shared case-level queries and statistical primitives, never plot dependencies."""
import calendar
import json
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import date
from functools import cached_property, lru_cache
from app.domain.statistics import describe, months
from app.config import DEFINITION_VERSION

# Case-level measures that depend on first-listing / hearing records, which are unreliable for
# cases bulk-migrated at digitization. Monthly throughput, arrivals and disposal are deliberately
# NOT cut off: they use genuine filing/decision dates or whole-month hearing counts.
CUTOFF_MEASURES = ('gap', 'hearings', 'case_rate_wd', 'case_rate_mo')

class Context:

    def __init__(self, repo, snapshot, court, start, end):
        self.repo = repo
        self.snapshot = snapshot
        self.court = court
        self.start = start
        self.end = end
        with repo.connect() as db:
            row = db.execute('SELECT config,quality,n FROM snapshots WHERE id=?', (snapshot,)).fetchone()
        self.n = row['n']  # integer key used by the cases/hearings/working_days tables
        self.config = json.loads(row['config'])
        self.config['definition_version'] = DEFINITION_VERSION
        self.quality = json.loads(row['quality']).get(court, {})
        self.metadata = next((c for c in self.config['courts'] if c['id'] == court))
        self.first = start + '-01'
        y, m = map(int, end.split('-'))
        self.last = f'{end}-{calendar.monthrange(y, m)[1]}'
        self.months = months(start, end)

    @cached_property
    def cases(self):
        # Only explicitly classified Civil/Criminal cases belong to the dashboard cohort.
        # Keep other records in storage for source auditing, not in totals or plots.
        with self.repo.connect() as db:
            return [dict(r) for r in db.execute("SELECT c.*,t.name,t.side FROM cases c JOIN types t ON t.snapshot=? AND t.court=c.court AND t.code=c.type_code WHERE c.snapshot=? AND c.court=? AND c.filing BETWEEN ? AND ? AND t.side IN ('Civil', 'Criminal') ORDER BY c.type_code,c.cino", (self.snapshot, self.n, self.court, self.first, self.last))]

    @cached_property
    def groups(self):
        groups = defaultdict(list)
        for c in self.cases:
            groups[c['type_code']].append(c)
        return groups

    @cached_property
    def calendar(self):
        with self.repo.connect() as db:
            return [r[0] for r in db.execute('SELECT day FROM working_days WHERE snapshot=? AND court=? ORDER BY day', (self.n, self.court))]

    @cached_property
    def working_months(self):
        return Counter((d[:7] for d in self.calendar if self.first <= d <= self.last))

    @cached_property
    def workbook_working_months(self):
        with self.repo.connect() as db:
            return {r['month']: r['days'] for r in db.execute(
                'SELECT month,days FROM monthly_working_days WHERE snapshot=? AND court=? AND month BETWEEN ? AND ?',
                (self.snapshot, self.court, self.start, self.end))}

    @cached_property
    def cutoff(self):
        """ISO date before which filings are excluded from CUTOFF_MEASURES, or None."""
        return (self.config.get('listing_cutoffs') or {}).get(self.court)

    def monthly_denominators(self, purpose):
        source = self.config.get('monthly_working_days', {})
        if self.config.get('require_monthly_working_days') and purpose not in source.get('uses', []):
            raise ValueError(f'{self.config.get("district")}: no authoritative monthly working-day source for {purpose}; refusing to infer from activity dates')
        counts = self.workbook_working_months if purpose in source.get('uses', []) else self.working_months
        return {month: counts.get(month) for month in self.months}

    def monthly_denominator_info(self, purpose):
        source = self.config.get('monthly_working_days', {})
        uses_workbook = purpose in source.get('uses', [])
        counts = self.monthly_denominators(purpose)
        return {'source': source['file'] if uses_workbook else 'raw all-court activity dates',
                'sheet': source['sheets'][self.court] if uses_workbook else None,
                'months': self.months, 'working_days': [counts[m] for m in self.months],
                'missing_months': [m for m in self.months if counts[m] is None],
                'zero_months': [m for m in self.months if counts[m] == 0]}

    def duration(self, start, end):
        return bisect_right(self.calendar, end) - bisect_right(self.calendar, start)

    def resolved(self, c):
        return bool(c['decision'] and c['filing'] <= c['decision'] <= self.last)

    @cached_property
    def hearings(self):
        data = defaultdict(list)
        eligible_cases = {case['cino'] for case in self.cases}
        with self.repo.connect() as db:
            for r in db.execute('SELECT h.cino,h.day FROM hearings h JOIN cases c ON c.snapshot=h.snapshot AND c.court=h.court AND c.cino=h.cino\n                WHERE h.snapshot=? AND h.court=? AND c.filing BETWEEN ? AND ? AND h.day BETWEEN c.filing AND ?\n                AND (c.decision IS NULL OR h.day<=c.decision) ORDER BY h.cino,h.day', (self.n, self.court, self.first, self.last, self.last)):
                if r['cino'] in eligible_cases:
                    data[r['cino']].append(r['day'])
        return data

    def identity(self, code):
        c = self.groups[code][0]
        return {'code': code, 'case_type': c['name'], 'side': c['side']}

    @cached_property
    def arrivals(self):
        result = []
        for code, cases in self.groups.items():
            counts = Counter((c['filing'][:7] for c in cases))
            values = [counts[m] for m in self.months]
            result.append({**self.identity(code), 'filings': len(cases), 'values': values, **describe(values), 'max': max(values)})
        return sorted(result, key=lambda r: (-r['filings'], r['case_type'], r['code']))

    @lru_cache(maxsize=12)
    def measure(self, metric):
        result = []
        for arrival in self.arrivals:
            code = arrival['code']
            cases = self.groups[code]
            values = []
            excluded = Counter()
            if metric == 'monthly_rate':
                counts = Counter((d[:7] for c in cases for d in self.hearings.get(c['cino'], [])))
                denominators = self.monthly_denominators('hearing_rate')
                values = [counts[m] / denominators[m] if denominators[m] else None for m in self.months]
                excluded['months_without_working_days'] = sum(v is None for v in values)
            else:
                cutoff = self.cutoff if metric in CUTOFF_MEASURES else None
                for c in cases:
                    if cutoff and c['filing'] < cutoff:
                        excluded['before_listing_cutoff'] += 1
                        continue
                    if metric == 'gap':
                        event = c['listing']
                        if not event or not c['filing'] <= event <= self.last:
                            excluded['missing_invalid_or_later_listing'] += 1
                            continue
                        value = self.duration(c['filing'], event)
                    else:
                        if not self.resolved(c):
                            excluded['missing_invalid_or_later_decision'] += 1
                            continue
                        if metric == 'disposal':
                            value = self.duration(c['filing'], c['decision'])
                        elif metric == 'hearings':
                            value = len(self.hearings.get(c['cino'], []))
                        else:
                            denominator = self.duration(c['filing'], c['decision']) if metric == 'case_rate_wd' else (date.fromisoformat(c['decision']) - date.fromisoformat(c['filing'])).days / 30.4375
                            if denominator <= 0:
                                excluded['zero_denominator'] += 1
                                continue
                            value = len(self.hearings.get(c['cino'], [])) / denominator
                    values.append(value)
            result.append({**self.identity(code), **describe(values), 'values': values, 'excluded': dict(excluded)})
        return result

    def selection(self, codes=(), eligible=None, default=3):
        rows = self.arrivals if eligible is None else eligible
        return [r for r in rows if r['code'] in codes] if codes else rows[:default]

    def summary(self):
        return {'snapshot': self.snapshot, 'definition_version': self.config['definition_version'], 'court': self.court, 'district': self.config['district'], 'start': self.start, 'end': self.end, 'observation_end': self.last, 'filing_cohort_n': len(self.cases), 'quality': self.quality, 'monthly_rate_denominators': {purpose: self.monthly_denominator_info(purpose) for purpose in ('arrival_rate', 'hearing_rate')}, 'duration_calendar_source': 'raw all-court activity dates', 'data_quality_warnings': self.config.get('data_quality_warnings', []), 'filings_basis': 'filed in selected range', 'listing_cutoff': self.cutoff, 'cutoff_measures': list(CUTOFF_MEASURES) if self.cutoff else [], 'cutoff_note': (f'Gap, hearings per case and case-wise hearing rates exclude cases filed before {self.cutoff} (bulk-digitization artefact); filings, arrivals, disposal and monthly hearing throughput include them.' if self.cutoff else None), 'note': 'Cases filed in the selected range; events observed only through its end. Unresolved cases do not enter disposal statistics.'}
