"""Validate every registered external VaccEval data source without publishing it."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path


def load_published_date(path: Path) -> str:
    payload = json.loads(path.read_text())
    return payload["meta"]["dateRange"][1]


def validate_csv(source: dict, raw: bytes) -> dict:
    text = raw.decode("utf-8-sig")
    first_line = text.splitlines()[0]
    delimiter = ";" if first_line.count(";") > first_line.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    columns = set(reader.fieldnames or [])
    required = set(source["required_columns"])
    if missing := required - columns:
        raise ValueError(f"missing columns: {', '.join(sorted(missing))}")

    rows = list(reader)
    if len(rows) < source["minimum_rows"]:
        raise ValueError(f"only {len(rows)} rows; expected at least {source['minimum_rows']}")

    dates = [row[source["date_column"]][:10] for row in rows if row[source["date_column"]]]
    if not dates:
        raise ValueError("no sampling dates")
    latest = max(dates)
    age = (date.today() - date.fromisoformat(latest)).days
    if age > source["maximum_age_days"]:
        raise ValueError(f"latest observation is {age} days old (limit {source['maximum_age_days']})")

    targets = {row["target"] for row in rows}
    if missing := set(source["required_targets"]) - targets:
        raise ValueError(f"missing targets: {', '.join(sorted(missing))}")
    cities = {row["city"] for row in rows}
    if missing := set(source["required_cities"]) - cities:
        raise ValueError(f"missing required cities: {', '.join(sorted(missing))}")

    return {"rows": len(rows), "latest": latest, "cities": len(cities), "targets": len(targets)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, default=Path("config/external_sources.json"))
    parser.add_argument("--report", type=Path, default=Path("output/external-data-validation.md"))
    args = parser.parse_args()
    registry = json.loads(args.registry.read_text())
    results = []
    failed = False

    for source in registry["sources"]:
        try:
            download = subprocess.run(
                ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "60", source["url"]],
                check=True, capture_output=True,
            )
            raw = download.stdout
            if len(raw) > source["maximum_bytes"]:
                raise ValueError(f"download exceeds {source['maximum_bytes']} bytes")
            details = validate_csv(source, raw)
            published = load_published_date(Path(source["published_output"]))
            results.append({
                "name": source["name"], "status": "Valid", "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(), "published": published, **details,
            })
        except Exception as exc:
            failed = True
            results.append({"name": source["name"], "status": f"Failed: {exc}"})

    lines = [
        "# External data validation",
        "",
        f"Checked {datetime.now(timezone.utc).isoformat(timespec='seconds')}",
        "",
        "| Source | Status | Rows | Latest observation | Published through | Result |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for result in results:
        if result["status"] == "Valid":
            comparison = "New data available" if result["latest"] > result["published"] else "No newer observations"
            lines.append(
                f"| {result['name']} | Valid | {result['rows']:,} | {result['latest']} | "
                f"{result['published']} | {comparison} |"
            )
            lines += ["", f"SHA-256 `{result['sha256']}` · {result['cities']} cities · {result['targets']} targets"]
        else:
            lines.append(f"| {result['name']} | {result['status']} | — | — | — | Last valid data retained |")

    report = "\n".join(lines) + "\n"
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(report)
    print(report)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
