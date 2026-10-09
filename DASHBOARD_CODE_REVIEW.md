# Dashboard Code Review and Methodology Audit

**Review date:** 30 September 2026  
**Scope:** FastAPI service, workbook ingestion, SQLite persistence, analytics layer, browser dashboard, exports, and supplied Purba Medinipur source snapshot.

## Executive assessment

The dashboard is analytically careful for descriptive reporting from pre-aggregated court workbooks. It validates workbook structure, preserves source cohorts, reconciles monthly panels to arrival totals, records source rows, hashes imported files, and explicitly avoids inventing case-level data. The methodology page also communicates several important limitations that are often hidden in operational dashboards.

It is not yet production-ready as a multi-district or externally deployed system. The highest risks are the unauthenticated workbook import/replacement endpoint, hard-coded Purba-specific methodology text in a supposedly extensible dashboard, and silent serving of stale database data when a source workbook changes. The trend rendering and absence of automated tests create additional analytical and regression risk.

**Overall rating:** suitable for trusted local exploration and source-cohort reporting; requires security, provenance, portability, and test improvements before deployment as a shared production service.

### Strengths

- Workbook ingestion is schema-aware and rejects malformed, oversized, non-consecutive, or internally inconsistent input.
- Monthly arrival panels are reconciled against the corresponding `Arrival.Filings` totals before persistence.
- Source values are retained rather than recomputed from unavailable case-level records.
- Combined means are explicitly N-weighted and described as approximate because source means are rounded.
- Medians and percentiles are not incorrectly pooled across courts or case types.
- The interface distinguishes monthly throughput from case-wise hearing intensity and warns that chart date controls do not recompute summary cohorts.
- CSV export applies spreadsheet-formula-injection protection to string values.

## System and data flow

1. **Source files** are read from `Data/<district>/Monthly_<court>.xlsx` by `app/ingestion/service.py`.
2. **Workbook validation** in `app/ingestion/workbook.py` checks required worksheets, headers, numeric values, case-type/side consistency, month continuity, matching panel layouts, and arrival-panel totals.
3. **Normalization** produces a `CourtDataset` containing source metadata, summary rows, monthly points, definitions, a SHA-256 digest, reporting range, and warnings.
4. **Persistence** in `app/repository.py` stores dataset metadata, JSON summary rows, normalized monthly points, and import history in SQLite. Re-importing the same digest is a no-op; replacing changed data requires an explicit flag.
5. **API access** in `app/api/routes.py` exposes catalog, overview, summary, time-series, CSV export, upload, health, and original-report endpoints.
6. **Analytics** in `app/processing/analytics.py` calculates N-weighted means, panel coverage, monthly trends, and additive arrival aggregates. Hearing rates are intentionally not added across courts because each retains its own working-day denominator.
7. **Browser rendering** in `app/static/app.js` consumes API responses and renders KPI cards, tables, distributions, charts, source metadata, and methodology text.

No application source files were modified for this review. The review is based on the current workspace snapshot, which is not a Git repository; therefore, no commit history or diff-based regression analysis was available.

## Data-source inventory

### Supplied workbooks

The repository contains four source workbooks under `Data/Purba Medinipur/`:

| File | Court | Window | Arrival rows | Panel case types |
|---|---|---:|---:|---:|
| `Monthly_CJM.xlsx` | Chief Judicial Magistrate | Jan 2010–Jun 2026 | 26 | 8 |
| `Monthly_CJ_Jr.xlsx` | Civil Judge (Jr. Div.) | Jan 2010–Jun 2026 | 19 | 4 |
| `Monthly_CJ_Sr.xlsx` | Civil Judge (Sr. Div.) | Jan 2010–Jun 2026 | 28 | 3 |
| `Monthly_DJ.xlsx` | District Judge | Jan 2010–Jun 2026 | 55 | 13 |

Each workbook covers 198 months and contains:

- `Definitions`
- `Arrival`
- `Gap_workdays`
- `Hearings_X`
- `Hearing_rate_monthly`
- `Hearing_rate_casewise`
- `Disposal_workdays`
- one arrival monthly panel
- one monthly hearing-rate panel

The supplied definitions identify 20 July 2026 as the extraction date and June 2026 as the last complete month. The original PDF report is available at `Purba_Medinipur_Courts_Monthly_Report_v2.pdf` and is exposed through `/api/report`.

### Imported SQLite snapshot

The current database snapshot contains:

- 4 datasets
- 422 summary rows
- 11,088 monthly points across the arrival and hearing-rate panels
- 4 import-history records
- 142,240 total source filings
- 137,116 filings represented in monthly panels
- 96.4% overall panel coverage by filings

