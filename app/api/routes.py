import calendar
import io
import json
import re
from dataclasses import replace
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from openpyxl import Workbook
from app.components.types import Options
from app.config import REPORT_PATH, DEFINITION_VERSION
from app.outputs.export import csv_text
router = APIRouter(prefix='/api/v1')
PAIR_NAME_CAP = 20

def service(request: Request):
    return request.app.state.analytics

def active(district: str | None=None, svc=Depends(service)):
    snapshot = svc.repo.active(district)
    if not snapshot and district and svc.repo.districts():
        raise HTTPException(404, 'District not imported')
    if not snapshot:
        raise HTTPException(503, 'No CSV snapshot imported. Run the documented import command.')
    return snapshot

@router.get('/health')
def health(district: str | None=None, svc=Depends(service)):
    return svc.repo.health(district)

@router.get('/metadata')
def metadata(svc=Depends(service), snapshot=Depends(active)):
    config = json.loads(snapshot['config'])
    config['definition_version'] = DEFINITION_VERSION
    for court in config['courts']:
        court.pop('cutoff', None)
    from app.domain.context import CUTOFF_MEASURES
    cutoffs = config.get('listing_cutoffs') or {}
    return {**config, 'snapshot': snapshot['id'], 'components': svc.registry, 'cutoffs_applied': bool(cutoffs), 'listing_cutoffs': cutoffs, 'cutoff_measures': list(CUTOFF_MEASURES) if cutoffs else [], 'districts': svc.repo.districts()}

@router.get('/methodology')
def methodology():
    from app.config import ROOT
    return {'definition_version': DEFINITION_VERSION, 'text': (ROOT / 'docs' / 'METHODOLOGY.md').read_text()}

def filters(court: str, start: str | None=None, end: str | None=None, district: str | None=None, types: str='', smoothing: Literal['actual', 'ma12']='actual', side: Literal['all', 'civil', 'criminal', 'unknown']='all', search: str=Query('', max_length=200), page: int=Query(0, ge=0), snapshot=Depends(active), svc=Depends(service)):
    config = json.loads(snapshot['config'])
    config['definition_version'] = DEFINITION_VERSION
    start = start or config['start']
    end = end or config['end']
    if court not in {c['id'] for c in config['courts']}:
        raise HTTPException(404, 'Unknown court')
    if district and district != config['district']:
        raise HTTPException(404, 'Unknown district')
    if any((not re.fullmatch('\\d{4}-(0[1-9]|1[0-2])', x) for x in (start, end))) or start > end or start < config['start'] or (end > config['end']):
        raise HTTPException(422, 'Choose an ordered month range within the complete source window.')
    codes = tuple(dict.fromkeys((x for x in types.split(',') if x)))
    ctx = svc.context(snapshot['id'], court, start, end)
    available = set(ctx.groups)
    if any((code not in available for code in codes)):
        raise HTTPException(422, 'Case type not available in this filing cohort.')
    return (snapshot['id'], config['definition_version'], court, start, end, Options(codes, smoothing, side, search, page))

def calculate(svc, key, f):
    if key not in svc.registry:
        raise HTTPException(404, 'Component not registered')
    snap, version, court, start, end, opts = f
    return svc.result(snap, version, key, court, start, end, opts)

@router.get('/options')
def options(f=Depends(filters), svc=Depends(service)):
    snap, version, court, start, end, opts = f
    ctx = svc.context(snap, court, start, end)
    return {'types': [{'code': r['code'], 'case_type': r['case_type'], 'filings': r['filings']} for r in ctx.arrivals], 'meta': ctx.summary()}

@router.get('/components/{component}')
def component(component: str, f=Depends(filters), svc=Depends(service)):
    if component in svc.registry and svc.registry[component]['group'] in ('filing', 'hearing') and (len(f[-1].types) > 5):
        raise HTTPException(422, 'Select at most five case types')
    return calculate(svc, component, f)

def export_rows(data):
    if 'all_rows' in data:
        return data['all_rows']
    if 'rows' in data:
        return data['rows']
    if 'series' in data:
        return [{'month': m, **{s['label'] + ' [' + s['code'] + ']': s['values'][i] for s in data['series']}} for i, m in enumerate(data['labels'])]
    if 'points' in data:
        return data['points']
    if 'observations' in data:
        return data['observations']
    return [{k: v for k, v in data.items() if k != 'meta'}]

def safe(value):
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')):
        return "'" + value
    return value

