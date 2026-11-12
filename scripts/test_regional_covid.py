"""Regression checks for the restricted CSV importer; uses synthetic data."""
import tempfile
import unittest
from pathlib import Path
from import_regional_covid import read_rows


class ImportTests(unittest.TestCase):
    def test_gap_is_not_zero_and_explicit_zero_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic.csv"
            path.write_text("Datum;Region;Count\n2026-10-03;Kalmar;2\n2026-10-01;Kalmar;0\n", encoding="utf-8")
            rows = read_rows(path, "Datum", "Region", {"count": "Count"})
            self.assertEqual([row["date"] for row in rows], ["2026-10-01", "2026-10-03"])
            self.assertEqual(rows[0]["count"], 0)

    def test_rejects_duplicate_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic.csv"
            path.write_text("Datum;Region;Count\n2026-10-01;Kalmar;1\n2026-10-01;Kalmar;2\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                read_rows(path, "Datum", "Region", {"count": "Count"})


if __name__ == "__main__":
    unittest.main()
