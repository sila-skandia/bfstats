# Delivering `fireingForce` to the baked trees — 2026-10-18

What `patch_fireing_force.py` changed, and what went to the volume.

## The patch

`python3 tools/bf1942-models/patch_fireing_force.py --mod <each tree>`, over
every tree that has one. 29 minutes for the lot, almost all of it reading the
53,263 glbs that turned out to have nothing to do (a glb with no `"fireArms"`
in its bytes is skipped before it is parsed).

Counted afterwards by parsing every glb in the trees back out, not by trusting
the script's own tally:

| Tree | glbs carrying the word | gun nodes |
|---|---:|---:|
| fhsw | 814 | 4,412 |
| fhsweurope | 952 | 3,764 |
| eod | 270 | 3,256 |
| dc_final | 125 | 976 |
| fh | 426 | 961 |
| desertcombat | 104 | 742 |
| xpack2 | 181 | 603 |
| xpack1 | 135 | 510 |
| bf1942 | 50 | 351 |
| bf1918, bg42, finnwars, gcmod, interstate, pirates | 0 | 0 |
| **total** | **3,057** | **15,575** |

The six that changed nothing declare the word on no template — not a failure,
an answer: those mods' guns give their hulls no shove, and a re-run says so
again in seconds.

A second pass over every tree reported `0 glb(s), 0 gun node(s) changed`
throughout, which is the idempotence the script promises and the check that the
first pass finished what it started.

## What landed in a file

Spot-checked by parsing the JSON chunk back out, rather than trusting the
script's own count:

```
viewer/models/Sherman.Kasserine_Pass.glb: 3 gun node(s), 1 with fireingForce
     110.0  ShermanGunBarrel
    (no force: Coaxial_browning, Browning)

viewer/maps/bocage/scene.glb: 56 gun node(s), 12 with fireingForce
     110.0  ShermanGunBarrel   x3        (the three Shermans the level places)
      90.0  TigerGunBarrel     x2
      90.0  M10Cannon
    (no force: Coaxial_MG42, MG42, flak38_gun_fire, BF109Guns, ...)
```

The MGs, the flak and the aircraft guns carry no key, which is what the data
says: in vanilla only the eleven tanks and guns and the Yamato's two turrets
declare the word.

## The gzip sidecars

`rewrite_in_place` calls `glbgz.ensure`, and a sweep of all 53,263 glbs
afterwards found **0** whose `.gz` is missing or whose gzip trailer disagrees
with the glb — which is the test `publish-mesh-delta.py` applies before it
sends either file.

24 `.gz` files are a fraction of a second OLDER than their glb. They are not
this change: all 24 are `dc_final` ships from a bake on 2026-10-11, their
content is correct, and the publisher goes by the trailer rather than the
mtime. It is worth knowing because the API's own route prefers a `.gz` at least
as new as the file beside it, so those ships are served uncompressed by that
path; too small and too far outside this work to chase here.

## Published

`scripts/publish-mesh-delta.py models maps --hash` — `--hash` because a layer
patch can land on the same byte count, and size alone would miss it. Both trees
went in one run, models first, which is the order the publisher imposes.

| | to send | sent | bytes | time |
|---|---:|---:|---:|---:|
| models | 5,072 files | 101 units, all `ok` | 4.72 GB | 16 min |
| maps | 1,173 files | 466 units, all `ok` | 34.14 GB | 80 min |

A unit is a batch of files sharing a directory, which is why 1,173 files are 466
lines; each line's `+N` is the siblings that rode with it. No line read `FAILED`
and neither tree held its manifests back, so nothing was dropped. Two
`connection reset by peer` lines from kubectl sit in the log between units
(17:51 and 18:57); they are the closed-stream failure the publisher's own
`listing` docstring describes, and the unit on either side reported `ok`.

34 GB for a one-float change is the level bakes: a `scene.glb` is 10–30 MB and
goes whole, so patching one node's extras re-sends the file.

### That it is really there

Not the publisher's own tally — the bytes on the volume, read back through the
filebrowser pod and grepped for the literal key, against the same count taken
locally:

| File | on the volume | local |
|---|---:|---:|
| `maps/bocage/scene.glb` | 12 | 12 |
| `maps/kursk/scene.glb` | 17 | 17 |
| `maps/mods/xpack1/kasserine_pass/scene.glb` | 24 | 24 |
| `models/Sherman.glb` | 1 | 1 |
| `models/Sherman.Kasserine_Pass.glb` | 1 | 1 |
| `models/mods/fh/Sherman.glb` | 1 | 1 |

Their mtimes on the volume match the local files exactly once the pod's clock is
read as UTC (`06:53:54` there is `16:53:54` here), so the file being served is
the patched file and not a survivor of an earlier bake.

And the whole set, re-listed afterwards with the same test the run used
(`--hash --dry-run`, which fetches the volume listing again rather than trusting
the run):

```
models: 200528 local, 205858 on the volume, 0 to send (0.00 GB)
maps:   134402 local, 135183 on the volume, 0 to send (0.00 GB)
```

0 against the 5,072 and 1,173 the same command reported before the run. The maps
tree gained 23 files (135,160 to 135,183) because 23 of the local files had never
been on the volume at all — `.gz` sidecars `glbgz.ensure` wrote during the patch
for glbs that had none. The models tree's total did not move, so all 5,072 there
were overwrites.

## What is not checked here

The page was driven headless on Bocage: the level's three Shermans are found,
the body world holds the hull, the turret traverses, the body sits at rest. But
**no trigger produces a round** in that harness — `__setSeatFire(true)` and
`__setSeatFire(false, true)` both leave `firing` false and `shots` 0 through
`__renderOnce`, with the gate open (`blocked: false`), the root seat active and
a deployed soldier. `__stepSim` does not run the gun loop either, by design.
So the hull was never seen to move in a browser.

That is the harness's input path, not this change, and it was checked rather
than assumed: **the throttle does not move the tank either**. With the same
soldier in the same seat, `window.__keys.add('KeyW')` leaves the hull's speed
at 0.0000 through 60 `__renderOnce` frames AND through `__stepSim(60)`. No
input of any kind reaches a vehicle in this harness, so the trigger was never
the thing failing. The seam it would have
covered is one line, `map.html`'s
`guns.hullRecoil = (group, push) => hullBodies.recoilOnHull(group.node, push)`,
whose scope, ordering and export were checked by reading. Everything below that
line is covered by `tests/test_gun_recoil.py`, which drives the real
`gunfire.js`, `gun-recoil.js`, `hull-bodies.js` and `rigid-body.js`.

Worth closing: either find why a seat trigger fires nothing under `?shots`
(`features/vehicle-sound-coverage` measured a T-34 coax this way on Kursk, so
it worked once), or add a hook that hands a check the page's own `GunFire` the
way `__worldFire` hands it the world one.
