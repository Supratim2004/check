# Migration verification — 4 October 2026

## Reference and preserved behavior

Frozen reference assets are in `docs/reference/`, copied from `/Users/supratim/Documents/GitHub/check`. The reference project was read only and its running service on port 8080 was not changed. The migrated project runs separately on port 8081.

Inventory: Overview distribution/percentile/ranking panels; Filing Trends counts, daily rates, smoothing, case-type selection and observations; Timeliness disposal, first listing and delay flags; Hearing Rates monthly series, monthly/case-wise percentiles and observations; Case Complexity bubble plot, selection/reset, legends and observations; Case Register jurisdiction filter and pagination; per-chart zoom/PDF/Excel; complete court JSON export. Date controls and register search were added. CSS and zoom behavior come from the reference. Data-source wording and approved analytical descriptions were corrected.

Six same-fixture renderer comparisons verify identical chart types, labels, plotted data, colours, border styles, responsiveness and aspect-ratio settings. These are chart configuration comparisons, not a claim of exhaustive pixel equivalence across browsers. The original desktop overview and migrated overview were visually inspected. Changed values and the added date controls necessarily change some text and sidebar height.

## Automated checks

`python -m pytest -q` covers CSV validation, pending/archived overlap, hearing deduplication, invalid dates, date bounds, cut-offs, working Saturdays/Sundays, same-day events, unresolved/later decisions, zero hearing counts, percentiles, selected-window smoothing, working-day denominator independence, empty cohorts, atomic import failure, cached snapshot replacement, all component endpoints, three export formats, and removal of each of 17 components while every other module continues working.

`node tests/frontend_contract.mjs` compares six renderer contracts against identical fixture values and checks that all 17 frontend modules are independent.

`python scripts/verify_snapshot.py` independently reads the CSV case tables and compares API filing totals for all four courts across the full period and January–March 2026. Results are in `docs/reconciliation.json`.

## Source reconciliation

| Court | Workbook filings | Raw CSV filings | Additional unknown/unclassified filings |
|---|---:|---:|---:|
| CJM | 61,638 | 63,806 | 2,168 |
| CJ (Jr.) | 6,938 | 7,213 | 275 |
| CJ (Sr.) | 6,559 | 6,724 | 165 |
| DJ | 67,105 | 67,880 | 775 |
| Total | 142,240 | 145,623 | 3,383 |

Known Civil/Criminal filing totals match the workbook totals exactly for every court. The raw edition includes unknown case-type codes and missing classifications instead of dropping those cases. The imported snapshot has 157,820 distinct court/case records, including records outside the selected analysis filing window.

Duration and hearing results need not equal the workbook: they are recomputed using the approved explicit interval boundaries, calendar, cut-offs, raw percentiles and date filtering. Historical workbook numbers are not forced into the new calculations.

## Browser checks

Verified all six tabs; full-period and January–March 2026 filtering; 12-month smoothing selection; complexity chart and live zoom/open/in/reset/close; case-register next-page and search; Excel download and its worksheet/date metadata; PDF chart download. CJM January–March 2026 shows 1,053 filings. The reference's external Chart.js/jsPDF delivery is retained. At a 390×844 viewport, document width is 390 pixels with no page-level horizontal overflow. No browser error/warning logs were recorded during the exercised interactions.

## Limits

This remains a local descriptive analysis application. Source snapshot completeness is declared by the configured complete-month bounds; a zero count inside those bounds assumes the supplied CSV snapshot is complete. No forecasts, reconstructed historical status transitions, survival correction or inferred missing events are introduced. `/api/v1/health` exposes source quality counters; missing dates are reported rather than guessed. Existing test-client libraries emit upstream deprecation warnings, but tests complete successfully.

## Cut-off removal update

At the user’s request, all historical filing cut-offs were removed from hearing and first-listing calculations (definition v3). Older records within the selected filing range now contribute to rates, durations, complexity and exports. Earlier descriptions of cut-off exclusions above refer to the initial migration. Selected date bounds, event validity, and zero-denominator checks still apply.

## Bankura addition — 4 October 2026

