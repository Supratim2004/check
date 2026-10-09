"""Real-data verification for definition v5 (listing cut-offs + authoritative monthly working days).

Usage: python scripts/verify_cutoffs_and_working_days.py [--reference "<check-main>/Data/Purba Medinipur"] [--out docs/cutoff-working-day-verification.json]

1. For every district/court: workbook monthly working days vs. days derived from raw CSV activity.
2. With --reference (the other app's Monthly_<court>.xlsx files): per-case-type N and median for
   gap / hearings-per-case, before the cut-off (v4 behaviour) and after (v5), against the workbook.
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from openpyxl import load_workbook
from app.bootstrap import ensure_loaded
from app.config import DB_PATH
from app.domain.context import Context
from app.domain.statistics import describe
from app.repository import Repository

FILES = {'CJM': 'Monthly_CJM.xlsx', 'CJ_JR': 'Monthly_CJ_Jr.xlsx', 'CJ_SR': 'Monthly_CJ_Sr.xlsx', 'DJ': 'Monthly_DJ.xlsx'}


def sheet(book, name):
    rows = list(book[name].values)
    for i, r in enumerate(rows):
        if r[0] == 'Case type':
            header, rows = r, rows[i + 1:]
            break
    return {r[0]: dict(zip(header, r)) for r in rows if r[0]}


def working_days(repo, report):
    for district in repo.districts():
        snap = repo.active(district)['id']
        for court in ('CJM', 'CJ_JR', 'CJ_SR', 'DJ'):
            ctx = Context(repo, snap, court, '2010-01', '2026-06')
            sheet_counts = ctx.workbook_working_months
            activity = ctx.working_months
            diff = [m for m in ctx.months if sheet_counts.get(m) != activity.get(m, 0)]
            report['working_days'].append({'district': district, 'court': court, 'months': len(ctx.months),
                                           'workbook_vs_csv_activity_differing_months': len(diff)})


def reference(repo, ref, report):
    snap = repo.active('Purba Medinipur')['id']
    for court, filename in FILES.items():
        book = load_workbook(ref / filename, read_only=True, data_only=True)
        gap, hx = sheet(book, 'Gap_workdays'), sheet(book, 'Hearings_X')
        ctx = Context(repo, snap, court, '2010-01', '2026-06')
        cut = ctx.cutoff
        by = defaultdict(list)
        for c in ctx.cases:
            by[c['name']].append(c)
        for a in ctx.arrivals[:3]:
            name, cases = a['case_type'], by[a['case_type']]
            g = [ctx.duration(c['filing'], c['listing']) for c in cases if c['listing'] and c['filing'] <= c['listing'] <= ctx.last]
            g5 = [ctx.duration(c['filing'], c['listing']) for c in cases if c['listing'] and c['filing'] <= c['listing'] <= ctx.last and c['filing'] >= cut]
            h = [len(ctx.hearings.get(c['cino'], [])) for c in cases if ctx.resolved(c)]
            h5 = [len(ctx.hearings.get(c['cino'], [])) for c in cases if ctx.resolved(c) and c['filing'] >= cut]
            row = {'court': court, 'case_type': name, 'cutoff': cut,
                   'gap': {'workbook_n': gap[name]['N'], 'workbook_median': gap[name]['Median'],
                           'v4_n': len(g), 'v4_median': describe(g)['median'], 'v5_n': len(g5), 'v5_median': describe(g5)['median']},
                   'hearings': {'workbook_n': hx[name]['N'], 'workbook_median': hx[name]['Median'],
                                'v4_n': len(h), 'v4_median': describe(h)['median'], 'v5_n': len(h5), 'v5_median': describe(h5)['median']}}
            report['reference_comparison'].append(row)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default=DB_PATH)
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    repo = ensure_loaded(Repository(args.db))  # in-memory default: imports the CSVs first (~30 s)
    report = {'working_days': [], 'reference_comparison': []}
    working_days(repo, report)
    if args.reference:
        reference(repo, args.reference, report)
    text = json.dumps(report, indent=2, default=str)
    if args.out:
        args.out.write_text(text + '\n')
    print(text)


if __name__ == '__main__':
    main()
