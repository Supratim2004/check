from app.components.types import Options, Result
from app.components.common import clean

def calculate(ctx, options: Options) -> Result:
    return {'rows': clean(ctx.selection(options.types, ctx.measure('monthly_rate'), 3)), 'units': 'hearings / working day'}
