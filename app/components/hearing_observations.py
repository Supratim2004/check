from app.components.types import Options, Result

def calculate(ctx, options: Options) -> Result:
    obs = []
    for metric, title, unit in [('monthly_rate', 'Highest median monthly throughput', 'hearings / working day'), ('case_rate_mo', 'Highest median hearing frequency', 'hearings / case-month')]:
        rows = [r for r in ctx.selection(options.types, ctx.measure(metric), 3) if r['median'] is not None]
        if rows:
            top = max(rows, key=lambda r: r['median'])
            obs.append({'title': title, 'text': f'{top['case_type']}: {top['median']:.2f} {unit}; N={top['n']}.'})
    rows = [r for r in ctx.selection(options.types, ctx.measure('case_rate_mo'), 3) if r['p90'] is not None]
    if rows:
        top = max(rows, key=lambda r: r['p90'] - r['median'])
        obs.append({'title': 'Largest median-to-90th-percentile gap', 'text': f'{top['case_type']}: {top['p90'] - top['median']:.2f} hearings / case-month.'})
    peaks = [(r['case_type'], m, v) for r in ctx.selection(options.types, ctx.measure('monthly_rate'), 3) for m, v in zip(ctx.months, r['values']) if v is not None]
    if peaks:
        name, month, value = max(peaks, key=lambda p: p[2])
        obs.append({'title': 'Peak in selected monthly time series', 'text': f'{name}: {value:.2f} hearings per working day in {month}.'})
    return {'observations': obs}
