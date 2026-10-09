# Docket Intelligence — raw CSV edition

A modular FastAPI/SQLite (in-memory by default) dashboard preserving the Docket Intelligence reference interface. Calculations use normalized case and hearing records plus configured monthly working-day counts; the browser only requests and renders results.

## Run locally

```sh
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8081
```

Open http://127.0.0.1:8081.

**The database is in memory by default.** On startup the app reads the CSVs in `Source_Data_For_Analysis/` into an in-memory SQLite database (about 25 s for both districts, roughly 0.3 GB of RAM) and serves requests once that finishes. Nothing is written to disk, so there is no database file to commit and no 100 MB GitHub limit to hit. The data is rebuilt on every start; an import failure for one district is logged, `/api/v1/health` reports `degraded`, and the other districts still load.

`python -m app.cli` is a validate-only dry run in this mode: it imports the CSVs, prints the per-district result, and discards the database.

### Optional: keep a database file on disk

Set `COURTS_DB_PATH` (or pass `--db` to the CLI) to use a file. File mode behaves as before: import explicitly, startup never replaces data, an unchanged source/config hash is a no-op, and a failed import leaves the previous snapshot active. The file is git-ignored.

```sh
export COURTS_DB_PATH=var/raw-courts.sqlite3
python -m app.cli
python -m uvicorn app.main:app --host 127.0.0.1 --port 8081
```

Note that every config or CSV change in file mode adds a *new full snapshot* to the file and old ones are never pruned, which is how a clean ~0.2 GB database can grow to several GB. Delete the file and re-import to reset it.

`COURTS_SOURCE_DIR`, `COURTS_DB_PATH`, and `COURTS_CONFIG` override source folder, database and court configuration. Defaults are the project-local `Source_Data_For_Analysis`, `:memory:`, and `config/courts.json`. The original `var/courts.sqlite3`, CSVs, workbooks and report PDF remain untouched.

## Pushing to GitHub

GitHub rejects any file over 100 MB, and `.gitignore` already excludes databases (`*.sqlite3`, `*.db`, WAL/SHM files). If a push is ever rejected with `GH001: Large files detected`, do **not** just `git rm --cached` and commit again: the file is still inside the earlier unpushed commit, so the push keeps failing. Run:

```sh
scripts/fix_git_push.sh --dry-run   # show the offending files and which commits are affected
scripts/fix_git_push.sh             # strip them from the unpushed commits only; messages and your files are kept
git push
scripts/fix_git_push.sh --cleanup   # after a successful push: remove the safety backup and shrink .git
```

Add `--install-hook` to block oversized files at commit time. Commits already on GitHub are never rewritten.

## Structure and extension

- `app/ingestion/raw.py`: validated CSV imports, provenance, atomic snapshots.
- `app/repository.py`: normalized persistence (in-memory shared connection or file); no display logic.
- `app/bootstrap.py`: imports the configured district folders; used by the CLI and by in-memory startup.
- `app/domain/`: cohort queries, working-day calendar, reusable statistics. No plot imports.
- `app/components/`: independent calculation modules and `registry.json`.
- `app/processing/service.py`: snapshot/version/filter-aware bounded caches.
- `app/api/routes.py`: validation, versioned read APIs and server-generated exports.
- `app/static/js/components/`: one renderer per component; shared chart presentation and zoom utilities are outside these modules.

To add a plot, create a backend module with `calculate(context, Options) -> Result`, create its renderer exporting `render(data)`, add its styled container with `data-component="yourKey"`, and register module, renderer URL, canvas and filter group in `registry.json`. Never call another component: reuse domain primitives. Update approved definitions and tests for any new metric.

To remove a plot, delete its registry entry and its Python/JS modules. Its declarative container is hidden automatically. Other components and court exports do not depend on it. Remove its unused markup if permanently retired. Restart after registry/code changes.

The frontend has no analytical calculations. It retains chart-layout math (pixel sizing, zoom, rendering) and display formatting. Components load independently; stale requests are aborted and version checked. Errors stay in the affected panel.

## API

Interactive schema: `/docs`. Read endpoints: `/api/v1/metadata`, `/options`, `/components/{component}`, `/methodology`, `/health`, `/report`, `/exports/{component}`.

