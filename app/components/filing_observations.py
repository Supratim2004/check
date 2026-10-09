from app.components.types import Options, Result
from app.components.common import selected
from app.domain.statistics import moving_average

def calculate(ctx, options: Options) -> Result:
    rows = selected(ctx, options)
    obs = []
    if rows:
        highest = max(rows, key=lambda r: r['mean'])
        obs.append({'title': 'Highest mean monthly filings', 'text': f'{highest['case_type']}: {highest['mean']:.2f} filings per month in the selected filing range.'})
        totals = [sum((r['values'][i] for r in rows)) for i in range(len(ctx.months))]
        if options.smoothing == 'ma12':
            totals = moving_average(totals)
        valid = [(m, v) for m, v in zip(ctx.months, totals) if v is not None]
        if valid:
            peak = max((v for m, v in valid))
            ties = [m for m, v in valid if v == peak]
            obs.append({'title': 'Peak selected filing volume', 'text': f'{peak:.2f} in {ties[0]} across selected case types ({len(ties)} peak month(s)).'})
            obs.append({'title': 'Latest available selected month', 'text': f'{valid[-1][0]}: {valid[-1][1]:.2f} filings.'})
        denominators = ctx.monthly_denominators('arrival_rate')
        rates = [(r['case_type'], m, v / denominators[m]) for r in rows for m, v in zip(ctx.months, r['values']) if denominators[m]]
        if rates:
            name, month, rate = max(rates, key=lambda x: x[2])
            obs.append({'title': 'Highest unsmoothed daily filing rate', 'text': f'{name}: {rate:.2f} filings per working day in {month}.'})
    return {'observations': obs}
