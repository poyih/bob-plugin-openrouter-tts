import copy
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import check_catalog
import generate_catalog


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.catalog = generate_catalog.load_catalog()
        self.response = {"data": []}
        for model in self.catalog["models"]:
            family = self.catalog["families"][model["family"]]
            option = family["voiceOption"]
            voices = [voice["value"] for voice in option["menuValues"]] if option and not family["optionalVoice"] else None
            self.response["data"].append({"id": model["id"], "supported_voices": voices})

    def test_added_removed_models_and_changed_voices_are_reported(self):
        response = copy.deepcopy(self.response)
        removed = response["data"].pop()
        changed = response["data"][0]
        old_voice = changed["supported_voices"].pop()
        changed["supported_voices"].append("new-voice")
        response["data"].append({"id": "provider/new-model", "supported_voices": None})
        issues = check_catalog.compare_catalog(self.catalog, response)
        self.assertTrue(any("provider/new-model" in issue for issue in issues))
        self.assertTrue(any(removed["id"] in issue for issue in issues))
        self.assertTrue(any("new-voice" in issue for issue in issues))
        self.assertTrue(any(old_voice in issue for issue in issues))

    def test_unlisted_provider_voices_do_not_reject_community_references(self):
        self.assertEqual(check_catalog.compare_catalog(self.catalog, self.response), [])
        fish = next(model for model in self.response["data"] if model["id"].startswith("fish-audio/"))
        self.assertIsNone(fish["supported_voices"])

    def test_invalid_remote_catalog_cannot_pass_as_an_empty_directory(self):
        for bad in [{}, {"data": []}, {"data": [{}]}, {"data": [{"id": "model", "supported_voices": "voice"}]}]:
            with self.assertRaises(ValueError):
                check_catalog.compare_catalog(self.catalog, bad)

    def test_generator_is_repeatable_and_matches_committed_runtime_and_ui(self):
        expected = generate_catalog.generated_files()
        for name, contents in expected.items():
            self.assertEqual((ROOT / name).read_text(encoding="utf-8"), contents, name)
        with tempfile.TemporaryDirectory(prefix="bob-catalog-test-") as directory:
            root = pathlib.Path(directory)
            (root / "catalog.json").write_text(json.dumps(self.catalog), encoding="utf-8")
            for name, contents in expected.items():
                (root / name).write_text(contents, encoding="utf-8")
            self.assertEqual(generate_catalog.generated_files(root), expected)

    def test_invalid_duplicate_models_and_invalid_defaults_fail_generation(self):
        with tempfile.TemporaryDirectory(prefix="bob-catalog-test-") as directory:
            root = pathlib.Path(directory)
            catalog = copy.deepcopy(self.catalog)
            catalog["models"].append(copy.deepcopy(catalog["models"][0]))
            (root / "catalog.json").write_text(json.dumps(catalog))
            with self.assertRaises(ValueError):
                generate_catalog.load_catalog(root)
            catalog = copy.deepcopy(self.catalog)
            catalog["families"]["gemini"]["voiceOption"]["defaultValue"] = "missing-voice"
            (root / "catalog.json").write_text(json.dumps(catalog))
            with self.assertRaises(ValueError):
                generate_catalog.load_catalog(root)


if __name__ == "__main__":
    unittest.main()
