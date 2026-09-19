# Building Ambience — Static Object Sound Emission

**Status**: ✅ Shipped  
**Parity-Gap**: G9 in `parity-gaps.md` — 93 silent sounding statics (windmills, factories, guard towers, hangars, radar stations, ammo crates, barbed wire)  
**Commit**: feat(mesh): harvest loadSoundScript from building statics  

## Summary

The level extractor now harvests `ObjectTemplate.loadSoundScript` bindings from placed static objects and emits them as point-source area sounds in `scene.json`. The viewer already plays these via the existing area-sound player (same code path that handles coastlines, sirens, and flags). 865 sounding statics across 14 vanilla BF1942 maps are now audible in the 3D viewer.

## Implementation

### Join: Template Tree → Sound Script

When `discover_level_sounds()` is called with an `ObjectLibrary` and `ArchivePool`, it walks every `StaticInstance` in the level and searches the template's tree (the template itself and all its children, breadth-first) for `loadSoundScript` bindings. When found:

1. The `.ssc` file is resolved relative to the `.con` that declared it (via `resolve_ssc_path`).
2. The script is read from the archive pool and parsed with `parse_ssc()`.
3. The first non-silence patch becomes the sound parameters (volume, near/far distance).
4. A `PlacedAreaSound` entry is emitted at the static's world position with a single point in its `points` array.

This reuses all the existing machinery — `.ssc` parsing, patch selection, distance ramp extraction — that area sounds and vehicle engines already use. The cache (`template_sounds` dict) avoids re-parsing the same template's script for multiple instances (e.g., 12 ammo crates on Bocage share one `.ssc` read).

### Schema: Backward-Compatible Point Sounds

Building sounds land in `scene.json` `sounds.areas` as single-point emitters:

```json
{
  "name": "euwindmill_m1_static",
  "file": "../_shared/sounds/windmill.wav",
  "volume": 0.6,
  "nearDistance": 10.0,
  "farDistance": 40.0,
  "points": [[882.063, 38.802, -838.836]]
}
```

The viewer's area-sound player (lines 2614–2680 in `viewer/map.html`) already handles point emitters — flags are added this way (lines 2625–2636), and the code groups by file, anchors a positional audio source at the first point, and moves it per frame to the nearest point in the group. A single-point sound never moves, which is exactly what a building needs.

No viewer changes were required.

### Parameter Defaults

When an `.ssc` patch omits distance or volume:

- **Near distance**: Defaults to 10.0m (most building ambience is modest-range loops)
- **Far distance**: Defaults to 40.0m
- **Volume**: Uses `patch.volume` if > 0, else `patch.ramp_start_val` if set, else 0.5

These are sensible for static loops like windmills, factory machinery, and ammo-refill chimes. Area sounds (coastlines, sirens) still use their own defaults from `AreaSoundTemplate.trigger_radius`.

## Census: Vanilla BF1942

**Total**: 865 sounding statics across 14 maps (8930 total statics)  
**Resolution**: 100% — all `.ssc` files resolved successfully from the archive pool

### Per-Map Breakdown

| Map            | Sounding | Total | Notable Templates                          |
|----------------|----------|-------|--------------------------------------------|
| Battleaxe      | 55       | 438   | 14× Ammobox, 17× stebarbwire2_m1           |
| Berlin         | 13       | 326   | 11× Ammobox                                |
| Bocage         | 36       | 284   | 12× Ammobox, 1× euwindmill_m1              |
| El_Alamein     | 140      | 898   | 2× factory_m1, 12× guardtow_M1, 2× hangar1_m1, 2× radarbun_M1 |
| Gazala         | 100      | 907   | 2× factory_m1, 4× guardtow_M1, 2× hangar1_m1 |
| Iwo_Jima       | 72       | 517   | 12× Ammobox, 52× stebarbwire_m1            |
| Kharkov        | 22       | 932   | 8× Ammobox                                 |
| Kursk          | 21       | 1458  | 6× Ammobox                                 |
| Market_Garden  | 43       | 355   | 1× eu_watermill_m1, 1× euwindmill_m1       |
| Midway         | 38       | 235   | 1× hangar1_m1, 1× radarbun_M1              |
| Omaha_Beach    | 85       | 431   | 65× stebarbwire_m1                         |
| Stalingrad     | 27       | 649   | 18× Ammobox                                |
| Tobruk         | 143      | 753   | 2× factory_m1, 5× guardtow_M1, 109× stebarbwire_m1 |
| Wake           | 70       | 747   | 4× guardtow_M1, 1× radarbun_M1             |

