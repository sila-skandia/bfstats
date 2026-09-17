# R2 — What a bolt-action rifle does when it fires

You are a research agent on the map-viewer fidelity round. Read
`features/mesh-viewer-fidelity-defects/BRIEFING.md` first if you have not.
You read the engine and the shipped data; you do not change the viewer.

## The defect

Firing the scout's rifle in the viewer looks nothing like retail. Three things
are visibly wrong at once, and they may have three different causes:

1. **The round is visible and slow.** A dark speck leaves the muzzle and drifts
   across the frame. Retail shows nothing.
2. **The muzzle flash is enormous and lingers.** Measured off the 15 fps sheets:
   retail's flash occupies ~2–3% of frame width, sits at the muzzle, and is gone
   within one 15 fps frame; the viewer's covers ~40% of frame width, sits to the
   *left* of the muzzle, and survives two.
3. **The weapon dips.** Instead of a recoil and a bolt cycle, the rifle drops
   away and eases back. The user's own reading: *"the animation when you reload
   is perfect, and by the looks it is the same thing the game plays each time
   you take a shot."*

The weapon is `No4Sniper` (US, US Marines, British scouts) and `K98Sniper`
(Japanese, German). Both are bolt-action.

## Evidence

- `/home/dylan/bf1942-sniper-reload.mp4` — retail. The shot is at **t ≈ 4.33 s**;
  `game-sniper-shot-15fps.png` is a 15 fps sheet of `t = 4.0…5.8`.
- `/home/dylan/mesh-sniper-reload.mp4` — the viewer, same sequence. The shot is
  at **t ≈ 2.0 s**; `mesh-sniper-shot-15fps.png` is the matching sheet.
- `game-sniper-hip.png` versus `mesh-sniper-hip.png` — the same doorway, the
  same stance. **The rig sits differently**: retail's rifle crosses the lower
  centre of the frame with forearm and both hands visible; the viewer's sits in
  the bottom-right corner, smaller, partly out of frame. Treat this as a
  candidate cause of "the gun dips", not a separate cosmetic issue.

## What is already settled — do not re-derive it

