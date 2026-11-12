"""Synthetic checks for failed sources, history regression and atomic writes."""
import copy
import io
import json
import unittest
from refresh_private_covid import atomic_json, data_changed, validate_candidate


def fixture():
    rows = [{"region": region, "date": date, "count": 1}
            for region in ("Östergötland", "Jönköping", "Kalmar")
            for date in ("2026-01-01", "2026-01-03")]
    return {"meta": {"importedAt": "2026-01-04"}, "diagnoses": rows,
            "encounters": copy.deepcopy(rows), "vaccinations": copy.deepcopy(rows)}


class FakeFTP:
    def __init__(self, corrupt=False, fail=False):
        self.files = {"data/active.json": b'old valid data'}
        self.corrupt = corrupt
        self.fail = fail

    def storbinary(self, command, stream):
        if self.fail:
            raise OSError("Interrupted upload")
        self.files[command[5:]] = b"corrupted" if self.corrupt else stream.read()

    def retrbinary(self, command, callback):
        callback(self.files[command[5:]])

    def rename(self, old, new):
        self.files[new] = self.files.pop(old)


class RefreshTests(unittest.TestCase):
    def test_import_timestamp_does_not_trigger_replacement(self):
        old = fixture()
        candidate = copy.deepcopy(old)
        candidate["meta"]["importedAt"] = "2026-01-05"
        self.assertFalse(data_changed(candidate, old))
        candidate["diagnoses"][0]["count"] = 2
        self.assertTrue(data_changed(candidate, old))

    def test_missing_region_is_rejected(self):
        candidate = fixture()
        candidate["diagnoses"] = [row for row in candidate["diagnoses"] if row["region"] != "Kalmar"]
        with self.assertRaisesRegex(ValueError, "missing a region"):
            validate_candidate(candidate, fixture())

    def test_backward_cutoff_is_rejected(self):
        candidate = fixture()
        candidate["vaccinations"].pop()
        with self.assertRaisesRegex(ValueError, "regressed"):
            validate_candidate(candidate, fixture())

    def test_valid_history_and_gaps_are_accepted(self):
        validate_candidate(fixture(), fixture())

    def test_corrupt_upload_preserves_active_file(self):
        ftp = FakeFTP(corrupt=True)
        with self.assertRaises(ValueError):
            atomic_json(ftp, "data/active.json", {"valid": True})
        self.assertEqual(ftp.files["data/active.json"], b"old valid data")

    def test_interrupted_upload_preserves_active_file(self):
        ftp = FakeFTP(fail=True)
        with self.assertRaises(OSError):
            atomic_json(ftp, "data/active.json", {"valid": True})
        self.assertEqual(ftp.files["data/active.json"], b"old valid data")

    def test_verified_upload_replaces_active_file(self):
        ftp = FakeFTP()
        atomic_json(ftp, "data/active.json", {"valid": True})
        self.assertEqual(json.loads(ftp.files["data/active.json"]), {"valid": True})


if __name__ == "__main__":
    unittest.main()
