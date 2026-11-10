"""Fly the dogfight school's lessons on Desert Combat's jets, for the tests
(features/dogfight-lessons-jets): `dogfight_jet_harness.mjs` over the
published airframes in `fixtures/dc-jets.json`.

    from jet_school import jet_lesson, jet_fit
    runs = jet_lesson("boom-and-zoom")["demos"]["counter"]     # nine starts
    runs = jet_lesson("boom-and-zoom", demo="move")["demos"]["move"]
"""

from __future__ import annotations

import functools
import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "dogfight_jet_harness.mjs"


def _run(*args: str) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS), *args], capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"jet harness failed ({' '.join(args)}):\n{proc.stderr[-3000:]}")
    return json.loads(proc.stdout)


@functools.lru_cache(maxsize=None)
def jet_fit() -> dict:
    """What `fitAirframe` makes of each jet, and the pieces it is made of."""
    return _run("--fit")


@functools.lru_cache(maxsize=None)
def jet_live() -> dict:
    """The live fight's seats (`dogfight-live.js`) flown off the page on the
    jets, beside `runDuel` flying the same sides."""
    return _run("--live")


@functools.lru_cache(maxsize=None)
def jet_lesson(lesson: str, plane: str = "F16", demo: str | None = None, base: bool = False) -> dict:
    """A lesson's demos from the nine starts on `plane`: `{"demos": {id: [run]}}`.
    `base` flies the lesson as written, without its jet file."""
    args = [lesson, "--plane", plane]
    if demo:
        args += ["--demo", demo]
    if base:
        args.append("--base")
    return _run(*args)


@functools.lru_cache(maxsize=None)
def jet_steps(lesson: str) -> dict:
    """The jet lesson's own step lists, each step timed on one flight:
    `{"steps": {demo: [{"phase", "t"}]}, "spitfires": {demo: bool}}`."""
    return _run(lesson, "--steps")


def shot_down(runs: list[dict], side: int) -> int:
    """In how many of the runs `side` (0 the ace, 1 you) was shot down."""
    return sum(1 for r in runs if r["winner"] == 1 - side and r["why"] == "shot down")
