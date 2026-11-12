"""LiU -> validated aggregate JSON -> protected Loopia. No data in Git/artifacts.

Credentials are read only from the Actions environment, never command arguments.
"""
import ftplib
import io
import json
import os
import ssl
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import (
    HTTPBasicAuthHandler, HTTPPasswordMgrWithDefaultRealm, HTTPRedirectHandler,
    Request, build_opener,
)

from import_regional_covid import build_payload

BASE = "https://vacceval.ida.liu.se/insidan/"
FILES = [
    "CovidDiagnoserPerÖppenSlutenvårdDatumRegion.csv",
    "CovidPerDatumRegion.csv",
    "VaccinationerRullande6månPerDatumRegion.csv",
]
DATA_PATH = "data/regional-covid.json"
STATUS_PATH = "data/regional-covid-status.json"
MAX_BYTES = 15 * 1024 * 1024
REGIONS = {"Östergötland", "Jönköping", "Kalmar"}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Unexpected redirect from the configured source")


def ensure_protected():
    # Anonymous requests must be rejected before uploading restricted data.
    for host in ("vacceval.se", "www.vacceval.se"):
        for path in ("/", "/" + DATA_PATH):
            try:
                with build_opener(NoRedirect).open("https://" + host + path, timeout=30) as response:
                    code = response.status
            except HTTPError as error:
                code = error.code
            if code != 401:
                raise ValueError("Destination authentication check failed")


def download_sources(folder):
    passwords = HTTPPasswordMgrWithDefaultRealm()
    passwords.add_password(None, BASE, os.environ["LIU_VACCEVAL_USERNAME"], os.environ["LIU_VACCEVAL_PASSWORD"])
    opener = build_opener(NoRedirect, HTTPBasicAuthHandler(passwords))
    paths = []
    for number, name in enumerate(FILES):
        for attempt in range(3):
            try:
                with opener.open(Request(BASE + quote(name), headers={"User-Agent": "VaccEval-data-refresh/1.0"}), timeout=30) as response:
                    content = response.read(MAX_BYTES + 1)
                if len(content) > MAX_BYTES:
                    raise ValueError("Source exceeds size limit")
                path = folder / (str(number) + ".csv")
                path.write_bytes(content)
                paths.append(path)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2)
    return build_payload(*paths)


def read_json(ftp, path):
    stream = io.BytesIO()
    try:
        ftp.retrbinary("RETR " + path, stream.write)
    except ftplib.error_perm as error:
        if str(error).startswith("550"):
            return None
        raise
    return json.loads(stream.getvalue())


def validate_candidate(candidate, previous):
    for measure in ("diagnoses", "encounters", "vaccinations"):
        rows = candidate[measure]
        if {row["region"] for row in rows} != REGIONS:
            raise ValueError("A regional source is missing a region")
        # Reject truncated history and backwards date cutoffs; revisions to
        # values and removal of individual erroneous records remain allowed.
        for region in REGIONS:
            dates = [row["date"] for row in rows if row["region"] == region]
            if max(dates) > datetime.now(timezone.utc).date().isoformat():
                raise ValueError("Future observation date")
            old = [row["date"] for row in previous[measure] if row["region"] == region] if previous else []
            if old and (min(dates) > min(old) or max(dates) < max(old)):
                raise ValueError("Regional history or latest date regressed")
            if old and len(dates) < len(old) * 0.8:
                raise ValueError("Large loss of regional history")


def data_changed(candidate, previous):
    return previous is None or any(candidate[key] != previous.get(key) for key in ("diagnoses", "encounters", "vaccinations"))


def atomic_json(ftp, path, value):
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    temporary = path + ".pending"
    ftp.storbinary("STOR " + temporary, io.BytesIO(encoded))
    # Verify bytes before replacing the active file.
    uploaded = io.BytesIO()
    ftp.retrbinary("RETR " + temporary, uploaded.write)
    if uploaded.getvalue() != encoded:
        raise ValueError("Uploaded bytes did not match")
    ftp.rename(temporary, path)


def main():
    if not all(os.environ.get(name) for name in ("LIU_VACCEVAL_USERNAME", "LIU_VACCEVAL_PASSWORD")):
        print("::warning::LiU refresh not configured: add LIU_VACCEVAL_USERNAME and LIU_VACCEVAL_PASSWORD. Existing data retained.")
        return
    ensure_protected()
    with ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=30) as ftp:
        ftp.connect("ftpcluster.loopia.se", 21)
        ftp.login(os.environ["LOOPIA_FTP_USERNAME"], os.environ["LOOPIA_FTP_PASSWORD"])
        ftp.prot_p()
        previous = read_json(ftp, DATA_PATH)
        old_status = read_json(ftp, STATUS_PATH) or {}
        checked = datetime.now(timezone.utc).isoformat(timespec="seconds")
        try:
            with tempfile.TemporaryDirectory(prefix="vacceval-private-") as folder:
                candidate = download_sources(Path(folder))
            validate_candidate(candidate, previous)
            changed = data_changed(candidate, previous)
            if changed:
                atomic_json(ftp, DATA_PATH, candidate)
            status = {"state": "available", "checkedAt": checked, "lastSuccessfulCheck": checked,
                      "lastImportedAt": candidate["meta"]["importedAt"] if changed else previous["meta"]["importedAt"]}
            atomic_json(ftp, STATUS_PATH, status)
            print("Private regional data refreshed." if changed else "LiU checked: regional data unchanged.")
        except Exception:
            # Do not print response bodies, record values or credentials.
            status = {**old_status, "state": "unavailable", "checkedAt": checked}
            atomic_json(ftp, STATUS_PATH, status)
            print("::warning::LiU regional refresh failed. Previous validated data retained; check source access or CSV format.")
            raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        print("::warning::Private regional refresh could not complete. Existing regional data retained.")
        raise SystemExit(1)
