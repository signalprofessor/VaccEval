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
from urllib.parse import urlencode


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


def download(url: str, maximum_bytes: int) -> bytes:
    response = subprocess.run(
        ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "60", url],
        check=True, capture_output=True,
    )
    raw = response.stdout
    if len(raw) > maximum_bytes:
        raise ValueError(f"download exceeds {maximum_bytes} bytes")
    return raw


def period_age_days(period: str) -> int:
    year_text, week_text = period.split("V", 1)
    period_end = date.fromisocalendar(int(year_text), int(week_text), 7)
    return (date.today() - period_end).days


def validate_scb_pxweb_v2(source: dict) -> dict:
    metadata_raw = download(f"{source['table_url']}/metadata?lang=sv", source["maximum_bytes"])
    metadata = json.loads(metadata_raw)
    latest = list(metadata["dimension"]["Tid"]["category"]["index"])[-1]
    age = period_age_days(latest)
    if age > source["maximum_age_days"]:
        raise ValueError(f"latest observation is {age} days old (limit {source['maximum_age_days']})")

    region_labels = metadata["dimension"]["Region"]["category"]["label"]
    for code, label in source["regions"].items():
        if region_labels.get(code) != label:
            raise ValueError(f"region {code} is missing or renamed")

    parameters = [("lang", "sv"), ("outputFormat", "json-stat2")]
    parameters += [("valuecodes[Region]", code) for code in source["regions"]]
    parameters += [
        ("valuecodes[Alder]", source["age_code"]),
        ("valuecodes[Kon]", source["sex_code"]),
        ("valuecodes[ContentsCode]", source["contents_code"]),
        ("valuecodes[Tid]", latest),
    ]
    query_url = f"{source['table_url']}/data?{urlencode(parameters)}"
    data_raw = download(query_url, source["maximum_bytes"])
    payload = json.loads(data_raw)
    values = payload.get("value", [])
    if len(values) != len(source["regions"]) or any(not isinstance(value, (int, float)) for value in values):
        raise ValueError("unexpected or non-numeric regional values")

    return {
        "rows": len(values),
        "latest": latest,
        "published": "Not yet imported",
        "comparison": "Ready for contextual import",
        "detail": f"{len(source['regions'])} regions · all ages · both sexes · preliminary/revisable",
        "bytes": len(metadata_raw) + len(data_raw),
        "sha256": hashlib.sha256(metadata_raw + data_raw).hexdigest(),
    }


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
            if source["format"] == "csv":
                raw = download(source["url"], source["maximum_bytes"])
                details = validate_csv(source, raw)
                published = load_published_date(Path(source["published_output"]))
                comparison = "New data available" if details["latest"] > published else "No newer observations"
                results.append({
                    "name": source["name"], "status": "Valid", "bytes": len(raw),
                    "sha256": hashlib.sha256(raw).hexdigest(), "published": published,
                    "comparison": comparison,
                    "detail": f"{details['cities']} cities · {details['targets']} targets", **details,
                })
            elif source["format"] == "scb-pxweb-v2":
                results.append({"name": source["name"], "status": "Valid", **validate_scb_pxweb_v2(source)})
            else:
                raise ValueError(f"unsupported format: {source['format']}")
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
            lines.append(
                f"| {result['name']} | Valid | {result['rows']:,} | {result['latest']} | "
                f"{result['published']} | {result['comparison']} |"
            )
            lines += ["", f"SHA-256 `{result['sha256']}` · {result['detail']}"]
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
