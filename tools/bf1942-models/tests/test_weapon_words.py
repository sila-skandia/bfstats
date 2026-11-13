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

# watches: nothing
# (its folder scans read temp, game-install or generated asset folders, not repo code; scripts/select_model_tests.py)

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
    # `changeWeaponWhenNoAmmo` (FA-10) and `cantSelectWhenNoAmmo` left this
    # table on 2026-10-17 (`viewer/kit-select.js`).
    # 38: `FireArmsTemplate+0x244` (the client's `+0x3b0`), 0.5 from the
    # HandFireArms constructor. Its console handler (lnxded
    # `ConsoleClass332::executeObjectMethod` 0x082d4b30, client 0x004d5ab0)
    # and `makeScript` are its only readers in either binary: no game code
    # looks at it, so there is nothing to build.
    "delaytouse": PLUMBING,
    # `ammoType` left this table on 2026-11-12 (SUP-2): `con.py` reads it into
    # the magazine block and `damage.json` `ammoTypes`, and a depot rearms
    # each item from the row its tag names (`viewer/fire-state.js`).
    "destroyvehiclewhennoammo": OPEN,       # 3
    "disablewhenfired": OPEN,               # 55
    # -- the round as it leaves ------------------------------------------- #
    # `addRootSpeed` left this table on 2026-10-25 (ledger FA-23): the
    # stats block carries it and `round-launch.js` honours a 0.
    # `fireingForce` left this table on 2026-10-18 (ledger FA-1,
    # `features/gun-hull-recoil`): the gun's push on its vehicle is built.
    # Dead in retail (2026-11-12, `features/retail-inverse-gap-audit-2026-11-12`
    # orphan-words): no string `projectileVisible` in lnxded or BF1942.exe, so
    # no console object answers either spelling and the engine prints
    # *Unknown object or method!* (CON-15). Nothing to build.
    "projectilevisible": PLUMBING,          # 101
    "setprojectilevisible": PLUMBING,       # 4
    "projectile2template": OPEN,            # 1: the binoculars
    # Dead in retail: `setStartOnEffects` is the registered word (strings
    # `ObjectTemplate.setStartOnEffects`, lnxded and BF1942.exe; the method
    # `EffectBundleTemplate::setStartOnEffects`), a method (type 0), and the
    # console adds no `set` to a bare word (CON-15), so the data's bare
    # `startOnEffects` is *Unknown object or method!*.
    "startoneffects": PLUMBING,             # 1272
    "setfirecamerashakeanimationstate": OPEN,   # 1460
    "hasresponsephysics": OPEN,             # 8
    # -- the launcher's second deviation family (Bazooka, Panzerschreck) --- #
    # Dead in retail (2026-11-12): neither binary has a string containing
    # `addDev`, `subDev` or `minDevStanding`/`Crouching`/`Lying` (the only
    # `minDev` word is `ObjectTemplate.setMinDev`, `FireArmsTemplate::setMinDev`),
    # so the console rejects all fourteen (CON-15). Nothing to build.
    "adddevfire": PLUMBING, "adddevjump": PLUMBING, "adddevpitch": PLUMBING,
    "adddevrun": PLUMBING, "adddevstrafe": PLUMBING, "adddevwalk": PLUMBING,
    "adddevyaw": PLUMBING, "mindevcrouching": PLUMBING, "mindevlying": PLUMBING,
    "mindevstanding": PLUMBING, "subdev": PLUMBING, "subdevcrouching": PLUMBING,
    "subdevlying": PLUMBING, "subdevstanding": PLUMBING,
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

    def test_the_words_neither_binary_registers_are_plumbing(self) -> None:
        # No console object answers them in lnxded or BF1942.exe (CON-15), so
        # the queue of open words does not list them.
        dead = {"projectilevisible", "setprojectilevisible", "startoneffects",
                "adddevfire", "adddevjump", "adddevpitch", "adddevrun",
                "adddevstrafe", "adddevwalk", "adddevyaw", "mindevcrouching",
                "mindevlying", "mindevstanding", "subdev", "subdevcrouching",
                "subdevlying", "subdevstanding"}
        self.assertEqual({PLUMBING}, {UNREAD_WEAPON_WORDS[w] for w in dead})

    def test_ammo_type_reaches_the_magazine_block_and_its_round_the_ff_flag(self) -> None:
        # `ObjectTemplate.ammoType` writes `FireArmsTemplate+0x238` (lnxded
        # 0x082c98be), the tag `SupplyDepot::reloadAmmo` matches (SUP-2);
        # `noFFSound` writes `ProjectileTemplate+0x14f` (0x082e39fe, FF-6).
        from bf42.con import ObjectLibrary
        library = ObjectLibrary()
        library.add_con("Objects/HandWeapons/GrenadeAllies/Objects.con", """
ObjectTemplate.create HandFireArms GrenadeAllies
ObjectTemplate.magSize 3
ObjectTemplate.ammoType 2

ObjectTemplate.create HandFireArms KnifeAllies

ObjectTemplate.create Projectile GrenadeAlliesProjectile
ObjectTemplate.noFFSound 1
""")
        self.assertEqual({"size": 3, "ammoType": 2},
                         library.object("GrenadeAllies").weapon_stats()["magazine"])
        self.assertIsNone(library.object("KnifeAllies").ammo_type)
        self.assertTrue(library.object("GrenadeAlliesProjectile").no_ff_sound)

    def test_the_select_words_reach_the_magazine_block(self) -> None:
        from bf42.con import ObjectLibrary
        library = ObjectLibrary()
        library.add_con("Objects/HandWeapons/GrenadeAllies/Objects.con", """
ObjectTemplate.create HandFireArms GrenadeAllies
ObjectTemplate.magSize 3
ObjectTemplate.changeWeaponWhenNoAmmo 1
ObjectTemplate.cantSelectWhenNoAmmo 1

ObjectTemplate.create HandFireArms ExpPackKasserine
ObjectTemplate.changeWeaponWhenNoAmmo 0

ObjectTemplate.create Projectile StickyProjectile_stick
ObjectTemplate.isSticky 1
""")
        self.assertEqual(
            {"size": 3, "changeWeaponWhenNoAmmo": True, "cantSelectWhenNoAmmo": True},
            library.object("GrenadeAllies").weapon_stats()["magazine"])
        # An explicit 0 is kept: Kasserine's ExpPack writes it.
        self.assertIs(False, library.object("ExpPackKasserine").change_weapon_when_no_ammo)
        self.assertTrue(library.object("StickyProjectile_stick").is_sticky)

    def test_add_root_speed_zero_reaches_the_stats_block(self) -> None:
        # Every vanilla rifle, pistol and MG writes `addRootSpeed 0`; the
        # grenade keeps the template default 1 and writes nothing (FA-23).
        from bf42.con import ObjectLibrary
        library = ObjectLibrary()
        library.add_con("Objects/HandWeapons/Bar1918/Objects.con", """
ObjectTemplate.create HandFireArms Bar1918
ObjectTemplate.addRootSpeed 0
ObjectTemplate.velocity 400

ObjectTemplate.create HandFireArms GrenadeAllies
ObjectTemplate.velocity 25
""")
        self.assertIs(False, library.object("Bar1918").weapon_stats()["addRootSpeed"])
        self.assertNotIn("addRootSpeed", library.object("GrenadeAllies").weapon_stats())


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
