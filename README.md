# District Courts Intelligence Platform

Flask dashboard backed by Excel workbooks in the Data folder. Each subfolder
is an independent district; each Monthly_<court>.xlsx file is one court.
The application discovers districts and courts automatically.

## Run

```sh
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000. Select a district, then a court. The district
selection is saved in the page URL. Exports include district and court identity.

The default source is Data beside app.py, regardless of the current working
directory. Set DATA_DIR to an absolute path to use another data folder.

## Add or update a district

```text
Data/
  Purba Medinipur/
    Monthly_CJM.xlsx
    Monthly_DJ.xlsx
    Monthly_CJ_Sr.xlsx
    Monthly_CJ_Jr.xlsx
  Another District/
    Monthly_CJM.xlsx
    Monthly_Other_Court.xlsx
```

1. Create a district folder with the display name you want.
2. Add workbooks using the same sheet and column layout as the supplied files.
3. Reload the dashboard. No Python or JavaScript changes are needed.

Court codes come from filenames. CJ_Sr and CJ_Jr retain the existing
CJ (Sr.) and CJ (Jr.) API codes. Full court names come from Definitions.
Excel lock files and hidden folders are ignored. Only Monthly_*.xlsx files
are imported. Do not put multiple exports for the same court in a district.

Replace completed workbooks atomically when updating a running deployment.
Each request checks filenames, modification times, and sizes; changed files
invalidate the district cache. Only the requested district is parsed. Each
worker caches up to 32 district versions in memory. Restart if a replacement
deliberately preserves both timestamp and size. Deployments must include Data
or mount it and set DATA_DIR. No database or background ingestion service is required.

## Workbook contract and metrics

Required sheets:

- Definitions: court name in the first populated row; Court cut-off and
  Scope / window supply the listing cutoff and extraction date.
- Arrival: Case type, Side, Filings, Mean/mo, Median/mo, Max/mo, Daily rate.
- Gap_workdays, Hearings_X, Disposal_workdays: Case type, Side, N, Mean,
  Median, 75th, 90th, 95th.
- Hearing_rate_monthly: Case type, Side, Mean, Median, 75th, 90th, 95th.
- Exactly one Arrival_panel_* sheet: Month in YYYY-MM format followed by
  case-type columns. The suffix is not restricted to 198mo.

Summary-table headers are located by the Case type cell, so title rows are
allowed. All case types are imported and arrivals are sorted by total filings.
Summary statistics are read as reported, not recalculated from rounded
aggregates. The trend uses actual monthly counts for the leading case type.
No simulated values are generated. If that case type has no panel column,
the trend is unavailable. Blank panel observations remain null chart gaps.

Reporting windows and observed-month counts come from each court's panel.
District metadata reports their union. Missing numeric summary measures
(dashes or blanks) remain null, including missing daily rates; zero stays zero.
Missing extraction dates and cutoffs are identified as not provided.
Formulas must have saved calculated values; the importer does not calculate Excel formulas.

Invalid required headers, duplicate case types/months, malformed numeric
values, unreadable files, or empty arrivals produce an actionable 503 error
with the source filename. They are never replaced with embedded fallback
data. A malformed district does not prevent reading another district.
Other sheets, including Hearing_rate_casewise and HearingRate_panel_*,
remain in the source workbooks and are not currently displayed.

## API

- GET /api/districts: available district IDs and names (folder names).
- GET /api/districts/<district>/meta: district metadata and court totals.
- GET /api/districts/<district>/court/<code>: full court data.
- GET /api/districts/<district>/court/<code>/trend: actual filing series.
- GET /api/districts/<district>/court/<code>/insights: derived observations.

The Hearing Rates tab compares the two workbook hearing-rate measures. It
shows a monthly hearing-rate time series (hearings per working day) beside
reported mean/median summary bars, plus case-wise hearing-rate summary bars
(hearings per elapsed working day). Each plot shares a selector limited to
five case types.

The Case Register shows ten rows per page and can be filtered to all, Civil,
or Criminal cases. Pagination ranges update after filtering.

URL-encode district names and court codes. Existing /api/meta and
/api/court/<code> routes (including trend and insights) accept ?district=<name>.
Without a district, they select the first folder alphabetically. Unknown
districts and courts return 404.

## Validation

```sh
python -m unittest discover -s tests -v
node --check static/js/intelligence.js
```

Tests use disposable copies of supplied workbooks to verify source totals,
actual trends, two districts sharing a court code, changed-file refresh,
missing values, malformed files, and API errors.
