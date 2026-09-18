import os
from pathlib import Path
from flask import Flask, jsonify, render_template, request, abort
from data import DataError, district_folders, load_district

app = Flask(__name__)
app.config["DATA_DIR"] = os.environ.get("DATA_DIR", str(Path(__file__).parent / "Data"))

def build_insights(code, c):
    """Derive simple, explainable insights + recommendation cards from the
    reported summary statistics for one court."""
    arrivals = c["arrivals"]
    disposal = {d["case_type"]: d for d in c["disposal"]}
    gaps = {g["case_type"]: g for g in c["gap"]}

    total_filings = sum(a["filings"] for a in arrivals)
    busiest = max(arrivals, key=lambda a: a["filings"])

    disposal_rows = [d for d in disposal.values() if d["median"] is not None and d["p90"] is not None]
    slowest = max(disposal_rows, key=lambda d: d["median"]) if disposal_rows else None
    fastest = min(disposal_rows, key=lambda d: d["median"]) if disposal_rows else None

    gap_rows = [g for g in gaps.values() if g["p90"] is not None and g["median"] is not None]
    worst_gap = max(gap_rows, key=lambda g: g["p90"]) if gap_rows else None

    insights = [
        f"{busiest['case_type']} dominates the docket at {c['full_name']}, "
        f"accounting for {busiest['filings']:,} of {total_filings:,} tracked filings "
        f"({(busiest['filings'] / total_filings * 100 if total_filings else 0):.0f}%).",
    ]
    if slowest:
        insights.append(
            f"{slowest['case_type']} carries the longest typical resolution time: "
            f"a median of {slowest['median']:,} working days, stretching to "
            f"{slowest['p90']:,} at the 90th percentile."
        )
    if fastest:
        insights.append(
            f"{fastest['case_type']} clears fastest, with a median disposal of "
            f"{fastest['median']:,} working days."
        )
    if worst_gap:
        insights.append(
            f"{worst_gap['case_type']} shows the widest filing-to-first-listing spread: "
            f"90th percentile of {worst_gap['p90']} working days versus a median of "
            f"{worst_gap['median']}."
        )
    insights.append(
        f"Gap and hearing-count measures are only reliable from {(c['listing_cutoff'] or 'an unspecified cutoff')} "
        f"onward for this court; arrivals and disposal use the full "
        f"{c['window_start']}\u2013{c['window_end']} window."
    )

    recommendations = []
    if slowest and slowest["median"] > 500:
        recommendations.append({
            "priority": "high",
            "title": f"Backlog risk: {slowest['case_type']}",
            "description": (
                f"Median time to disposal is {slowest['median']:,} working days "
                f"(90th pct {slowest['p90']:,}), the slowest tracked case type at this court."
            ),
            "action": "Prioritise case-management review and additional listing slots for this case type.",
            "impact": "Reduced pendency and faster clearance for the largest-backlog category.",
        })
    if worst_gap and worst_gap["p90"] > 100:
        recommendations.append({
            "priority": "medium",
            "title": f"Listing delay: {worst_gap['case_type']}",
            "description": (
                f"90th percentile filing-to-first-listing gap is {worst_gap['p90']} working days "
                f"versus a median of {worst_gap['median']}, indicating a long tail of delayed first hearings."
            ),
            "action": "Audit the scheduling queue for outlier cases awaiting first listing.",
            "impact": "Shorter, more predictable time-to-first-hearing.",
        })
    busiest_rate = busiest.get("daily_rate")
    if busiest_rate and busiest_rate > 1.0:
        recommendations.append({
            "priority": "low",
            "title": f"Sustained high-volume intake: {busiest['case_type']}",
            "description": (
                f"Averaging {busiest_rate} filings per working day "
                f"({busiest['mean']}/month), this case type anchors the court's total workload."
            ),
            "action": "Maintain dedicated bench time and clerical capacity for this category.",
            "impact": "Keeps the court's single largest filing stream from crowding out others.",
        })

    return {"insights": insights, "recommendations": recommendations}


def selected_district(district=None):
    folders = district_folders(app.config["DATA_DIR"])
    if not folders:
        raise DataError("No district workbooks found. Add Data/<district>/Monthly_<court>.xlsx.")
    district = district or request.args.get("district") or next(iter(folders))
    if district not in folders:
        abort(404, description="Unknown district")
    return load_district(app.config["DATA_DIR"], district)


def selected_court(code, district=None):
    data = selected_district(district)
    if code not in data["courts"]:
        abort(404, description="Unknown court code in this district")
    return data["courts"][code]


@app.errorhandler(DataError)
def data_error(error):
    return jsonify({"error": str(error)}), 503


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": error.description}), 404


@app.route("/")
def index():
    data = selected_district()
    return render_template("index.html", meta=data["meta"], courts=list(data["courts"]),
                           districts=list(district_folders(app.config["DATA_DIR"])))


@app.route("/api/districts")
def api_districts():
    return jsonify({"districts": [{"id": name, "name": name}
                    for name in district_folders(app.config["DATA_DIR"])]})


@app.route("/api/meta")
@app.route("/api/districts/<district>/meta")
def api_meta(district=None):
    data = selected_district(district)
    totals = {code: {
        "full_name": c["full_name"], "listing_cutoff": c["listing_cutoff"],
        "total_filings": sum(a["filings"] for a in c["arrivals"]),
        "case_types_tracked": len(c["arrivals"]),
    } for code, c in data["courts"].items()}
    return jsonify({"meta": data["meta"], "court_totals": totals,
                    "grand_total_filings": sum(v["total_filings"] for v in totals.values())})


@app.route("/api/court/<code>")
@app.route("/api/districts/<district>/court/<code>")
def api_court(code, district=None):
    return jsonify(selected_court(code, district))


@app.route("/api/court/<code>/trend")
@app.route("/api/districts/<district>/court/<code>/trend")
def api_court_trend(code, district=None):
    c = selected_court(code, district)
    top = c["arrivals"][0]["case_type"]
    values = c["arrival_series"].get(top)
    return jsonify({"case_type": top, "labels": c["month_labels"] if values is not None else [],
                    "values": values if values is not None else [], "available": values is not None,
                    "note": ("Actual monthly filing counts from " + c["source_file"] +
                             ". Missing observations are shown as gaps.") if values is not None else
                            "Monthly filing counts are unavailable for this case type."})


@app.route("/api/court/<code>/insights")
@app.route("/api/districts/<district>/court/<code>/insights")
def api_court_insights(code, district=None):
    return jsonify(build_insights(code, selected_court(code, district)))


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8080)
