"""Fetch aggregate weekly laboratory-confirmed virus cases from FHM PXWeb."""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import date, datetime
from itertools import product
from pathlib import Path

BASE = "https://fohm-app.folkhalsomyndigheten.se/Folkhalsodata/api/v1/sv/A_Folkhalsodata/H_Sminet"
REGIONS = {"05": "Östergötland", "06": "Jönköping", "08": "Kalmar"}
TABLES = (
    {
        "path": "Covid19/falldata/ccov19kontid.px",
        "pathogens": {None: "COVID-19"},
        "fixed": {"Kön": ["1+2+0"]},
        "measures": ["1", "2"],
    },
    {
        "path": "Influensa/binflRegtid.px",
        "pathogens": {"1+2": "Influenza A+B", "1": "Influenza A", "2": "Influenza B"},
        "fixed": {"Kön": ["1+2+0"]},
        "measures": ["1", "2"],
    },
    {
        "path": "RSvirus/arsvReg.px",
        "pathogens": {None: "RSV"},
        "fixed": {},
        "measures": ["1", "11"],
    },
)


def request_json(url: str, body: dict | None = None) -> dict:
    command = ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "90"]
    if body is not None:
        command += ["--request", "POST", "--header", "Content-Type: application/json", "--data", json.dumps(body)]
    command.append(url)
    response = subprocess.run(command, check=True, capture_output=True)
    return json.loads(response.stdout)


def ordered_codes(payload: dict, dimension: str) -> list[str]:
    index = payload["dimension"][dimension]["category"]["index"]
    if isinstance(index, list):
        return index
    return [code for code, _position in sorted(index.items(), key=lambda item: item[1])]


def week_end(period: str) -> str:
    year, week = period.split("W")
    return date.fromisocalendar(int(year), int(week), 7).isoformat()


def query_table(table: dict) -> tuple[list[dict], str]:
    url = f"{BASE}/{table['path']}"
    metadata = request_json(url)
    variables = {variable["code"]: variable for variable in metadata["variables"]}
    period_code = "År och vecka"
    type_code = "Typ av influensa" if "Typ av influensa" in variables else None
    selections = {"Region": list(REGIONS), "Mått": table["measures"], period_code: ["*"]}
    selections.update(table["fixed"])
    if type_code:
        selections[type_code] = list(table["pathogens"])
    body = {
        "query": [
            {"code": variable["code"], "selection": {"filter": "all" if selections[variable["code"]] == ["*"] else "item", "values": selections[variable["code"]]}}
            for variable in metadata["variables"]
        ],
        "response": {"format": "json-stat2"},
    }
    payload = request_json(url, body)
    dimensions = payload["id"]
    codes = [ordered_codes(payload, dimension) for dimension in dimensions]
    values = payload["value"]
    if len(values) != __import__("math").prod(payload["size"]):
        raise ValueError(f"Unexpected cell count for {table['path']}")

    records = []
    for offset, coordinate in enumerate(product(*codes)):
        cell = dict(zip(dimensions, coordinate))
        value = values[offset]
        if value is None:
            continue
        pathogen = table["pathogens"][cell.get(type_code)] if type_code else table["pathogens"][None]
        key = (cell["Region"], pathogen, cell[period_code])
        records.append((key, cell["Mått"], value))

    combined: dict[tuple[str, str, str], dict] = {}
    for (region_code, pathogen, period), measure, value in records:
        item = combined.setdefault((region_code, pathogen, period), {
            "week": period,
            "date": week_end(period),
            "region": REGIONS[region_code],
            "pathogen": pathogen,
        })
        item["count" if measure == table["measures"][0] else "per100k"] = value
    complete = [item for item in combined.values() if "count" in item and "per100k" in item]
    return complete, payload.get("updated") or metadata.get("updated") or ""


def fetch() -> dict:
    series, updates = [], []
    for table in TABLES:
        rows, updated = query_table(table)
        series.extend(rows)
        updates.append(updated)
    series.sort(key=lambda item: (item["date"], item["region"], item["pathogen"]))
    if not series:
        raise ValueError("FHM returned no virus-case observations")
    return {
        "meta": {
            "source": "Folkhälsomyndigheten, SmiNet",
            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "sourceUpdatedAt": max(updates),
            "dateRange": [series[0]["date"], series[-1]["date"]],
            "measure": "Weekly laboratory-confirmed reported cases",
            "scope": "Published aggregate counts and rates only",
            "qualification": "Reported cases depend on testing and reporting practices and do not represent all infections.",
        },
        "regions": list(REGIONS.values()),
        "pathogens": ["COVID-19", "Influenza A", "Influenza B", "Influenza A+B", "RSV"],
        "series": series,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    payload = fetch()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps({"through": payload["meta"]["dateRange"][1], "records": len(payload["series"])}, indent=2))


if __name__ == "__main__":
    main()
