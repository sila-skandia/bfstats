"""bf42.portable and bf42.gamedir: what lets the pipeline run on Windows as well as POSIX."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from bf42 import gamedir, portable  # noqa: E402


class LockTest(unittest.TestCase):
    def test_a_second_holder_waits_until_release(self):
        with tempfile.TemporaryDirectory() as t:
            path = Path(t) / "sub" / "x.lock"
            a = portable.FileLock(path)
            self.assertTrue(a.acquire())
            # fcntl locks are per open file description, so a second FileLock in this process contends too.
            b = portable.FileLock(path, poll_s=0.01)
            self.assertFalse(b.acquire(timeout=0.1))
            a.release()
            self.assertTrue(b.acquire(timeout=1))
            b.release()

    def test_posix_paths_stay_the_ones_flock_jobs_use(self):
        if os.name == "nt":
            self.skipTest("POSIX only")
        self.assertEqual(portable.chromium_lock_path(), "/tmp/claude-1000/chromium.lock")
        self.assertEqual(portable.gpu_busy_flag_path(), Path("/tmp/bfstats-gpu-busy"))

    def test_windows_paths_are_in_the_temp_dir(self):
        with mock.patch.object(portable, "is_windows", return_value=True), \
                mock.patch.object(portable.subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200, create=True):
            self.assertTrue(portable.chromium_lock_path().startswith(tempfile.gettempdir()))
            self.assertEqual(portable.python_cmd(), sys.executable)
            self.assertEqual(portable.native_argv(["python3", "x.py"]), [sys.executable, "x.py"])
            self.assertIn("creationflags", portable.group_popen_kwargs())

    def test_posix_keeps_python3(self):
        with mock.patch.object(portable, "is_windows", return_value=False):
            self.assertEqual(portable.native_argv(["python3", "x.py"]), ["python3", "x.py"])
            self.assertEqual(portable.group_popen_kwargs(), {"start_new_session": True})


class GameDirTest(unittest.TestCase):
    def test_env_var_wins(self):
        with mock.patch.dict(os.environ, {"BF42_GAME_DIR": "/somewhere/Battlefield 1942"}):
            self.assertEqual(gamedir.default_game_dir(), Path("/somewhere/Battlefield 1942"))

    def test_posix_default_is_the_wine_prefix(self):
        env = {k: v for k, v in os.environ.items() if k != "BF42_GAME_DIR"}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(gamedir.os, "name", "posix"):
            self.assertEqual(gamedir.default_game_dir(), Path.home() / ".wine/drive_c/EA Games/Battlefield 1942")

    def test_windows_probes_the_install_folders(self):
        env = {k: v for k, v in os.environ.items() if k != "BF42_GAME_DIR"}
        env["ProgramFiles(x86)"] = r"C:\Program Files (x86)"
        # windows_candidates() reads only the environment, so it is checked without faking os.name (which breaks
        # pathlib on a POSIX host).
        with mock.patch.dict(os.environ, env, clear=True):
            cands = [str(p) for p in gamedir.windows_candidates()]
            self.assertTrue(any("EA GAMES" in c and "Battlefield 1942" in c for c in cands))


if __name__ == "__main__":
    unittest.main()
