"""Windows / POSIX differences the extraction pipeline meets, in one place.

stdlib only. On POSIX every path and call here is what `mod_pipeline.py` used
before it ran on Windows: the same `/tmp/claude-1000/chromium.lock` that a job
using `flock /tmp/claude-1000/chromium.lock <cmd>` takes, the same
`/tmp/bfstats-gpu-busy` flag, `fcntl.flock`, a new session for a child and
`killpg`. On Windows the lock is `msvcrt.locking`, the paths sit in
`tempfile.gettempdir()` and a child tree ends with `taskkill /T /F`.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

POSIX_CHROMIUM_LOCK = "/tmp/claude-1000/chromium.lock"
POSIX_GPU_BUSY_FLAG = "/tmp/bfstats-gpu-busy"


def is_windows() -> bool:
    return os.name == "nt"


def chromium_lock_path() -> str:
    """The shared Chromium lock file. POSIX keeps the literal path other jobs'
    `flock` calls use; Windows has no /tmp, so it goes in the temp dir."""
    if not is_windows():
        return POSIX_CHROMIUM_LOCK
    return str(Path(tempfile.gettempdir()) / "bfstats" / "chromium.lock")


def gpu_busy_flag_path() -> Path:
    """The file another session creates while it films on the GPU."""
    if not is_windows():
        return Path(POSIX_GPU_BUSY_FLAG)
    return Path(tempfile.gettempdir()) / "bfstats-gpu-busy"


class FileLock:
    """An exclusive advisory lock on a file, held between `acquire` and
    `release` (or as a context manager). `fcntl.flock` on POSIX, so it
    coordinates with the `flock(1)` command; `msvcrt.locking` of the first byte
    on Windows."""

    def __init__(self, path: str | os.PathLike, poll_s: float = 0.2):
        self.path = os.fspath(path)
        self.poll_s = poll_s
        self.fd: int | None = None

    def acquire(self, timeout: float | None = None) -> bool:
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o666)
        deadline = None if timeout is None else time.monotonic() + timeout
        try:
            if is_windows():
                import msvcrt
                while True:
                    try:
                        os.lseek(fd, 0, os.SEEK_SET)
                        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                        break
                    except OSError:
                        if deadline is not None and time.monotonic() >= deadline:
                            os.close(fd)
                            return False
                        time.sleep(self.poll_s)
            else:
                import fcntl
                if deadline is None:
                    fcntl.flock(fd, fcntl.LOCK_EX)
                else:
                    while True:
                        try:
                            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                            break
                        except OSError:
                            if time.monotonic() >= deadline:
                                os.close(fd)
                                return False
                            time.sleep(self.poll_s)
        except BaseException:
            try:
                os.close(fd)
            except OSError:
                pass
            raise
        self.fd = fd
        return True

    def release(self) -> None:
        if self.fd is None:
            return
        fd, self.fd = self.fd, None
        try:
            if is_windows():
                import msvcrt
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self.release()
        return False


# child processes -----------------------------------------------------------


def group_popen_kwargs() -> dict:
    """Popen kwargs that put the child (and what it spawns) in a group of its own."""
    if is_windows():
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def terminate_tree(proc: subprocess.Popen, force: bool = False) -> None:
    """End `proc` and its descendants. POSIX: SIGTERM (SIGKILL when `force`) to
    the group `group_popen_kwargs` made. Windows: `taskkill /T /F`, which has no
    gentler form for a console child. A tree already gone is not an error."""
    if is_windows():
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        return
    import signal
    sig = signal.SIGKILL if force else signal.SIGTERM
    try:
        os.killpg(proc.pid, sig)
    # macOS answers EPERM, not ESRCH, for a group whose only members are
    # zombies (exited on the SIGTERM, not yet reaped).
    except (ProcessLookupError, PermissionError):
        pass


def killed_by_sigkill(rc: int) -> bool:
    """A command the kernel's OOM killer ended: SIGKILL (no such signal on Windows)."""
    return rc in (-9, 128 + 9)


def python_cmd() -> str:
    """The interpreter name for child scripts: `python3` on POSIX (what the
    recipe has always run), this interpreter on Windows, where `python3` is
    often the Store stub or absent."""
    return sys.executable if is_windows() else "python3"


def native_argv(argv: list[str]) -> list[str]:
    """`argv` with a leading `python3` swapped for `python_cmd()`."""
    if argv and argv[0] == "python3":
        return [python_cmd(), *argv[1:]]
    return list(argv)


def ensure_utf8_mode() -> None:
    """Windows reads and writes text in the ANSI code page by default; the
    pipeline's JSON and logs are UTF-8. Mark the children UTF-8 and, when this
    process is not, run it again in UTF-8 mode and exit with its status."""
    if not is_windows():
        return
    os.environ["PYTHONUTF8"] = "1"
    if not sys.flags.utf8_mode:
        raise SystemExit(subprocess.run([sys.executable, "-X", "utf8", *sys.argv]).returncode)
