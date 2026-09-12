"""Fetch SCB weekly all-cause deaths and publish compact regional counts."""
from __future__ import annotations

import argparse
import json
import subprocess
import urllib.parse
from datetime import date, datetime
from pathlib import Path

TABLE_URL = "https://statistikdatabasen.scb.se/api/v2/tables/TAB6474"
REGIONS = {
    "05": "Östergötland",
    "06": "Jönköping",
    "08": "Kalmar",
}


def fetch_json(url: str) -> dict:
    response = subprocess.run(
        ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "60", url],
        check=True, capture_output=True,
    )
    return json.loads(response.stdout)


def week_end(period: str) -> str:
    year_text, week_text = period.split("V", 1)
    return date.fromisocalendar(int(year_text), int(week_text), 7).isoformat()


def write_if_changed(path: Path, payload: dict) -> bool:
    if path.exists():
        previous = json.loads(path.read_text())
        previous_comparable = {key: value for key, value in previous.items() if key != "meta"}
        current_comparable = {key: value for key, value in payload.items() if key != "meta"}
        previous_meta = {key: value for key, value in previous.get("meta", {}).items() if key != "generatedAt"}
        current_meta = {key: value for key, value in payload.get("meta", {}).items() if key != "generatedAt"}
        if previous_comparable == current_comparable and previous_meta == current_meta:
            print("SCB mortality data unchanged")
            return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    metadata = fetch_json(f"{TABLE_URL}/metadata?lang=sv")
    periods = list(metadata["dimension"]["Tid"]["category"]["index"])
    by_region = {region: [] for region in REGIONS.values()}
    source_updated = metadata["updated"]
    for start in range(0, len(periods), 20):
        requested_periods = periods[start:start + 20]
        parameters = [("lang", "sv"), ("outputFormat", "json-stat2")]
        parameters += [("valuecodes[Region]", code) for code in REGIONS]
        parameters += [
            ("valuecodes[Alder]", "TotSA"),
            ("valuecodes[Kon]", "TotSa"),
            ("valuecodes[ContentsCode]", "000007SS"),
        ]
        parameters += [("valuecodes[Tid]", period) for period in requested_periods]
        data = fetch_json(f"{TABLE_URL}/data?{urllib.parse.urlencode(parameters)}")
        returned_periods = list(data["dimension"]["Tid"]["category"]["index"])
        values = data["value"]
        expected = len(REGIONS) * len(returned_periods)
        if returned_periods != requested_periods or len(values) != expected:
            raise ValueError("SCB returned an unexpected period selection or cell count")
        offset = 0
        for region in REGIONS.values():
            for period in returned_periods:
                value = values[offset]
                offset += 1
                if value is not None:
                    by_region[region].append({"week": period, "date": week_end(period), "region": region, "count": value})

    series = [point for region in REGIONS.values() for point in by_region[region]]

    payload = {
        "meta": {
            "source": "SCB PxWeb API v2, table TAB6474",
            "sourceUpdatedAt": source_updated,
            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "dateRange": [week_end(periods[0]), week_end(periods[-1])],
            "periodRange": [periods[0], periods[-1]],
            "measure": "Weekly all-cause deaths",
            "status": "Preliminary and subject to revision",
            "population": "All ages and both sexes",
        },
        "regions": list(REGIONS.values()),
        "series": series,
    }
    changed = write_if_changed(args.output, payload)
    print(json.dumps({**payload["meta"], "records": len(series), "changed": changed}, indent=2))


if __name__ == "__main__":
    main()