@router.get('/exports/{component}')
def export(component: str, format: Literal['xlsx', 'csv', 'json']='xlsx', f=Depends(filters), svc=Depends(service)):
    if component == 'court':
        snap, version, court, start, end, opts = f
        ctx = svc.context(snap, court, start, end)
        data = {'meta': ctx.summary(), 'arrivals': ctx.arrivals, **{metric: ctx.measure(metric) for metric in ['gap', 'disposal', 'hearings', 'monthly_rate', 'case_rate_wd', 'case_rate_mo']}}
        return Response(json.dumps(data, ensure_ascii=False), media_type='application/json', headers={'Content-Disposition': 'attachment; filename="court-data.json"'})
    data = calculate(svc, component, f)
    rows = export_rows(data)
    if format == 'json':
        content = json.dumps(data, ensure_ascii=False)
        mime = 'application/json'
    elif format == 'csv':
        content = csv_text([{k: safe(v) for k, v in r.items()} for r in rows])
        mime = 'text/csv'
    else:
        book = Workbook()
        sheet = book.active
        sheet.title = 'Chart Data'
        fields = list(dict.fromkeys((k for r in rows for k in r)))
        if fields:
            sheet.append(fields)
            for row in rows:
                sheet.append([safe(row.get(k)) for k in fields])
        method = book.create_sheet('Methodology')
        for k, v in data['meta'].items():
            method.append([k, safe(v)])
        method.append(['units', data.get('units', '')])
        buffer = io.BytesIO()
        book.save(buffer)
        content = buffer.getvalue()
        mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    return Response(content, media_type=mime, headers={'Content-Disposition': f'attachment; filename="{component}.{format}"'})

@router.get('/compare')
def compare(court: str, start: str, end: str, districts: str='', svc=Depends(service)):
    if any((not re.fullmatch('\\d{4}-(0[1-9]|1[0-2])', x) for x in (start, end))) or start > end:
        raise HTTPException(422, 'Choose an ordered month range.')
    snapshot = svc.repo.active()
    if not snapshot or court not in {c['id'] for c in json.loads(snapshot['config'])['courts']}:
        raise HTTPException(404, 'Unknown court')
    chosen = tuple(dict.fromkeys(x for x in districts.split(',') if x))
    known = svc.repo.districts()
    if any(x not in known for x in chosen):
        raise HTTPException(404, 'Unknown district')
    if chosen and len(chosen) < 2:
        raise HTTPException(422, 'Choose two or more districts to compare.')
    return svc.compare(start, end, court, chosen)

@router.get('/compare/measure')
def compare_measure(metric: str, start: str, end: str, a_district: str, a_court: str, b_district: str, b_court: str, side: Literal['all', 'civil', 'criminal', 'unknown']='all', type: list[str]=Query([], max_length=PAIR_NAME_CAP), limit: int=Query(6, ge=1, le=20), svc=Depends(service)):
    from app.compare import PAIR_METRICS
    if metric not in PAIR_METRICS:
        raise HTTPException(404, 'Unknown measure')
    if any((not re.fullmatch('\\d{4}-(0[1-9]|1[0-2])', x) for x in (start, end))) or start > end:
        raise HTTPException(422, 'Choose an ordered month range.')
    known = svc.repo.districts()
    specs = []
    for district, court in ((a_district, a_court), (b_district, b_court)):
        if district not in known:
            raise HTTPException(404, 'Unknown district')
        if court not in {c['id'] for c in json.loads(svc.repo.active(district)['config'])['courts']}:
            raise HTTPException(404, 'Unknown court')
        specs.append((district, court))
    return svc.compare_measure(metric, start, end, specs[0], specs[1], side, tuple(dict.fromkeys(type)), limit)

@router.get('/report')
def report():
    return FileResponse(REPORT_PATH, media_type='application/pdf')


@router.get('/compare/filing-flow')
def filing_flow(start: str, end: str, a_district: str, a_court: str,
                b_district: str, b_court: str,
                type: list[str] = Query([], max_length=3), svc=Depends(service)):
    from app.components.calculations import calculate_filing_comparison
    if any(not re.fullmatch(r'[1-9]\d{3}-(0[1-9]|1[0-2])', value) for value in (start, end)) or start > end:
        raise HTTPException(422, 'Choose an ordered month range.')
    start_year, start_month = map(int, start.split('-'))
    end_year, end_month = map(int, end.split('-'))
    if (end_year-start_year)*12 + end_month-start_month >= 600:
        raise HTTPException(422, 'Choose at most 600 months.')
    for district, court in ((a_district, a_court), (b_district, b_court)):
        snapshot = svc.repo.active(district)
        if not snapshot:
            raise HTTPException(404, 'Unknown district')
        if court not in {c['id'] for c in json.loads(snapshot['config'])['courts']}:
            raise HTTPException(404, 'Unknown court')
    with svc.lock:
        return calculate_filing_comparison(svc.repo, start, end,
                                          (a_district, a_court), (b_district, b_court), tuple(type))
