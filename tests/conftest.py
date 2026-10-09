import csv
import copy
from pathlib import Path
import pytest
from app.config import configuration
from app.repository import Repository
from app.ingestion.raw import import_snapshot, SCHEMAS

@pytest.fixture
def source(tmp_path):
    config = copy.deepcopy(configuration())
    config['courts'] = config['courts'][:1]
    folder = tmp_path / 'source' / 'cjm'
    folder.mkdir(parents=True)

    def write(name, items):
        fields = sorted(SCHEMAS[name])
        with (folder / name).open('w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(items)

    def case(id, filing, decision='', listing='', code='1'):
        return dict(cino=id, regcase_type=code, date_of_filing=filing, dt_regis=filing, date_first_list=listing, date_of_decision=decision, disp_nature='1')
    write('case_type_t.csv', [dict(case_type='1', type_name='Alpha', type_flag='2'), dict(case_type='2', type_name='Beta', type_flag='1')])
    write('disp_type_t.csv', [dict(disp_type='1', disp_name='Disposed', national_code='D')])
    write('civil_t.csv', [case('A', '2017-01-02'), case('P', '2017-01-04', listing='2017-01-05'), case('L', '2017-01-05', '2017-02-02', '2017-02-01'), case('INVALID', 'bad-date')])
    write('civil_t_a.csv', [case('A', '2017-01-02', '2017-01-06', '2017-01-03'), case('B', '2017-01-03', '2017-01-03', '2017-01-03', '2'), case('OLD', '2016-12-31', '2017-01-06', '2017-01-03'), case('NEG', '2017-01-06', '2017-01-02', '2017-01-02', '2')])
    write('daily_proc.csv', [dict(cino='A', todays_date='2017-01-03'), dict(cino='A', todays_date='2017-01-03'), dict(cino='A', todays_date='2017-01-06'), dict(cino='A', todays_date='2017-01-07'), dict(cino='P', todays_date='2017-01-05'), dict(cino='L', todays_date='2017-02-01'), dict(cino='ORPHAN', todays_date='2017-01-09')])
    write('daily_proc_a.csv', [dict(cino='A', todays_date='2017-01-03'), dict(cino='A', todays_date='2017-01-01')])
    repo = Repository(tmp_path / 'test.sqlite3')
    result = import_snapshot(repo, folder.parent, config)
    return (repo, folder.parent, config, result, write)
