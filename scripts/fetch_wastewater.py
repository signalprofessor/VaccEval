"""Download public SLU/SEEC wastewater data and publish a compact aggregate."""
from __future__ import annotations
import argparse, csv, io, json, subprocess
from collections import defaultdict
from datetime import datetime
from pathlib import Path

SOURCE_URL = "https://blobserver.dc.scilifelab.se/blob/new_slu_ww_data.csv"
CITIES = {"Linkoping": "Östergötland", "Kalmar": "Kalmar", "Jonkoping": "Jönköping"}
TARGETS = {
    "SARS CoV-2": "COVID-19", "Influenza A virus": "Influenza A",
    "Influenza B virus": "Influenza B", "RSV": "RSV", "Norovirus GII": "Norovirus GII",
}

def number(value: str) -> float | None:
    try: return float(value)
    except (TypeError, ValueError): return None

def write_if_changed(path: Path, payload: dict) -> bool:
    if path.exists():
        previous = json.loads(path.read_text())
        previous["meta"].pop("generatedAt", None)
        comparable = json.loads(json.dumps(payload))
        comparable["meta"].pop("generatedAt", None)
        if previous == comparable:
            print("Wastewater data unchanged")
            return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return True

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", help="Local CSV override; otherwise download official data")
    args = parser.parse_args()
    if args.source:
        raw = Path(args.source).read_bytes()
        source_label = Path(args.source).name
    else:
        response = subprocess.run(
            ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "60", SOURCE_URL],
            check=True, capture_output=True,
        )
        raw = response.stdout
        source_label = SOURCE_URL
    text = raw.decode("utf-8-sig")
    delimiter = ";" if text.splitlines()[0].count(";") > text.splitlines()[0].count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    required = {"target", "sampling_date", "city", "inhabitants", "pmmov_normalised"}
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
        raise ValueError(f"Wastewater schema mismatch: {reader.fieldnames}")

    values: dict[tuple[str, str, str], list[tuple[float, float]]] = defaultdict(list)
    for row in reader:
        region = CITIES.get(row["city"])
        pathogen = TARGETS.get(row["target"])
        signal = number(row["pmmov_normalised"])
        population = number(row["inhabitants"])
        if not region or not pathogen or signal is None or population is None: continue
        key = (row["sampling_date"][:10], region, pathogen)
        values[key].append((signal, population))

    dates = sorted({key[0] for key in values})
    pathogens = ["COVID-19", "Influenza A", "Influenza B", "Influenza A+B", "RSV", "Norovirus GII"]
    regions = ["All regions", "Östergötland", "Kalmar", "Jönköping"]
    series = []
    for day in dates:
        for region in regions[1:]:
            base = {}
            for pathogen in pathogens:
                if pathogen == "Influenza A+B": continue
                rows = values.get((day, region, pathogen), [])
                base[pathogen] = sum(v for v, _ in rows) / len(rows) if rows else None
            a, b = base.get("Influenza A"), base.get("Influenza B")
            base["Influenza A+B"] = None if a is None and b is None else (a or 0) + (b or 0)
            for pathogen in pathogens:
                if base.get(pathogen) is not None:
                    series.append({"date": day, "region": region, "pathogen": pathogen, "value": base[pathogen]})
        for pathogen in pathogens:
            rows = []
            for city_region in regions[1:]:
                if pathogen == "Influenza A+B":
                    a = values.get((day, city_region, "Influenza A"), [])
                    b = values.get((day, city_region, "Influenza B"), [])
                    av = sum(v for v, _ in a) / len(a) if a else None
                    bv = sum(v for v, _ in b) / len(b) if b else None
                    poprows = a or b
                    if av is not None or bv is not None: rows.append(((av or 0) + (bv or 0), poprows[0][1]))
                else:
                    rows.extend(values.get((day, city_region, pathogen), []))
            if rows:
                weight = sum(pop for _, pop in rows)
                series.append({"date": day, "region": "All regions", "pathogen": pathogen,
                               "value": sum(v * pop for v, pop in rows) / weight})
    payload = {"meta": {"source": source_label, "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                         "dateRange": [dates[0], dates[-1]], "measure": "PMMoV-normalized viral concentration",
                         "methodChangeDate": "2026-08-31"},
               "regions": regions, "pathogens": pathogens, "series": series}
    changed = write_if_changed(args.output, payload)
    print(json.dumps({**payload["meta"], "records": len(series), "changed": changed}, indent=2))

if __name__ == "__main__": main()
