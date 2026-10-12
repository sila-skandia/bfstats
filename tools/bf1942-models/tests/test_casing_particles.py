"""A gun's casing is a bare mesh particle: it falls for its second and is gone.

Asked of the viewer after FHSW's M1 Garand: "the casings fall through the
ground". They do in the game's data too. Every casing a FireArms throws is a
`Particle` whose template says `geometry`, `timeToLive`, `gravityModifier`
and sometimes `size` and nothing else, under an Emitter that never says
`hasCollisionPhysics`: collision is opt-in on every template and defaults off
(ledger COL-16, EMT-13), and the mods that wanted a casing to land built a
different thing for it (FH's `Em_Ejected50mmCasing` emits a Bundle with
`setHasCollisionPhysics 1`, FHSW's `Em_CartridgeEjection_*` SimpleObjects).

So `effects.js` gives a mesh particle no ground test. This fails when an
installed mod gives a FireArms a mesh particle that asks for collision: that
casing lands in the game and the page would have to land it.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_models import DEFAULT_GAME_DIR  # noqa: E402

MODS = ("bf1942", "XPack1", "XPack2", "FH", "FHSW")


def casing_particles(library):
    """`(weapon, emitter, particle, collides)` for every mesh particle a
    FireArms' own bundles emit. `collides` is the reader's
    `has_collision_physics` (both spellings of the word, CON-15) on the
    particle or on its emitter."""
    def emitters(name, seen, depth=0):
        template = library.object(name)
        if template is None or name.lower() in seen or depth > 6:
            return
        seen.add(name.lower())
        if template.kind.lower() == "emitter":
            yield template
        for ref in template.children:
            yield from emitters(ref.template, seen, depth + 1)

    for weapon in library.objects.values():
        if weapon.kind.lower() not in ("firearms", "handfirearms"):
            continue
        roots = [ref.template for ref in weapon.children]
        if weapon.visible_barrel_template:
            roots.append(weapon.visible_barrel_template)
        for root in roots:
            bundle = library.object(root)
            if bundle is None or bundle.kind.lower() not in ("effectbundle", "emitter"):
                continue
            for emitter in emitters(root, set()):
                particle = (library.object(emitter.emitter_template)
                            if emitter.emitter_template else None)
                if particle is None or particle.kind.lower() != "particle":
                    continue
                yield (weapon.name, emitter.name, particle.name,
                       bool(particle.has_collision_physics
                            or emitter.has_collision_physics))


class ReaderTests(unittest.TestCase):
    def test_the_word_is_read_on_a_particle_and_on_an_emitter(self):
        from bf42 import con as con_mod
        library = con_mod.ObjectLibrary()
        library.add_con("Objects/Gun/Objects.con",
            "ObjectTemplate.create HandFireArms Gun\n"
            "ObjectTemplate.addTemplate e_Shell\n"
            "ObjectTemplate.create EffectBundle e_Shell\n"
            "ObjectTemplate.addTemplate Em_Shell\n"
            "ObjectTemplate.addTemplate Em_Lands\n"
            "ObjectTemplate.create Emitter Em_Shell\n"
            "ObjectTemplate.template Fx_Shell\n"
            "ObjectTemplate.create Particle Fx_Shell\n"
            "ObjectTemplate.timeToLive CRD_NONE/1/0/0\n"
            "ObjectTemplate.create Emitter Em_Lands\n"
            "ObjectTemplate.template Fx_Lands\n"
            "ObjectTemplate.create Particle Fx_Lands\n"
            "ObjectTemplate.hasCollisionPhysics 1\n")
        rows = {particle: collides
                for _w, _e, particle, collides in casing_particles(library)}
        self.assertEqual({"Fx_Shell": False, "Fx_Lands": True}, rows)


@unittest.skipUnless((DEFAULT_GAME_DIR / "Mods" / "bf1942").is_dir(),
                     "Battlefield 1942 is not installed")
class InstalledCasingTests(unittest.TestCase):
    def test_no_gun_throws_a_mesh_particle_that_collides(self):
        import extract_vehicle_sounds as evs
        for mod in MODS:
            if not (DEFAULT_GAME_DIR / "Mods" / mod).is_dir():
                continue
            with self.subTest(mod=mod):
                library = evs.load_sources(DEFAULT_GAME_DIR, mod).library
                rows = list(casing_particles(library))
                self.assertGreater(len(rows), 0)
                self.assertEqual([], sorted({(emitter, particle)
                                             for _w, emitter, particle, collides in rows
                                             if collides}))


if __name__ == "__main__":
    unittest.main()