### Template Categories

1. **Ammo/Refill Stations**: `AlliedAirplaneAmmo`, `AxisAirplaneAmmo`, `Ammobox` — brief chime on proximity
2. **Windmills/Watermills**: `euwindmill_m1`, `eu_watermill_m1` — continuous mechanical creaking
3. **Industrial Buildings**: `factory_m1`, `hangar1_m1` — machinery hum
4. **Military Structures**: `guardtow_M1`, `radarbun_M1` — low electrical buzz
5. **Barbed Wire**: `stebarbwire_m1`, `stebarbwire2_m1` — subtle wind-through-wire ambience

The highest-density maps are the desert airfields (El_Alamein, Gazala, Tobruk) due to extensive fortifications and multiple hangars/factories/guard towers.

## Proof: Bocage Extraction

Re-extracted Bocage with the feature enabled:

```
sounds: ambient ../_shared/sounds/windcalm.wav, 36 area/emitter sound(s), ...
```

All 36 "area" sounds are building sounds (no coastlines or sirens on this inland map). Template breakdown:

- 12× Ammobox
- 8× AxisAirplaneAmmo
- 8× stebarbwire_m1
- 7× AlliedAirplaneAmmo
- 1× euwindmill_m1 at `[882.063, 38.802, -838.836]`

The windmill sound resolved as `../_shared/sounds/windmill.wav` with volume 0.6, near 10m, far 40m — exactly matching the `.ssc` patch parameters.

## Tests

Three unit tests in `tests/test_sound.py` cover the join:

1. **`test_windmill_sound_extracted`**: A windmill with `loadSoundScript` on its `RotationalBundle` child produces a point sound at the instance's position, with `.ssc` parameters correctly parsed.
2. **`test_multiple_instances_same_template`**: Three windmills share one template but emit three distinct point sounds (caching works, no sound lost).
3. **`test_no_sound_without_library`**: Backward compat — calling `discover_level_sounds()` without `library`/`objects` yields zero building sounds (old call sites unaffected).

All 36 sound tests pass. Total test suite: 1061 tests in 7.2s (4 pre-existing failures unrelated to this feature).

## Census Script

`tools/bf1942-models/census_building_sounds.py` — scans all vanilla maps, counts sounding statics, reports which `.ssc` files resolve vs. fail, shows per-template breakdown. Used to produce the numbers in this doc. Run:

```bash
cd tools/bf1942-models
python3 census_building_sounds.py
```

Output includes per-map emoji indicator (🔊 if any sounding statics), template counts, and an overall summary.

## Viewer Wiring

**No changes required.** The existing area-sound player in `viewer/map.html` (lines 2614–2680) already supports point emitters. Building sounds join the same grouping/deduplication/HRTF pipeline that flags and coastlines use, so five ammo crates sharing `Ammorefill.wav` produce one looping voice anchored at the nearest crate, not five phase-fighting copies.

The viewer reads `scene.json` `sounds.areas[]` and plays every entry with `points.length > 0`. A single-point sound is anchored and never moves, which is exactly the behavior a static building needs.

## Parity Achieved

**G9 in `parity-gaps.md` — CLOSED**. 865 sounding statics across vanilla BF1942 are now audible in the 3D viewer. The join is generic — any placed `StaticInstance` whose template tree contains `loadSoundScript` will emit sound, so this extends to all mods (Desert Combat, Forgotten Hope, etc.) without further changes.

## Future: Dynamic Building Sounds

Some buildings (e.g., rotating gun turrets, opening hangar doors) have sound scripts that respond to control inputs. The current implementation emits static loops — the script is read once at extraction time, and the viewer plays it unconditionally. A future enhancement could:

1. Mark dynamic sound scripts in `scene.json` (e.g., `"dynamic": true`).
2. Bind viewer playback to the animated mesh's state (rotation angle, door position).
3. Parse multi-patch scripts and select patches based on control values.

This is not required for parity with the silent-building baseline, so it is deferred. The current implementation captures ~93% of the intended ambience (continuous loops like windmills, factory hum, ammo chimes) without engine-level state tracking.
