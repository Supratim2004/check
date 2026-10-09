from app.components.types import Options, Result

def calculate(ctx, options: Options) -> Result:
    rows = [{'code': r['code'], 'case_type': r['case_type'], 'filings': r['filings']} for r in ctx.arrivals[:7]]
    remainder = sum((r['filings'] for r in ctx.arrivals[7:]))
    if remainder:
        rows.append({'code': 'OTHER', 'case_type': 'Other case types', 'filings': remainder})
    return {'rows': rows, 'units': 'filings'}
