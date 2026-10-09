# Source data used in the Bankura Courts analysis

Only the tables and columns actually used across the analysis are included here, extracted from
the 4 courts' eCourts / CIS case-management databases. One folder per court:
`cjm`, `district_judge`, `civil_judge_sr`, `civil_judge_jr`.

## Tables, columns, and which analysis section each feeds

### civil_t.csv (live / pending cases) and civil_t_a.csv (disposed / archived cases)
Master case tables; a case appears in exactly one of the two (no cino overlap), so their union is
the full case list. Columns:
- `cino`            — universal case id; join key to daily_proc / daily_proc_a.
- `regcase_type`    — case-type code; join to `case_type_t.case_type`.
- `date_of_filing`  — ARRIVAL RATE (Sec 1); the analysis window; and the working-day calendar.
- `dt_regis`        — registration date; feeds the working-day calendar (days of genuine court activity).
- `date_first_list` — first-listing date; FILING -> FIRST-LISTING GAP (Sec 2); basis of the digitization cut-off.
- `date_of_decision`— decision date; TIME TO DISPOSAL (Sec 5); and the working-day calendar.
- `disp_nature`     — disposal-nature code; decode with `disp_type_t`.

### case_type_t.csv (case-type lookup)
- `case_type`, `type_name` (label), `type_flag` (1 = Civil, 2 = Criminal).
- Used for CASE-TYPE SEGREGATION and the Civil/Criminal side in EVERY section.

### daily_proc.csv (proceedings for live cases) and daily_proc_a.csv (proceedings for archived cases)
- `cino`, `todays_date` (the date of each hearing / proceeding).
- NUMBER OF HEARINGS (Sec 3) and RATE OF HEARINGS (Sec 4); and the working-day calendar.

### disp_type_t.csv (disposal-nature lookup — decodes disp_nature)
- `disp_type` (code), `disp_name` (label), `national_code` (eCourts national code), `contested_uncontested`.
- Any disposal-nature breakdown.
- NOTE: codes are ESTABLISHMENT-SPECIFIC — the same number can mean different things across courts;
  use `national_code` for cross-court comparisons.

## Notes
- Dates are text, `YYYY-MM-DD`; empty = null. Files are UTF-8, CRLF, comma separated.
- Window: 2010-01 to 2026-06. The extract runs to 2026-08; the last 2 complete months are held back so every district in the project covers the same most-recent month.
- Cut-offs (listing-dependent measures): CJM / DJ / CJ (Sr.) 2015-01-01; CJ (Jr.) 2016-01-01.
- Hearing records are complete only from 2015-05;
  earlier months show few or no hearings because none were recorded, not because none were held.
- Months excluded as missing: 2016-10 (recorded per court in the district file; treated as missing, never as zero).
- Working-day calendar = union of filing / registration / decision / hearing dates on rule-allowed days
  (Mon-Sat excl. Sundays and 2nd & 4th Saturdays). The calendar the analysis used is included
  here as `Working_days_court_wise.xlsx` — one sheet per court, working days per month with
  per-year totals. Rates are per working day, and gap and disposal are counted in working days,
  so this workbook is needed to reproduce any of them.
- Data extracted 2026-09-28.