Both districts now import from the project-local `Source_Data_For_Analysis/<district>` folders, with separate active snapshots. Added tests for identical case IDs across districts, cache/result/export isolation, district-specific failure recovery, and legacy single-district activation migration. All 28 backend tests pass; six same-fixture frontend chart contracts and all 17 independent renderer modules pass.

Independent source reconciliation matches all 16 district/court/window filing totals (full range and January–March 2026). Bankura full-range totals: CJM 49,274; CJ (Jr.) 6,925; CJ (Sr.) 5,041; DJ 31,915. Results are in `reconciliation.json`. The existing Purba CSVs in the local folder match the original source hashes.

The user approved retaining Bankura's recorded hearing values without coverage exclusions, accompanied by a visible warning for incomplete pre-May-2015 records and missing October 2016. The warning is carried in API results and tabular export metadata. No historical filing cut-offs apply.

All 136 Bankura real-data component/export comparisons passed (17 components × four courts × two date windows). Live browser checks passed for district switching, Bankura's extraction date and warning, date filtering (CJM January–March 2026: 1,562 filings), restored Purba totals, and Bankura chart zoom. No browser warnings/errors were reported. Preview: `screenshots/bankura.jpg`.

## Monthly Excel working days — 4 October 2026

38 backend tests pass, including workbook parsing, month/annual-column separation, duplicate/invalid counts, missing/zero denominators without fallback, source-hash invalidation, import failure recovery, export consistency and preservation of daily durations. Existing frontend contracts pass. Independently checked 4,752 Bankura rate values against workbook monthly counts and direct normalized record queries (both monthly rates, all four courts, three leading types, 198 months); chart JSON exports matched. See `working-day-verification.json`.

Bankura's monthly denominators now use its Excel file. Purba's copied Bankura workbook remains inactive pending user replacement; Purba keeps CSV-derived counts with a visible notice. Exact duration calendars remain CSV-based in both districts. Source spreadsheets were read without modification.

## Definition v5 — cut-offs and working days (reconciliation against the workbook dashboard)

Reproduce: `python scripts/verify_cutoffs_and_working_days.py --reference "<check-main>/Data/Purba Medinipur" --out docs/cutoff-working-day-verification.json`.

**Working days.** Monthly working days in the Excel sources equal the days derived from raw CSV activity in all 198 months for all four courts of both districts (0 differing months). Replacing Purba's copied-Bankura workbook with its own therefore leaves every Purba rate numerically unchanged.

**Before/after on the real snapshots (full window, all case types).** Bankura: arrivals, gap, hearings, both case-wise rates, monthly rate and disposal identical for all four courts. Purba Medinipur: arrivals, monthly rate and disposal identical; gap, hearings and both case-wise rates change for the case types that have pre-cut-off cases (e.g. CJM 24 of 27 types).

**Agreement with the workbook dashboard (leading case types, v4 = no cut-off, v5 = cut-off).**

| Court / type | Measure | Workbook N, median | v4 N, median | v5 N, median |
|---|---|---|---|---|
| CJM Gr Case | gap | 22,047; 45 | 30,269; 69 | 21,067; 44 |
| CJM Gr Case | hearings/case | 8,901; 1 | 14,762; 3 | 8,806; 1 |
| CJ (Sr.) Title Suit | hearings/case | 1,097; 16 | 1,769; 13 | 1,084; 16 |
| DJ Electricity Act | hearings/case | 8,115; 3 | 10,013; 3 | 8,114; 3 |

Case-wise N (working-day basis), CJM Gr Case: workbook 6,816; v4 12,679; v5 6,736. The monthly hearing-rate panel is not cut off in the workbook either (see METHODOLOGY, Definition v5).

**Automated tests.** `tests/test_cutoffs_and_working_days.py` adds 18 tests: cut-off scope (the four measures only), boundary day, range wholly before the cut-off, metadata/summary/export reporting, invalid cut-off or working-day policy failing the import while keeping the prior snapshot, no activity fallback, rejection of a workbook copied from another district, and the shipped district configuration and Purba workbook. Each rule was mutation-checked (removing it makes a test fail).

**Known gaps.** Bankura has no source-defined cut-off, so none is applied; its pre-May-2015 coverage warning remains the only caveat. The per-chart cut-off tag and footnote are verified by `node --check` and by API metadata tests, not by a browser run.