- `extract_viewmodel.py` bakes one glTF clip per family the state machine
  declares: `idle` (`Ub_StandAim<W>`), `walk`, `run`, `fire` (`Ub_Fire<W>`,
  **looping while the trigger is held**), `reload` (`Ub_StandReload<W>` plus the
  state's declared `c_AsmWeaponState` weapon-channel clip), `deploy`.
- A clip's duration is the engine's, not the authoring rate: one full pass lasts
  `1/|speed|` seconds however many frames it holds (`clip_span`, read out of
  `AnimationStateMachineInstance::updateState` and
  `BoneAnimation::applyOnSkeleton`). `1pAnimationsTweaking.con` /
  `3pAnimationsTweaking.con` override declared rates and the parser applies them.
- A `BFSoldier` holds **four** animation machines, not three (a corpus
  correction from the 2026-09-16 round).
- **CS-6:** the walking view bob is multiplied by a shipped zero
  (`cameraShakeFactor` = 0.0f, zero-filled `.data`) — retail has no first-person
  walking bob at all. **Weapon-fire and explosion shakes are unaffected**: they
  are passed a hardcoded 1.0.
- **VIEW-1…10** and `subsystems/handweapon-view-and-deviation.md` cover the
  hip↔zoom ease, deviation decay and fire bloom, all per-1/30 s quantities;
  `handleVisualUpdate` (the ease) runs once per rendered frame.
- The two-state first-person FOV question is **live and unresolved**: retail has
  been captured drawing the 1P rig at two sizes — matching the world FOV 57.3°,
  and matching `set1pFov` 0.47 rad, which is ~2.28x larger. `map.html`'s near
  pass currently defaults to the large state; `?fov1p=world` renders the small
  one. See `features/bf1942-3d-models/first-person-soldier.md` (2026-09-16 note)
  and ledger VIEW-9. **Do not re-litigate which is default.** Do establish
  whether the rig's *placement* in the captures above is consistent with either
  state, since that is what makes the viewer's rifle sit in the corner.
- `EMT-2`, `EMT-3`, `EMT-5`, `SPR-2…SPR-6` settle emitter spawn timing,
  `startRotation`'s degrees, particle drag as an acceleration, and the client's
  sprite particles including 791 flipbook sprites.

## Questions, in priority order

1. **What plays per shot on a bolt action?** Enumerate, from
   `animations.rfa` and the state machine (`bf42/animstates.py` parses it),
   every 1P state for `No4Sniper` and `K98Sniper`: names, clips, `speed`,
   `morphFactor`, `returnTo`, and any weapon-channel `c_AsmWeaponState` clip.
   Then read the engine's state selection to establish **which state a single
   shot actually enters**, whether it plays once or loops, and what returns it
   to the aim state. If the per-shot motion really is the reload clip (or the
   same weapon-channel clip the reload uses), prove it from the data, because
   that is the single most useful sentence you can write for the implementer.
2. **Timing.** The delay between shots (`setDelayBetweenShots` or equivalent),
   the fire clip's span, the reload's span against `reloadTime`, and what the
   engine does when a clip is longer than the interval between shots. Give the
   numbers for both rifles. Check them against the retail recording (the shot is
   at t ≈ 4.33 s; the next action is visible in the sheet).
3. **Is the weapon drawn at all while zoomed?** The retail scoped capture
   (`game-sniper-zoom.png`) shows no weapon — only the scope overlay. Establish
   what the engine hides while a scope is active, and what happens to the firing
   animation in that state (does firing unzoom? does the clip still run
   unseen?). R5 is researching the overlay itself; coordinate by staying on the
   *weapon and animation* side of the line.
4. **The muzzle flash.** Which effect template the rifle's fire spawns, its
   emitter parameters (size, lifetime, count, drag, `startRotation`), whether
   the first-person flash is a different template from the third-person one, and
   what the engine attaches it to. `e_MuzzGun` is the barrel-tip emitter in the
   fp rigs; `<Weapon>_muzzle_1` is a stub at the grip, which is a known trap for
   anyone positioning a flash. Name the values, so the implementer can compare
   against `viewer/effects.js`.
5. **The round.** Is a rifle round ever a visible object in retail? Read the
   projectile template for both rifles: geometry, any tracer or trail effect,
   `velocity`, lifetime, and whether the client draws anything for it at all.
   If retail draws nothing for a rifle round, say so plainly with the evidence —
   that alone fixes defect (1).
6. **Recoil, and what actually moves.** Separate three things and give the
   quantity for each: the *view* kick (the fire shake, per CS-6 passed 1.0 —
   what does it do and for how long), the *weapon's* own animated movement (the
   clip), and the *deviation* change (the fire bloom, per-shot, per VIEW rows).
   The viewer's "dip" is probably one of these three applied wrongly; the
   implementer needs to know which one owns the motion.
7. **The rig's resting placement.** From the weapon's own fields
   (`soldierCameraPosition`, `soldierZoomPosition`, `center1pHands`,
   `set1pFov`, and whatever else `extract_viewmodel.py` already rides out in
   the extras), work out where retail puts a `No4Sniper` in the frame, and
   whether the capture's centred rifle is consistent with those numbers under
   either FOV state. This is a measurement question, not an opinion: give the
   predicted screen position and compare it with `game-sniper-hip.png`.

## Deliverable

The report shape in the briefing, plus:

- A table of every 1P animation state for the two rifles, with clip, speed,
  span in seconds, morphFactor and returnTo.
- The muzzle-flash and projectile numbers as a table the implementer can diff
  against `viewer/effects.js` and `viewer/gunfire.js`.
- An explicit answer to "what does a single shot look like, frame by frame, for
  the first 0.5 s" — the sequence of states, what each one moves, and when.

## What would make this report wrong

- Concluding from the video alone. The video says what happens; the data says
  why, and only the data generalises to the other rifles and the mods.
- Treating the fire clip as looping for a bolt action because that is what
  `extract_viewmodel.py`'s comment says about the Thompson.
- Ignoring the weapon channel: the reload's `c_AsmWeaponState` clip moves the
  gun's own parts, and the bolt is exactly such a part.
- Quoting a flash size in "looks big". Give emitter numbers.