Filter query: `court`, `start=YYYY-MM`, `end=YYYY-MM`, optional `district`, comma-separated court-local `types`, `smoothing=actual|ma12`, and register `side`, `search`, `page`. Invalid ranges and unavailable case types return 422. Removed components return 404. Exports support xlsx, csv and json; `/exports/court` returns a complete JSON summary. No public import/upload endpoint remains.

The normalized database contains source records and identifiers; APIs expose aggregate results only. Run on localhost as documented. Chart.js and jsPDF currently use the reference dashboard's CDN delivery; the web interface requires access to those CDN assets.

## Validation and rollback

```sh
.venv/bin/python -m pytest -q
node tests/frontend_contract.mjs
```

See `docs/METHODOLOGY.md`, `docs/VALIDATION.md`, and `docs/reference/` for approved calculations, verification findings, and the frozen reference assets. Historical review documents describe the previous workbook edition, not this implementation.

Imports preserve previous snapshots in the new database. To reactivate a previously imported exact source/config set, import it again. The original workbook database is retained separately for rollback; no schema conversion was applied to it.

## Districts

`config/districts.json` lists district names, source subfolders and extraction dates; shared court definitions are in `config/courts.json`. Each district has its own active snapshot. Case IDs, court-local type codes, calendars, caches and exports remain isolated by snapshot. Adding a district needs a configuration entry and the six CSV tables per court, followed by an explicit import.

Import all configured districts with `.venv/bin/python -m app.cli`, or just Bankura with `.venv/bin/python -m app.cli --district Bankura`. Choose the district in the Selection panel; the header, accent colour and context bar change with the district. The Overview tab has a Comparison panel (by court and by case type) covering all configured districts. Metadata and health accept `?district=Bankura`; component and export requests use the same district filter. Failed imports retain that district's prior snapshot without changing other districts.

Bankura's source notes flag incomplete hearings before May 2015 and missing October 2016. As approved, all recorded values remain in calculations with a visible source-quality warning, included in result/export metadata. No filing cut-off (none is defined for Bankura) or additional missing-month exclusions are applied. Daily duration calculations retain the raw-activity calendar. Bankura monthly arrival and hearing rates use the supplied working-day Excel workbook.

### Monthly working-day workbooks

Bankura's `monthly_working_days` entry in `config/districts.json` maps court IDs to workbook sheets and enables `arrival_rate` and `hearing_rate`. The importer reads only the Month and Working days columns and preserves source hashes and cell-row provenance. Workbook failures retain the prior district snapshot. Missing/zero monthly counts produce gaps; they never fall back to raw-activity counts. CSV dates still determine exact elapsed working-day durations.

Purba Medinipur has its own `monthly_working_days` entry and workbook (`Source_Data_For_Analysis/Purba Medinipur/Working_days_court_wise.xlsx`, built from the district's `Monthly_<court>.xlsx` working-day sheets). The earlier byte-copy of Bankura's file is kept, inactive, under `_superseded/`.

Both districts set `require_monthly_working_days: true` in `config/districts.json`. For such a district the import fails, and the previous snapshot is retained, if the workbook entry is missing, does not cover both `arrival_rate` and `hearing_rate`, lacks a court sheet, or is byte-identical to another district's workbook. Activity-inferred working days are therefore never used silently for monthly rates. Districts without the flag keep the legacy CSV-activity fallback (used by the test fixtures).

### Listing cut-offs (digitization artefact)

`listing_cutoffs` in `config/districts.json` maps court IDs to an ISO date. Cases filed before that date are excluded from four case-level measures only: first-listing gap, hearings per disposed case, and both case-wise hearing rates (hence the Case Complexity X and Y axes). Filings, arrivals, disposal and monthly hearing throughput are never cut off. Purba Medinipur: CJM 2017-01-01; CJ (Jr.), CJ (Sr.), DJ 2015-01-01. Bankura has none because its source defines none. The cut-off, its measures and the per-measure exclusion count (`excluded.before_listing_cutoff`) appear in API metadata, result/export metadata and the page footnote. Verify with `python scripts/verify_cutoffs_and_working_days.py`.
