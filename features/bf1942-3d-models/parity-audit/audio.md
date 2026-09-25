# Audio parity gaps: what BF1942 plays that the extractor/viewer does not

**SUPERSEDED below this banner.** The 2026-09-26 census at the top of this file
is current; everything under "The 2026-09-14 audit" is kept for its ground-truth
detail (script paths, directive semantics, spatialisation table) but its gap
list, priority table and counts predate four extraction rounds and no longer
describe the tree. Read the census first.

---

# Sound corpus census, 2026-09-26

Census date 2026-09-26, against the installed archives of all three in-scope
mods (`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/{bf1942,XPack1,XPack2}`,
per the owner's mod-scope rule: only the three vanilla packs are counted, other
mods' archives are ignored), the extracted trees under
`tools/bf1942-models/viewer/`, and HEAD `01d9671c`. Every number below came off
the live archives with `bf42.rfa.RfaArchive` or off the shipped trees with
`find`/`stat`; the reproducing commands are in the last section.

**The verdict in one line.** Of the things the engine plays, the viewer now
plays most of what a person on the map page can hear, and the residue is two
runtime-event families (round whizz-by/distant fire, and the non-bail-out
soldier state sounds) plus the deliberately-unextracted dead weight, not
extraction reach. Complete in-scope audio parity is within roughly 4 MB of MP3
of where the trees stand today.

## What the game ships

`RfaArchive.entries` keyed counts, per mod, distinct `.wav` paths (the three
rate tiers carry the same names three times; the 44 kHz tier is the corpus the
engine plays at desktop quality):

| mod | sound archives | distinct wavs | non-voice stems | voice (44 kHz) | total bytes |
|---|---|---|---|---|---|
| bf1942 | `sound.rfa` + `sound_001.rfa` | 4,227 | 712 (55.3 MB @44k) | 6 packs x 116-117 | 254.2 MB |
| XPack1 | `Sound.rfa` | 1,017 | 107 (23.7 MB @44k) | none | 89.7 MB |
| XPack2 | `sound.rfa` | 480 | 160 (30.3 MB @44k) | none | 53.1 MB |

The two expansion packs share 2 of XPack1's 107 non-voice stems with vanilla
and 16 of XPack2's 160; the rest are new recordings (XPack1's birds, crickets,
church bells and two-prop engines; XPack2's Bren, FG42, G43, shotgun, jetpack
and generator). The expansion packs ship no `@Language` directories: their
soldiers reuse vanilla's packs through the mod chain.

Every `.ssc` in the three mods parses: 988 vanilla (re-verified this census;
the 988/981 drift from the old audit is filename count vs script count, not a
parser gap), 178 XPack1, 351 XPack2. `parse_ssc` handles the block-comment law
since the G16 fix (`tests/test_sound.py` covers `/* */` directly), so the old
audit's "parser gaps" column is empty now.

`@Language` voice: vanilla's scripts reference 105 distinct `@Language` stems;
all 105 exist in all six packs. XPack scripts reference none.

Referenced vs dead, against a union of every `load` line in the three mods'
`.ssc` (block-comment aware):

| mod | non-voice stems | referenced by some `.ssc` | unreferenced |
|---|---|---|---|
| bf1942 | 712 | 634 | 75 (9 of them level-local ambience resolved from level archives) |
| XPack1 | 107 | 54 | 53 (birds, crickets, seagulls, church bell, harbour ambience) |
| XPack2 | 160 | 90 | 69 (jetpack, generator, BMW idle out-takes, Bren alt takes) |

Two XPack1 references resolve only against the other mods' archives or not at
all: `Aircraft_2prop_engine_medRPM.wav` (the extractor's per-layer rate
fallback handles it; the bare `medRPM` name is genuinely absent, only the
`_left/_mid/_right` variants ship) and `100voco.wav` (loaded by
`SturmGeschutzTower.ssc`, present in no archive: a dead reference in shipped
data).

