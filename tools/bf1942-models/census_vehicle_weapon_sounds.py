#!/usr/bin/env python3
"""Every vehicle weapon of a mod, and which sound script each one resolves to.

    python3 census_vehicle_weapon_sounds.py --mod XPack2            # + every level
    python3 census_vehicle_weapon_sounds.py --mod XPack1 --no-levels
    python3 census_vehicle_weapon_sounds.py --mod XPack2 --json out.json

The question it answers: for each FireArms under each vehicle a round can
field, does the viewer's table bind the sound the game binds, or a fallback?
Reported 2026-10-11 from a Secret Weapons replay: the Flettner's rockets made
"a strange noise". Its launcher declares no sound script; its ROUND does, four
rocket-motor loops, and the extractor handed those loops to the launcher, so a
motor roared at the cockpit for six seconds with the rocket long gone. The same
fallback bound the Calliope's, Raid on Agheila's Krupp launcher and its rocket
platform. A bomb rack on the same fallback was right (its round's script has a
release one-shot, which is the rack's trigger), so no look at one weapon finds
the class; the whole set has to be walked.

Each FireArms is classified by where its sound comes from, in the order the
game reads them (`extract_map.find_weapon_scripts`):

    own          its own `loadSoundScript`; the patch the table ships must
                 resolve every non-silent sample of its firing patch
    round-shot   none of its own; the round's script, whose first ONE-SHOT
                 patch is the weapon's report (a bomb's release clack, a
                 rocket's launch crack: `_firing_patch(release=True)`)
    round-flight none of its own and nothing but loops on the round: the
                 weapon is mute and the loops are the round's flight, heard
                 from the rocket (`extract_effects.flight_sound_names`)
    silent       no script on the weapon or its round: silent in the game too
    unresolved   a script named that no archive holds (the game plays nothing
                 either; listed so a missing archive is told from authoring)

and checked against the table `extract_vehicle_sounds` writes. A PROBLEM is

    loop-on-launcher   a weapon that sounds off its round's script ships a
                       looping layer (the Flettner's bug)
    round-sound-lost   a round-flight weapon the table still carries
    dropped-sample     an `own` / `round-shot` patch sample that no archive
                       resolves, so a layer is missing from the entry
    no-entry           an `own` / `round-shot` weapon the table has no entry
                       for
    flight-unlisted    a round-flight weapon whose round is not in the set the
                       effect-sound manifests list (`flight_sound_names`)

Exit status 1 when any weapon has a problem. The census builds the table in
memory (no sample is transcoded or written), so it is safe to run beside an
extraction and takes seconds a mod. `tests/test_census_vehicle_weapon_sounds.py`
holds the classification, and the install's XPack1 and XPack2 to zero problems.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import extract_effects as ee  # noqa: E402
import extract_map as em  # noqa: E402

# How a weapon's sound is bound; see the module docstring.
OWN, ROUND_SHOT, ROUND_FLIGHT, SILENT, UNRESOLVED = (
    "own", "round-shot", "round-flight", "silent", "unresolved")

PROBLEMS = ("loop-on-launcher", "round-sound-lost", "dropped-sample",
            "no-entry", "flight-unlisted")


@dataclass
class WeaponRow:
    template: str
    fire_arms: str
    kind: str
    script: str | None = None
    round: str | None = None
    # The entry's layers as `(file, loop)`; None where the table has no entry.
    layers: list[tuple[str, bool]] | None = None
    # Where the row was found: "" for the mod's global templates, else a level.
    scope: str = ""
    problems: list[str] = field(default_factory=list)

    def as_json(self) -> dict:
        return {
            "template": self.template, "fireArms": self.fire_arms,
            "kind": self.kind, "script": self.script, "round": self.round,
            "layers": self.layers, "scope": self.scope,
            "problems": self.problems,
        }


def fire_arms_nodes(library, template: str):
    """Every FireArms template under `template`, the walk
    `extract_map.find_weapon_scripts` makes, silent ones included."""
    root = library.objects.get(template.lower())
    if root is None:
        return []
    seen: set[str] = set()
    queue = [root]
    found = []
    while queue:
        node = queue.pop(0)
        key = node.name.lower()
        if key in seen:
            continue
        seen.add(key)
        if node.kind.lower() == "firearms":
            found.append(node)
        for ref in node.children:
            child = em._child_template(library, ref)
            if child is not None:
                queue.append(child)
    return found


def _read_script(objects):
    def read(path: str) -> str | None:
        hit = objects.find(path)
        return objects.read(hit).decode("latin-1") if hit else None
    return read


def classify(library, objects, node):
    """`(kind, script path, round name, firing patch's non-silent samples)`."""
    read = _read_script(objects)

    def patches_of(script: str):
        text = read(script)
        if text is None:
            return None
        return em.parse_ssc(text, level=em.VEHICLE_SOUND_LEVEL,
                            include=read, source=script)

    own = em._weapon_script(objects, node)
    if own is not None:
        patches = patches_of(own[1])
        if patches is None:
            return UNRESOLVED, own[1], None, []
        chosen = [s for s in em._firing_patch(patches)
                  if s in em._non_silence([s])]
        # Authored silence (Battle of Britain's Ju88A right rear gun loops
        # `silence.wav`): the game plays nothing, and neither should the table.
        return (OWN if chosen else SILENT), own[1], None, chosen
    projectile = (library.objects.get(node.projectile_template.lower())
                  if node.projectile_template else None)
    if projectile is None:
        return SILENT, None, None, []
    hit = em._weapon_script(objects, projectile)
    if hit is None:
        return SILENT, None, projectile.name, []
    patches = patches_of(hit[1])
    if patches is None:
        return UNRESOLVED, hit[1], projectile.name, []
    shots = em._firing_patch(patches, release=True)
    if shots:
        return ROUND_SHOT, hit[1], projectile.name, shots
    sounding = [s for p in patches for s in em._non_silence(p.samples)]
    return (ROUND_FLIGHT if sounding else SILENT), hit[1], projectile.name, []


def census(library, objects, sounds, templates, *, flight: set[str],
           level_files=None, scope: str = "") -> list[WeaponRow]:
    """One row per FireArms under each of `templates`, checked against the
    table the extractor builds from the same pools (in memory)."""
    table = em.extract_vehicle_sounds(
        library, objects, sounds, templates, lambda resolved: resolved[0],
        level_files)
    entries = {}
    for vehicle in table:
        for weapon in vehicle.get("weapons") or []:
            entries[(vehicle["template"].lower(), weapon["fireArms"].lower())] = weapon
    flight_lower = {name.lower() for name in flight}
    rows: list[WeaponRow] = []
    for template in templates:
        root = library.objects.get(template.lower())
        name = root.name if root is not None else template
        for node in fire_arms_nodes(library, template):
            kind, script, rnd, chosen = classify(library, objects, node)
            entry = entries.get((name.lower(), node.name.lower()))
            row = WeaponRow(name, node.name, kind, script, rnd, scope=scope,
                            layers=None if entry is None else
                            [(layer["file"], bool(layer["loop"]))
                             for layer in entry["layers"]])
            wanted = [s for s in chosen
                      if not s.file.replace("\\", "/").lower().endswith("silence.wav")]
            if kind in (OWN, ROUND_SHOT):
                if entry is None:
                    row.problems.append("no-entry")
                elif len(entry["layers"]) < len(wanted):
                    row.problems.append("dropped-sample")
                if kind == ROUND_SHOT and any(loop for _f, loop in row.layers or []):
                    row.problems.append("loop-on-launcher")
            elif kind == ROUND_FLIGHT:
                if entry is not None:
                    row.problems.append("round-sound-lost")
                    if any(loop for _f, loop in row.layers or []):
                        row.problems.append("loop-on-launcher")
                if rnd and rnd.lower() not in flight_lower:
                    row.problems.append("flight-unlisted")
            rows.append(row)
    return rows


def run_mod(game_dir: Path, mod: str, *, levels: bool = True,
            only_levels: list[str] | None = None) -> list[WeaponRow]:
    """The mod's global templates, then each level's own set (a level's own
    objects, the Flettner, exist only there)."""
    import extract_vehicle_sounds as evs
    import scene_layers
    from extract_models import discover_levels, spawned_templates
    sources = evs.load_sources(game_dir, mod)
    templates = evs.vehicle_templates(
        sources.objects, sources.library,
        spawned_templates(discover_levels(sources.chain)))
    rows = census(sources.library, sources.objects, sources.sounds, templates,
                  flight=ee.flight_sound_names(sources.library))
    if not levels:
        return rows
    seen = {(r.template.lower(), r.fire_arms.lower(), r.script) for r in rows}
    mine = f"/mods/{mod.lower()}/"
    for name, archive in discover_levels(sources.chain):
        if only_levels:
            if name.lower() not in {n.lower() for n in only_levels}:
                continue
        elif mod.lower() != "bf1942" and mine not in archive.as_posix().lower():
            # A pack's tree holds the pack's own levels; the vanilla ones its
            # archives inherit are the vanilla census's.
            continue
        ctx = scene_layers.LevelContext(game_dir, mod, name, out=Path("/nonexistent"))
        sounds = sources.sounds
        library, objects = ctx.library, ctx.pools[2]
        level_templates = em.spawned_vehicle_templates(ctx.info, library)
        flight = ee.flight_sound_names(library)
        for row in census(library, objects, sounds, level_templates,
                          flight=flight, level_files=ctx.files, scope=name):
            key = (row.template.lower(), row.fire_arms.lower(), row.script)
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
    return rows


def render(rows: list[WeaponRow]) -> str:
    out = [f"{'scope':22} {'template':24} {'fireArms':30} {'bound':13} script / round"]
    for row in sorted(rows, key=lambda r: (r.kind, r.template.lower(), r.fire_arms.lower(), r.scope)):
        detail = (row.script or "-").rsplit("/", 1)[-1]
        if row.round:
            detail += f"  <- {row.round}"
        if row.problems:
            detail += "  PROBLEM " + ",".join(row.problems)
        out.append(f"{row.scope or '(mod)':22} {row.template:24} {row.fire_arms:30} "
                   f"{row.kind:13} {detail}")
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.kind] = counts.get(row.kind, 0) + 1
    problems = [r for r in rows if r.problems]
    out.append("")
    out.append(f"{len(rows)} weapons: "
               + ", ".join(f"{n} {k}" for k, n in sorted(counts.items()))
               + f"; {len(problems)} with a problem")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    from extract_models import DEFAULT_GAME_DIR
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--mod", default="XPack2")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--no-levels", action="store_true",
                    help="the mod's global templates only")
    ap.add_argument("--level", action="append", default=None,
                    help="only these levels (repeatable)")
    ap.add_argument("--json", type=Path, default=None, help="also write the rows")
    ap.add_argument("--quiet", action="store_true",
                    help="print only the rows with a problem and the totals")
    args = ap.parse_args(argv)
    rows = run_mod(args.game_dir.expanduser(), args.mod,
                   levels=not args.no_levels, only_levels=args.level)
    shown = [r for r in rows if r.problems] if args.quiet else rows
    print(render(shown) if shown else render(rows).splitlines()[-1])
    if args.json:
        args.json.write_text(json.dumps([r.as_json() for r in rows], indent=1))
    return 1 if any(r.problems for r in rows) else 0


if __name__ == "__main__":
    raise SystemExit(main())