Per-court panel coverage is 99.00% for CJM, 95.23% for CJ (Jr.), 79.23% for CJ (Sr.), and 95.80% for DJ. The lower CJ (Sr.) coverage is expected from the source rule that monthly panels include only higher-volume case types; it must not be interpreted as missing filings or zero activity.

### Provenance

The ingestion layer calculates a SHA-256 digest of each uploaded workbook and stores it with the dataset metadata and import history. Monthly points retain source sheet names, worksheet row numbers, case type, side, month, and value. Summary rows retain source row numbers and the metric/sheet identifier.

This is good lineage at the row level, but the database does not retain an immutable copy of the workbook itself. Reproducibility therefore depends on preserving the original files alongside the database or in an external artifact store.

## Methodology and formulas

The source workbook definitions are authoritative. The dashboard is a presentation and aggregation layer over those precomputed source statistics; it does not reconstruct cases, working-day calendars, or event histories.

### Monthly arrivals

For case type (c) and calendar month (m):

\[
A_{c,m} = \text{number of cases filed for case type } c \text{ in month } m
\]

The source `Arrival.Filings` value is the total over the full reporting grid:

\[
F_c = \sum_m A_{c,m}
\]

The ingestion validator enforces this equality for every case type represented in the monthly arrival panel. The panel does not include every case type; the source workbook limits panels to higher-volume case types.

### Panel coverage

The overview computes:

\[
\text{Panel coverage} =
100 \times \frac{\sum_{c,m} A_{c,m}^{\text{panel}}}
{\sum_c F_c^{\text{Arrival summary}}}
\]

This is a coverage indicator, not a clearance or completeness rate. A value below 100% reflects case types omitted from the monthly panels, not necessarily missing source data.

### Court working days

The source defines (W(m)) as rule-allowed days with genuine court activity: Monday–Saturday excluding Sundays and the second and fourth Saturdays, with activity represented by filing, registration, disposal, or hearing activity.

The supplied workbooks contain rates derived from (W(m)), but do not provide the working-day calendar or the underlying activity events. The dashboard correctly does not attempt to reconstruct (W(m)).

### Filing-to-first-listing gap

For a case (i):

\[
G_i = \text{court working days between filing and first listing}
\]

The source cohort excludes cases affected by the bulk-digitization artefact. The workbook cut-offs are 1 January 2017 for CJM and 1 January 2015 for the other supplied courts.

### Number of hearings per case

For a disposed, listing-unaffected case (i):

\[
X_i = \text{number of distinct hearing dates for case } i
\]

This is a per-case count, not monthly court throughput.

### Monthly hearing throughput

For case type (c) and month (m):

\[
H_{c,m} = \frac{h_{c,m}}{W(m)}
\]

where (h_{c,m}) is the number of hearings held in the month. Because (W(m)) is court-specific, rates from different courts are not additive. The implementation preserves each court’s rate series and does not produce a pooled hearing-rate line.

### Case-wise hearing intensity

For case (i), with (e_i) equal to elapsed filing-to-decision time:

\[
R_i^{WD} = \frac{X_i}{e_i^{WD}}, \qquad
R_i^{Mo} = \frac{X_i}{e_i^{calendar\ months}}
\]

Same-day disposals are excluded by the source methodology. The dashboard presents the working-day and calendar-month variants as separate source columns.

### Time to disposal

For disposed case (i):

\[
D_i = \text{court working days between filing and decision}
\]

The supplied cohort is for disposed cases filed from 2010 onward. Pending cases are not represented; therefore, the measure cannot establish backlog, clearance, or current pending inventory.

### Combined means

For source rows (i) with mean (μ_i) and sample size (N_i>0), the dashboard uses:

\[
\bar{x}_{weighted} =
\frac{\sum_i N_i\mu_i}{\sum_i N_i}
\]

Rows with missing means or non-positive/missing (N) are excluded. Since source means have already been rounded, combined means are approximate. Medians and percentiles cannot be reconstructed from summary rows and are deliberately not pooled.

### Trend lines

For monthly values (x_t), the dashboard calculates a trailing mean only after 12 complete observations:

\[
MA_t = \frac{1}{12}\sum_{j=t-11}^{t}x_j
\]

The fitted line uses an ordinary least-squares regression over non-null observations:

\[
\hat{y}_t = \bar{y} + \beta(t-\bar{t}),
\qquad
\beta = \frac{\sum_t(t-\bar{t})(y_t-\bar{y})}
{\sum_t(t-\bar{t})^2}
\]

The line is intended to be descriptive rather than predictive.

