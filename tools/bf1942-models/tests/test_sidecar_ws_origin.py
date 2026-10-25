"""The sidecar socket's origin allowlist (sidecar/wsserver.mjs): the live site,
the viewer's host and a local viewer on any port connect; any other page is
refused at the upgrade; a client with no Origin (the node lab probes) connects;
--allow-origin adds more (features/sidecar-desktop-app)."""
import json
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class WsOriginTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", str(HERE / "sidecar_ws_origin_harness.mjs")],
                             capture_output=True, text=True, check=True, timeout=30)
        cls.r = json.loads(out.stdout)

    def allowed(self, origin, extra=False):
        return self.r["check"][origin]["withExtra" if extra else "plain"]

    def test_no_origin_is_allowed(self):
        self.assertTrue(self.allowed("None"))

    def test_the_site_and_the_viewer_host_are_allowed(self):
        for o in ("https://bfstats.io", "https://www.bfstats.io", "https://mesh.bfstats.io",
                  "https://mesh.bfstats.io/", "HTTPS://BFSTATS.IO"):
            self.assertTrue(self.allowed(o), o)

    def test_the_site_over_another_scheme_or_port_is_refused(self):
        for o in ("http://bfstats.io", "https://bfstats.io:8443"):
            self.assertFalse(self.allowed(o), o)

    def test_lookalike_hosts_are_refused(self):
        for o in ("https://evil.bfstats.io", "https://bfstats.io.evil.com", "https://evil.com",
                  "http://localhost.evil.com", "http://127.0.0.1.evil.com:80"):
            self.assertFalse(self.allowed(o), o)

    def test_local_viewers_on_any_port_are_allowed(self):
        for o in ("http://localhost", "http://localhost:5173", "https://localhost:8443",
                  "http://127.0.0.1:8080", "http://[::1]:3000"):
            self.assertTrue(self.allowed(o), o)

    def test_opaque_and_malformed_origins_are_refused(self):
        for o in ("null", "file://", "chrome-extension://abcdef", "http://localhost:5173/path"):
            self.assertFalse(self.allowed(o), o)

    def test_allow_origin_adds_one(self):
        self.assertFalse(self.allowed("https://extra.example"))
        self.assertTrue(self.allowed("https://extra.example", extra=True))
        self.assertFalse(self.allowed("https://evil.com", extra=True))

    def test_a_real_upgrade_follows_the_check(self):
        live = self.r["live"]
        self.assertEqual(live["None"], 101)
        self.assertEqual(live["https://mesh.bfstats.io"], 101)
        self.assertEqual(live["http://localhost:5173"], 101)
        self.assertEqual(live["https://extra.example"], 101)
        self.assertEqual(live["https://evil.com"], 403)
        self.assertEqual(live["null"], 403)
        self.assertEqual(sorted(self.r["refused"]), ["https://evil.com", "null"])


if __name__ == "__main__":
    unittest.main()
