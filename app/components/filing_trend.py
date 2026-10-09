from app.components.types import Options, Result
from app.components.common import selected, series_result

def calculate(ctx, options: Options) -> Result:
    return series_result(ctx, selected(ctx, options), 'filings / month', options.smoothing)