## Findings

Severity uses the following interpretation: **High** can compromise data integrity, security, or deployment correctness; **Medium** can materially mislead users or create operational risk; **Low** is primarily maintainability, portability, or documentation risk.

### F-01 — High: workbook ingestion and replacement are unauthenticated

**Location:** `app/api/routes.py:86-98`

`POST /api/ingest` accepts a workbook and can replace an existing district/court dataset when the `replace` form field is supplied. No authentication, authorization, CSRF protection, audit-user identity, rate limiting, or deployment-mode guard is present.

**Impact:** On a shared or externally reachable deployment, any caller who can reach the service can upload data, overwrite a court snapshot, or consume ingestion resources. The explicit replacement flag prevents accidental replacement but is not an access-control boundary.

**Recommendation:** Protect ingestion behind authentication and role-based authorization; require elevated permission for replacement; add CSRF protection when browser cookies are used; rate-limit uploads; record the acting user and reason; and consider immutable dataset versions instead of destructive replacement.

**Acceptance criteria:** unauthenticated upload returns 401/403; ordinary users cannot replace a dataset; authorized replacements create an auditable version record; upload and expanded-size limits remain enforced.

### F-02 — High: methodology text is hard-coded to the supplied Purba snapshot

**Location:** `app/static/app.js:91-100`

The methodology page hard-codes Jan 2010–Jun 2026, the CJM 2017 cut-off, the 2015 cut-offs for the other three courts, the 20 July 2026 extraction date, and Purba-specific source wording. The same application exposes workbook upload for other districts and courts.

**Impact:** A newly imported workbook can display methodology text that is false for its reporting window, extraction date, cut-off, or source definitions. This undermines the dashboard’s strongest feature—traceable source-cohort reporting—and creates a portability defect rather than a cosmetic documentation issue.

**Recommendation:** Expose definitions and reporting metadata through a dedicated API response or extend `/api/catalog` with structured definitions. Render the selected court’s window, cut-off, extraction date, inclusion rules, and available measures dynamically. For multiple selected courts, list each court’s value and explicitly identify conflicts.

**Acceptance criteria:** a fixture workbook with a different window and cut-off causes the methodology page to update without code changes; no Purba-specific dates remain in generic UI logic; displayed formulas and limitations come from stored definitions or documented generic rules.

### F-03 — Medium: changed source files can leave stale data active without a visible warning

**Location:** `app/main.py:12-18`, `app/ingestion/service.py:7-17`, `app/repository.py:51-69`

At startup, the application scans the data directory. If a workbook has changed and replacement is not enabled, ingestion returns an error result, but the application continues serving the previous database snapshot. The dashboard does not surface `startup_imports` to the user.

**Impact:** An operator can update a workbook, restart the service, and believe the dashboard reflects the new file while it continues serving older data. This is especially risky because the source directory is presented as a live data location.

**Recommendation:** Choose and document one explicit policy: fail startup on changed source files, or retain the old snapshot but show a prominent stale-source warning containing old/new digests and the required replacement action. Include source status in the catalog response and UI.

**Acceptance criteria:** a changed workbook produces a visible stale/error state; health checks distinguish healthy-current from healthy-stale; the dashboard never presents stale data as current without an explicit warning.

### F-04 — Medium: fitted trend values span null or out-of-coverage periods

**Location:** `app/processing/analytics.py:14-22`, `app/processing/analytics.py:25-42`, `app/static/app.js:62-69`

The OLS fit uses non-null values, but returns a fitted value for every requested month. When a series has null months because the selected date range extends outside its source window, the UI still draws a continuous fitted line through those months. The implementation describes the result as “never forecast,” but the visual can appear extrapolated.

**Impact:** Users may interpret the line as evidence for months where no source observation exists. This is most relevant when courts have different reporting windows or when a custom chart range extends beyond a court’s coverage.

**Recommendation:** Return fitted values only within the convex hull of valid observations, break the line across internal null gaps, and expose `fit_start`, `fit_end`, and `fit_n` in the API response. Label the line “descriptive fit over observed months.”

**Acceptance criteria:** no fitted line is drawn before the first or after the last observed point; null gaps are visually broken; tooltips identify the number and range of observations used.

### F-05 — Medium: no automated test suite protects the analytics contract

**Evidence:** `requirements-dev.txt` declares pytest, but the repository contains no `tests/` directory and `pytest -q` reports `no tests ran`.

**Impact:** Workbook parsing, aggregation, filtering, export, and chart API behavior can regress without detection. The most consequential formulas are compact enough that a small change can alter reported values silently.

