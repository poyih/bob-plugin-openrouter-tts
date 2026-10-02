import contextlib
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))
import publish_appcast
import release


def entry(version="1.4.0"):
    return {"version": version, "desc": "test release", "sha256": "a" * 64,
            "url": f"https://github.com/test/plugin/releases/download/v{version}/plugin.bobplugin",
            "minBobVersion": "1.8.0", "timestamp": 1234567890}


def git(root, *arguments):
    result = subprocess.run(["git", "-C", str(root), *arguments], capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="bob-release-test-")
        self.root = pathlib.Path(self.temporary.name)
        self.info = {"identifier": "test.plugin", "version": "1.4.0", "minBobVersion": "1.8.0"}
        (self.root / "info.json").write_text(json.dumps(self.info))
        (self.root / "main.js").write_text("function tts() {}\n")
        (self.root / "README.md").write_text("## Changelog\n- **1.4.0** — 更新 `音频`。\n", encoding="utf-8")

    def tearDown(self):
        self.temporary.cleanup()

    def do_release(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return release.release("1.4.0", "", "test/plugin", 1234567890, root=self.root, metadata_root=self.root, **kwargs)

    def test_bundle_is_repeatable_and_contains_only_installable_sources(self):
        first = release.build_bundle("1.4.0", self.root)
        checksum = release.sha256_of(first)
        self.assertEqual(checksum, release.sha256_of(release.build_bundle("1.4.0", self.root)))
        with zipfile.ZipFile(first) as archive:
            self.assertEqual(archive.namelist(), ["info.json", "main.js"])
            self.assertEqual(json.loads(archive.read("info.json")), self.info)
            self.assertTrue(all(item.date_time == release.ZIP_TIMESTAMP for item in archive.infolist()))

    def test_no_appcast_build_emits_fixed_record_without_changing_metadata(self):
        original = {"identifier": "test.plugin", "versions": [entry("1.3.0")]}
        path = self.root / "appcast.json"
        path.write_text(json.dumps(original))
        before = path.read_bytes()
        bundle, record = self.do_release(update_appcast=False)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(record["sha256"], release.sha256_of(bundle))
        written = json.loads((self.root / "dist/appcast-entry.json").read_text())
        self.assertEqual(written, {"identifier": "test.plugin", "entry": record})
        self.assertEqual(record["timestamp"], 1234567890)
        self.assertEqual(record["desc"], "更新 音频")

    def test_metadata_checkout_cannot_replace_tag_sources(self):
        metadata = self.root / "metadata"
        metadata.mkdir()
        (metadata / "info.json").write_text(json.dumps({**self.info, "version": "2.0.0"}))
        (metadata / "main.js").write_text("different branch code")
        (metadata / "appcast.json").write_text(json.dumps({"identifier": "test.plugin", "versions": [entry("2.0.0")]}))
        with contextlib.redirect_stdout(io.StringIO()):
            bundle, record = release.release("1.4.0", "", "test/plugin", 1234567890, root=self.root, metadata_root=metadata)
        with zipfile.ZipFile(bundle) as archive:
            self.assertEqual(json.loads(archive.read("info.json"))["version"], "1.4.0")
            self.assertEqual(archive.read("main.js"), (self.root / "main.js").read_bytes())
        versions = json.loads((metadata / "appcast.json").read_text())["versions"]
        self.assertEqual([item["version"] for item in versions], ["2.0.0", "1.4.0"])

    def test_version_mismatch_and_invalid_appcast_fail_before_metadata_changes(self):
        path = self.root / "appcast.json"
        path.write_text('{"identifier":"other.plugin","versions":[]}')
        before = path.read_bytes()
        with self.assertRaises(ValueError):
            self.do_release()
        self.assertEqual(path.read_bytes(), before)
        self.assertFalse((self.root / "dist").exists())
        (self.root / "info.json").write_text(json.dumps({**self.info, "version": "1.3.0"}))
        with self.assertRaises(ValueError):
            self.do_release(update_appcast=False)
        self.assertEqual(path.read_bytes(), before)

    def test_bundle_failure_leaves_existing_appcast_untouched(self):
        path = self.root / "appcast.json"
        path.write_text('{"identifier":"test.plugin","versions":[]}')
        before = path.read_bytes()
        (self.root / "main.js").unlink()
        with self.assertRaises(ValueError):
            self.do_release()
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list((self.root / "dist").iterdir()), [])

    def test_semantic_version_sort_and_same_version_replacement(self):
        versions = release.upsert_version([entry("1.4.0"), entry("1.10.0"), entry("1.3.2")], {**entry("1.4.0"), "desc": "replaced"})
        self.assertEqual([item["version"] for item in versions], ["1.10.0", "1.4.0", "1.3.2"])
        self.assertEqual(versions[1]["desc"], "replaced")
        for bad in ["1.4", "v", "../1.4.0", "1.4.0-beta", 1]:
            with self.assertRaises(ValueError):
                release.normalize_version(bad)

    def test_atomic_write_failure_keeps_original_file_and_removes_temporary_file(self):
        path = self.root / "appcast.json"
        path.write_text("original")
        with mock.patch.object(release.os, "replace", side_effect=OSError("write failed")):
            with self.assertRaises(OSError):
                release.write_json_atomic(path, {"new": True})
        self.assertEqual(path.read_text(), "original")
        self.assertEqual(list(self.root.glob(".appcast.json.*.tmp")), [])


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="bob-publish-test-")
        self.root = pathlib.Path(self.temporary.name)
        self.remote = self.root / "origin.git"
        self.checkout = self.root / "metadata"
        git(self.root, "init", "--bare", "--initial-branch=main", str(self.remote))
        git(self.root, "clone", str(self.remote), str(self.checkout))
        git(self.checkout, "config", "user.name", "Test Author")
        git(self.checkout, "config", "user.email", "test@example.test")
        (self.checkout / "appcast.json").write_text(json.dumps({"identifier": "test.plugin", "versions": [entry("1.3.0")]}))
        (self.checkout / "README.md").write_text("original\n")
        git(self.checkout, "add", ".")
        git(self.checkout, "commit", "-m", "initial")
        git(self.checkout, "push", "origin", "main")
        self.original_head = git(self.checkout, "rev-parse", "HEAD")
        self.record = {"identifier": "test.plugin", "entry": entry()}
        self.record_path = self.root / "appcast-entry.json"
        self.record_path.write_text(json.dumps(self.record))

    def tearDown(self):
        self.temporary.cleanup()

    def do_publish(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return publish_appcast.publish(self.record_path, self.checkout, "main", retry_delay=0, **kwargs)

    def remote_appcast(self):
        return json.loads(git(self.remote, "show", "main:appcast.json"))

    def assert_no_extra_worktrees(self):
        lines = git(self.checkout, "worktree", "list", "--porcelain")
        self.assertEqual(sum(line.startswith("worktree ") for line in lines.splitlines()), 1)

    def test_publish_merges_and_preserves_user_checkout_changes(self):
        (self.checkout / "README.md").write_text("uncommitted user change\n")
        (self.checkout / "user-note.txt").write_text("user note")
        status = git(self.checkout, "status", "--porcelain")
        self.assertTrue(self.do_publish())
        self.assertEqual(git(self.checkout, "rev-parse", "HEAD"), self.original_head)
        self.assertEqual(git(self.checkout, "status", "--porcelain"), status)
        self.assertEqual((self.checkout / "README.md").read_text(), "uncommitted user change\n")
        appcast = self.remote_appcast()
        self.assertEqual([item["version"] for item in appcast["versions"]], ["1.4.0", "1.3.0"])
        self.assertEqual(appcast["versions"][0], self.record["entry"])
        self.assert_no_extra_worktrees()

    def test_racing_main_update_is_merged_on_retry_without_rebuilding_record(self):
        other = self.root / "other"
        git(self.root, "clone", str(self.remote), str(other))
        git(other, "config", "user.name", "Other Author")
        git(other, "config", "user.email", "other@example.test")
        real_run_git = publish_appcast.run_git
        pushed = []

        def racing_git(root, arguments, check=True):
            if arguments[0] == "push":
                pushed.append(True)
                if len(pushed) == 1:
                    (other / "README.md").write_text("new remote documentation\n")
                    (other / "appcast.json").write_text(json.dumps({"identifier": "test.plugin", "versions": [entry("1.6.0"), entry("1.3.0")]}))
                    git(other, "add", ".")
                    git(other, "commit", "-m", "concurrent main update")
                    git(other, "push", "origin", "main")
            return real_run_git(root, arguments, check)

        with mock.patch.object(publish_appcast, "run_git", side_effect=racing_git):
            self.assertTrue(self.do_publish())
        self.assertEqual(len(pushed), 2)
        self.assertEqual(git(self.remote, "show", "main:README.md"), "new remote documentation")
        versions = self.remote_appcast()["versions"]
        self.assertEqual([item["version"] for item in versions], ["1.6.0", "1.4.0", "1.3.0"])
        self.assertEqual(versions[1], self.record["entry"])
        self.assert_no_extra_worktrees()

    def test_exact_repeated_record_does_not_create_another_commit(self):
        self.assertTrue(self.do_publish())
        tip = git(self.remote, "rev-parse", "main")
        self.assertFalse(self.do_publish())
        self.assertEqual(git(self.remote, "rev-parse", "main"), tip)
        self.assert_no_extra_worktrees()

    def test_permanent_push_failure_has_bounded_retries_and_cleans_worktrees(self):
        real_run_git = publish_appcast.run_git
        attempts = []

        def failing_push(root, arguments, check=True):
            if arguments[0] == "push":
                attempts.append(True)
                return subprocess.CompletedProcess(arguments, 1, "", "permission denied")
            return real_run_git(root, arguments, check)

        with mock.patch.object(publish_appcast, "run_git", side_effect=failing_push):
            with self.assertRaises(publish_appcast.PublishError):
                self.do_publish(max_attempts=3)
        self.assertEqual(len(attempts), 3)
        self.assertEqual(git(self.remote, "rev-parse", "main"), self.original_head)
        self.assert_no_extra_worktrees()

    def test_identifier_mismatch_prevents_commit_and_cleans_worktree(self):
        self.record_path.write_text(json.dumps({**self.record, "identifier": "other.plugin"}))
        with self.assertRaises(ValueError):
            self.do_publish()
        self.assertEqual(git(self.remote, "rev-parse", "main"), self.original_head)
        self.assert_no_extra_worktrees()

    def test_invalid_record_is_rejected_before_git_mutation(self):
        for malformed in [{}, {**self.record, "entry": {**self.record["entry"], "sha256": "invalid"}}, {**self.record, "entry": {**self.record["entry"], "version": "v1.4.0"}}]:
            self.record_path.write_text(json.dumps(malformed))
            with mock.patch.object(publish_appcast, "run_git") as mocked:
                with self.assertRaises(ValueError):
                    self.do_publish()
                mocked.assert_not_called()


if __name__ == "__main__":
    unittest.main()
