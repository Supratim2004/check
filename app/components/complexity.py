import math
from app.components.types import Options, Result

def color(value, low, high):
    if high <= low:
        return 'rgba(148,163,184,0.85)'
    stops = [(37, 99, 235), (6, 182, 212), (34, 197, 94), (234, 179, 8), (220, 38, 38)]
    t = (value - low) / (high - low) * 4
    i = min(3, int(t))
    fraction = t - i
    rgb = [round(a + (b - a) * fraction) for a, b in zip(stops[i], stops[i + 1])]
    return f'rgba({rgb[0]},{rgb[1]},{rgb[2]},0.85)'

def calculate(ctx, options: Options) -> Result:
    maps = [{r['code']: r for r in ctx.measure(m)} for m in ['hearings', 'case_rate_mo', 'monthly_rate', 'disposal']]
    raw = []
    for a in ctx.arrivals:
        measures = [m[a['code']] for m in maps]
        values = [r['mean'] for r in measures]
        if any((v is None for v in values)):
            continue
        raw.append({'code': a['code'], 'label': a['case_type'], 'side': a['side'], 'filings': a['filings'], 'x': values[0], 'y': values[1], 'throughput': values[2], 'disposalMean': values[3], 'sample_sizes': {k: r['n'] for k, r in zip(['hearings', 'case_rate', 'monthly_rate', 'disposal'], measures)}})
    available = [{'code': p['code'], 'case_type': p['label'], 'filings': p['filings']} for p in raw]
    if not raw:
        return {'points': [], 'available': [], 'observations': [], 'color_labels': [], 'bubbles': [], 'guides': [], 'max_x': 1, 'max_y': 1}
    hmax = max((p['throughput'] for p in raw))
    low = min((p['disposalMean'] for p in raw))
    high = max((p['disposalMean'] for p in raw))
    codes = options.types or tuple((p['code'] for p in raw[:4]))
    points = [dict(p, r=34 * math.sqrt(p['throughput'] / hmax) if hmax else 0, backgroundColor=color(p['disposalMean'], low, high)) for p in raw if p['code'] in codes]
    points.sort(key=lambda p: -p['r'])
    mx = max((p['x'] for p in points), default=0) * 1.15 or 1
    my = max((p['y'] for p in points), default=0) * 1.15 or 1
    candidates = [t for t in [0.5, 1, 1.5, 2, 3, 4, 6, 9, 12, 18, 24, 36, 48, 60, 84, 120] if my * 0.04 < mx / t < my * 1.3]
    if len(candidates) > 4:
        candidates = [candidates[round(i * (len(candidates) - 1) / 3)] for i in range(4)]
    guides = [{'months': t, 'points': [{'x': 0, 'y': 0}, {'x': min(mx, my * t), 'y': min(mx / t, my)}]} for t in candidates]
    obs = []
    if points:
        for field, title, unit in [('x', 'Most recorded hearings per disposed case', 'hearings / case'), ('throughput', 'Highest mean cohort hearing throughput', 'hearings / working day'), ('disposalMean', 'Longest observed mean disposal', 'working days')]:
            top = max(points, key=lambda p: p[field])
            obs.append({'title': title, 'text': f'{top['label']}: {top[field]:.2f} {unit}.'})
        obs.append({'title': 'Reference lines', 'text': 'Implied duration is mean hearings divided by mean case-wise rate, not observed mean disposal time; the source populations differ.'})
    hs = [p['throughput'] for p in points]
    hmin = min(hs, default=0)
    htop = max(hs, default=0)
    return {'points': points, 'available': available, 'observations': obs, 'max_x': mx, 'max_y': my, 'guides': guides, 'color_labels': [low, (low + high) / 2, high], 'bubbles': [{'value': h, 'radius': 34 * math.sqrt(h / hmax) if hmax else 0} for h in dict.fromkeys((hmin + (htop - hmin) * i / 3 for i in range(4)))], 'units': 'x: hearings/case; y: hearings/case-month; area: hearings/working day; colour: working days'}
