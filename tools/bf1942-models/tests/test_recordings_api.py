"""`viewer/recordings-api.js` and the REPLAY feed's links, under node, through
`recordings_api_harness.mjs` (features/replay-feed).

A shared recording is played as `map.html?replay=<API>/stats/recordings/<slug>.ndjson`:
the replay's comments (`replay-social.js`) know the recording, and which API to
ask, from that URL alone. A time in a comment is a link into the round, read
with the same pattern the API reads a comment's first time with
(`api/Recordings/RecordingText.cs`). The pages, the upload and the replay's
comments are checked in a browser against a running API.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "recordings_api_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RecordingsApiTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_shared_recording_is_known_by_its_url(self) -> None:
        shared = self.results["shared"]
        self.assertEqual(shared["sameOrigin"], {"slug": "abcdefghjk", "base": ""})
        self.assertEqual(shared["absoluteSame"], {"slug": "abcdefghjk", "base": ""})
        self.assertEqual(shared["localApi"], {"slug": "abcdefghjk", "base": "http://localhost:9222"})
        self.assertEqual(shared["withQuery"], {"slug": "abcdefghjk", "base": ""})
        # A file, one held for the page, a malformed slug and a server log are
        # not the feed's recordings.
        for key in ("file", "held", "shortSlug", "serverLog"):
            self.assertIsNone(shared[key], key)

    def test_an_api_is_this_sites_a_local_ones_or_read_only(self) -> None:
        self.assertEqual(self.results["modes"], {
            "same": "same", "sameExplicit": "same", "local": "local", "remote": "remote",
        })

    def test_the_times_in_a_comment_are_places_in_the_round(self) -> None:
        runs = self.results["runs"]
        linked = [(r["text"], r["at"]) for r in runs if "at" in r]
        # 1:02:03 is past the end, 12:3 and 20:61 are not times.
        self.assertEqual(linked, [("0:21", 21), ("12:40", 760)])
        self.assertEqual("".join(r["text"] for r in runs), "0:21 get rekt, then 12:40 and 1:02:03 or 12:3 and 20:61")
        self.assertEqual([(r["text"], r.get("at")) for r in self.results["runsPastEnd"]],
                         [("at 59:00 then ", None), ("0:30", 30)])

    def test_a_query_keeps_its_paths_readable(self) -> None:
        self.assertEqual(
            self.results["query"],
            "mod=bf1942&map=midway&replay=http://localhost:9222/stats/recordings/abcdefghjk.ndjson&t=21&name=a%20b%26c")

    def test_the_feed_says_lengths_counts_and_ages_as_people_do(self) -> None:
        self.assertEqual(self.results["clock"], ["0:00", "0:59", "14:43", "1:02:03", "0:00"])
        self.assertEqual(self.results["count"], [
            "0 views", "1 view", "2 views", "1.2K views", "13K views", "1M views", "3 comments"])
        self.assertEqual(self.results["ago"], [
            "2 seconds ago", "1 minute ago", "2 hours ago", "3 days ago", "2 months ago", ""])
        self.assertEqual(self.results["size"], ["0 MB", "512 MB", "1.5 GB", "20 GB"])

    def test_signing_in_goes_by_way_of_bfstats_io(self) -> None:
        sign_in = self.results["signIn"]
        self.assertEqual(
            sign_in["play"],
            "https://bfstats.io/auth/discord/start?returnTo=https%3A%2F%2Fplay.bfstats.io%2Fplay%2F%3Ftab%3Dreplay%26rec%3Dabcdefghjk")
        # A page served from this PC signs in on its own origin (a local UI).
        self.assertTrue(sign_in["local"].startswith("http://localhost:5273/auth/discord/start?returnTo="))

    def test_watching_names_the_mod_the_level_and_the_moment(self) -> None:
        watch = self.results["watch"]
        self.assertEqual(
            watch["plain"],
            "https://play.bfstats.io/map.html?mod=bf1942&map=midway"
            "&replay=/stats/recordings/abcdefghjk.ndjson&serverlog=/stats/recordings/abcdefghjk.xml")
        self.assertEqual(
            watch["at"],
            "https://play.bfstats.io/map.html?mod=bf1942&map=midway&replay=/stats/recordings/abcdefghjk.ndjson&t=21")
        self.assertIn("replay=http://localhost:9222/stats/recordings/abcdefghjk.ndjson", watch["localApi"])

    def test_a_recording_is_shared_under_the_player_who_recorded_it(self) -> None:
        # The name the share dialogs offer first, found as the API finds it
        # (RecordingInspectorTests): the roster's local player, the pid of his
        # own shots under the name it had when he fired, his chat, the only
        # human; of several humans with nothing marking one, nobody.
        self.assertEqual(self.results["recorder"], {
            "v2Lab": "skandia", "v3Lab": "skandia", "roster": "skandia", "ownShots": "skandia",
            "v3Trigger": "skandia", "chat": "skandia", "severalHumans": "", "nobody": "",
        })


if __name__ == "__main__":
    unittest.main()
