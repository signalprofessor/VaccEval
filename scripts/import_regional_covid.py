"""Convert LiU's aggregate CSV exports; never impute missing dates.

Output is private deployment data, not a Git-tracked public data source.
"""
import argparse
import csv
import json
from datetime import date, datetime, timezone
from pathlib import Path


def read_rows(path, date_column, region_column, values):
    records = []
    keys = set()
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, delimiter=";")
        required = {date_column, region_column, *values.values()}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("Unexpected CSV columns")
        for row in reader:
            observed = date.fromisoformat(row[date_column]).isoformat()
            region = row[region_column].strip()
            if region not in {"Östergötland", "Jönköping", "Kalmar"}:
                raise ValueError("Unexpected region")
            key = (observed, region)
            if key in keys:
                raise ValueError("Duplicate date and region")
            keys.add(key)
            record = {"date": observed, "region": region}
            for name, column in values.items():
                value = int(row[column])
                if value < 0:
                    raise ValueError("Negative count")
                record[name] = value
            records.append(record)
    if not records:
        raise ValueError("Empty CSV")
    return sorted(records, key=lambda row: (row["date"], row["region"]))


def build_payload(diagnosis_path, encounter_path, vaccination_path):
    diagnoses = read_rows(diagnosis_path, "Datum", "Region", {
        "outpatient": "AntalCoviddiagnoserÖppenvård",
        "inpatient": "AntalCoviddiagnoserSlutenvård",
    })
    for row in diagnoses:
        row["total"] = row["outpatient"] + row["inpatient"]
    payload = {
        "meta": {
            "importedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "VaccEval / LiU · regional COVID exports",
            "reportingCompleteness": "unknown",
            "missingDates": "unknown, not zero",
            "dateRange": [diagnoses[0]["date"], diagnoses[-1]["date"]],
        },
        "regions": ["Östergötland", "Jönköping", "Kalmar"],
        "diagnoses": diagnoses,
        "encounters": read_rows(encounter_path, "StartdatumVårdtillfälle", "Region", {
            "count": "AntalVårdtillfällen",
        }),
        "vaccinations": read_rows(vaccination_path, "Datum", "region", {
            "count": "AntalVaccinationerSenaste6Månaderna",
        }),
    }
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--diagnoses", type=Path, required=True)
    parser.add_argument("--encounters", type=Path, required=True)
    parser.add_argument("--vaccinations", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = build_payload(args.diagnoses, args.encounters, args.vaccinations)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("Imported aggregate regional data; missing dates preserved.")


if __name__ == "__main__":
    main()
