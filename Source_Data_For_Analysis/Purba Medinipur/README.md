# Source data used in the Purba Medinipur (Tamluk) Courts analysis

Only the tables and columns actually used across the analysis are included here, extracted from
the four courts' eCourts / CIS case-management databases. One folder per court:
`cjm`, `district_judge`, `civil_judge_sr`, `civil_judge_jr`.

## Tables, columns, and which analysis section each feeds

### civil_t.csv (live / pending cases) and civil_t_a.csv (disposed / archived cases)
Master case tables; a case appears in exactly one of the two (no cino overlap), so their union is
the full case list. Columns:
- `cino`            — universal case id; join key to daily_proc / daily_proc_a.
- `regcase_type`    — case-type code; join to `case_type_t.case_type`.
- `date_of_filing`  — ARRIVAL RATE (Sec 1 / 2); the 2010 analysis window; and the working-day calendar.
- `dt_regis`        — registration date; feeds the working-day calendar (days of genuine court activity).
- `date_first_list` — first-listing date; FILING -> FIRST-LISTING GAP (Sec 3); basis of the digitization cut-off.
- `date_of_decision`— decision date; TIME TO DISPOSAL (Sec 5); and the working-day calendar.
- `disp_nature`     — disposal-nature code; decode with `disp_type_t`; drives the "M.P" anomaly (Sec 7).

### case_type_t.csv (case-type lookup)
- `case_type`, `type_name` (label), `type_flag` (1 = Civil, 2 = Criminal).
- Used for CASE-TYPE SEGREGATION and the Civil/Criminal side in EVERY section.

### daily_proc.csv (proceedings for live cases) and daily_proc_a.csv (proceedings for archived cases)
- `cino`, `todays_date` (the date of each hearing / proceeding).
- NUMBER OF HEARINGS and RATE OF HEARINGS (Sec 4); and the working-day calendar.

### disp_type_t.csv (disposal-nature lookup — decodes disp_nature)
- `disp_type` (code), `disp_name` (label), `national_code` (eCourts national code), `contested_uncontested`.
- Sec 7 (M.P) and any disposal-nature breakdown.
- NOTE: codes are ESTABLISHMENT-SPECIFIC — the same number can mean different things across courts;
  use `national_code` for cross-court comparisons.

## Notes
- Dates are text, `YYYY-MM-DD`; empty = null.
- Working-day calendar = union of filing / registration / decision / hearing dates on rule-allowed days
  (Mon-Sat excl. Sundays and 2nd & 4th Saturdays). See `Working_days_court_wise.xlsx`.
- Cut-offs (listing-dependent measures): CJM 2017-01-01; DJ / CJ (Sr.) / CJ (Jr.) 2015-01-01.
- Data extracted up to 20 July 2026; analyses cap at June 2026 (last complete month).