Category census, vanilla 44 kHz tier (the classification is the owning
`.ssc`'s directory, same method as the 2026-09-14 audit):

| category | files | MB | state in the viewer |
|---|---|---|---|
| Effect (explosion / impact / ricochet / debris / fire) | 213 | 15.12 | extracted (`extract_effects.py` -> `_shared/effects.sounds.json` + `_shared/sounds`), played by `effect-audio.js` |
| Hand weapon | 106 | 3.79 | extracted (`extract_weapon_sounds.py` -> `models/sounds/`), played |
| Soldier movement (footsteps/swim/chute) | 104 | 4.06 | extracted (footsteps + run/walk + bail-out set), played |
| Vehicle land / air / sea + stationary + common | 162 | 18.65 | extracted per map into `_shared/sounds`, played by `vehicle-audio.js` |
| Building ambience (windmill, factory, guardtow, radar, depot) | 6 | 2.01 | harvested per level into `scene.json` `sounds.areas` (`bf42/level.py` §4 of `discover_level_sounds`), played by the area pool |
| Menu / UI | 12 | 0.51 | not extracted, nothing plays it (no menu chrome for it) |
| Game / HUD (radio crackle) | 1 (`radiomess`) | 0.03 | extracted to `voices/radiomess.mp3`, played as the radio open |
| Projectile whizz-by / distant MG / shell bounce | 29 | 2.0 | **not extracted, not played** |
| `@Language` voice | 105 x 6 | 13.8-17.2/pack @44k | 80 of 105 stems extracted (see below); 23 radio + 22 local + 6 capture per nation play |

Music: the 6 vanilla `.bik` files are outside the rfAs. The viewer ships two of
them transcoded (`_shared/music/menu.mp3` 3.7 MB from `Slaughter4.bik`,
`vehicle4.mp3` 5.7 MB from `Vehicle4.bik` as load music), played by
`play/index.html` and `progress.js`; the other four are unshipped.

## What the viewer trees carry

Measured 2026-09-26, MP3 only (the extracted payload; `collision-meshes.json`
and friends excluded):

| tree | files | MB | what put it there |
|---|---|---|---|
| `maps/_shared/sounds/` | 360 | 5.64 | `extract_map.py` (vehicle + ambient + area + flag), `extract_effects.py` (the 192 effect samples, 2.18 MB of it) |
| `maps/_shared/voices/` | 369 | 5.48 | `extract_capture_voices.py` (6 stems x 6 nations) + `extract_radio.py` (54 stems x 6 nations + `radiomess`) |
| `maps/_shared/music/` | 2 | 9.40 | `extract_menu_music.py` + `extract_loading_assets.py` |
| `models/sounds/` | 151 | 1.22 | `extract_weapon_sounds.py` (27 weapons, 113 firing-patch layers) + `extract_soldier_sounds.py` (77 soldier samples, `soldier.json`) |
| `maps/mods/xpack1/_shared/` | 879 | 23.51 | same extractors with `--mod xpack1` (6 levels) |
| `maps/mods/xpack2/_shared/` | 765 | 21.57 | same, `--mod xpack2` (9 levels) |
| `models/mods/xpack1/sounds/` | 30 + manifest | 0.32 | `extract_weapon_sounds.py --mod xpack1` (Breda, K98Bayonet, No4Bayonet, Stengun) |
| `models/mods/xpack2/sounds/` | 34 + manifest | 0.33 | `--mod xpack2` (BrenLMG, CommandoKnife, EliteKnife, Gewehr42/43, K98RifleGrenade, Shotgun) |

`_shared/sounds` decomposes as: 153 files (3.14 MB) referenced by the 23
vanilla `scene.json` sound blocks, 192 (2.18 MB) referenced by
`effects.sounds.json`, 15 (0.36 MB) orphaned on disk
(`Ammorefill` moved to the depot give sound, parachute/bail-out samples now
served from `models/sounds/`, two Garand reverb takes and `brownmlp_dist`,
`dingy_idle`, `rifle-distance1` dropped by extractor choices). The 348 MP3s the
two xpack trees share with vanilla are byte-identical re-transcodes of the same
sources; each xpack `_shared/sounds` also carries its mod's genuinely new
recordings. EoD's `mods/eod/_shared` (74.32 MB) predates the mod-scope rule and
is excluded from this census.

## What plays, and what is wired

The runtime paths, with the categories each one owns:

- `page-audio.js` — listener + limiter, level ambience (`cfg.ambient`),
  area/flag pool (`cfg.areas` + `cfg.flags`, which the building harvest feeds),
  the SupplyDepot give sound (`playSupplyGive`), bot footsteps
  (`botFootstepTick` -> `handleSoldierFootstep` -> `soldier.json`, surface-picked
  per `collision-materials.js`), hurt grunts (`playSoldierHurtSound`, 2D for
  the local player, positional for a bot via `onHurt`), and `playWorldShot`
  into `world-fire.js`.
- `vehicle-audio.js` — every occupied hull's engine and gun patches
  (`MAX_LIVE_VEHICLES = 5`, `AUDIBLE_RANGE = 300`); the G3 world of one-aircraft
  audio is gone, a bot convoy sounds.
- `world-fire.js` — a bot's hand-weapon fire patch, near/far layers handing
  over on `Volume <- Distance`, one cycle per round.
- `effect-audio.js` — the impact/explosion/debris pool off
  `effects.sounds.json`, triggered by `round-impact.js`/`effects.js` at the
  collision point; pooled per script, budget 32-6 voices, `randomPlay`
  pick-one honoured per patch.
- `engine-audio.js` — the generic `.ssc` player underneath all of the above;
  honours `stereo` (G5 fixed), `randomPlay`, per-layer `Volume <- Distance`.
- `comms.js` + `capture.js` — radio (`MenuRadioSoundHigh.ssc` patches, 2D) and
  shouted (`SoldierVoice.ssc`, 3D on the speaker) voice, both per-nation, plus
  the capture announcer (`WeNowHaveControlOver*` / `WeHaveLostControlOf*`) on
  `onCapture`.
- `parachute.js` — names the `c_SstFallingHigh` / `c_SstOpenParachute` /
  `c_SstParachuteLand` triggers per state, and `soldier.json` + `models/sounds`
  carry the samples; the events surface through
  `soldier.drainParachuteEvents()` into `localPlayer.parachuteLog`, which the
  test hooks read — **the sample plumbing exists but no page code plays the
  bail-out triggers yet** (see the delta below).

Extracted but silent, the honest list:

1. **The bail-out triggers do not play.** `extract_soldier_sounds.py` ships
   `SoldierFallingHigh` / `SoldierOpenParachute` (77 samples incl. the
   11.5 s `soprupp` easter egg and the `@Language` scream) and `parachute.js`
   emits the triggers, but nothing consumes them into `playSoldierOneShot` —
   the samples and the events never met. S of runtime work, zero extraction.
2. **Round whizz-by and distant MG** (`bulletair1..7`, `mgdist1..20`,
   `patronrelease1..3`, 2.0 MB) are extracted by nothing and played by nothing.
   The old G8's size call stands: closest-approach per round against the
   camera, S-M.
3. **The remaining soldier states** (jump, jump-land, crouch, crawl, swim,
   ladder, death `Dying1..8`, medic, exertion `charge`) are extracted by
   nothing. Of these only death has an event to hang it on (`onDeath`).
4. **Menu/UI SFX** (`menucancel`, `menuchange`, the cloth rustles) — extracted
   by nothing; the play front-end has music but no click layer.
5. **`Vehicle` classes beyond Engine/FireArms** (turret traverse, tracks,
   landing gear, airframe creak, sonar, torpedo launch) — extracted by nothing.
   Unchanged from the old G4, still M.
6. **Weapon reload/bolt/shell-bounce patches** — the weapon extractor ships the
   firing patch only (G7's 60 dropped patches); `viewer/models/sounds` carries
   `patron1..5` and the Garand ping already, but no manifest entry names them
   for a runtime event.
7. **Music, four of six tracks** — no briefing/vehicle/theme layer beyond load
   and menu.

## The delta, and the build list

What stands between the trees and in-scope parity, with size-ranked order by
audible impact:

| # | item | extraction | runtime | audible payoff |
|---|---|---|---|---|
| 1 | Wire the bail-out triggers (`c_SstFallingHigh`/`OpenParachute`) into `playSoldierOneShot` | none — shipped | S | the parachute jump gets its wind, whoosh, scream and canopy |
| 2 | Round whizz-by + distant MG from `Projectile_High.ssc` / `mgdist_High.ssc` | S (two shared scripts) | S-M (closest-approach per round in `round-impact.js`/`gunfire.js`) | a firefight has geometry you can hear |
| 3 | Death sounds (`SoldierKilled.ssc`, `Dying1..8` per nation) | S (one `@Language` script, the substitution `extract_soldier_sounds.py` already knows) | S (`onDeath` exists) | kills stop being only visual |
| 4 | The 15 orphaned `_shared/sounds` files: repoint or drop (`Ammorefill` is the depot give now; `dingy_idle` belongs to an unextracted XPack2 boat script) | S (a `--prune` on the extractor or a repoint) | none | tree hygiene, ~0.36 MB |
| 5 | XPack dead references: `100voco.wav` (SturmGeschütz turret) has no sample anywhere; `Aircraft_2prop_engine_medRPM` needs the extractor's `_left/_mid/_right` variant fallback | S | none | one silent SturmGeschütz turret |
| 6 | Jump/land/crouch/crawl/swim states | M (12 scripts, all plain movement samples) | M (needs the corresponding soldier states surfaced as events) | fuller first-person footwork |
| 7 | Weapon reload/bolt/bounce patches into `weapons.json` | S (emit all sounding patches) | M (needs reload events in the gun model) | the Garand pings |
| 8 | Menu UI click layer | S | S-M | only worth it with more menu chrome |
| 9 | Landing gear / turret traverse / tracks (`RotationalBundle` etc.) | M | M | polish on the driven surface |
| 10 | The other four music tracks | S | S | context, not gameplay |

Not gaps, re-confirmed by this census: the 75+53+69 unreferenced wavs (dead
assets in shipped data, do not extract), the menu `addGroup Volume` mixer
group, the six language packs' missing 36 stems (they are the CTF flag lines,
`Dying`/`charge`/`incoming`/`grenade` families — extractable on demand per
item 3, but 2.9 MB per pack if taken whole), and music beyond the two shipped
tracks.

## Census reproducing commands

Run from `/home/dylan/projects/skandia/bfstats/tools/bf1942-models` (the
archive ones read the live install; note `RfaArchive.entries` is a dict keyed
by lowered path and each value is `(c_size, uc_size, offset)`):

```bash
# Per-mod wav census (distinct paths, 44 kHz non-voice, voice packs)
python3 - <<'EOF'
from bf42.rfa import RfaArchive
from pathlib import Path
import collections
B = Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods'
for mod, names in [('bf1942', ['sound.rfa','sound_001.rfa']),
                   ('XPack1', ['Sound.rfa']), ('XPack2', ['sound.rfa'])]:
    seen = {}
    for n in names:
        a = RfaArchive(B/mod/'Archives'/n)
        for name, (c, u, o) in a.entries.items():
            ln = name.lower()
            if ln.endswith('.wav'): seen[ln] = u
    rates = collections.Counter(p.split('/')[1] for p in seen)
    voice = sum(1 for p in seen if len(p.split('/')) == 4)
    print(mod, len(seen), dict(rates), 'voice:', voice)
EOF

# Every .ssc load line, block-comment aware, against the union corpus
# (the census script: walk all three mods' Objects/Game/Menu rfAs, strip /* */,
# collect `load` paths, resolve @ROOT/@RTD/@Language, diff against wavs)

# Effect sound manifest coverage: damage-table templates vs sounding bundles
python3 - <<'EOF'
import json
from pathlib import Path
ed = json.loads(Path('viewer/maps/_shared/effects.sounds.json').read_text())
print(len(ed['bundles']), 'bundles,', len(ed['scripts']), 'scripts,',
      len(ed['silent']), 'silent,', ed['level'])
EOF

# What scene.json actually references vs what _shared/sounds holds
python3 - <<'EOF'
import json, glob
from pathlib import Path
ref = set()
for p in glob.glob('viewer/maps/*/scene.json'):
    s = json.loads(Path(p).read_text()).get('sounds') or {}
    if s.get('ambient'): ref.add(s['ambient']['file'].split('/')[-1])
    for a in s.get('areas') or []:
        if a.get('file'): ref.add(a['file'].split('/')[-1])
    for v in s.get('vehicles') or []:
        for l in v.get('layers') or []: ref.add(l['file'].split('/')[-1])
        for w in v.get('weapons') or []:
            for l in w.get('layers') or []: ref.add(l['file'].split('/')[-1])
    if s.get('flags'): ref.add(s['flags']['file'].split('/')[-1])
ed = json.loads(Path('viewer/maps/_shared/effects.sounds.json').read_text())
eff = {l['file'].split('/')[-1] for s in ed['scripts'].values() for l in s['layers']}
disk = {q.name for q in Path('viewer/maps/_shared/sounds').glob('*.mp3')}
print('scene refs:', len(ref), 'effect refs:', len(eff), 'on disk:', len(disk),
      'orphans:', sorted(disk - {x.replace('.mp3','') for x in ref} - eff))
EOF
```

Spot-check extractions this census ran, all into scratch, nothing published:
`extract_weapon_sounds.py Thompson K98 M1Garand --out <scratch>` (3 weapons,
0 quiet), `extract_soldier_sounds.py --out <scratch>` (77 samples, manifest
records `c_SstParachuteLand` as genuinely absent from the mod), and
`extract_capture_voices.py` + `extract_radio.py --out <scratch>` (6x6 capture,
23+22 patches x 54 stems per nation).

---

# The 2026-09-14 audit

Audit date 2026-09-14, against vanilla `bf1942` under
`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/`, the 23 extracted maps
in `tools/bf1942-models/viewer/maps/`, and HEAD `0380713`.

Everything below is measured, not estimated, unless marked **UNVERIFIED**.
Every count came from one of the reproducing commands in §9.

**The headline.** The viewer plays 5 of the ~14 things the engine plays, and the
reason is not size. Every `.wav` any vanilla `.ssc` references — all 643 of them
— is **48.15 MB at 44 kHz, 7.59 MB as MP3 -V2**, measured by transcoding all 643
through the pipeline's own ffmpeg invocation. One full voice pack is another
**2.00 MB**. The shipped tree today is **147 files, 3.1 MB**. Complete vanilla
audio coverage is a **+6.5 MB** delta against a 14 GB `viewer/maps` tree. The
size argument that justified the MP3 work does not apply to widening coverage;
what is missing is extraction reach and runtime event plumbing.

---

## 1. The sound catalogue

`sound.rfa` (218,499,997 B) + `sound_001.rfa` (43,385,438 B) = **4,280 entries**,
4,278 `.wav` + 2 `.sfk` (Sound Forge peak files, not audio).

Layout is `sound/<rate>/[<LanguagePack>/]<name>.wav` — the `@RTD` sample-rate
directory the engine substitutes per `game.setQuality`:

| rate dir | entries | bytes |
|---|---|---|
| `sound/11khz` | 1,428 | 36.61 MB |
| `sound/22khz` | 1,426 | 73.04 MB |
| `sound/44kHz` (`44khz` in sound_001) | 1,426 | 145.90 MB |
| **total on disk** | **4,280** | **255.56 MB** |

One rate tier is the real corpus: **1,409 distinct files at 44 kHz, 145.17 MB** —
**712 non-voice (55.29 MB)** plus **697 voice (89.88 MB)** split across six
language packs (`English` 116, `German` 116, `Japanese` 116, `Russian` 116,
`UsEnglish` 116, `Canadian` 117 — Canadian ships only in `sound_001.rfa`).

All PCM 16-bit, mono except a handful (`CAMG1/2.wav` and their per-plane
equivalents are 2-channel — verified by `ffprobe` on the extracted
`_shared/sounds/CAMG1.mp3`: `44100,2,0.089977`). No compression inside the
archive; the `.rfa` LZO is the only packing.

**Referenced vs shipped.** 643 of the 712 non-voice files are `load`ed by some
`.ssc` in `Objects.rfa`/`Game.rfa`/`menu.rfa` (48.15 MB @44 kHz). 69 are not —
of those, 9 are level-local ambience resolved from level archives
(`water_waves`, `windall`, `windcalm`, `lake`, `river`, `underground`,
`wavesconcrete`, `ambfx`, `air-raid-siren-pitched-reverb`) and the rest look
like dead or superseded assets (`m1reload-2.wav`, `mg42.wav`, `t34eng.wav`,
`menuok.wav`, …).

Classification by the owning script's directory, against what is on disk in
`viewer/maps/_shared/sounds` today:

| role | files in game data | MB (wav 44k) | extracted | MB extracted |
|---|---|---|---|---|
| Effect (explosion / impact / ricochet / fire / debris) | 213 | 15.12 | 0 | 0.00 |
| Hand weapon (infantry) | 106 | 3.79 | 1 | 0.08 |
| Soldier movement (footsteps, swim, jump, chute) | 104 | 4.06 | 0 | 0.00 |
| Vehicle — Land | 81 | 9.52 | 69 | 7.94 |
| Vehicle — Air | 53 | 3.98 | 42 | 3.32 |
| Common (whizz-by, distant MG, shell bounce, sandstorm) | 32 | 3.06 | 0 | 0.00 |
| Vehicle — Sea | 26 | 5.15 | 23 | 4.73 |
| Menu / UI | 12 | 0.51 | 0 | 0.00 |
| Building (windmill, factory, hangar, radar, dock) | 6 | 2.01 | 1 | 0.81 |
| Stationary weapon (MG42, Browning) | 4 | 0.09 | 1 | 0.05 |
| Game / HUD (radio crackle) | 2 | 0.05 | 0 | 0.00 |
| Vehicle common (torpedo) | 2 | 0.14 | 0 | 0.00 |
| Soldier voice / pain (non-@Language part) | 1 | 0.34 | 0 | 0.00 |
| Item (flag flap) | 1 | 0.52 | 1 | 0.52 |
| **subtotal non-voice** | **643** | **48.35** | **138** | **17.44** |
| Voice lines (`@Language`, ×6 packs) | 105 ×6 | 12.96/pack | 0 | 0.00 |
| Music (`Mods/bf1942/Music/*.bik`, outside the rfa) | 6 | 38.5 MB Bink | 0 | 0.00 |

(The 138 vs 147 difference is the 9 level-local ambience files, which are
extracted but have no `.ssc` in `Objects.rfa` to classify them by. "MB
extracted" is the 44 kHz source weight of what got shipped, not the MP3 weight —
the 147 MP3s on disk total 3.1 MB.)

## 2. The sound-script layer, and how much of it the code speaks

Sound binds through `ObjectTemplate.loadSoundScript <path>` in a `.con`, onto a
**template**, not a vehicle. 428 bindings in `Objects.rfa`:

| class | bindings | | class | bindings |
|---|---|---|---|---|
| EffectBundle | 83 | | AnimatedBundle | 22 |
| RotationalBundle | 82 | | Wing | 22 |
| FireArms | 56 | | LandingGear | 14 |
| Engine | 51 | | SupplyDepot | 10 |
| Projectile | 46 | | Bundle | 10 |
| HandFireArms | 27 | | PlayerControlObject / SonarObject / SimpleObject | 5 |

Plus **three binding mechanisms that are not `loadSoundScript` at all**:

- `SoldierSound.*` — `Objects/Soldiers/Common/Sounds/SoldierSound.inc` loads 24
  per-event scripts and `Objects/Soldiers/Common/Sounds/MaterialToSound.con`
  maps **104 material indices to 8 surface names** (`Grass Water Gravel Mud
  Frozen Sand Concrete Metal Wood`), plus rate settings
  (`SoldierSound.setRunFrequency 0.36`, `setRandomRunFrequency 0.017`, …).
- `MaterialManager.setEffectTemplate` — **3,047 lines across 39
  `Bf1942/Game/damage_system/*.con`**, mapping (attGroup × defGroup) to one of
  **52 impact effect templates**; each effect carries its own `.ssc`.
- Game-level scripts run by the engine directly: `Bf1942/Game/GamePlay.ssc`
  (control-point gain/loss, ticket warnings, desertion warning, radio crackle),
  `Bf1942/Game/CTF.ssc` (8 patches), `Bf1942/Game/Heartbeats.ssc`
  (`#beginMap HeartBeat / Pitch / Volume`), `menu/MenuSound.ssc` +
  `menu/MenuRadioSound*.ssc`.

**`parse_ssc` (`bf42/level.py:1118`) is genuinely generic** — it is not a
Corsair special case. A full directive census over all 988 `.ssc` files shows it
handles every directive that occurs more than 16 times, including the shipped
typos (`oad` ×4, `pram` ×2, `volume.2` ×3, `endeffec` ×1). Only three things in
the vocabulary are unhandled:

| directive | uses | where | handled |
|---|---|---|---|
| `addGroup Volume Menu` | 16 | `menu/MenuSound.ssc`, `menu/MenuRadioSound*.ssc` | no (harmless — menu mixer group) |
| `/* … */` block comment | 50 open / 26 close | `Objects/HandWeapons/{M1Garand,Type5}/Sounds/{High,Medium,Low}.ssc`, `Objects/Effects/e_ExplWindow/...` | **no — see G16** |
| `#beginMap` channel names (`Rpm`, `DiveAngle`, `Speed`, `Angle`, `Pitch`) | 5 | `EngineMap.ssc`, `SoundMap.ssc`, `Heartbeats.ssc` | skipped correctly |

So the gap is **not** the parser. It is (a) what the extractor asks the parser
for, and (b) what `engine-audio.js` does with the result.

---

## 3. Gaps

### G1 — Impact and ricochet sound per surface material: nothing extracted, nothing plays

**Gap.** Bullets and shells hit terrain, metal, wood, stone, water and flesh with
completely different, randomised sounds, and the viewer plays none of them —
even though the material→effect table is already parsed in this repo.

**Ground truth.** `Bf1942/Game/damage_system/*.con`, 39 files, **3,047
`MaterialManager.setEffectTemplate` lines → 52 distinct effect templates**. 18
are ricochet bundles (`e_RichoMetal` 260 references, `e_RichoPHeavy` 207,
`e_RichoGround` 129, `e_RichoWood` 57, `e_RichoStone` 50, `e_RichoGrass` 22,
`e_RichoWater` 11, `e_RichoSandbag` 14, `e_RichoSnow`, `e_RichoGlass`, … plus
`Heavy` variants), each with three tier scripts under
`Objects/Effects/e_Richo*/Sounds/`. Example
`Objects/Effects/e_RichoMetal/Sounds/richometal_High.ssc`: **12 alternates**
`metalimpact1..12.wav`, each `volume .9`, `minDistance 5`, `dopplerOff`,
`priority 4`, `Volume <- Distance Ramp 6 25 1 -1`, and the file closes with
`randomPlay 1`. Effect-category totals: **213 files, 15.12 MB** — the single
largest untouched block.

**Current state.** `bf42/damage.py:308-310` already stores these into
`DamageTables.effects[(att, def)]`; `extract_models.py:113` already calls
`load_tables`. Nothing then reads the effect's `loadSoundScript`.
`viewer/gunfire.js` has no collision detection at all — rounds recycle on
`TRACER_MAX_AGE` / `TRACER_MAX_RANGE` (`gunfire.js:39-40`), so there is no
impact event to hang a sound on.

**Size.** L. Needs (1) a raycast/terrain-collision in `gunfire.js` to produce an
impact event with a surface, (2) a material lookup at the hit point, (3)
`randomPlay` support (G12), (4) a one-shot voice pool. Extraction itself is S —
the tables and `parse_ssc` both exist.

**Impact.** High. This is the sound that makes shooting feel like it connects,
and today firing produces a gun report and then silence.

---

### G2 — Explosions: no near/far layering, no debris, no wreck fire

**Gap.** Nothing explodes audibly. The game's explosion is a distance-layered,
speed-of-sound-delayed stack, and none of it is extracted.

**Ground truth.** `Objects/Effects/e_ExplGas/Sounds/High.ssc`: `explgas.wav`
main layer (`minDistance 40`, `Volume <- Distance Ramp 100 200 1 -1`), then
`explnrmsemi1.wav` gated **on** at 100 m (`Ramp 100 130 0 1`) with
`trigger Volume` and a step `Time Ramp 0.3 0.3 0 1` — a 0.3 s delay, i.e. 100 m
at 340 m/s — then `explnrmdst1.wav` at 200 m / 0.55 s, `explnrmfar1.wav` at
400 m / 0.75 s, plus two `explrevdist` tails. `e_ExplArmor` is referenced 198×
by the damage tables, `e_ExplGranade` 129×, `BombSmallNS_Expl` 128×,
`e_ExplBoatArmor` 117×, `BombBig_Expl` 92×. Wreck burn is
`Objects/Vehicles/Common/Sounds/fire.ssc` (three `vefr1/2/3.wav` crackle loops,
`randomPlay 1`); debris impacts route to `e_Collision_Debrie_Metal` →
`debrie_metal.ssc`.

**Current state.** No explosion path anywhere. `extract_map.py` walks only
`Engine` (`find_engine_script`, `extract_map.py:254`) and `FireArms`
(`find_weapon_scripts`, `extract_map.py:296`). `EffectBundle` — the class with
the most sound bindings (83) — is never visited.

**Size.** L, and blocked by the same missing impact/death event as G1. Extraction
alone is S.

**Impact.** High, but only once something can explode.

---

### G3 — Engine sound reaches 3 of 54 vehicles; 111 of 136 extracted samples can never be heard

**Gap.** `extract_map.py` ships engine+gun patches for **54 distinct vehicle
templates across 23 maps** (136 sample files, 2.41 MB of MP3), but
`setupEngineAudio` only ever runs for the vehicle the user is flying, and
`setPilot` only ever seats a **Corsair, Spitfire or Zero**. **111 of the 136
sample files (2.04 MB) are unreachable by any user action.** Parked and idling
vehicles — every tank, jeep, ship and AA gun on the map — are silent.

**Ground truth.** 51 `Engine` bindings in `Objects.rfa`; the extracted set
includes `sherman`, `tiger`, `panzeriv`, `t34`, `willy`, `kubelwagen`,
`hanomag`, `elco80`, `fletcher`, `yamato`, `hatsuzuki`, `shokaku`, `sub7c`,
`lcvp`, `priest`, `wespe`, `m10`, `katyusha`, `kettenkrad`, `blackmedal`, … In
game every one of these idles audibly; `ShermanEngine` even carries
`ObjectTemplate.setAttachToListener 1`.

**Current state.** `viewer/map.html:1954` —
`findVehicle(currentRoot, 'Corsair') || findVehicle(..., 'Spitfire') ||
findVehicle(..., 'Zero')`. `viewer/map.html:1429` `setupEngineAudio` returns
early `if (!aircraft)`.

**Size.** M. `EngineAudio` is already a generic `.ssc` player and the data is
already in `scene.json`; what is needed is an idle-engine manager over nearby
spawned vehicles with a distance-sorted voice cap (§4) and `rpm = 0`.

**Impact.** High. An airfield with eight parked aircraft and a running Sherman
that makes no noise is the single most obvious silence in the flythrough.

---

### G4 — Land/sea/air vehicle sound classes beyond `Engine` and `FireArms` are never extracted

**Gap.** `find_engine_script` and `find_weapon_scripts` between them cover 107 of
the 428 bindings. Turret traverse, tracks, landing gear, airframe creak, horn,
sonar and torpedo launch are all authored and none are touched.

**Ground truth.** 32 vehicle-owned `.wav` files (2.9 MB) referenced by no
extracted script. Concretely:
`Objects/Vehicles/Land/Chi-ha/Sounds/High/ChihaTurret.ssc` →
`turret_handoperated.wav` (133 K); `ChihaTrackL.ssc` → `vealttrack.wav` (232 K);
`Objects/Vehicles/Land/KettenKrad/Sounds/High/KettenKradTrack.ssc` →
`v_kettenkrad_treds.wav` (352 K);
`Objects/Vehicles/Land/AA_Base/Sounds/High/AA_Allies_Carriage.ssc` →
`wsaaaturrot.wav`; `Objects/Vehicles/Air/Common/Sounds/LandingGearHighMed.ssc` →
`lg1/lg2/lg3/lg5/lghi` (+ `lcvphirpm`); `Objects/Vehicles/Air/Common/Sounds/
HullLeft.ssc`/`HullRight.ssc` → `arplcrnk.wav` (the airframe creak, bound to the
`Wing` class, 22 bindings, `Volume = ramp(Acceleration 10→30) × ramp(Speed
20→40)`); `Objects/Vehicles/Sea/Common/Sounds/High/SonarDest.ssc` →
`snrsub.wav`; `Objects/Vehicles/Sea/Type38/Sounds/High/Type38_Torpedo_Left.ssc`
→ `torpedo_launch_2.wav`; level-local
`bf1942/Levels/Battle_of_Britain/Objects/Willy/Sounds/High/WillyHorn.ssc` →
`willy_horn.wav`. Class census: `RotationalBundle` 82 bindings (turret/gun
traverse), `AnimatedBundle` 22, `LandingGear` 14, `Wing` 22.

**Current state.** `extract_map.py:254` walks the template tree for the first
`Engine` child and stops; `extract_map.py:296` collects `FireArms`. No other
class is visited.

**Size.** M for extraction (generalise the walk to *every* child template
carrying a `loadSoundScript`, keyed by class), M for runtime (`RotationalBundle`
needs a turret-angle-rate control channel, `LandingGear` a gear state, `Wing`
already has `Speed` and `Acceleration` in `engineControl`).

**Impact.** Medium — the Corsair's landing gear and airframe creak are the two
most-missed on the surface that exists today.

---

### G5 — `stereo` is extracted and then ignored: the cockpit gun is HRTF-panned when the data says 2D

**Gap.** `stereo` marks a sample for non-spatialised playback (185 uses in
vanilla, and `Settings/Default.con` reserves channels for it:
`Sound.reserve2dStereoChans 2/2/2`). The extractor writes the flag into every
layer dict; `engine-audio.js` never reads it, so the two-channel cockpit gun
layers are downmixed and HRTF-convolved at a 1.2 m distance.

**Ground truth.** `Objects/Vehicles/Air/Corsair/Sounds/CorsairMG.ssc` marks
`CAMG1.wav`/`CAMG2.wav` `stereo`; `ffprobe` on the shipped
`_shared/sounds/CAMG1.mp3` → `44100,**2**,0.089977`. Six such layers exist on
the three flyable planes today: `corsair` CAMG1/CAMG2, `spitfire` SFMG1/SFMG2,
`zero` AVMG2/CAMG1.

**Current state.** `extract_map.py:678` emits `"stereo": sample.stereo`.
`viewer/engine-audio.js:131-154` (`class Voice`) connects every voice to a
`PannerNode` unconditionally; grepping `stereo` in `engine-audio.js` finds only
a comment at line 186.

**Size.** S. Route `layer.stereo` voices to the bus directly instead of through
`voice.group.panner`, and leave their `Volume <- Distance` ramp alone.

**Impact.** Medium-high, and it is wrong *today* on the one surface that ships —
the cockpit "brrrt" is the layer the whole gun patch is built around.

---

### G6 — The model browser (`viewer/index.html`) has no audio at all

**Gap.** `viewer/index.html` is 4,797 lines, drives `GunFire` (3 references),
fires every weapon and spins every vehicle — and contains **zero** occurrences of
`AudioListener`, `AudioContext`, `PositionalAudio` or `engine-audio`. The model
and kit browser is completely silent.

**Ground truth.** 27 `HandFireArms` templates carry sound scripts
(`Bar1918 Bazooka Colt DP Detonator ExpPack GrenadeAllies GrenadeAxis JohnsonLMG
K98 K98Sniper KnifeAllies KnifeAxis Landmine M1Garand MedPack Mp18 Mp40 No4
No4Sniper Panzershreck RepairPack Sg44 Thompson Type5 Type99 WalterP38`),
**106 files / 3.79 MB**, of which exactly one (`silence.wav`) is extracted.
The whole infantry weapon set is 0.6 MB as MP3.

**Current state.** `bf42/con.py`, `bf42/assemble.py`, `bf42/roster.py` and
`extract_models.py` contain **no** `loadSoundScript` / `.ssc` handling — grep
returns nothing. Sound only exists on the map pipeline.

**Size.** M. Extraction reuses `find_weapon_scripts` + `_sound_layers` verbatim
against the model library; runtime reuses `EngineAudio` with a fixed listener.

**Impact.** High — `mesh.bfstats.io`'s browse page is the surface most people
see, and a Thompson that fires silently reads as broken rather than as
unimplemented.

---

### G7 — Only one patch per weapon survives extraction: no reload, bolt, shell bounce, or distant report

**Gap.** `_firing_patch` takes **the first non-silence patch and discards the
rest**. Every vanilla weapon script declares six slots (Fire, Reload, Release,
Shell Bounce, MG distance, Fire Loop). Across the 83 `FireArms`/`HandFireArms`
bindings that is **60 patches dropped, carrying 84 distinct samples**.

**Ground truth.** Parsing all 83 bound scripts at `#templateLevel HIGH` with the
repo's own `parse_ssc`: 46 `FireArms` have 1 sounding patch, 10 have 2; 9
`HandFireArms` have 1, 2 have 2, **12 have 3**, 2 have 4, **2 have 10**. The
dropped samples include `m1reload.wav`, `m1-insert-clip.wav`,
`m1_final_reload.wav` (the Garand ping), `patron1..5.wav` and
`patronrelease1..3.wav` (shell bounce), `rifle-distance1.wav`,
`m1garand_fire_3_reverb.wav`, and all 20 `mgdist*.wav`.

**Current state.** `extract_map.py:345` `_firing_patch`, docstring: "the first
with a non-silence sample". `extract_map.py:625` similarly takes `patches[0]`
for the engine.

**Size.** S for extraction (emit all sounding patches with their index, so the
slot meaning is recoverable), M for runtime (needs reload/bolt events, which the
viewer's gun model does not currently have).

**Impact.** Medium.

---

### G8 — Distant weapon report and bullet whizz-by are absent

**Gap.** Two of the most characteristic BF1942 sounds — the crack of a round
passing you, and the far-off rattle of a firefight — are single shared scripts
that nothing extracts.

**Ground truth.** `Objects/Common/Sounds/Projectile_High.ssc`: seven
`bulletair1..7.wav` alternates (114 KB total), `minDistance 5`,
`randomStartPitch 0.05/0.05`, `dopplerOff`, `priority -1`,
`Volume <- Distance Ramp 10 35 1 -1` and `trigger Volume` gated by a step
`Time Ramp 0.075 0.075 0 1`. Bound to the `Projectile` class (46 bindings).
`Objects/Common/Sounds/mgdist_High.ssc`: **20** `mgdist1..20.wav` alternates,
1.8 MB, `randomPlay 1`. `Objects/Common/Sounds/ShellBounce.ssc`:
`patronrelease1..3.wav`.

**Current state.** Not extracted (the `Projectile` and shared-`Common` classes
are not walked). `gunfire.js` already knows each round's position each frame, so
whizz-by only needs a closest-approach test.

**Size.** M (whizz-by is the cheapest realistic win here: no new collision
system, just per-round distance-to-listener).

**Impact.** Medium-high for the flown surface.

---

### G9 — Static-object ambience: 93 sounding buildings placed across vanilla maps, all silent

**Gap.** Nine building templates carry looping ambience and none of it is
discovered, because `discover_level_sounds` only scans `Sounds/*.con` **inside
the level archive**, and these bindings live in `Objects.rfa`.

**Ground truth.** `ObjectTemplate.loadSoundScript` on `euwindmill_m1`
(`Sounds/windmill.ssc`), `eu_watermill_m1` (`watermill.ssc`), `factory_m1`
(`Factory.ssc`, with `relativePosition 5/0/0`), `guardtow_M1`
(`guardtow.ssc`), `hangar1_m1` (`Hangar.ssc`), `harbdock_m1`
(`harbdock.ssc`), `radarbun_M1` + `radarbun_tower_M1`
(`Radarbun.ssc`/`Radarbun_tow.ssc`), plus four `SupplyDepot` ammo-box templates
(`Objects/Common/Sounds/SupplyDepot.ssc`). Counted from every vanilla
`StaticObjects.con`: **93 placements** — `guardtow_m1` 54× on 12 levels,
`radarbun_m1` 12× on 6, `hangar1_m1` 11× on 5, `factory_m1` 8× on 4,
`euwindmill_m1` 5× on 5, `eu_watermill_m1` 3× on 3. Building-category audio is
6 files / 2.01 MB.

Same mechanism misses `Objects/Vegetation/Common/Afri_Sandstorm` →
`Afri_SandStorm.ssc` (`sandstorm.wav` 821 K + `windrumble.wav` 128 K) — **not
placed in any vanilla level** (checked all 23 `StaticObjects.con`), but XPack
and mod content places it.

**Current state.** `bf42/level.py:1382-1392` — the template scan is
`("sounds/" in name) and name.endswith(".con")` over `files.names()`, i.e. the
level archive only. `bf42/level.py:1395` then matches those templates against
`static_objects`.

**Size.** S-M. The placement list and the object pool are both already in
`extract_map.py`'s hands; this is "also look up the template in `objects` and
take its `loadSoundScript`", feeding the existing `areas` list, which the viewer
already groups, dedupes and distance-ramps.

**Impact.** High per unit of work — it makes 12 of 23 maps stop sounding empty,
and it reuses the shipped area-sound runtime end to end.

---

### G10 — Voice: `@Language` is not a substitution the extractor knows

**Gap.** `resolve_sound` substitutes `@ROOT` and `@RTD` and nothing else. Every
voice line in the game is `@ROOT/Sound/@RTD/@Language/<name>.wav`, so the entire
spoken layer is unresolvable by the current code path.

**Ground truth.** **105 distinct `@Language` samples** referenced by `.ssc`, all
105 present in every pack; English pack = 116 files / 13.81 MB at 44 kHz, 2.00 MB
as MP3 -V2. They cover:
`Bf1942/Game/GamePlay.ssc` — `WeNowHaveControlOver{,2,3}.wav` (`randomPlay 1`,
`priority 11`), `WeHaveLostControlOf{,2,3}.wav`,
`WeAreTakingHeavyCasualities.wav`, `WeAreRunningLowOnReinforce.wav`,
`WarningDesertersShot{,ALT}.wav`, plus non-voice `radiomess.wav`;
`Bf1942/Game/CTF.ssc` — 8 patches of flag steal/capture/recover/drop;
`Objects/Soldiers/Common/Sounds/SoldierKilled.ssc` — `Dying1..8.wav`,
`randomPlay 1`, `Volume <- Distance Ramp 8 30 1 -1`;
`SoldierHitDamage.ssc` — `BeingHit1..6.wav`; `SoldierVoice.ssc`,
`SoldierCharge.ssc`, `SoldierHealedByMedic.ssc`.

**Current state.** `extract_map.py:211` `resolve_sound` — the only substitutions
are `@root/` strip and `@rtd` regex.

**Size.** S for extraction (one substitution + a `--language` flag); M-L for
anything to trigger it, because the viewer simulates no capture, no death and
no ticket count.

**Impact.** Low on today's flythrough, high the moment control-point capture is
simulated (§G11).

---

### G11 — Flags: the flap loop plays, the capture events do not — and 3 maps get no flag sound at all

**Gap (a).** `scene.json.sounds.flags` carries only the `AnimatedFlag` cloth
loop. Capturing, losing and contesting a control point are separate 2D voice
patches that are neither extracted nor triggered.

**Gap (b).** `midway`, `truk` and `kasserine_pass` have control points in
`scene.json` (4, 5, 5) but **no `flags` key**, because `extract_flag_sound`
drops any point whose team-resolved cloth mesh is absent — and those levels
declare `ObjectTemplate.team 0` with only `setTeamGeometry 1/2`, so neutral
points resolve to `flagMesh: null`. `coral_sea` legitimately has zero control
points.

**Ground truth.** `bf1942/levels/Midway/Conquest/ControlPointTemplates.con`:
`ObjectTemplate.team 0` … `ObjectTemplate.addTemplate AnimatedFlag` …
`setTeamGeometry 1 flagJp_m1` / `setTeamGeometry 2 flagUs_m1`. The
`AnimatedFlag` child — which is what carries `Sounds/flag.ssc` — **is** added
regardless of team. Whether Refractor still plays the flap with no cloth mesh
bound is **UNVERIFIED**. Capture voice: `Bf1942/Game/GamePlay.ssc` patches 1-2.

**Current state.** `extract_map.py:535` `extract_flag_sound`, the filter
`if not tpl.flag_mesh(team): continue`. Runtime: `viewer/map.html:1314-1325`
folds flags into the area pool as point emitters.

**Size.** S for (b) — decide the rule and either drop the filter or document it.
M for (a), gated on capture simulation.

**Impact.** Low-medium; (b) is a two-line question with a concrete
three-map symptom.

---

### G12 — `randomPlay` is parsed, then dropped at extraction and unimplemented at runtime

**Gap.** `randomPlay 1` means "play **one** randomly chosen sample from this
patch", not "play them all". `parse_ssc` sets `SoundPatch.random_play`
(`level.py:1247`), `_sound_layers` never emits it, and `EngineAudio.start()`
plays every non-`trigger Release` layer unconditionally.

**Ground truth.** 253 uses. By owning class at HIGH tier: **EffectBundle
114 / 136 patches**, **Projectile 28 / 42**, HandFireArms 20 / 113,
FireArms 11 / 171, **Engine 0 / 50**. So it is latent for what ships today and
**blocking for G1, G2, G8 and every soldier sound** — a 12-alternate ricochet
patch played as 12 simultaneous layers is a wall of noise, not an impact.

**Current state.** `extract_map.py:662` `_sound_layers` returns a flat list with
no patch-level flag; `viewer/engine-audio.js:226` `start()` iterates all voices.

**Size.** S. Emit `randomPlay` on the patch, and in `start()`/`#play` pick one
voice per trigger when it is set.

**Impact.** Medium now, blocking later.

---

### G13 — `priority` and the voice budget are extracted but unenforced

**Gap.** The game mixes into a fixed pool (`Sound.setHardwareVoiceLimit 32` in
`Settings/Default.con`, `game.setChannels 64` in
`Settings/Profiles/skandia/Sound.con`) and arbitrates with `priority` (4,195
uses, range −9..11). The viewer has no cap and no stealing.

**Current state.** `extract_map.py:676` emits `"priority": sample.priority`;
`engine-audio.js` never reads it — grep finds no `priority`. Today's peak is
bounded by construction (1 ambient + N unique area files + ≤12 engine + 4×N
weapon), so nothing has clipped yet. It becomes load-bearing the moment G3
(parked vehicles) or G1 (impacts) lands.

**Size.** S — sort candidate voices by `priority` then by distance, cap at 32.

**Impact.** Low today, prerequisite for G1/G2/G3.

---

### G14 — `stop FinishSample` is extracted and ignored

**Gap.** 415 uses, and the MG fire loops all carry it: on release the sample
finishes its current loop pass so a burst ends on a bullet boundary rather than
mid-crack. `gunfire.md` documents the intent; the code mutes the bus instead.

**Current state.** `extract_map.py:675` emits `"stop": sample.stop`;
`engine-audio.js` has no reference. `viewer/map.html:1585`
`weapon.audio.setMaster(group?.firing ? master : 0)` — a gain cut.

**Size.** S. **Impact.** Low.

---

### G15 — Menu/UI sound and music are entirely absent

**Gap.** No UI feedback sound, no menu music, no level music.

**Ground truth.** `menu/MenuSound.ssc` — patches for Victory (`VOMOCF.wav`),
toggleItem (`menucancel.wav`), selectItem (`menuchange.wav` + four layered
`SoFa1/SoFa3/SoMewa1/SoMewa3` cloth rustles on `trigger Volume` +
`Time` step delays of 0.20/0.50/0.23/0.36 s), MouseOver, SelectKit, Ok — 12
files / 0.51 MB, all `addGroup Volume Menu`. Plus `menu/MenuRadioSound{,High,Low}.ssc`.
Music is 6 loose Bink files in `Mods/bf1942/Music/`: `Briefing.bik` 5.33 MB,
`Menu.bik` 4.26 MB, `Slaughter4.bik` 7.99 MB, `Theme2.bik` 2.70 MB,
`Vehicle3.bik` 7.94 MB, `Vehicle4.bik` 10.28 MB = **38.5 MB**, gated in game by
`game.setMusicOnOff 1` / `game.setMenuMusicVolume 100`.

**Current state.** None. Note the repo **already has a working bik→MP3 path** —
`ui/public/wrapped-music/*.mp3` for the wrapped feature
(`ffmpeg -i x.bik -vn -c:a libmp3lame`), and the MP3-not-AAC constraint is the
same one `audio-compression.md` re-derived independently.

**Size.** S for music (6 files, one ffmpeg loop, a `<audio>` element and a
toggle). S-M for menu SFX.

**Impact.** Medium for music — it is the cheapest single thing on this list that
changes how the viewer *feels*, and the conversion is already solved in-repo.

---

### G16 — `parse_ssc` treats `/* … */` block comments as live script

**Gap.** `parse_ssc` skips `rem`, `//`, `***` and `;` but not `/*`. **Six vanilla
files** have `load` lines inside a block comment, which the parser will happily
turn into samples.

**Ground truth.** `Objects/HandWeapons/M1Garand/Sounds/{High,Medium,Low}.ssc`
and `Objects/HandWeapons/Type5/Sounds/{High,Medium,Low}.ssc` each comment out a
`load @ROOT/Sound/@RTD/snpreload.wav` block. Census: 50 `/*` and 26 `*/` tokens
across all `.ssc`.

**Current state.** `bf42/level.py:1161-1164`.

**Size.** S — a block-comment state flag in `_ssc_lines`.

**Impact.** Latent today (no hand weapon is extracted) — becomes a wrong-sample
bug the moment G6 lands. Worth fixing *with* G6.

---

### G17 — Area sounds collapse to one sample and the first tier

**Gap.** `discover_level_sounds` takes `patches[0]` and `close_patch` projects
only `samples[0]` onto the scalar view, and it calls `parse_ssc` with no `level=`
filter so HIGH/MEDIUM/LOW patches are merged and the first wins. Any multi-layer
or tier-dispatched level ambience loses everything after the first `load`.

**Current state.** `bf42/level.py:1372` and `1412` (`parse_ssc(ssc_txt)` — no
level), `1141-1159` `close_patch`.

**Size.** S. **Impact.** Low for vanilla — `engine-sound.md` §7.1 records that
all 93 vanilla level-root ambient/area scripts are single-load, verified
byte-identical output. It is a mod-facing gap (EoD ships per-map radio/music
beds), so verify before changing.

---

### G18 — Soldier audio: the whole subsystem is unimplemented

**Gap.** Footsteps per surface, jump, land, crouch, crawl, swim, ladder,
parachute, pain, death and exertion are 32 `.ssc` files and **104 movement
samples / 4.06 MB**, plus the 105 `@Language` lines of G10. None extracted.

**Ground truth.** `Objects/Soldiers/Common/Sounds/SoldierSound.inc` loads 24
scripts by name (`SoldierStop/Walk/Run/Jump/JumpLand/ToCrouch/FromCrouch/
CrouchMove/ToCrawl/StandUp/CrawlMove/ToSwim/Swim/SwimStand/FromSwim/
OpenParachute/FallingHigh/ParachuteLand/HitDamage/FFHitDamage/Killed/
ClimbLadder/RefillAmmo/HealedByMedic`) with rate settings
(`setRunFrequency 0.36`, `setWalkFrequency 0.66`, `setSwimFrequency 1`, …).
`Objects/Soldiers/Common/Sounds/High/SoldierWalk.ssc` is one patch **per surface
name** — SAND (`SOWASAND1..4.wav`), METAL (`SOWAMTL1..4`), WOOD (`SOWAWD1..4`),
… each closed with `randomPlay 1`, `volume .5`, `minDistance 1`, `dopplerOff`,
`Volume <- Distance Ramp 3 10 1 -1`. `MaterialToSound.con` supplies the
104-row material→surface-name table that selects which patch.

**Current state.** Nothing. There is also no soldier in the map viewer to make
the noise — `map.html` has 2 incidental `soldier`/`kit` references.

**Size.** L, and the *correct* deprioritisation: it needs a walking first-person
avatar, which the flythrough does not have.

**Impact.** Low on the surface as it exists. Flag it so the coverage table is
honest, not because it should be built next.

---

## 4. Spatialisation quality

What the game does, from `Settings/Profiles/skandia/Sound.con` and
`Settings/Default.con`: `Sound.setDopplerFactor 1`, `Sound.setRolloffFactor 1`,
`Sound.setDistanceFactor 1`, `Sound.setPitchChangeRate 15`,
`Sound.setHardwareVoiceLimit 32`, `game.setChannels 64`,
`Sound.reserve2dMonoChans 4/4/4`, `Sound.reserve2dStereoChans 2/2/2`,
`Sound.soundBufferCacheSize 200`. Per-sample: `minDistance` for the DS3D
full-volume radius, but the audible falloff is always the explicit
`Volume <- Distance` ramp.

What the viewer does, and how it lines up:

| aspect | game | viewer | verdict |
|---|---|---|---|
| distance attenuation | explicit `.ssc` ramp, DS3D rolloff on top | ramp only, `panner.rolloffFactor = 0` (`engine-audio.js:203`, `map.html:1356`) | **deliberate and correct** — documented in `map-sounds.md`; avoids double attenuation |
| panning | DS3D | `panningModel 'HRTF'`, one panner per distinct `relativePosition` | at parity or better |
| doppler | global factor 1, per-sample `dopplerOff` | radial-velocity differencing, clamped 0.85–1.2 (`engine-audio.js:117-119`, `331-334`) | at parity; the clamp is an addition |
| pitch slew | `setPitchChangeRate 15` | `PITCH_TAU = 0.1` via `setTargetAtTime` | at parity in spirit |
| 2D (`stereo`) voices | reserved 2D channels | **not implemented** | **G5** |
| voice limit / priority | 32 hardware voices, `priority` −9..11 | none | **G13** |
| listener orientation | player head | `camera.add(audioListener)` (`map.html:1221`) — follows all four vehicle camera modes and free-fly | correct |
| ambience ducking in cockpit | n/a (engine simply dominates) | `AMBIENT_DUCK = 0.12` over `0.4 s` (`map.html:1567`) | a viewer-specific mixing fix, measured 0.42→0.05 on Wake |
| reverb / environment zones | **none in the data** | none | **not a gap.** No `.ssc` directive, no settings command, and no EAX preset exists anywhere in vanilla. `air-raid-siren-pitched-reverb.wav` has reverb *baked into the sample*. Adding a ConvolverNode would be a departure from parity, not an approach to it. |
| occlusion by geometry | **none in the engine** | none | **not a gap** (same reasoning) |
| anti-phasing | `randomStartPitch` (2,714 uses) | implemented — `Voice.jitter` (`engine-audio.js:145-146`) plus a random loop-start offset | at parity |

Two runtime invariants already established and worth not regressing: one decode
per un-busted path (`map.html:1246` `soundBuffer`), and one looping voice per
role created once and muted by gain (the `319a794` hall-echo fix). Measured
looping-voice count on a Corsair is constant at 9 through a throttle sweep, a
dive, a ground impact and a map change.

## 5. Asset pipeline and size budget

Path today: `.rfa` → `resolve_sound` (`extract_map.py:211`, rate preference
`AMBIENT_RATES = 22/44/11` for ambience, `VEHICLE_RATES = 44/22/11` for
vehicles) → `extract_sounds`' inner `write()` (`extract_map.py:468`) →
`transcode_to_mp3` (LAME `-q:a 2`, atomic `os.replace`, `-f mp3` mandatory) →
`<maps-root>/_shared/sounds/<stem>.mp3`, referenced from `scene.json` as
`../_shared/sounds/x.mp3` measured against `--final-out`. Published by
`scripts/upload-mesh-maps-resumable.sh` to `/mnt/assets/mesh/maps` on the
`hetzner` FileBrowser pod.

Measured sizes:

| | files | bytes |
|---|---|---|
| vanilla `_shared/sounds` today | 147 | **3.1 MB** |
| … of which reachable by a user (Corsair/Spitfire/Zero + ambient + areas + flag) | 36 | ~1.1 MB |
| … extracted but unreachable (51 non-flyable vehicles) | 111 | **2.04 MB** |
| EoD `mods/eod/_shared/sounds` | — | 56 MB |
| whole `viewer/maps` tree | — | **14 GB** (13 GB of it EoD) |
| **every wav any vanilla `.ssc` references, as MP3 -V2** | **643** | **7.59 MB** |
| **+ one full voice pack (English), as MP3 -V2** | **105** | **2.00 MB** |
| + all six vanilla music tracks (Bink source) | 6 | 38.5 MB → ~4 MB at 128 kbps MP3 |

**Complete vanilla audio parity is ≈13.6 MB of assets, against a 14 GB tree.**
The per-map page-weight argument does not bite either: samples are shared, and
only the patches the viewer actually instantiates are fetched.

Two pipeline hazards worth recording while here:

- `transcode_to_mp3` must never be followed by a tag rewriter — MP3's
  sample-exact looping is entirely LAME's Xing header. Already documented; still
  true for every new category.
- `upload-mesh-maps-resumable.sh` iterates `find "$LOCAL_DIR" -mindepth 1
  -maxdepth 1 -type d` and treats each as a level. Pointed at `viewer/maps` that
  includes `_shared` (fine, it is self-contained) **and `mods/`** (13 GB in one
  tar stream). **UNVERIFIED** whether it has ever been run that way; worth a
  guard.

## 6. Priority table

Sorted by impact per unit of size. "Blocked-by" is a hard dependency, not a
preference.

| # | gap | size | impact | blocked by |
|---|---|---|---|---|
| 1 | **G5** — honour `stereo`: route 2D layers past the panner | S | High (wrong *today*, on the shipped surface) | — |
| 2 | **G9** — static-object ambience (windmill/factory/guardtower/hangar/radar), 93 placements | S-M | High | — |
| 3 | **G15a** — level/menu music from the 6 `.bik` files | S | Medium-high (the in-repo wrapped pipeline already does this) | — |
| 4 | **G3** — idle engines for parked vehicles; unlocks 111 already-extracted samples | M | High | G13 (voice cap) |
| 5 | **G6** — any audio at all in `viewer/index.html`; infantry weapon fire | M | High | G16 (block comments), G12 (`randomPlay`) |
| 6 | **G12** — `randomPlay` end to end | S | Medium now, blocking later | — |
| 7 | **G13** — priority + 32-voice cap | S | Low now, prerequisite | — |
| 8 | **G16** — `/* */` in `parse_ssc` | S | Latent correctness | — |
| 9 | **G11b** — flag flap on neutral control points (midway/truk/kasserine) | S | Low-medium | decide the rule (UNVERIFIED) |
| 10 | **G4** — landing gear, airframe creak, turret traverse, tracks, horn, sonar | M | Medium | — |
| 11 | **G8** — bullet whizz-by (7 samples) and distant MG (20 samples) | M | Medium-high on the flown surface | G12 |
| 12 | **G7** — all weapon patches, not just the firing one (60 patches, 84 samples) | S extract / M runtime | Medium | reload/bolt events |
| 13 | **G1** — per-material impacts and ricochets (3,047 table rows, 52 effects) | L | High | projectile collision in `gunfire.js`; G12; G13 |
| 14 | **G2** — explosions with near/far layering, debris, wreck fire | L | High | a destruction event; G1's collision work; G12 |
| 15 | **G14** — `stop FinishSample` | S | Low | — |
| 16 | **G10 / G11a** — `@Language` + control-point capture voice | S extract / L trigger | Low now | capture simulation |
| 17 | **G17** — multi-layer / tier-filtered area sounds | S | Low (vanilla), mod-facing | verify against EoD first |
| 18 | **G15b** — menu/UI SFX | S-M | Low (no menu to attach to) | — |
| 19 | **G18** — the whole soldier sound subsystem | L | Low (no avatar exists) | a walking first-person mode |

## 7. Already covered — do not re-report these

- **Map ambience.** `Environment.con` → `Environment.ssc`, all 23 maps
  (`truk` genuinely silent in the data). `Sound/` singular fallback for
  Kasserine's custom `ambfx.wav`.
- **Area / shoreline / emitter sounds.** AreaObject + SimpleObject polylines,
  closest-point-across-the-group tracking, `.ssc` near/far ramp owning distance
  volume, one voice per unique wave file (the `319a794` dedupe).
- **Flag flap loop** as a point-emitter group with `randomStartPitch`, on 20 of
  23 maps.
- **Aircraft engine**, data-driven from the real `.ssc`: three-band RPM
  crossfade, `Time` attack, `TimeRelease` fade, start/stop one-shots, dive
  scream, cockpit whines on their own panners, doppler, bus headroom 0.28,
  measured to within 0.02 of the script at every sampled RPM.
- **Aircraft gun patch**, four layers with distance handover (cockpit pair to
  4 m, distant pair 4→250 m), `WEAPON_HEADROOM = 0.75`, voice count constant
  through a held burst.
- **Ambience ducking** while piloting.
- **The `.ssc` parser itself** — `#include` expansion, `#templateLevel`,
  `#beginMap`, `beginSkip`, every sample directive, the shipped typos. All 981
  vanilla scripts parse.
- **Codec and dedup work.** MP3 -V2, shared `_shared/sounds`, sample-exact
  looping verified in the real Chromium. No reason to revisit for new
  categories.
- **Reverb and occlusion.** Not missing — the engine has neither.

## 8. Unverified claims

1. Whether Refractor plays `flag.ssc` on a control point whose team resolves to
   no cloth geometry (the midway/truk/kasserine case, G11b).
2. Whether `upload-mesh-maps-resumable.sh` has ever been pointed at a directory
   containing `mods/`, and what it does when it is.
3. The exact semantics of the 6-parameter `Ramp` surplus pair (573 uses) —
   inherited as unresolved from `engine-sound.md` §1.4 and untouched here;
   treating them as 4-param reproduces the audible design.
4. `Bf1942/Game/Heartbeats.ssc`'s `HeartBeat::Pitch` / `HeartBeat::Volume`
   channels — read out of the data, but what feeds them (low health? sprint?) is
   inferred, not confirmed.
5. That the 69 unreferenced non-voice wavs are genuinely dead rather than
   referenced by a mechanism not scanned here (they were checked against `.ssc`
   `load` lines only).

## 9. Reproducing commands

All run from `/home/dylan/projects/skandia/bfstats/tools/bf1942-models`.

```bash
# Catalogue: entries, rates, language packs, bytes
python3 -c "
from bf42.rfa import RfaArchive; from pathlib import Path; import collections
b=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives'
for n in ('sound.rfa','sound_001.rfa'):
    a=RfaArchive(b/n); print(n, len(a.entries))"

# Every wav any .ssc loads, split @Language vs plain  -> 105 / 647
# (full script: see the 'refs2.json' step in the audit transcript)

# loadSoundScript census by class -> 428 bindings
# Material impact table -> 3,047 setEffectTemplate lines / 52 templates
python3 -c "
from bf42.rfa import RfaArchive; from pathlib import Path; import collections
g=RfaArchive(Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/bf1942/Game.rfa')
n=collections.Counter()
for e in g.entries:
    if 'damage_system' in e.lower():
        for l in g.read(e).decode('latin-1').splitlines():
            if l.strip().lower().startswith('materialmanager.seteffecttemplate'): n[l.split()[-1].lower()]+=1
print(sum(n.values()), len(n))"

# Full-corpus MP3 -V2 size: 643 non-voice -> 7.59 MB, 105 voice -> 2.00 MB
#   (transcode each 44 kHz wav with the pipeline's own args:
#    ffmpeg -hide_banner -loglevel error -y -i x.wav -codec:a libmp3lame -q:a 2 -f mp3 x.mp3)

# Unreachable extracted vehicle audio -> 111 files / 2.04 MB
python3 -c "
import json,glob
from pathlib import Path
FLY={'corsair','spitfire','zero'}; all_=set(); fly=set()
for p in glob.glob('viewer/maps/*/scene.json'):
    for v in (json.load(open(p)).get('sounds') or {}).get('vehicles') or []:
        ls=list(v.get('layers') or [])
        for w in v.get('weapons') or []: ls+=w.get('layers') or []
        for l in ls:
            f=l['file'].split('/')[-1]; all_.add(f)
            if v['template'].lower() in FLY: fly.add(f)
sz={q.name:q.stat().st_size for q in Path('viewer/maps/_shared/sounds').glob('*.mp3')}
d=all_-fly; print(len(d), round(sum(sz.get(f,0) for f in d)/1048576,2),'MB')"

# Sounding static buildings placed in vanilla levels -> 93
# Weapon patches dropped by _firing_patch -> 60 patches / 84 samples
# /* */ blocks containing a live `load` -> 6 files
```
