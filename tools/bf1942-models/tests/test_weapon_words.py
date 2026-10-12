"""The weapon words `bf42/con.py` does not read, each with a verdict.

`allowReloadOnEmptyClipOnly` was written on one vanilla weapon and read by
nothing until a play-test met it (ledger FA-6). `census_weapon_words.py` counts
such words; this file is where each one is answered for, and where a new one
is noticed: with the game installed, a FireArms or HandFireArms word of the
five in-scope mods that is neither read by `ObjectLibrary.add_con` nor listed
below fails the run.

A listed word is not a word that does nothing. `open` means the engine's use
of it has not been read and the viewer does not have the behaviour.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import census_weapon_words as census  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402

PLUMBING = "engine plumbing: nothing for the viewer to carry"
OPEN = "open: the engine's use is unread and the viewer has no such behaviour"
READ_NOT_BUILT = "the engine's use is read (the ledger row), the viewer has no such behaviour"

# word (lower case, as `add_con` would meet it) -> verdict. The census of
# 2026-10-12 over bf1942, XPack1, XPack2, FH and FHSW found these and no
# others; the counts are FHSW's templates, the mod that writes each most.
UNREAD_WEAPON_WORDS: dict[str, str] = {
    "networkableinfo": PLUMBING,            # 829: the netcode's state layout
    "setnetworkableinfo": PLUMBING,         # 4446
    "hasdynamicshadow": PLUMBING,           # 841: the retail shadow pass
    "guiindex": PLUMBING,                   # 928: the weapon's index for the HUD and kill messages
    "setinputid": PLUMBING,                 # 1018
    "cullradiusscale": PLUMBING,            # 4
    # -- magazine, reload and selection ----------------------------------- #
    # `ejectClipTime` (FA-7), `setWeaponLink` (FA-8) and
    # `timeToNotAllowChange` (FA-9) left this table on 2026-10-12.
    "sethasmag": OPEN,                      # 257
    # 325: `BFSoldier::handlePlayerInput` raises the best loaded item when
    # the held one has none left (FA-10). The order it tries them in is the
    # kit template's own list, which nothing reads yet.
    "changeweaponwhennoammo": READ_NOT_BUILT,
    "cantselectwhennoammo": OPEN,           # 323
    "delaytouse": OPEN,                     # 38
    "ammotype": OPEN,                       # 3808: what a supply depot's `addAmmoType` matches
    "destroyvehiclewhennoammo": OPEN,       # 3
    "disablewhenfired": OPEN,               # 55
    # -- the round as it leaves ------------------------------------------- #
    "addrootspeed": OPEN,                   # 949
    "fireingforce": OPEN,                   # 659: the gun's push on its vehicle
    "projectilevisible": OPEN,              # 101
    "setprojectilevisible": OPEN,           # 4
    "projectile2template": OPEN,            # 1: the binoculars
    "startoneffects": OPEN,                 # 1272
    "setfirecamerashakeanimationstate": OPEN,   # 1460
    "hasresponsephysics": OPEN,             # 8
    # -- the launcher's second deviation family (Bazooka, Panzerschreck) --- #
    "adddevfire": OPEN, "adddevjump": OPEN, "adddevpitch": OPEN,
    "adddevrun": OPEN, "adddevstrafe": OPEN, "adddevwalk": OPEN,
    "adddevyaw": OPEN, "mindevcrouching": OPEN, "mindevlying": OPEN,
    "mindevstanding": OPEN, "subdev": OPEN, "subdevcrouching": OPEN,
    "subdevlying": OPEN, "subdevstanding": OPEN,
}


class UnreadWeaponWordTests(unittest.TestCase):
    def test_a_listed_word_is_still_unread(self) -> None:
        # A word `add_con` learns to read leaves this table in the same change.
        read = census.branch_words("objecttemplate")
        self.assertEqual(set(), set(UNREAD_WEAPON_WORDS) & read)

    def test_the_census_counts_a_weapons_unread_words_once_a_template(self) -> None:
        library = census.WordCensus()
        library.add_con("Objects/HandWeapons/M1Garand/Objects.con", """
ObjectTemplate.create HandFireArms M1Garand
ObjectTemplate.magSize 8
ObjectTemplate.allowReloadOnEmptyClipOnly 1
ObjectTemplate.ejectClipTime 0.6
ObjectTemplate.setWeaponLink 3
ObjectTemplate.timeToNotAllowChange 0.25
ObjectTemplate.delayToUse 0.6
ObjectTemplate.delayToUse 0.6
rem ObjectTemplate.someOldWord 1

ObjectTemplate.create SimpleObject M1GarandClip
ObjectTemplate.someOtherWord 1

ObjectTemplate.create FireArms Coaxial
ObjectTemplate.delayToUse 0.2
ObjectTemplate.brandNewWord 3
""")
        self.assertEqual({"delaytouse": 2, "brandnewword": 1}, dict(library.unread))
        self.assertEqual(["M1Garand", "Coaxial"], library.examples["delaytouse"])
        # It is still the library a bake would build.
        garand = library.object("M1Garand")
        self.assertTrue(garand.reload_on_empty_only)
        self.assertEqual(
            {"size": 8, "reloadOnEmptyOnly": True, "ejectClipTime": 0.6, "link": 3,
             "timeToNotAllowChange": 0.25},
            garand.weapon_stats()["magazine"])


@unittest.skipUnless((DEFAULT_GAME_DIR / "Mods" / "bf1942").is_dir(),
                     "needs the BF1942 install")
class InstalledWeaponWordTests(unittest.TestCase):
    def test_every_weapon_word_of_the_in_scope_mods_is_read_or_answered_for(self) -> None:
        import warnings

        warnings.simplefilter("ignore", ResourceWarning)   # the archive pools
        mods_dir = DEFAULT_GAME_DIR / "Mods"
        installed = {d.name.lower() for d in mods_dir.iterdir() if d.is_dir()}
        unanswered: dict[str, list[str]] = {}
        for mod in census.DEFAULT_MODS:
            if mod.lower() not in installed:
                continue
            result = census.census(DEFAULT_GAME_DIR, mod)
            for word in sorted(set(result.unread) - set(UNREAD_WEAPON_WORDS)):
                unanswered.setdefault(word, []).append(
                    f"{mod}: {result.unread[word]} ({', '.join(result.examples[word][:3])})")
        self.assertEqual(
            {}, unanswered,
            "weapon words no branch of add_con reads: read them, or list them "
            "in UNREAD_WEAPON_WORDS with a verdict")


if __name__ == "__main__":
    unittest.main()
