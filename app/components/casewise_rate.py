from app.components.types import Options, Result
from app.components.common import clean

def calculate(ctx, options: Options) -> Result:
    wd = {r['code']: r for r in ctx.measure('case_rate_wd')}
    rows = [dict(r, working_day_rate={k: v for k, v in wd[r['code']].items() if k not in ('values', 'case_type', 'code', 'side')}) for r in ctx.selection(options.types, ctx.measure('case_rate_mo'), 3)]
    return {'rows': clean(rows), 'units': 'hearings / case-month'}
