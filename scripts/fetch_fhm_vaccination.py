"""Fetch FHM COVID-19 vaccination coverage and retain aggregate snapshots."""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path

TABLE_URL = (
    "https://fohm-app.folkhalsomyndigheten.se/Folkhalsodata/api/v1/sv/"
    "A_Folkhalsodata/L_Vaccin/Covid19/covvaccreg.px"
)
REGIONS = {"05": "Östergötland", "06": "Jönköping", "08": "Kalmar"}
AGES = {"3": "50–64", "4": "65–74", "5": "75+"}


def request_json(url: str, body: dict | None = None) -> dict:
    command = ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "60"]
    if body is not None:
        command += ["--request", "POST", "--header", "Content-Type: application/json", "--data", json.dumps(body)]
    command.append(url)
    response = subprocess.run(command, check=True, capture_output=True)
    return json.loads(response.stdout)


def query() -> dict:
    body = {
        "query": [
            {"code": "Region", "selection": {"filter": "item", "values": list(REGIONS)}},
            {"code": "Åldersgrupp", "selection": {"filter": "item", "values": list(AGES)}},
            {"code": "Antal och andel", "selection": {"filter": "item", "values": ["1", "2"]}},
            {"code": "År", "selection": {"filter": "all", "values": ["*"]}},
        ],
        "response": {"format": "json-stat2"},
    }
    return request_json(TABLE_URL, body)


def snapshot(payload: dict) -> dict:
    expected_ids = ["ContentsCode", "Region", "Åldersgrupp", "Antal och andel", "År"]
    if payload.get("id") != expected_ids or payload.get("size", [])[:4] != [1, 3, 3, 2]:
        raise ValueError("FHM vaccination schema changed")
    years = list(payload["dimension"]["År"]["category"]["index"])
    if len(years) != 1 or len(payload.get("value", [])) != 18:
        raise ValueError("FHM returned an unexpected period or cell count")

    values = payload["value"]
    records = []
    offset = 0
    for region in REGIONS.values():
        for age_group in AGES.values():
            count, percent = values[offset:offset + 2]
            offset += 2
            if not isinstance(count, (int, float)) or not isinstance(percent, (int, float)):
                raise ValueError("FHM returned a missing or non-numeric vaccination value")
            records.append({"region": region, "ageGroup": age_group, "count": int(count), "percent": percent})
    return {
        "sourceUpdatedAt": payload["updated"],
        "snapshotDate": payload["updated"][:10],
        "referenceYear": years[0],
        "records": records,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    current = snapshot(query())
    snapshots = []
    if args.output.exists():
        snapshots = json.loads(args.output.read_text()).get("snapshots", [])
    previous = next((item for item in snapshots if item["sourceUpdatedAt"] == current["sourceUpdatedAt"]), None)
    changed = previous != current
    if changed:
        snapshots = [item for item in snapshots if item["sourceUpdatedAt"] != current["sourceUpdatedAt"]]
        snapshots.append(current)
        snapshots.sort(key=lambda item: item["sourceUpdatedAt"])
        payload = {
            "meta": {
                "source": "Folkhälsomyndigheten, Nationella vaccinationsregistret",
                "table": "covvaccreg.px",
                "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                "measure": "Current-season COVID-19 vaccination coverage",
                "scope": "Published aggregate counts and percentages only",
            },
            "regions": list(REGIONS.values()),
            "ageGroups": list(AGES.values()),
            "snapshots": snapshots,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    else:
        print("FHM vaccination data unchanged")
    print(json.dumps({"snapshot": current["snapshotDate"], "records": len(current["records"]), "changed": changed}, indent=2))


if __name__ == "__main__":
    main()
