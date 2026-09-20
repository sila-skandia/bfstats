# Two defects in the play maps: the bf109's cockpit, and every gun past the first

Reported 2026-09-20: *"the BF109 and Stuka have this super low fidelity blurred
HUD. They also have no sounds when you fire the guns. I've checked the spitfire
and corsair and they're OK — so it might affect all axis planes."*

Two unrelated bugs, neither of which is about the Axis. One is the bf109 alone;
the other is every vehicle in the game, on its second and later copy in a
level. The Spitfire and Corsair looked fine because they are not the bf109 and
because the ones that get flown first are instance zero.

---

## D1 — the bf109 flies inside its own fuselage below half throttle

**What it looked like.** A dark brown smear where the instrument panel should
be, resolving into the real cockpit the moment the throttle passed halfway.
Not a HUD at all: the *outside* of the aeroplane's fuselage, drawn from the
pilot's eye point 0.7 m away, which is what a 512-px skin looks like at that
range.

**Why.** Refractor picks between a vehicle's exterior and its 1P interior with
a `LodSelectorTemplate`, and `flight.js`'s `CockpitSwap` reproduces that. It
also reproduces the propeller's blade/blur swap, which is a different
`LodSelectorTemplate` on a different node. `assemble.py` tells the two apart by
name — a LodObject whose two alternatives end `Static` and `Blurred` is a
propeller — and vanilla breaks that convention exactly once:

| | exterior | interior | selector |
|---|---|---|---|
| Spitfire, Corsair, Stuka, +9 | `...CockpitExternal` | `...CockpitInternal` | `DistCompareSelector`, comparison 0.5 |
| **bf109** | **`bf109CockpitStatic`** | **`bf109CockpitBlurred`** | `DistCompareSelector`, comparison 0.5 |
| every real propeller (59 of them) | `...PropellerStatic` | `...PropellerBlurred` | `CompareSelector`, comparison 0.07–0.08 |

`geometry_is_first_person` already had this oddity written down
(`assemble.py`'s docstring names `bf109CockpitBlurred` as one of three
template-name exceptions); `is_propeller_blur_pair` did not.

So `BF109.glb` carries a `propellerBlur` stamp on `lodbf109Cockpit`. Nothing
happened at load, because the blurred half does not exist in a third-person
export — **the cockpit graft is what completes the pair.** `adoptCockpit` moves
`bf109CockpitBlurred` in, re-runs `collect()`, and the viewer now has a
"propeller" whose blurred disc is the pilot's cockpit. `applyRig` then rewrote
both nodes' visibility from `state.throttle` every frame, and won against
`CockpitSwap` every frame.

**Fixed in two places.**

* `bf42/con.py` — `is_propeller_blur_pair` takes the `LodSelector` and rejects
  anything that is not a `CompareSelector`. The engine never confused the two;
  the kind is how it told them apart. A selector that did not resolve says
  nothing either way and still falls back to the names, so an unreadable
  `LodSelectorTemplate` cannot cost a blurred disc.
* `viewer/flight.js` — `isPropellerBlurPair` applies the same rule to the
  stamp at runtime, so every **already-published** asset tree is right without
  a re-extraction. A stamp with no `selectorKind` at all (an older tree) is
  still taken at its word.

Blast radius of the bad stamp, measured across every `*.glb` under
`viewer/models/` and `viewer/models/mods/*`: 89 `propellerBlur` stamps, 87
`CompareSelector` and 2 `DistCompareSelector` — vanilla's bf109 and EoD's.

Re-extracting the two bf109s would drop the stamp from the data as well. It is
not required: the runtime guard is written to tolerate it deliberately, since
scenes older than this fix will exist for as long as the volume does.

## D2 — a vehicle's guns are silent on every instance but the first

**What it looked like.** Tracers, muzzle flash, ammo counting down, no report.

**Why.** The exporter numbers the second and later copy of a vehicle across the
whole level, and the numbering reaches every node inside it: the first bf109 on
Kasserine fires `BF109Guns`, the second fires `BF109Guns_1`. Sound specs are
per *template* (`findWeaponSpecs` keys on the vehicle's `control`), so they
only ever carry the bare name.

An aircraft's gun `.ssc` is a Fire Loop — layers that run from the moment the
patch is built and are muted by gain alone, which is the one-voice-per-role
rule `map-sounds.md` left behind. The only thing that un-mutes them is the gain
gate in `updateAudio`, and that gate matched the node name exactly:

```js
vehicleGuns.find(g => g.node.name === weapon.spec.fireArms)   // 'BF109Guns_1' !== 'BF109Guns'
```

No match, no `firing`, master pinned at 0 for the life of the seat.
`weaponAudioFor` — the one-shot trigger path — already stripped the suffix, so
the two halves of the same lookup disagreed. `setupWeaponAudio`'s
`getObjectByName` missed for the same reason and hung the panner on the
fuselage origin instead of the guns.

**Fixed in `viewer/map.html`**: one `bareFireArmsName`, used by the gain gate
(`firingGroupFor`), the panner lookup (`fireArmsNode`) and `weaponAudioFor`.
Checked against every published scene: of 251 distinct `fireArms` names, none
ends in `_<digits>`, so stripping the suffix is unambiguous.

---

## Verified

Headless on `map.html?map=kasserine_pass&shots`, driving the real input path
(`__enterOwner`, `__setSeatFire`) and reading `__getAudioState()`:

| | cockpit interior drawn | gun master / bus |
|---|---|---|
| bf109 (1st) at throttle 0 | yes (was: no) | 0.7 / 0.34 |
| bf109 (1st) at throttle 1 | yes | — |
| **bf109_1 (2nd)** | yes (was: no) | **0.7 / 0.34** (was: 0 / 0) |
| Spitfire (1st) | yes | 0.7 / 0.38 |
| **Spitfire_1 (2nd)** | yes | **0.7 / 0.41** (was: 0 / 0) |
| Stuka, pilot seat | yes | 0.7 / 0.31, rear `MG42_Air` muted |
| Stuka, rear gunner | yes | `MG42_Air` 0.7 / 0.34, `StukaGuns` muted |

The genuine propeller pair still swaps: `BF109PropellerStatic` visible at
throttle 0, `BF109PropellerBlurred` at throttle 1.

Tests: `tests/test_con.py`, `tests/test_assemble.py` (a bf109-shaped cockpit
`.con` that must not export a `propellerBlur`), `tests/flight_harness.mjs` +
`tests/test_flight.py` (the stamp collects no pair, and a `CompareSelector` one
still does).

**The Stuka was never broken.** Its cockpit is named `StukaCockpitInternal` /
`StukaCockpitExternal` and swaps correctly, and its guns sound on instance
zero. What the report saw on it was D2, from whichever copy was flown.
