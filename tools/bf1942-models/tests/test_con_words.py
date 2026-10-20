"""Every `ObjectTemplate` word the vanilla packs write that NOTHING in this
tree reads, named, so the next one fails the run instead of waiting for a
play-test.

`tests/test_weapon_words.py` does this for `FireArms` and `HandFireArms`.
Nothing did it for the other 31 template kinds, and that is how
`ObjectTemplate.fireingForce` sat unread on eleven vanilla tanks from the first
extract until an owner noticed that firing a Sherman's cannon across the hull
moved the tank in retail and not in the viewer (ledger FA-1, FA-19,
`features/gun-hull-recoil`). One word, eleven tanks, three years of data, and no
survey met it because every survey looked at the common words.

`census_con_words.py` asks the question of every kind, with a reader set per
kind — `con.py`'s branch always, `effects.py`'s tables for the effect kinds
whose words are stashed in `effect_props`, `kit.py`'s for a kit part. On top of
that it greps the tree for each word's spelling, which catches the readers no
table here knows: the level extractor's (`extract_map.py`, `bf42/level.py`), the
HUD pack's, the spotting bar's.

What is left is this table: a word no reader table has AND no file in the tree
so much as mentions. Each row says how many templates write it, on what kind,
and whether the research corpus under `features/` has ever looked at it —
`doc` means somebody has read what the engine does and nobody has exported it,
`new` means nobody has looked at all.

A row here is not a word that does nothing. It is a word whose behaviour the
viewer does not have, and the list is the queue.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import census_con_words as census  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402

#: The packs this table answers for. CLAUDE.md's extraction scope.
MODS = ("bf1942", "XPack1", "XPack2")

#: word -> "<templates>x<kind> | doc|new | what it looks like".
#: Counts are the largest of the three packs, taken 2026-10-18. `doc` means the
#: corpus under `features/` has looked at the word and nothing exports it;
#: `new` means nothing in the repo mentions it at all.
#:
#: Words `tests/test_weapon_words.py` already answers for are not repeated here
#: (21 of them, the `addDev*` family and friends): that table is the authority
#: for a weapon word, whatever kind writes it.
ORPHAN_WORDS: dict[str, str] = {
    # -- the big ones, by how much data writes them --------------------- #
    "settooltiptype": "161x playercontrolobject | new | the HUD's tooltip for a vehicle or emplacement",
    "explosiondamage": "52x playercontrolobject, 10x bfsoldier, 9x bundle, 6x projectile | doc | what a destroyed object's own blast does",
    "explosionradius": "52x playercontrolobject | doc | how far that blast reaches",
    "nametagoffset": "49x playercontrolobject | new | where a vehicle's name tag floats above it",
    "invisibleatendeffect": "38x projectile | doc | the round stops being drawn at its end effect",
    "setboneoriginoffset": "37x animatedbundle | doc | the tank tracks' bone origin",
    "useasbone": "37x animatedbundle | doc | the tracks again: the part drives a skeleton bone",
    "hasstaticcolor": "36x spriteparticle | doc | a particle that ignores its colour ramp",
    "setpcoid": "27x playercontrolobject | doc | the seat id a PCO answers to",
    "setspawnpositionoffset": "27x spawnpoint | doc | the spawn's own offset from its node",
    "setspawnpreventiondelay": "27x spawnpoint | doc | how long a used spawn is held shut",
    "setspawnrotation": "27x spawnpoint | doc | which way a spawned soldier faces",
    "hasstarteffect": "20x projectile | doc | the round plays an effect as it leaves",
    "disarmminesdistance": "10x bfsoldier | doc | the engineer's reach for disarming a mine",
    "dontclearteamonexit": "10x playercontrolobject | doc | the hull keeps its team when the last crew leaves",
    "isportalpassing": "10x bfsoldier | new | nothing in the repo has ever looked at this",
    "portalpassingposition": "10x bfsoldier | new | its companion, equally unknown",
    "addpcoposid": "9x playercontrolobject | doc | another seat-id word",
    # -- the long tail -------------------------------------------------- #
    "noffsound": "5x projectile | doc | a round's off sound",
    "alphatestrefovertime": "4x spriteparticle | doc | the alpha test reference as a ramp",
    "canberepaiedasdestroyed": "4x playercontrolobject | new | (sic) a wreck a depot can bring back",
    "dragoffset": "4x playercontrolobject, 1x simpleobject | doc | where the drag term is taken",
    "usemmonendeffect": "4x projectile | doc | the minimap marker at the end effect",
    "disablespawnpointsonenter": "2x playercontrolobject | new | boarding shuts the hull's own spawns",
    "inverseheatbar": "2x engine | new | the heat bar reads the other way",
    "removeatrestart": "2x simpleobject | new | the object does not come back on a round restart",
    "setheatbartype": "2x engine | new | which heat bar an engine draws",
    "subpos": "2x playercontrolobject | doc | a submarine's dive position",
    "usebuttonradius": "2x objectspawner | doc | the spawner is used by the action button, not by walking in",
    "addtoprojectilelist": "1x projectile | new | nothing in the repo has looked at this",
    "cameradelaydistance": "1x playercontrolobject | doc | the chase camera's lag",
    "cameradelaytime": "1x playercontrolobject | doc | the chase camera's lag in time",
    "deatheffectname": "1x playercontrolobject | doc | the effect a hull's death plays",
    "destroyonexit": "1x playercontrolobject | doc | the hull goes when the crew steps out",
    "downanglemultiplier": "1x seatobject | new | a seat's downward look limit",
    "headmaxanglemultiplier": "1x seatobject | new | how far the occupant's head turns",
    "leftanglemultiplier": "1x seatobject | new | a seat's left look limit",
    "nocollisionsasdestroyed": "1x bundle | doc | a wreck you can walk through",
    "projectiletype": "1x projectile | new | unknown",
    "rightanglemultiplier": "1x seatobject | new | a seat's right look limit",
    "setforwardmod": "1x playercontrolobject | new | unknown",
    "stalingradhouse": "1x simpleobject | new | a one-off word on one Stalingrad building",
    "upanglemultiplier": "1x seatobject | new | a seat's upward look limit",
    "useuvrotation": "1x spriteparticle | doc | the particle's UVs turn with it",
    "vehiclecamerashake": "1x playercontrolobject | new | the hull's own camera shake",
}

_ORPHANS: dict[str, set[str]] | None = None


def orphans() -> dict[str, set[str]]:
    """Per pack, the words no reader table has and no file in the tree names."""
    global _ORPHANS
    if _ORPHANS is None:
        game_dir = DEFAULT_GAME_DIR
        if not game_dir.is_dir():
            raise unittest.SkipTest(f"the game is not installed at {game_dir}")
        from tests.test_weapon_words import UNREAD_WEAPON_WORDS
        answered = set(UNREAD_WEAPON_WORDS)
        found = {}
        for mod in MODS:
            result = census.census_of(game_dir, mod)
            seen = census.mentions(list(result.unread))
            found[mod] = {w for w in result.unread
                          if not seen.get(w) and w not in answered}
        _ORPHANS = found
    return _ORPHANS


class OrphanWordTests(unittest.TestCase):
    def test_no_new_unread_word(self) -> None:
        # A word this table does not name is either behaviour nobody has
        # noticed is missing, or a reader that moved out from under the
        # census's tables. Read it, build it or answer for it here.
        for mod, words in orphans().items():
            with self.subTest(mod):
                self.assertEqual(set(), words - set(ORPHAN_WORDS))

    def test_a_word_that_becomes_read_leaves_the_table(self) -> None:
        # The other direction, so the queue shrinks as work lands rather than
        # keeping rows for words something now reads.
        every = set().union(*orphans().values())
        self.assertEqual(set(), set(ORPHAN_WORDS) - every)

    def test_fireingforce_is_not_here_any_more(self) -> None:
        # The word this file exists because of. It is read, exported, applied
        # and tested (`tests/test_gun_recoil.py`), so it is in no pack's
        # orphan set — and if a refactor ever silently drops the reader, this
        # is one of the two tests that says so.
        for mod, words in orphans().items():
            with self.subTest(mod):
                self.assertNotIn("fireingforce", words)
        self.assertNotIn("fireingforce", ORPHAN_WORDS)


class CensusTests(unittest.TestCase):
    """The census's own machinery, so a silent blindness fails loudly."""

    def test_the_reader_tables_are_still_where_the_census_looks(self) -> None:
        # Every table is harvested by AST from a named module-level dict; a
        # rename raises rather than quietly reading nothing, which would
        # report the whole particle vocabulary as unread.
        words = census.reader_words()
        for reader in ("con", "effects", "kit"):
            with self.subTest(reader):
                self.assertTrue(words[reader])

    def test_the_effect_kinds_get_the_effects_readers(self) -> None:
        words = census.reader_words()
        # `intensity` is read by `effects.py` off `effect_props`, never by
        # `add_con`'s branch: an emitter must not report it unread.
        self.assertIn("intensity", words["effects"])
        self.assertNotIn("intensity", words["con"])
        self.assertIn("intensity", census.readers_for("emitter", words))
        # ... and a FireArms, whose words are not stashed, must not be handed
        # the particle vocabulary, or a real gap there would be hidden.
        self.assertNotIn("intensity", census.readers_for("firearms", words))

    def test_a_kit_part_gets_the_kit_reader(self) -> None:
        words = census.reader_words()
        self.assertIn("burstfrequency", census.readers_for("activekitpart", words))
        self.assertNotIn("burstfrequency", census.readers_for("simpleobject", words))

    def test_every_kind_the_packs_declare_is_watched(self) -> None:
        # A kind missing from `VANILLA_KINDS` is a kind whose words are never
        # counted at all.
        game_dir = DEFAULT_GAME_DIR
        if not game_dir.is_dir():
            raise unittest.SkipTest(f"the game is not installed at {game_dir}")
        for mod in MODS:
            with self.subTest(mod):
                self.assertEqual(set(), set(census.kinds_of(game_dir, mod))
                                 - set(census.VANILLA_KINDS))


if __name__ == "__main__":
    unittest.main()
