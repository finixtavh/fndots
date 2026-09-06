# test fnsession
from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

MODULE_PATH = Path(__file__).with_name("fnsession")
LOADER = importlib.machinery.SourceFileLoader("fnsession_module", str(MODULE_PATH))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
assert SPEC is not None
fnsession = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(fnsession)

class FnSessionTests(unittest.TestCase):
    def test_safe_name_rejects_punctuation_only(self) -> None:
        with self.assertRaises(fnsession.FnSessionError):
            fnsession.safe_name("///")

    def test_list_sessions_returns_newest_first_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            session_dir = Path(directory)
            older = session_dir / "older.json"
            newer = session_dir / "newer.json"
            older.write_text("{}", encoding="utf-8")
            newer.write_text("{}", encoding="utf-8")
            older.touch()
            newer.touch()
            older_time = newer.stat().st_mtime - 20
            import os
            os.utime(older, (older_time, older_time))
            with (
                mock.patch.object(fnsession, "SESSION_DIR", session_dir),
                mock.patch("builtins.print") as output,
            ):
                self.assertEqual(fnsession.list_sessions(True), 0)
            rows = json.loads(output.call_args.args[0])
            self.assertEqual([row["name"] for row in rows], ["newer", "older"])

    def test_process_command_drops_private_arguments_by_default(self) -> None:
        raw = b"/usr/bin/firefox\0--profile\0/private/profile\0"
        with (
            mock.patch.object(fnsession.Path, "read_bytes", return_value=raw),
            mock.patch.object(fnsession, "CAPTURE_PROCESS_CONTEXT", False),
            mock.patch.object(fnsession, "host_relaunchable", return_value=True),
        ):
            self.assertEqual(
                fnsession.process_command(123, "firefox", "firefox"),
                ["/usr/bin/firefox"],
            )

    def test_process_command_full_context_requires_opt_in(self) -> None:
        raw = b"/usr/bin/firefox\0--profile\0/private/profile\0"
        with (
            mock.patch.object(fnsession.Path, "read_bytes", return_value=raw),
            mock.patch.object(fnsession, "CAPTURE_PROCESS_CONTEXT", True),
        ):
            self.assertEqual(
                fnsession.process_command(123, "firefox", "firefox"),
                ["/usr/bin/firefox", "--profile", "/private/profile"],
            )

    def test_relative_process_command_falls_back_to_window_class(self) -> None:
        raw = b"./steamwebhelper\0--token\0private\0"
        with (
            mock.patch.object(fnsession.Path, "read_bytes", return_value=raw),
            mock.patch.object(fnsession, "CAPTURE_PROCESS_CONTEXT", False),
            mock.patch.object(fnsession.shutil, "which", return_value="/usr/bin/steam"),
        ):
            self.assertEqual(
                fnsession.process_command(123, "steam", "steam"),
                ["/usr/bin/steam"],
            )

    def test_unrelated_new_window_is_never_used_as_fallback(self) -> None:
        saved = {"command": ["/usr/bin/firefox"], "class": "firefox"}
        unrelated = {"address": "0x123", "class": "kitty", "initialClass": "kitty"}
        with (
            mock.patch.object(fnsession.subprocess, "Popen"),
            mock.patch.object(fnsession, "clients", return_value=[unrelated]),
            mock.patch.object(fnsession.time, "monotonic", side_effect=[0.0, 0.0, 999.0]),
            mock.patch.object(fnsession.time, "sleep"),
        ):
            self.assertIsNone(fnsession.launch_window(saved, set()))

    def test_read_session_rejects_invalid_window_types(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            session_dir = Path(directory)
            payload = {
                "format": "fnsession",
                "version": 1,
                "windows": [{
                    "order": "first",
                    "command": [],
                    "workspace": "1",
                    "at": [0, 0],
                    "size": [800, 600],
                }],
            }
            (session_dir / "broken.json").write_text(json.dumps(payload), encoding="utf-8")
            with (
                mock.patch.object(fnsession, "SESSION_DIR", session_dir),
                self.assertRaises(fnsession.FnSessionError),
            ):
                fnsession.read_session("broken")

    def test_geometry_pair_rejects_non_finite_and_boolean_values(self) -> None:
        for value in ([float("nan"), 0], [float("inf"), 0], [True, 0]):
            with self.subTest(value=value):
                self.assertIsNone(fnsession.valid_pair(value))

    def test_scrub_removes_arguments_and_working_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            session_dir = Path(directory)
            session = session_dir / "legacy.json"
            payload = {
                "format": "fnsession",
                "version": 1,
                "windows": [{
                    "class": "firefox",
                    "initial_class": "firefox",
                    "command": ["/usr/bin/firefox", "--token", "private"],
                    "cwd": "/private/path",
                }],
            }
            session.write_text(json.dumps(payload), encoding="utf-8")
            with (
                mock.patch.object(fnsession, "SESSION_DIR", session_dir),
                mock.patch.object(fnsession, "host_relaunchable", return_value=True),
            ):
                self.assertEqual(fnsession.scrub_sessions(True), 0)
            scrubbed = json.loads(session.read_text(encoding="utf-8"))
            self.assertEqual(scrubbed["windows"][0]["command"], ["/usr/bin/firefox"])
            self.assertNotIn("cwd", scrubbed["windows"][0])

    def test_hyprctl_timeout_is_user_facing(self) -> None:
        error = subprocess.TimeoutExpired(["hyprctl", "clients"], timeout=3)
        with mock.patch.object(fnsession.subprocess, "run", side_effect=error):
            with self.assertRaisesRegex(fnsession.FnSessionError, "timed out"):
                fnsession.hyprctl("clients")

if __name__ == "__main__":
    unittest.main()
