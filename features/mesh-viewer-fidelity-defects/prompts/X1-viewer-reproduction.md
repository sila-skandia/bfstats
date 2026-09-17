# X1 — Reproduce all four defects in the viewer and name the code path

You are the diagnosis agent on the map-viewer fidelity round. Read
`features/mesh-viewer-fidelity-defects/BRIEFING.md` first if you have not.

R1–R5 are reading the engine to establish what retail does. **You establish
what the viewer currently does, and why** — measured, headlessly, with numbers.
You change nothing: no fixes, no "while I was there". A diagnosis that turns
out to be wrong costs an hour; a silent fix in a shared checkout costs more.

Two of the six implementers in an earlier round reported that the bug they were
sent to fix did not reproduce. That report was worth more than a plausible fix.
Treat "it does not reproduce" as a first-class outcome here too.

## Setup

`viewer/map.html` under `?shots` exposes a large headless surface. The ones
that matter here:

```
__renderOnce(w, h)      one deterministic frame; also runs frame(1/60)
__setOnFoot(true)       put a soldier on foot
__deploy                .select('The_Airfield'); .spawn()
__teleport(x,y,z,yaw)   yaw π/2 faces +x
__setTrigger(bool)      fire
__setAim, __setView, __look, __lookDelta, __keys, __stick
__nearEntry()           { control, seatId } for the entry you are standing at
__switchSeat(...)       seat changes
__getFire()             .hits and the rest of the fire state
__handWeapon()          the held weapon's live state, including .shots
__effects()             live effect instances; __effectNames, __playEffect
__collision()           heightfield dim/spacing, waterLevel, statics { triangles, cells, cellSize }
__castRay([x,y,z],[dx,dy,dz],dist) -> { t, point, kind, material, owner }
__colliderRef()         the collider itself
__hud, __hudVars()      the HUD painter and its live `vars` table
__gunGroups()           seat/gun bookkeeping counts
__scene, __camera, __renderer, __rig, __soldier
```

The briefing's section 5 has the rules that bite: the rAF loop does not tick
while the pane is hidden so you must step frames rather than wait; SwiftShader
crashes after 30–45 near-pass `__renderOnce` calls so batch in 20s; measure
`canvas.toDataURL` output, never a page screenshot. A dev server is usually
already on `:5273`.

## The four reproductions

### X1.a — Trees

Wake is full of palms. Pick one whose world position you can read out of the
extracted scene (`viewer/maps/wake/scene.json`, and the glb's node transforms
through `__scene`), then:

- `__castRay` a horizontal ray through the trunk at chest height from 5 m away.
  Report the hit (or the miss), its `kind`, `material` and `owner`.
- Report `__collision().statics.triangles` for Wake, and how many of those
  triangles belong to tree geometry (expected: none — prove it).
- Walk a soldier into the trunk with the real movement path and report whether
  `sweepSphere` stops them.
- Grep the level's `scene.json` collision report for what the exporter did
  emit, and confirm from `bf42/assemble.py` that the `treemesh` branch is the
  reason. Name file and line.
- Fire a round into the trunk and report what `__getFire().hits` and
  `__effects()` show.

### X1.b — The sniper's shot

Spawn a scout (`No4Sniper`), settle the deploy clip, teleport to a clear line
of fire, then fire one round and step frames one at a time.

- Capture the canvas each frame for ~0.5 s after the shot and report, per
  frame: what the weapon's transform is doing, what effect instances exist
  (`__effects()`), and the on-screen size of the muzzle flash as a fraction of
  frame width.
- **Identify the "floating bullet"**: what object is it, which module creates
  it, what velocity it is given, and why it is visible. `viewer/gunfire.js` is
  the obvious suspect; prove it rather than assuming.
- Report which animation clip the rig is playing per frame after the shot and
  where the clip selection happens.
- Report the rig's resting screen position and compare it with
  `game-sniper-hip.png` (the retail capture, same doorway). Give pixel numbers
  against a common frame size, not impressions.
- Do the same with `?fov1p=world` and report both. The two-state FOV question
  is open; you are gathering evidence for it, not settling it.

### X1.c — The tank

Find a drivable tracked vehicle in Wake's scene (name it; if Wake has none in
the extracted level, say so and use the level the retail capture was taken on).
Enter it, hold the throttle for 3 s of simulated time and log, per 0.1 s:
world position, speed, the drivetrain's own state (throttle, gear ratio,
per-side differential RPM, the force or acceleration it applies), and what
`collision.js` is doing underneath (ground contacts, any sweep that resolves).

- Report the speed curve. If it plateaus, say what term is limiting it and at
  what value; if it never starts, say which term is zero and why.
- Report which class `ensureDrive` picked (`TrackedVehicle` or the
  `GroundVehicle` fallback) — the fallback would be a finding all on its own.
- Capture the HUD canvas in the same seat and report, for every drawn element:
  the layout rect from `hud-layout.json`, the device rect it actually painted,
  and the ratio between them. Then report the full `__hudVars()` table and
  which leaves `hud.js` culled for missing variables.
- Report what is drawn in the near pass — the black wedge in
  `mesh-tank-1p.png` is geometry; name the node.

### X1.d — The scope

Zoom the scout's rifle and report:

- The camera FOV before and during zoom, and the ease between them.
- The complete `__hudVars()` table while zoomed, and specifically whether any
  `CrossHair/*` key exists at all.
- Which `crosshair`-group leaves `hud.js` evaluated and why each was culled.
- Whether `maps/_shared/hud/sniper.png` is present in the atlas
  (`hud.json`) and reachable by the painter's sprite-key rule.

## Deliverable

The report shape in the briefing, with these additions:

- Every claim gets the measurement that produced it. "The tank accelerates at
  0.4 m/s²" with the log beside it, not "the tank feels slow".
- One section per defect: **what the viewer does**, **the code path**, with
  `file:line`, and **the smallest change that would alter the behaviour** —
  described, not applied.
- A list of anything that did **not** reproduce, or reproduced differently from
  the user's description.
- Your harness scripts in full, written under the scratchpad with an `x1_`
  prefix so a sibling agent does not overwrite them.

## What would make this report wrong

- Fixing something. You are the control measurement for the whole round; if
  you change the tree, nobody can trust the before-and-after.
- Reporting from the live browser's appearance instead of from the canvas and
  the numbers.
- Ending your turn waiting for a background job. Notifications never wake a
  subagent — run long jobs in the foreground (up to 600000 ms) or poll them.
