# Approved calculation definitions

Approved by the user section by section on 4 October 2026. Version: approved-2026-10-04-v4.

## Selection and observation

A selection identifies a court and inclusive filing months. Cases must have a valid filing date between the first day of the starting month and the last day of the ending month. All observations stop at that last day. Default complete window: January 2010–June 2026. The source was extracted through 20 July 2026; July is not included. Cases with missing/invalid filing dates are retained for provenance but excluded from filing cohorts. Court-local case-type codes remain distinct even when their display names match. As of definition v6 (9 October 2026), only cases explicitly classified as Civil (source type_flag 1) or Criminal (source type_flag 2) are included. Unknown, missing and other classifications are excluded from every dashboard cohort, total, plot, comparison, option list and export, but retained in source storage. The all-court activity calendar is unchanged; excluding a case does not remove evidence that the court worked on a particular day.

## Calendar and durations

The working-day calendar is built from the union of valid filing, registration, decision and hearing dates across the entire court, including activity outside any chosen case-type cohort. Sunday and the second/fourth Saturday are excluded. Valid hearing activity with an unmatched case identifier contributes evidence of a court activity day but cannot contribute to a case's hearing count. This calendar is not a statutory holiday calendar.

Duration is the count of those working days strictly after filing and on or before the event date. Same-day events have duration zero. Missing dates, events before filing and events after the selected end date are excluded from the relevant duration population. All statistics use individual observations, not averages of workbook statistics. Percentiles use linear interpolation at index (N−1)×p on sorted values. Unavailable measures are null, rendered as a dash; denominator-zero rates are null, never zero.

## Filings

### Four-quadrant monthly comparison

The Filing Trends side-by-side comparison accepts up to three case-type names. Quadrants I and IV (right) represent the current district/court; II and III (left) represent the comparison district/court. Both columns use identical calendar months and vertical scales. Upper panels show monthly filing counts (solid) and disposal counts (dashed). Lower panels show **cumulative case-load change = cumulative sum(monthly filings − monthly disposals), starting at 0**, with an explicit initial zero point before the first month. No opening pending count is added. This is change in backlog, not the actual pending total. Negative cumulative values are retained; changing the date range resets the baseline to zero.

Filings are counted by filing date. Disposals are counted by valid decision date, including cases filed before the selected range; missing filing dates and decisions before filing are excluded from disposal counts. Only Civil and Criminal cases are included. No hearing/listing digitization cut-off or working-day adjustment applies. This is an event-window comparison, unlike the dashboard's filing-cohort disposal-duration plots. Exact printed case-type names match courts; duplicate local codes sharing a name are aggregated. A known type with no events has zero monthly events and carries forward the previous cumulative value; unavailable months and types absent at a court are null and do not contribute to the sum. Defaults select up to three types with filing/disposal events, shared types first, then combined filing-plus-disposal volume descending. The selector is independent of the single-court Filing Trends selector.

Count distinct court/case identifiers filed in the selection. Monthly counts include every selected month, including months with zero filings. Mean = selected filings / selected month count. Median, maximum and other monthly statistics use that same grid. Rank case types by count descending, then name, then code. The Leading Case Type card uses the first type; Peak Month Filings is that type's highest monthly count, not the combined district peak. Distribution shows seven leading types plus Other; ranking shows five. All types with selected filings are eligible for monthly plots; no 500-filing threshold remains.

Monthly arrival rate (filings per working day) = that type's monthly filings / the court's working days in that month, from the configured monthly source below. A 12-month moving average requires twelve consecutive selected months with available values; it never borrows months before the selected start. Its first eleven values are null. Filing observation summaries describe the selected traces, while the explicitly labeled unsmoothed daily peak always uses monthly rates.

## First listing and disposal

First-listing statistics use all selected-cohort cases with a valid listing by the observation end. Where a court has a configured listing cut-off (see Definition v5 below), cases filed before it are excluded from the first-listing statistics. Disposal statistics have no digitization cut-off and require a valid decision by the observation end. Eligibility is established from dates; archived/pending table labels do not override a valid decision date.

The Median Disposal card uses the leading filing type's eligible disposal median. Delay flags identify case types with first-listing 90th percentile greater than 100 working days. Unresolved cases are not in the disposal distribution; recent filing cohorts can therefore have very small, selected disposal populations. This is descriptive observed-event reporting, not a survival estimate or court performance ranking.

## Hearings

Hearings per disposed case and the case-wise rates use the selected filing cohort, minus cases filed before the court's configured listing cut-off where one exists (Definition v5). Monthly hearing throughput uses the entire selected filing cohort and is never cut off. Count distinct valid hearing dates per case, from filing through decision or observation end, whichever is earlier. Duplicate same-date records count once, including overlaps between live and archived proceedings. Missing/invalid dates and unmatched cases do not contribute case hearings. Dates outside the case's observation interval are excluded.

Hearings per Disposed Case uses selected-cohort cases with valid decisions by the observation end and includes eligible cases with zero recorded hearings. Monthly throughput uses eligible cohort cases whether resolved or pending, and divides each month's hearings by the all-court working-day denominator. It represents the selected filing cohort's contribution to activity, not total court throughput. Valid zero-hearing months contribute zeros. Months with no working-day denominator are unavailable and excluded from rate statistics. Older months are neither forced to zero nor masked because of historical cut-off dates.

Case-wise rates use disposed cases: hearing count / elapsed working days, and hearing count / (elapsed calendar days / 30.4375). Cases with a zero denominator are separately excluded for that rate. No 20-disposed-case or 200-filing threshold remains. Statistics include sample sizes and exclusion counts.

