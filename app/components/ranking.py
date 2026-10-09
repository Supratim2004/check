from app.components.types import Options, Result
from app.components.common import clean

def calculate(ctx, options: Options) -> Result:
    return {'rows': clean(ctx.arrivals[:5]), 'units': 'filings'}
