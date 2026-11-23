"""`mesh/nginx.conf`: a link preview of a recording's page in the feed, or of
its replay, is sent to the recording's short link, whose page carries the
recording's own title, line and picture; a browser gets the page as before
(features/replay-feed, "Links pasted from the address bar").

The rules are nginx `map` blocks, read here as text and run as the regular
expressions they are: the reader's User-Agent, then the host, path and query
value joined the way the map's key joins them."""

# watches: mesh/nginx.conf

from __future__ import annotations

import re
import unittest
from pathlib import Path

NGINX = Path(__file__).resolve().parents[3] / "mesh" / "nginx.conf"

DISCORD = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"
IMESSAGE = "facebookexternalhit/1.1 Facebot Twitterbot/1.0"
SIGNAL = "WhatsApp/2"
SLACK = "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"
TELEGRAM = "TelegramBot (like TwitterBot)"
CHROME = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
SAFARI_IOS = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
              "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
DISCORD_APP = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
               "discord/0.0.320 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36")


def map_block(text: str, variable: str) -> list[tuple[re.Pattern, str]]:
    """The regex rows of the `map … $variable { … }` block, in order."""
    found = re.search(r"^map\s+\S+\s+\$" + re.escape(variable) + r"\s*\{(.*?)^\}", text, re.S | re.M)
    if not found:
        raise AssertionError(f"no map for ${variable} in {NGINX}")
    rows = []
    for row in re.finditer(r'^\s*"~(\*?)(.+?)"\s+(.+?);\s*$', found.group(1), re.M):
        # PCRE's named group to Python's; the conf doubles no backslashes.
        pattern = row.group(2).replace("(?<", "(?P<")
        rows.append((re.compile(pattern, re.I if row.group(1) else 0), row.group(3).strip().strip('"')))
    return rows


def lookup(rows: list[tuple[re.Pattern, str]], key: str) -> str:
    """What nginx's map gives for `key`: the first row that matches, its
    value with the row's named captures filled in; else the default, empty."""
    for pattern, value in rows:
        hit = pattern.search(key)
        if hit:
            return re.sub(r"\$(\w+)", lambda m: hit.groupdict().get(m.group(1), m.group(0)), value)
    return ""


class UnfurlRedirectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        text = NGINX.read_text(encoding="utf-8")
        cls.text = text
        cls.unfurler = map_block(text, "link_unfurler")
        cls.feed = map_block(text, "unfurl_feed_recording")
        cls.watch = map_block(text, "unfurl_watch_recording")
        cls.query = map_block(text, "unfurl_query")

    def is_unfurler(self, agent: str) -> str:
        return "1" if lookup(self.unfurler, agent) == "1" else "0"

    def feed_slug(self, agent: str, host: str, uri: str, rec: str) -> str:
        return lookup(self.feed, f"{self.is_unfurler(agent)}:{host}{uri}:{rec}")

    def watch_slug(self, agent: str, host: str, uri: str, replay: str) -> str:
        return lookup(self.watch, f"{self.is_unfurler(agent)}:{host}{uri}:{replay}")

    def test_the_readers_that_unfurl_links_are_known(self) -> None:
        for agent in (DISCORD, IMESSAGE, SIGNAL, SLACK, TELEGRAM):
            self.assertEqual(self.is_unfurler(agent), "1", agent)

    def test_a_browser_is_not_one_of_them(self) -> None:
        # The Discord app itself is a browser: it opens the page.
        for agent in (CHROME, SAFARI_IOS, DISCORD_APP, ""):
            self.assertEqual(self.is_unfurler(agent), "0", agent)

    def test_a_feed_link_goes_to_the_recordings_short_link(self) -> None:
        for uri in ("/play/", "/play/index.html"):
            self.assertEqual(self.feed_slug(DISCORD, "play.bfstats.io", uri, "fc4wb3tu6b"), "fc4wb3tu6b")
        self.assertEqual(self.feed_slug(CHROME, "play.bfstats.io", "/play/", "fc4wb3tu6b"), "")

    def test_only_a_slug_on_the_play_hosts_feed(self) -> None:
        cases = [
            ("play.bfstats.io", "/play/", ""),
            ("play.bfstats.io", "/play/", "../../etc"),
            ("play.bfstats.io", "/play/", "fc4wb3tu6b0"),
            ("play.bfstats.io", "/play/", "fc4wb3tu6b/x"),
            ("play.bfstats.io", "/play/front-end.js", "fc4wb3tu6b"),
            ("play.bfstats.io", "/map.html", "fc4wb3tu6b"),
            ("localhost", "/play/", "fc4wb3tu6b"),
            ("mesh.bfstats.io", "/play/", "fc4wb3tu6b"),
            ("playxbfstats.io", "/play/", "fc4wb3tu6b"),
        ]
        for host, uri, rec in cases:
            self.assertEqual(self.feed_slug(DISCORD, host, uri, rec), "", (host, uri, rec))

    def test_a_replay_link_goes_to_the_recordings_short_link(self) -> None:
        for replay in ("/stats/recordings/fc4wb3tu6b.ndjson", "%2Fstats%2Frecordings%2Ffc4wb3tu6b.ndjson",
                       "%2fstats%2frecordings%2ffc4wb3tu6b.ndjson"):
            self.assertEqual(self.watch_slug(DISCORD, "play.bfstats.io", "/map.html", replay), "fc4wb3tu6b", replay)
        self.assertEqual(
            self.watch_slug(CHROME, "play.bfstats.io", "/map.html", "/stats/recordings/fc4wb3tu6b.ndjson"), "")

    def test_only_a_shared_recording_on_the_play_hosts_map_page(self) -> None:
        cases = [
            ("play.bfstats.io", "/map.html", ""),
            ("play.bfstats.io", "/map.html", "/replays/round.ndjson"),
            ("play.bfstats.io", "/map.html", "/stats/recordings/fc4wb3tu6b.xml"),
            ("play.bfstats.io", "/map.html", "https://elsewhere.example/stats/recordings/fc4wb3tu6b.ndjson"),
            ("play.bfstats.io", "/play/", "/stats/recordings/fc4wb3tu6b.ndjson"),
            ("localhost", "/map.html", "/stats/recordings/fc4wb3tu6b.ndjson"),
        ]
        for host, uri, replay in cases:
            self.assertEqual(self.watch_slug(DISCORD, host, uri, replay), "", (host, uri, replay))

    def test_the_moment_and_the_edit_go_with_it(self) -> None:
        self.assertEqual(lookup(self.query, ":"), "")
        self.assertEqual(lookup(self.query, "95:"), "?t=95")
        self.assertEqual(lookup(self.query, ":k3f9ab2c"), "?edit=k3f9ab2c")
        self.assertEqual(lookup(self.query, "95:k3f9ab2c"), "?t=95&edit=k3f9ab2c")
        # What is not a moment or a code is left behind, never passed on.
        self.assertEqual(lookup(self.query, "9x:"), "")
        self.assertEqual(lookup(self.query, "9x:k3f9ab2c"), "?edit=k3f9ab2c")
        self.assertEqual(lookup(self.query, "95:a&b=c"), "?t=95")
        self.assertEqual(lookup(self.query, "1234567:"), "")

    def test_each_redirect_is_never_stored(self) -> None:
        """A redirect held at the edge would be handed to a browser."""
        blocks = re.findall(r"if \(\$unfurl_(?:feed|watch)_recording\) \{(.*?)\}", self.text, re.S)
        self.assertEqual(len(blocks), 2)
        for block in blocks:
            self.assertIn('add_header Cache-Control "no-store" always;', block)
            self.assertIn('add_header CDN-Cache-Control "no-store" always;', block)
            self.assertRegex(block, r"return 302 https://replay\.bfstats\.io/\$unfurl_(?:feed|watch)_recording\$unfurl_query;")


if __name__ == "__main__":
    unittest.main()
