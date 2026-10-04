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

    def test_an_uploader_links_to_their_player_page(self) -> None:
        self.assertEqual(self.results["playerHref"], [
            "https://bfstats.io/v4/players/skandia",
            "https://bfstats.io/v4/players/%3D%E2%80%A2NDR%E2%80%A2%3DLapu",
            "https://bfstats.io/v4/players/a%2Fb%3Fc%23d",
        ])

    def test_signing_in_goes_by_way_of_bfstats_io(self) -> None:
        sign_in = self.results["signIn"]
        self.assertEqual(
            sign_in["play"],
            "https://bfstats.io/auth/login?returnTo=https%3A%2F%2Fplay.bfstats.io%2Fplay%2F%3Ftab%3Dreplay%26rec%3Dabcdefghjk")
        # A page served from this PC signs in on its own origin (a local UI).
        self.assertTrue(sign_in["local"].startswith("http://localhost:5273/auth/login?returnTo="))

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

    def test_a_recording_is_linked_by_its_short_link(self) -> None:
        self.assertEqual(self.results["short"], {
            "play": "https://replay.bfstats.io/abcdefghjk",
            "at": "https://replay.bfstats.io/abcdefghjk?t=95",
            # The live feed read from this PC: its recordings are the live ones.
            "liveFromHere": "https://replay.bfstats.io/abcdefghjk",
            # This PC's own API, however the page reaches it: no host answers
            # a short link for its recordings.
            "localApi": None,
            "sameOnThisPc": None,
        })

    def test_a_recording_is_shared_under_the_player_who_recorded_it(self) -> None:
        # The name the share dialogs offer first, found as the API finds it
        # (RecordingInspectorTests): the roster's local player, the pid of his
        # own shots under the name it had when he fired, his chat, the only
        # human; of several humans with nothing marking one, nobody.
        self.assertEqual(self.results["recorder"], {
            "v2Lab": "skandia", "v3Lab": "skandia", "roster": "skandia", "ownShots": "skandia",
            "v3Trigger": "skandia", "chat": "skandia", "severalHumans": "", "nobody": "",
        })

    def test_a_round_is_watched_merged_the_one_asked_about_first(self) -> None:
        round_ = self.results["round"]
        self.assertEqual(round_["urls"], ["/stats/recordings/bbbbbbbbbb.ndjson", "/stats/recordings/aaaaaaaaaa.ndjson"])
        self.assertEqual(round_["one"], ["/stats/recordings/bbbbbbbbbb.ndjson"])
        self.assertEqual(
            round_["watch"],
            "https://play.bfstats.io/map.html?mod=bf1942&map=bocage"
            "&replay=/stats/recordings/bbbbbbbbbb.ndjson&replay=/stats/recordings/aaaaaaaaaa.ndjson"
            "&replay=/stats/recordings/cccccccccc.ndjson")
        # The first recording's server log comes with it.
        self.assertEqual(
            round_["watchLocal"],
            "https://play.bfstats.io/map.html?replay=http://localhost:9222/stats/recordings/aaaaaaaaaa.ndjson"
            "&replay=http://localhost:9222/stats/recordings/bbbbbbbbbb.ndjson"
            "&replay=http://localhost:9222/stats/recordings/cccccccccc.ndjson"
            "&serverlog=http://localhost:9222/stats/recordings/aaaaaaaaaa.xml")
        # A round is two or more recordings.
        self.assertEqual(round_["roundOf"], [3, None, None])

    def test_a_rounds_comments_are_moved_onto_the_merged_clock(self) -> None:
        round_ = self.results["round"]
        self.assertEqual(round_["toRound"], 499.98)
        self.assertEqual(round_["back"], 123.4)
        # The lead's own 0:21 is 1:21 of the round; a time past its end stays text.
        self.assertEqual(round_["runs"], [{"text": "1:21", "at": 81}, {"text": " get rekt, 12:40 past its end"}])

    def test_a_comment_on_a_round_goes_on_the_recording_that_holds_its_moment(self) -> None:
        self.assertEqual(self.results["round"]["targets"], [
            {"index": 0, "text": "no time at all"},
            {"index": 0, "text": "0:21 in the lead"},
            {"index": 1, "text": "0:30 before the lead began"},
            {"index": 2, "text": "3:10 and 3:30 after the lead ended"},
            {"index": 2, "text": "5:00 in the third only"},
            {"index": 0, "text": "58:00 in none"},
        ])

    def test_a_round_is_one_card_and_the_header_counts_both(self) -> None:
        switch = self.results["switch"]
        self.assertEqual(switch["count"], ["4 rounds · 6 recordings", "3", "1 round · 2 recordings", ""])
        # A card is a round when the API grouped it (roundCard) and it has two
        # or more recordings.
        self.assertEqual(switch["card"], [3, None, None])

    def test_the_replays_switch_keeps_the_moment_on_screen(self) -> None:
        switch = self.results["switch"]
        # Merged, at 100 s of the round (the lead 60 s in, a's clock 40 ppm
        # slow): merged again, a alone, the lead alone, c before it began, d
        # (its place unmeasured) not at all.
        self.assertEqual(switch["fromMerged"], [100, 100.004, 40, 0, None])
        # The lead alone at 40 s is 100 s of the round.
        self.assertEqual(switch["fromLead"], [100, 100, 40, 0, None])
        # Past a recording's end, its end.
        self.assertEqual(switch["pastEnds"], [476, 200])
        # From a recording whose place nothing measured: only itself.
        self.assertEqual(switch["fromUnplaced"], [None, None, 50])

    def test_a_card_offers_what_the_viewer_may_change(self) -> None:
        managed = self.results["managed"]
        # A recording on its own: when the API says this viewer may.
        self.assertEqual(managed["own"], ["aaaaaaaaaa"])
        self.assertEqual(managed["others"], [])
        self.assertEqual(managed["unsaid"], [])
        # A round: each of its recordings the viewer may change, in round
        # order, whether or not the lead is one.
        self.assertEqual(managed["round"], ["aaaaaaaaaa", "cccccccccc"])
        self.assertEqual(managed["roundNone"], [])
        self.assertEqual(managed["nothing"], [])

    def test_a_share_is_titled_by_its_level_and_server_until_renamed(self) -> None:
        self.assertEqual(self.results["defaultTitle"], [
            "Battle of Midway on MoonGamers.com | Est. 2004",
            "Bocage",
            "",
            "",
        ])

    def test_the_feed_narrows_to_a_server_and_an_uploader(self) -> None:
        filtered = self.results["filtered"]
        # An empty filter is left out of the API's query.
        self.assertEqual(filtered["asked"], [
            "https://bfstats.io/stats/recordings?sort=views&page=2&pageSize=24&server=MoonGamers.com%20%7C%20Est.%202004",
            "https://bfstats.io/stats/recordings?sort=recent&page=1&pageSize=24",
            "https://bfstats.io/stats/recordings/filters?uploader=a%20b%26c",
            "https://bfstats.io/stats/recordings/filters",
        ])
        # The page's own address names the filter, so it can be linked and gone back to.
        self.assertEqual(filtered["href"], "?tab=replay&server=MoonGamers.com%20%7C%20Est.%202004&uploader=Rut")
        self.assertEqual(filtered["hrefAll"], "?tab=replay")
        self.assertEqual(filtered["of"], {"server": "Moon Gamers", "uploader": ""})
        self.assertEqual(filtered["ofNone"], {"server": "", "uploader": ""})


if __name__ == "__main__":
    unittest.main()
