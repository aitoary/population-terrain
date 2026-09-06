import json
import unittest
from pathlib import Path
from unittest.mock import patch

import verify_data


class ReadOnlyVerificationTests(unittest.TestCase):
    def test_real_archives_and_outputs_without_writes(self):
        with patch.object(Path, "write_bytes", side_effect=AssertionError("Unexpected write")), patch.object(Path, "write_text", side_effect=AssertionError("Unexpected write")):
            report = verify_data.verify()
        self.assertEqual(report["valuesChecked"], 7612)
        self.assertEqual(report["borderLineStrings"], 1823)
        self.assertEqual(report["station"]["2050"], 377.5496)

    def test_rejects_revised_original(self):
        with patch.object(verify_data, "digest", return_value="invalid"), self.assertRaisesRegex(ValueError, "hash mismatch"):
            verify_data.verify()

    def test_rejects_modified_public_population(self):
        original = Path.read_text

        def read(path, *args, **kwargs):
            text = original(path, *args, **kwargs)
            if path.name == "miyako-population.geojson":
                data = json.loads(text)
                data["features"][0]["properties"]["population"]["2050"] = 123456
                return json.dumps(data)
            return text

        with patch.object(Path, "read_text", read), self.assertRaisesRegex(ValueError, "differ from pinned PTN"):
            verify_data.verify()


if __name__ == "__main__":
    unittest.main()
