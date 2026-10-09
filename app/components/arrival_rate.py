from app.components.types import Options, Result
from app.components.common import selected, series_result

def calculate(ctx, options: Options) -> Result:
    denominators = ctx.monthly_denominators('arrival_rate')
    rows = [dict(r, values=[v / denominators[m] if denominators[m] else None for m, v in zip(ctx.months, r['values'])]) for r in selected(ctx, options)]
    return series_result(ctx, rows, 'filings / working day', options.smoothing)
