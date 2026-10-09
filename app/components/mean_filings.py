from app.components.types import Options, Result
from app.components.common import selected, clean

def calculate(ctx, options: Options) -> Result:
    return {'rows': clean(selected(ctx, options)), 'units': 'filings / month'}