## Complexity and outputs

X = mean hearings per disposed case; Y = mean hearings per case-month; bubble area ∝ mean monthly cohort hearing throughput; colour = mean disposal working days. Types require all four means. Each uses its approved population, which can differ. Reference lines Y=X/T illustrate a ratio of means; they do not estimate observed mean disposal duration or intrinsic case complexity. Colour/bubble scales use all eligible types in the court/cohort, so changing displayed types does not change the scale basis.

The register and all data exports use these same definitions. Per-chart exports contain displayed series and methodology metadata. Court export contains all case-type summary measures, including both case-wise hearing-rate denominators. JSON retains full numerical precision; the browser rounds only for display.

## Bankura source coverage — approved 4 October 2026

Bankura uses the same definitions and January 2010–June 2026 selection bounds, extracted 28 September 2026. Hearing coverage is incomplete before May 2015 and October 2016 is documented as missing. The user approved retaining recorded values with a visible warning and no exclusions. These values describe recorded activity; absence of records does not imply absence of actual hearings. No filing cut-off is applied to Bankura (none is defined in its source). Source warnings travel with component and export metadata. Duration working days continue to use the union of raw all-court activity dates. Monthly rate denominators follow the Excel source policy below.

## Monthly working-day sources — updated 4 October 2026

The user approved using the supplied working-day Excel counts for **both monthly arrival and monthly hearing rates**, retaining CSV activity dates for case-level durations. Bankura uses `Source_Data_For_Analysis/Bankura/Working_days_court_wise.xlsx`: Month and Working days columns, matched by court sheet and YYYY-MM. Annual totals are not denominators. All calculations that depend on monthly hearing throughput (including summaries, observations, register and complexity bubble area) use this same source. Smoothing is applied to the resulting monthly rates.

Purba Medinipur now has its own supplied working-day workbook (see Definition v5); the earlier copy of Bankura's workbook is superseded and not used.

Missing monthly counts and zero denominators produce null rates, not zero, with month-specific metadata. There is no fallback to CSV counts for a missing/zero month in a configured Excel source. Positive denominators and genuinely zero recorded filings/hearings produce zero rates under the existing approved recording policy. Malformed months, duplicate months, non-integral/negative/impossible counts and missing court sheets fail the import, retaining the previous usable snapshot. File hashes, sheet names and source row numbers are retained; workbook changes invalidate the snapshot/cache through explicit reimport.

Monthly counts do not identify the individual working dates and are never prorated to invent case-level elapsed working days. Those durations and case-wise working-day hearing rates continue to use CSV activity dates. Cut-offs are governed by Definition v5.

## Definition v5 — listing cut-offs and authoritative working days (draft-2026-10-04-v5)

**Status: draft pending sign-off by the author of v3/v4.** v3 removed all cut-offs at that user's request; v5 restores them for Purba Medinipur only, at a later request to reconcile with the workbook-based dashboard (`check-main`). Revert by deleting `listing_cutoffs` from `config/districts.json` and re-importing.

**Listing cut-offs.** Configured per court in `listing_cutoffs`. A case filed before the cut-off date is excluded from exactly these measures: `gap`, `hearings`, `case_rate_wd`, `case_rate_mo`. Cases filed on the cut-off date are kept. Exclusion is by filing date and is counted per measure as `excluded.before_listing_cutoff` (counts every pre-cut-off case in the selected cohort, whatever its other eligibility). Not cut off: filing counts and arrival statistics, disposal, monthly hearing throughput (`monthly_rate`). The selected range may end before the cut-off; the affected measures are then empty (n = 0, null), never zero. Purba Medinipur: CJM 2017-01-01; CJ (Jr.), CJ (Sr.), DJ 2015-01-01 (the court-level dates in the district workbooks). Bankura: none.

*Why the monthly rate is not cut off.* The reference workbooks' Definitions sheet words the cut-off as covering "gap, hearing count & rate", but their published monthly hearing-rate values are not restricted to post-cut-off filings (DJ Criminal Misc.: workbook mean 6.37 equals the uncut value exactly; CJM December 2016 shows 52.7 hearings per working day, where a cut-off cohort would give 0). The case-level measures are the ones that match the workbook counts once the cut-off is applied.

*Known residual.* Using filing date ≥ cut-off, per-type N is within about 4% of the workbook (exactly equal for many types) and medians agree in nearly all cases. The reference pipeline's exact "digitization-unaffected" flag cannot be recovered from the workbook, so an exact match is not claimed. See `docs/cutoff-working-day-verification.json`.

**Authoritative monthly working days.** `require_monthly_working_days: true` (set for both districts) makes a configured workbook mandatory for monthly arrival and hearing rates: a missing entry, a missing purpose, a missing court sheet, or a workbook byte-identical to another district's fails the import and retains the previous snapshot; at calculation time an unconfigured purpose raises instead of using activity dates. Months absent from a valid workbook remain null, not zero (unchanged). Purba Medinipur's workbook is built from the district's own `Monthly_<court>.xlsx` working-day sheets and equals the CSV activity-day counts in all 198 months for all four courts, so no Purba rate changed value; what changed is that the denominator is now a hashed, auditable source rather than an inference. Exact elapsed-working-day durations still use CSV activity dates.

**Filings convention.** Every filing count is *cases filed in the selected range* (live-filtered), never a fixed whole-window total; the interface labels it so. The reference workbook's Filings column is a fixed full-window total and will equal this only when the range spans the full window.
