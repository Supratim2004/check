import csv
from io import StringIO


def csv_text(rows):
    """Export source names safely when opened in spreadsheet software."""
    out = StringIO(newline="")
    if not rows:
        return ""
    fields = list(dict.fromkeys(key for row in rows for key in row))
    writer = csv.DictWriter(out, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        writer.writerow({k: ("'" + v if isinstance(v, str) and v.lstrip().startswith(("=", "+", "-", "@")) else v) for k, v in row.items()})
    return "\ufeff" + out.getvalue()
