#!/usr/bin/env python3
"""Publish source health without replacing the last valid surveillance data."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

SOURCES = {
    "slu_seec_wastewater": "Wastewater",
    "scb_weekly_deaths": "All-cause mortality",
    "fhm_covid_vaccination": "Vaccination",
    "fhm_reported_virus_cases": "Reported cases",
}


def parse_failures(path: Path) -> set[str]:
    if not path.exists():
        return set()
    failed: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.lstrip("- ").split(":", 1)[0].strip()
        if value:
            failed.add(value)
    return failed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--failures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    previous = {}
    if args.output.exists():
        previous = json.loads(args.output.read_text(encoding="utf-8")).get("sources", {})

    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    failed = parse_failures(args.failures)
    sources = {}
    for source_id, name in SOURCES.items():
        unavailable = source_id in failed
        old = previous.get(source_id, {})
        sources[source_id] = {
            "name": name,
            "state": "unavailable" if unavailable else "available",
            "checkedAt": checked_at,
            "lastSuccessfulCheck": old.get("lastSuccessfulCheck") if unavailable else checked_at,
            "message": (
                "Source could not be refreshed; previous validated data retained."
                if unavailable
                else None
            ),
        }

    payload = {
        "meta": {"checkedAt": checked_at, "hasWarnings": bool(failed)},
        "sources": sources,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
