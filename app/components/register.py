from app.components.types import Options, Result
from app.components.common import clean

def calculate(ctx, options: Options) -> Result:
    disposals = {r['code']: r for r in ctx.measure('disposal')}
    rows = [dict(r, disposal_median=disposals[r['code']]['median'], disposal_p90=disposals[r['code']]['p90'], disposal_n=disposals[r['code']]['n']) for r in clean(ctx.arrivals) if (options.side == 'all' or r['side'].lower() == options.side) and options.search.casefold() in r['case_type'].casefold()]
    pages = max(1, (len(rows) + 9) // 10)
    page = min(options.page, pages - 1)
    return {'rows': rows[page * 10:page * 10 + 10], 'all_rows': rows, 'page': page, 'pages': pages, 'total': len(rows), 'status': f'{page * 10 + 1}–{min(page * 10 + 10, len(rows))} of {len(rows)}' if rows else '0 cases'}
