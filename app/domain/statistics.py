from statistics import mean

def percentile(values, fraction):
    if not values:
        return None
    v = sorted(values)
    p = (len(v) - 1) * fraction
    lo = int(p)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (p - lo)

def describe(values):
    v = [x for x in values if x is not None]
    return {'n': len(v), 'mean': mean(v) if v else None, 'median': percentile(v, 0.5), 'p75': percentile(v, 0.75), 'p90': percentile(v, 0.9), 'p95': percentile(v, 0.95)}

def moving_average(values):
    return [mean(values[i - 11:i + 1]) if i >= 11 and all((x is not None for x in values[i - 11:i + 1])) else None for i in range(len(values))]

def months(start, end):
    y, m = map(int, start.split('-'))
    result = []
    while f'{y:04}-{m:02}' <= end:
        result.append(f'{y:04}-{m:02}')
        m += 1
        if m == 13:
            y += 1
            m = 1
    return result
