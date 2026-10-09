"""Presentation-neutral helpers. No component imports another component."""
from app.domain.statistics import moving_average

def selected(ctx, options, metric=None, default=3):
    rows = ctx.arrivals if metric is None else ctx.measure(metric)
    return ctx.selection(options.types, rows, default)

def series_result(ctx, rows, units, smoothing='actual'):
    return {'labels': ctx.months, 'series': [{'code': r['code'], 'label': r['case_type'], 'values': moving_average(r['values']) if smoothing == 'ma12' else r['values']} for r in rows], 'units': units}

def clean(rows):
    return [{k: v for k, v in r.items() if k != 'values'} for r in rows]
