"""The viewer's profile on the bfstats.io account: `viewer/profile-sync.js`.

features/game-profiles. Signed in, the account's active profile is the one
the page plays with (over the localStorage copy, which stays as the offline
cache); an import or a DEFAULT goes back to the account two seconds after the
last change; the picker switches the active profile; and the active
profile's player name is who a `--name-from-page` sidecar joins as. Signed
out, offline or with the API failing, the page keeps working from
localStorage and says so once.

`profile_sync_harness.mjs` drives the module through the real API client
(`viewer/recordings-api.js`, same-origin mode) against
`game_profiles_standin.mjs`, a stand-in for the contract's four routes.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "profile_sync_harness.mjs"
DEFAULTS = HERE.parent / "viewer" / "controls-defaults.js"
FILES = ["Controls/Air.con", "Controls/Common.con", "Controls/Infantry.con", "Controls/Land.con", "GeneralOptions.con"]


class ProfileSyncTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        if not DEFAULTS.is_file():
            raise unittest.SkipTest("viewer/controls-defaults.js is not in the tree")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_signed_out_keeps_to_this_browser(self) -> None:
        o = self.r["signedOut"]
        self.assertEqual(o["state"], "signed-out")
        self.assertEqual(len(o["warnings"]), 1)          # said once, for two changes
        self.assertEqual(o["puts"], [])
        self.assertEqual(o["identity"], "LocalName")     # the local profile still names the player
        self.assertEqual(o["profileName"], "LocalName")

    def test_the_active_profile_replaces_the_local_copy(self) -> None:
        o = self.r["loaded"]
        self.assertEqual((o["state"], o["active"]), ("synced", "skandia"))
        self.assertEqual(o["warnings"], [])
        self.assertEqual(o["profileName"], "skandia")
        self.assertTrue(o["mapOnF"])                     # the owner's map key, from the account's files
        self.assertEqual(o["crossHair"], [255, 0, 0])    # its GeneralOptions.con
        self.assertEqual(o["identity"], "skandia")
        self.assertEqual(o["origin"], {"source": "profile", "account": "skandia", "folder": "skandia"})
        self.assertEqual(o["stored"], "skandia")         # and it is the offline copy now
        self.assertEqual(o["puts"], [])                  # loading saves nothing

    def test_an_import_is_saved_as_its_folder_once(self) -> None:
        o = self.r["imported"]
        self.assertEqual(o["puts"], ["/stats/account/game-profiles/Other"])
        self.assertEqual(o["active"], ["Other"])
        self.assertEqual(o["syncActive"], "Other")
        self.assertEqual(o["files"], FILES)
        self.assertEqual(o["playerName"], "OtherName")
        self.assertEqual(o["general"], 'game.setPlayerName "OtherName"\n')
        self.assertEqual(o["identity"], "OtherName")

    def test_default_resets_the_bindings_not_the_profile(self) -> None:
        o = self.r["reset"]
        self.assertEqual(o["puts"], ["/stats/account/game-profiles/Other"])
        self.assertTrue(o["defaultsSent"])
        self.assertEqual(o["active"], ["Other"])
        self.assertEqual(o["profileName"], "OtherName")
        names = {p["name"]: p["playerName"] for p in self.r["activate"]["view"]["profiles"]}
        self.assertEqual(names["Other"], "OtherName")

    def test_the_picker_switches_the_active_profile(self) -> None:
        o = self.r["activate"]
        self.assertTrue(o["ok"])
        self.assertEqual(o["calls"], ["POST /stats/account/game-profiles/skandia/activate"])
        self.assertEqual(o["active"], ["skandia"])
        self.assertEqual(o["profileName"], "skandia")
        self.assertTrue(o["mapOnF"])
        self.assertEqual(o["view"]["active"], "skandia")
        self.assertFalse(self.r["missing"])

    def test_the_sidecar_name_names_the_player_and_survives_a_save(self) -> None:
        # features/game-profiles, "Sidecar name": the identity is the sidecar
        # name when the profile has one; the page's PUT leaves the field out,
        # so the account keeps it; cleared, the game's name is the identity.
        o = self.r["sidecarName"]
        self.assertEqual(o["identity"], "Sidecar Ace")
        saved = o["afterSave"]
        self.assertEqual(saved["puts"], ["/stats/account/game-profiles/skandia"])
        self.assertTrue(saved["defaultsSent"])
        self.assertEqual(saved["storedSidecar"], "Sidecar Ace")
        self.assertEqual(saved["viewSidecar"], "Sidecar Ace")
        self.assertEqual(saved["identity"], "Sidecar Ace")
        self.assertEqual(o["cleared"], "skandia")

    def test_an_api_failure_keeps_to_this_browser(self) -> None:
        o = self.r["failed"]
        self.assertEqual(o["state"], "error")
        self.assertEqual(len(o["warnings"]), 1)
        self.assertEqual(o["puts"], [])
        self.assertEqual(self.r["offline"], {"state": "signed-out", "warnings": 1})

    def test_an_empty_account_takes_the_local_import(self) -> None:
        o = self.r["seeded"]
        self.assertEqual(o["profiles"], [["Mine", True, "MineName"]])
        self.assertEqual(o["active"], "Mine")

    def test_the_eleventh_profile_is_refused_and_kept_here(self) -> None:
        o = self.r["full"]
        self.assertEqual(o["count"], 10)
        self.assertEqual(len(o["warnings"]), 1)
        self.assertIn("10 profiles", o["warnings"][0])
        self.assertEqual(o["local"], "E")


if __name__ == "__main__":
    unittest.main()
