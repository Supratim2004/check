"""Explicit calculations for the four-quadrant filing/disposal comparison."""
import calendar
import json

from app.domain.statistics import months


def calculate_filing_comparison(repo, start, end, a, b, names=()):
    """Count calendar-month events, not disposals limited to the filing cohort.

    F[m] = cases whose filing date is in month m.
    D[m] = cases whose valid decision date is in month m, including older filings.
    Cumulative case load[m] = cumulative sum of F[m] - D[m], starting at zero.
    This is backlog change in the range, not the absolute number of pending cases.
    The two courts are matched by exact printed case-type name, not local codes.
    """
    labels = months(start, end)
    sides = []
    volume = {}
    for district, court in (a, b):
        snapshot = repo.active(district)
        config = json.loads(snapshot['config'])
        court_meta = next(c for c in config['courts'] if c['id'] == court)
        first_month, last_month = max(start, config['start']), min(end, config['end'])
        counts = {}
        with repo.connect() as db:
            known_names = {r[0] for r in db.execute(
                "SELECT name FROM types WHERE snapshot=? AND court=? AND side IN ('Civil','Criminal')",
                (snapshot['id'], court))}
            if first_month <= last_month:
                first_day = first_month + '-01'
                year, month = map(int, last_month.split('-'))
                last_day = f'{last_month}-{calendar.monthrange(year, month)[1]}'
                # One record per court/cino is enforced by the database primary key.
                # Aggregate duplicate local codes with the same printed type name.
                for row in db.execute("""
                    SELECT t.name, substr(c.filing,1,7) AS month, COUNT(*) AS n
                    FROM cases c JOIN types t
                      ON t.snapshot=? AND t.court=c.court AND t.code=c.type_code
                    WHERE c.snapshot=? AND c.court=? AND t.side IN ('Civil','Criminal')
                      AND c.filing BETWEEN ? AND ?
                    GROUP BY t.name, substr(c.filing,1,7)
                """, (snapshot['id'], snapshot['n'], court, first_day, last_day)):
                    counts.setdefault(row['name'], {'filings': {}, 'disposals': {}})['filings'][row['month']] = row['n']
                # Deliberately no filing-window restriction here: earlier filings
                # disposed during the displayed month must contribute to outflow.
                for row in db.execute("""
                    SELECT t.name, substr(c.decision,1,7) AS month, COUNT(*) AS n
                    FROM cases c JOIN types t
                      ON t.snapshot=? AND t.court=c.court AND t.code=c.type_code
                    WHERE c.snapshot=? AND c.court=? AND t.side IN ('Civil','Criminal')
                      AND c.decision BETWEEN ? AND ? AND c.filing<=c.decision
                    GROUP BY t.name, substr(c.decision,1,7)
                """, (snapshot['id'], snapshot['n'], court, first_day, last_day)):
                    counts.setdefault(row['name'], {'filings': {}, 'disposals': {}})['disposals'][row['month']] = row['n']
        for name, events in counts.items():
            volume[name] = volume.get(name, 0) + sum(events['filings'].values()) + sum(events['disposals'].values())
        sides.append({'district': district, 'court': court,
                      'label': f"{district} · {court_meta['label']}",
                      'start': first_month, 'end': last_month,
                      'known_names': known_names, 'counts': counts})

    ordered = sorted(volume, key=lambda name: (
        not all(name in s['known_names'] for s in sides), -volume[name], name))
    selected = [name for name in dict.fromkeys(names) if name in volume][:3] if names else ordered[:3]
    if not selected:
        selected = ordered[:3]
    options = [{'case_type': name, 'in_both': all(name in s['known_names'] for s in sides)} for name in ordered]
    notes = [
        'Filings are counted by filing month; disposals by decision month, including cases filed before the displayed range. Only Civil and Criminal cases with valid event dates are included.',
        'Cumulative case-load change = cumulative sum(monthly filings − monthly disposals), starting at 0. No opening pending count is added. The curve measures change in backlog, not the absolute pending total; negative values mean cumulative disposals exceed cumulative filings.',
        'Changing the date range resets the cumulative baseline to 0. Only available months are accumulated; unavailable months remain blank.',
        'Types are matched by exact printed name (duplicate codes with the same name are combined). Blank segments mean an unavailable month or a type not present at that court; zero means no events in an available month.',
    ]
    for side in sides:
        side['series'] = []
        for name in selected:
            events = side['counts'].get(name, {'filings': {}, 'disposals': {}})
            available = [side['start'] <= m <= side['end'] and name in side['known_names'] for m in labels]
            filings = [events['filings'].get(m, 0) if valid else None for m, valid in zip(labels, available)]
            disposals = [events['disposals'].get(m, 0) if valid else None for m, valid in zip(labels, available)]
            net_change = [f - d if f is not None and d is not None else None for f, d in zip(filings, disposals)]
            baseline = 0 if any(available) else None
            running_load = 0
            cumulative_load = []
            for change in net_change:
                if change is None:
                    cumulative_load.append(None)
                else:
                    running_load += change
                    cumulative_load.append(running_load)
            side['series'].append({'case_type': name, 'filings': filings, 'disposals': disposals,
                                   'net_change': net_change, 'baseline': baseline, 'cumulative_load': cumulative_load})
        if side['start'] > side['end']:
            notes.append(side['label'] + ': no data in the selected months.')
        elif (side['start'], side['end']) != (start, end):
            notes.append(f"{side['label']}: available months {side['start']}–{side['end']} only.")
        del side['known_names'], side['counts']
    return {'labels': labels, 'a': sides[0], 'b': sides[1], 'selected': selected,
            'case_type_options': options, 'notes': notes, 'units': 'events: cases / month; cumulative change: cases'}