**Recommendation:** Add unit tests for ingestion and analytics, API integration tests using a temporary SQLite database, and browser-level regression tests for methodology rendering and chart filtering.

**Acceptance criteria:** CI runs tests on every change; tests cover valid and invalid workbook fixtures, source reconciliation, weighted means, trend null handling, filters, exports, conflict/replacement behavior, and dynamic methodology metadata.

### F-06 — Medium: cross-court comparison remains easy to over-interpret

**Location:** `app/processing/analytics.py:45-61`, `app/static/app.js:36-48`, `app/static/app.js:89`

The dashboard does warn that case mix, cut-offs, and reporting windows limit comparison. However, overview KPIs and comparison tables still place N-weighted cohort means beside filings in a visually direct ranking. Selected courts may have different source windows, and the underlying duration, hearing, and listing populations are not the same as arrival populations.

**Impact:** A reader can treat a larger or smaller mean disposal time as a court performance ranking even though courts may differ in case mix, source period, digitization cut-off, and cohort composition.

**Recommendation:** Make the comparison view show cohort labels and sample sizes adjacent to every mean, display reporting-window mismatches prominently, and use language such as “source-cohort average” rather than performance-oriented labels. Consider disabling direct ranking when windows or cohort definitions differ materially.

**Acceptance criteria:** every comparison metric displays its source N and cohort; different windows produce a blocking or prominent comparability warning; documentation states that the dashboard is descriptive, not a causal or performance ranking system.

### F-07 — Low: reproducibility is dependent on external workbook retention

**Location:** `app/repository.py:60-68`

The database stores metadata and digests, but not the original workbook bytes. The full source file is therefore required to reproduce the exact import or investigate a disputed value.

**Recommendation:** For production use, retain immutable source artifacts in controlled storage or a versioned archive, link the database record to the artifact location, and include schema/version and import-actor metadata in the manifest.

## Analytical limitations that are correctly preserved

The following are not implementation defects; they are limits of the supplied source data and should remain explicit in user-facing documentation:

- There are no individual filing, listing, hearing, or decision records.
- The working-day calendar (W(m)) is not supplied.
- Monthly disposal counts cannot be reconstructed.
- Pending inventory, backlog, clearance rate, and disposal-flow rates cannot be calculated.
- Summary cohorts differ: arrivals, listing gaps, hearing counts, case-wise hearing rates, and disposal times are not interchangeable populations.
- Smaller case types may appear in summary sheets but not in monthly panels.
- Missing values mean unavailable or insufficient source data, not zero.
- Percentiles and medians are source-row statistics and cannot be pooled safely.
- The supplied workbook contains a wording distinction around the hearing-rate cut-off; the dashboard preserves source values rather than silently reapplying a rule.

## Recommended remediation order

1. **Protect ingestion and replacement** before any shared deployment.
2. **Make methodology metadata-driven** and add a regression fixture for a non-Purba workbook.
3. **Expose and handle stale source state** at startup and in the UI.
4. **Correct trend rendering around missing coverage.**
5. **Add the test suite** around ingestion, analytics, API behavior, and methodology rendering.
6. **Strengthen reproducibility** with immutable source-artifact retention and richer import manifests.

## Verification and acceptance test matrix

| Area | Required scenarios |
|---|---|
| Workbook ingestion | Missing sheet; invalid header; duplicate case type; invalid side; negative/non-finite value; non-consecutive month; duplicate month; mismatched panel headers; panel total mismatch; Excel lock file; expanded-size limit |
| Analytics | Empty rows; missing means; zero N; exact weighted mean; rounded source means; 12-point moving average; fewer than 12 points; internal null; leading/trailing null; one valid point; multi-court arrival aggregation; non-additive hearing-rate series |
| API | Unknown district/court; side and case filters; invalid month; reversed range; range limit; summary date-filter behavior; monthly export; empty export; upload conflict; authorized replacement; stale startup source |
| UI | Dynamic reporting window; court-specific cut-offs; selected-court window mismatch; panel coverage wording; unavailable versus zero; trend line over missing coverage; chart tooltip fit range; source digest and import status |
| Security | Unauthorized upload; unauthorized replacement; CSRF attempt where cookies are used; upload rate limit; oversized compressed/expanded workbook; formula-injection-safe CSV output |

## Final conclusion

The dashboard’s core analytical stance is sound: it treats the workbook as a precomputed source-cohort report, validates what can be validated, and avoids fabricating unavailable metrics. The most important improvements are not new statistical formulas; they are controls that ensure the displayed methodology and data state remain truthful when the system is uploaded, updated, shared, or extended beyond the four supplied courts.
