from app.components.types import Options, Result
from app.components.common import clean

def calculate(ctx, options: Options) -> Result:
    return {'rows': clean([r for r in ctx.measure('gap') if r['p90'] is not None and r['p90'] > 100]), 'units': 'working days'}
