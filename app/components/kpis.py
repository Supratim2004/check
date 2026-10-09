from app.components.types import Options, Result

def calculate(ctx, options: Options) -> Result:
    top = ctx.arrivals[0] if ctx.arrivals else None
    disposal = next((r for r in ctx.measure('disposal') if top and r['code'] == top['code']), None)
    return {'total': len(ctx.cases), 'types': len(ctx.arrivals), 'leading': top['case_type'] if top else None, 'mean': top['mean'] if top else None, 'peak': top['max'] if top else None, 'disposal': disposal['median'] if disposal else None, 'disposal_n': disposal['n'] if disposal else 0}
