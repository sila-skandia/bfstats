## Summary

All four defects reproduce in the Wake map viewer under `?shots` on `:5273`. TreeMesh palms contribute no collider triangles (assembler skips them), so walk/ray/sweep pass through the trunk; the only “tree” hits in the static index are five `Pacific_Palm_4_M1` StandardMesh placements (95 tris). The sniper shot path plays `fire`, spawns a large additive effect flash (~12–29% of frame width for ~5 frames), and uses eye-line `aimRay` tracers in `gunfire.js` rather than a muzzle-origin round. `ensureDrive` correctly picks `TrackedVehicle`; the Sherman reaches ~9.25 m/s in 3 s, but driver HUD omits `30`/`400` because `mannedActive()` is false on the root seat so `feedVehicleHud` never writes ammo counts, and `Soldier/ShowSoldierIcon` stays false. Zoom FOV eases 57.3→5.73 with `fovFactor→0.6`, but every `crosshair` leaf is culled: no `CrossHair/*` keys exist in `__hudVars()` despite `sniper.png` being loaded in the atlas.

## Findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| X1-1 | Wake runtime statics: **20542** tris (`__collision().statics`); scene.json export reports **6176** / 83 parts | confirmed | `x1_a_trees.json` collision; `scene.json` `objects.collision` |
| X1-2 | Tree-named owners in statics: **only** `Pacific_Palm_4_M1`×5 = **95** tris; **0** for `Pacific_Palm_large_*` / `PALMHIGH` (TreeMesh) | confirmed | `treeTriInfo.treeOwners`, `sceneTreeCollision` |
| X1-3 | Assembler returns `[]` for `template.kind == "treemesh"`; `treemesh._skip_collision` discards the `.tm` hull | confirmed | `assemble.py:627–632`, `treemesh.py:166–191` |
| X1-4 | Palm under test `Pacific_Palm_large_1_M1` at `[1365.34, 116.129, -771.936]`; visual present as owner id 612 | confirmed | GLB + `ownerProbe.nearOwners` / `palms` |
| X1-5 | Horizontal `__castRay` from 5 m west **misses the palm**; first hit at t≈9.76 is `pacificfarm1_m1_4` (owner 590, mat 113, wood) behind it | confirmed | `castHit` + `ownerProbe.ownerName` |
| X1-6 | Walk +W 2 s: x 1361.84→1369.79 through palm (`blocked=false`, contacts 0); `sweepSphere` returned no hit | confirmed | `walk`, `sweep` |
| X1-7 | Shot into trunk line: 1 shot, hit same farm (not palm); effect `RichoWoodDecal`; palm itself does not stop/register | confirmed | `fireAfter.fire.hits` |
| X1-8 | `Pacific_Palm_4_M1` has collision nodes but chest-height cast at one instance returned `hit: null` (thin/miss geometry) | confirmed | `palm4Cast` |
| X1-9 | Scout spawn: `No4Sniper` / `USSoldier__No4Sniper`; hip idle, world FOV 57.3°, near-pass FOV **26.93°** (`fov1p=0.47` rad) | confirmed | spawn + `hip` |
| X1-10 | `?fov1p=world`: near-pass FOV becomes **57.3°** (matches world) | confirmed | `x1_b2_fovworld.json` |
| X1-11 | After one shot: clip=`fire` for ≥20 frames (held by `cool` in `updateViewmodelAnimation`); then loco/`idle` | confirmed | frames + `map.html:5315–5320` |
| X1-12 | Muzzle flash: effect run active frames 0–4; orange-biased width **~21–29%** of 800 px WebGL frame; gone by frame 5 (~83 ms) | confirmed | `flashOrange` / `effects` in `x1_b2_sniper.json` |
| X1-13 | “Floating bullet” code path: `gunfire.js` `#fireShot` for `kind==='bullet'` + `group.aimRay` → `#spawnTracer(..., bright=false)` with `shellMaterial`; `#muzzleVelocity` uses **eye ray**, not muzzle (flash stays on muzzle) | confirmed | `gunfire.js:545–554`, `577–594`, `108–111` |
| X1-14 | Live `__getFire().tracers` often empty after step (round already recycled / `__getFire().groups` is **vehicleGuns only**); diagnosis is from code + effect/flash timing, not a lasting tracer dump | inferred | `map.html:7572–7574`; empty `afterTracers` |
| X1-15 | Rig parent: `viewmodel root` → Scene (near pass); projecting with world cam is imperfect for hip pixel compare | confirmed | `hip.rigParent` |
| X1-16 | Wake Sherman PCO at `[1389.67, 116.704, -737.147]`; enter via EntryPoint; `ensureDrive` → **`TrackedVehicle`** (ratio 4, mass 25000, drag 2, 12 wheels, drivenBySide ±1:2) | confirmed | `x1_c_tank.json` |
| X1-17 | Throttle 3 s: vf 0.09→2.71→5.67→8.66→**9.25** m/s; throttle surface→1 by t=0.2; **not** stalled; asymptote ~9.25 ≪ fadeSpeed 100 | confirmed | `speedLog` |
| X1-18 | `occupancy.fireArms` live: cannon **30**, coax **400**, but `mannedActive: false` on driver root | confirmed | occupancy |
| X1-19 | `mannedActive()` = `!(isActiveRoot() && (aircraft\|\|car))` → driver seat skips FireState ammo feed in `feedVehicleHud` | confirmed | `map.html:3839–3841`, `4002–4022` |
| X1-20 | HUD scale at 800×450: `sx=1, sy=0.75` (independent axes); vehicle health layout `[174,525,32,64]` → device y **393.8** | confirmed | `hud.scale`, drawn rows |
| X1-21 | Drawn: vehicle icon/health + ammo **panels/icons**; culled: `Ammo/PrimaryAmmoText`, `SecondaryAmmoText`, soldier group (`Soldier/ShowSoldierIcon=false`) | confirmed | drawn/culled + vars |
| X1-22 | Near-pass / 1P: `ShermanCockpitInternal` + `1P_Sherman_Gunner_M1*` **visible**; `ShermanCockpitExternal` hidden; viewMode `cockpit` — black wedge is this interior mesh, not a missing texture alone | confirmed | `hud.named` |
| X1-23 | Zoom: FOV 57.3→~5.73, `fovFactor` 1→0.6 over ~20 frames (0.7/0.3 ease in map.html) | confirmed | `zoomCurve` |
| X1-24 | Zoomed `__hudVars()`: **zero** `CrossHair/*` keys; all 14 crosshair leaves culled for missing vars; `hud.sprite('sniper')` = 256×256 complete | confirmed | `x1_d_scope.json` |
| X1-25 | Comment at `hud.js:505` already states nothing writes `CrossHair/*` | confirmed | `hud.js:502–506` |

### Did not reproduce / differed from user wording

- **Tank “barely moves”**: tank **does** accelerate to ~9.25 m/s in 3 s under `TrackedVehicle`. May still be slow vs retail (R3), but it is not stuck at zero.
- **“Round into tree neither stops nor registers”**: round **does** hit and play an effect — but on **building behind** the palm, not the palm. Palm itself remains a miss.
- **Hip rifle screen position vs retail doorway shots**: evidence PNGs are ~2560×1440; headless bbox used world-cam projection of a near-pass rig — qualitative only. Default near FOV 26.9° vs world 57.3° is a real two-state FOV split (`?fov1p=world` equalizes).

## What the viewer must change

### D1 — Trees (`treemesh.py`, `assemble.py`, re-extract, `collision.js`)

- Stop discarding TreeMesh collision in `treemesh._skip_collision` / `assemble._collision_for_geometry` (`assemble.py:627–632`); parse `CID_SimpleCollisionMesh` into glTF collision meshes like StandardMesh.
- Re-extract Wake (and other maps) so TreeMesh palms (`Pacific_Palm_large_*`, `PALMHIGH`, etc.) appear in statics, not only `Pacific_Palm_4_M1`.
- No viewer runtime workaround needed beyond consuming re-exported hulls.

### D2 — Sniper fire (`gunfire.js`, `effects*`, viewmodel / extract)

- **Floating round**: for hand weapons with `fireInCameraDof` / `aimRay`, either hide the dim `#spawnTracer(..., false)` stand-in, or spawn visual only at muzzle while keeping eye-line for hit tests — today eye origin + muzzle flash = “floating” (`gunfire.js:545–594`).
- **Flash size/linger**: muzzle EffectBundle / particle scale and lifetime are too large (~25% frame, ~5 frames); shrink to retail ~2–3% / &lt;1/15 s (R2 for authored numbers).
- **Fire clip**: selection is `updateViewmodelAnimation` (`map.html:5294–5320`) — `fire` while `cool>0`. Awkward dip is clip/rate/`cool` coupling; R2 owns retail bolt timing.
- **FOV evidence**: default `nearPassFov≈26.9°` vs `worldFov=57.3°`; `?fov1p=world` forces both to 57.3 — feed to FOV decision, do not settle here.

### D3 — Tank (`map.html` `feedVehicleHud` / `mannedActive`, `hud.js`, cockpit extract)

- **Ammo 30/400**: `occupancy` already has the counts; `feedVehicleHud` only reads FireState when `mannedActive()` (`map.html:4002`). Driver root with `car` set forces `mannedActive===false`. Smallest fix: feed root-seat FireArms ammo into `Ammo/PrimaryAmmo(Text)` / `SecondaryAmmo(Text)` when driving a tank (or redefine `mannedActive` so driver weapons count).
- **Soldier HUD in tank**: `Soldier/ShowSoldierIcon=false` from `updateSoldierHud` / `onFootActive`; retail shows soldier bar in vehicle — set true (or vehicle-specific gate) when occupied.
- **Scale / clip**: `_scaleFor` uses independent `sx=W/800`, `sy=H/600` (`hud.js:286–291`) — matches retail stretch; at 800×450, y=525→393.8 and bottom elements clip. Fix stage size / letterbox policy if captures still look “1.3× / run off bottom” at full window.
- **Black wedge**: geometry is visible `ShermanCockpitInternal` / `1P_Sherman_Gunner_*` in cockpit mode — fidelity of that mesh/extract (`--cockpit`), not “nothing drawn.”
- **Drivetrain**: class is correct (`TrackedVehicle`); measured top ~9.25 m/s — if retail is higher, force/drag constants (R3), not gear-curve class selection.

### D4 — Scope (`map.html` HUD feed)

- On zoom (`isZoomed()` / sniper): write at least `CrossHair/ShowCrossHair=true`, `CrossHair/ScopeIndex≠0`, `CrossHair/ScopeIcon` → `sniper`, `CrossHair/SniperSight` as retail requires; clear when unzoomed.
- Atlas already has `sniper` (256×256); layout leaves already gate correctly — **only the vars feed is missing** (`hud.js:505`).

## Open

- Exact retail Sherman top speed / limiting term vs viewer 9.25 m/s (R3).
- Whether dim eye-line tracer is ever intended for bolt-action 1P (R2); we never held a long-lived `__getFire().tracers` sample for No4.
- Pixel-accurate hip pose vs `game-sniper-hip.png` (need near-pass camera projection, same doorway teleport).
- Why `Pacific_Palm_4_M1` cast missed despite 19 tris in index (ray height / thin hull).
- `Vehicle/ShowTurretIcon` / seat occupancy HUD still unfed (VHUD-9); out of D3 ammo scope but visible in cull list.
- Runtime 20542 vs export 6176 static tris — likely vehicles/spawners in live collider; not load-bearing for D1.

Load-bearing inferences: floating-bullet attribution to `aimRay`+#spawnTracer(false) (code-confirmed path; live tracer list empty); cockpit black wedge = `ShermanCockpitInternal` meshes (named/visible, not pixel-matched to evidence wedge).

## Proposed ledger rows

| id | finding | status | evidence |
|---|---|---|---|
| X1-TM-skip | TreeMesh collision skipped at assemble; Wake TreeMesh palms have 0 static tris | confirmed | assemble.py:627; x1_a treeOwners |
| X1-TM-walk | Soldier walks through Pacific_Palm_large_1; blocked=false | confirmed | x1_a walk |
| X1-gun-aimRay | Hand-weapon non-tracer rounds use dim aimRay tracer, not muzzle origin | confirmed | gunfire.js:545–594 |
| X1-flash-size | No4 muzzle flash ~0.21–0.29 frame width, ~5 frames @60 Hz | confirmed | x1_b2 frames |
| X1-tank-class | Sherman ensureDrive → TrackedVehicle, ratio=4 | confirmed | x1_c driveClass |
| X1-tank-speed | 3 s W: vf→9.25 m/s, throttle surface=1 | confirmed | x1_c speedLog |
| X1-vhud-ammo | Driver mannedActive false → Ammo/*AmmoText undefined despite fireArms 30/400 | confirmed | map.html:3839,4002; x1_c |
| X1-scope-vars | No CrossHair/* in vars when zoomed; sniper sprite present | confirmed | x1_d_scope.json |

---

## Harness scripts

Artifacts: `/home/dylan/bfstats-evidence/viewer-defects-2026-09-16/x1_out/`  
(`x1_a_trees.json`, `x1_b2_sniper.json`, `x1_b2_fovworld.json`, `x1_c_tank.json`, `x1_d_scope.json`, canvases, scripts below).  
Run: `node /tmp/x1_a_trees.mjs` then `node /tmp/x1_b2_sniper.mjs` then `node /tmp/x1_cd.mjs` (viewer on `:5273`).

### `x1_lib.mjs`

```javascript
import { chromium } from '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BASE = (() => {
  const i = process.argv.indexOf('--url');
  return i > -1 ? process.argv[i + 1] : 'http://127.0.0.1:5273';
})();
export const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i > -1 ? process.argv[i + 1] : '/home/dylan/bfstats-evidence/viewer-defects-2026-09-16/x1_out';
})();
export const W = 800, H = 450;
export const PALM = { name: 'Pacific_Palm_large_1_M1', pos: [1365.34, 116.129, -771.936] };
export const SHERMAN_APPROX = [1389.67, 116.704, -737.147];

export async function launch() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  return { browser, page };
}

export async function openMap(page, extra = '') {
  const url = `${BASE}/map.html?mod=bf1942&map=wake&shots${extra}`;
  console.log('goto', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__renderOnce === 'function', null, { timeout: 180000 });
  await page.waitForFunction(() => {
    try {
      window.__renderOnce(640, 360);
      return !!(window.__collision && window.__collision()?.statics);
    } catch { return false; }
  }, null, { timeout: 180000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      try { window.__renderOnce(640, 360); } catch {}
    }
  });
  console.log('map ready');
}

export async function step(page, n, w = W, h = H) {
  let left = n;
  while (left > 0) {
    const take = Math.min(20, left);
    await page.evaluate(({ take, w, h }) => {
      for (let i = 0; i < take; i++) {
        try { window.__renderOnce(w, h); }
        catch (e) { /* minimap paintMap can NPE under headless */ }
      }
    }, { take, w, h });
    left -= take;
    if (left > 0) await page.waitForTimeout(20);
  }
}

export async function canvasJpeg(page, name, quality = 0.85) {
  const dataUrl = await page.evaluate(q => {
    const c = document.querySelector('canvas');
    return c.toDataURL('image/jpeg', q);
  }, quality);
  const buf = Buffer.from(dataUrl.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
  const file = path.join(OUT, name);
  await writeFile(file, buf);
  return { file, bytes: buf.length };
}

export async function spawnScout(page, flag = 'The_Airfield') {
  await page.evaluate(() => window.__setFly(true));
  await page.evaluate(() => window.__setOnFoot(true));
  await step(page, 20);
  await page.evaluate(flag => {
    try { window.__deploy.select(flag); } catch {}
  }, flag);
  await page.click('[data-kit="scout"]').catch(() => {});
  await page.waitForTimeout(100);
  const spawned = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const spawnBtn = btns.find(b => /spawn/i.test(b.textContent || '') || /spawn/i.test(b.id || '') || /spawn/i.test(b.className || ''));
    if (spawnBtn) { spawnBtn.click(); return 'btn'; }
    try { return window.__deploy.spawn() ? 'api' : 'fail'; } catch (e) { return 'err:' + e.message; }
  });
  console.log('spawn via', spawned);
  for (let i = 0; i < 80; i++) {
    await step(page, 10);
    const ok = await page.evaluate(() => !!(window.__soldier?.() && window.__handWeapon?.()?.viewmodel));
    if (ok) break;
    await page.waitForTimeout(50);
  }
  await step(page, 120);
  return {
    loadout: await page.evaluate(() => { try { return window.__deploy.loadout; } catch { return null; } }),
    soldier: await page.evaluate(() => window.__soldier()),
    hw: await page.evaluate(() => window.__handWeapon()),
  };
}

export async function save(name, data) {
  const file = path.join(OUT, name);
  await writeFile(file, JSON.stringify(data, null, 2));
  console.log('wrote', file);
  return file;
}
```

### `x1_a_trees.mjs`

```javascript
import { launch, openMap, step, spawnScout, canvasJpeg, save, PALM } from '/tmp/x1_lib.mjs';

const { browser, page } = await launch();
try {
  await openMap(page);
  const spawn = await spawnScout(page);
  const palm = PALM.pos;
  const from = [palm[0] - 5, palm[1] + 1.5, palm[2]];
  const castHit = await page.evaluate(({ from }) => window.__castRay(from, [1, 0, 0], 10), { from });
  const coll = await page.evaluate(() => window.__collision());

  const treeTriInfo = await page.evaluate(() => {
    const c = window.__colliderRef();
    const statics = c?.statics;
    if (!statics) return { error: 'no statics' };
    const ownerNodes = statics.ownerNodes || [];
    const owners = statics.owners;
    const counts = new Map();
    let treeTris = 0;
    if (owners && owners.length) {
      for (let i = 0; i < owners.length; i++) {
        const id = owners[i];
        const node = id >= 0 ? ownerNodes[id] : null;
        const name = node?.name || (id < 0 ? '(none)' : `#${id}`);
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    const treeOwners = [];
    for (const [name, n] of counts) {
      if (/palm|tree|bush|plant|jungle|foliage/i.test(name)) {
        treeTris += n;
        treeOwners.push({ name, triangles: n });
      }
    }
    const collNodes = [];
    window.__scene?.traverse(o => {
      const ex = o.userData || {};
      if (ex.collision || ex.collisionHull || /collision/i.test(o.name || '')) {
        collNodes.push({
          name: o.name,
          sourceTemplate: ex.sourceTemplate || null,
          sourceGeometry: ex.sourceGeometry || null,
        });
      }
    });
    const treeCollNodes = collNodes.filter(m =>
      /palm|tree|bush|plant|jungle|foliage/i.test(`${m.name}|${m.sourceTemplate}|${m.sourceGeometry}`));
    return {
      staticTriangles: statics.count,
      ownerNodeCount: ownerNodes.length,
      uniqueOwners: counts.size,
      treeTrianglesInStatics: treeTris,
      treeOwners,
      topOwners: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
        .map(([name, n]) => ({ name, n })),
      sceneCollisionNodes: collNodes.length,
      sceneTreeCollisionNodes: treeCollNodes.length,
      sceneTreeCollision: treeCollNodes,
    };
  });

  await page.evaluate(({ palm }) => {
    window.__teleport(palm[0] - 3.5, palm[1] + 0.1, palm[2], Math.PI / 2);
  }, { palm });
  await step(page, 30);
  const beforeWalk = await page.evaluate(() => window.__soldier());
  await page.evaluate(() => window.__keys.add('KeyW'));
  await step(page, 120);
  await page.evaluate(() => window.__keys.delete('KeyW'));
  const afterWalk = await page.evaluate(() => window.__soldier());

  const sweep = await page.evaluate(({ palm }) => {
    const c = window.__colliderRef();
    if (!c?.sweepSphere) return { error: 'no sweepSphere', keys: c && Object.keys(c) };
    const hit = c.sweepSphere(palm[0] - 3.5, palm[1] + 1.0, palm[2], 1, 0, 0, 4.0, 0.4, -1);
    return hit && {
      t: hit.t, point: [hit.x, hit.y, hit.z], kind: hit.kind,
      material: hit.material, owner: hit.owner,
      ownerName: hit.owner >= 0 ? c.statics?.ownerNodes?.[hit.owner]?.name : null,
    };
  }, { palm });

  await page.evaluate(({ palm }) => {
    window.__teleport(palm[0] - 5, palm[1] + 0.1, palm[2], Math.PI / 2);
    window.__seedRandom(42);
  }, { palm });
  await step(page, 30);
  await page.evaluate(() => window.__setTrigger(true));
  await step(page, 5);
  await page.evaluate(() => window.__setTrigger(false));
  await step(page, 120);
  const fireAfter = await page.evaluate(() => ({
    fire: window.__getFire(),
    effects: window.__effects(),
    shots: window.__handWeapon()?.shots,
  }));
  await canvasJpeg(page, 'x1_a_tree_fire.jpg');

  const palm4 = await page.evaluate(() => {
    const hits = [];
    window.__scene?.traverse(o => {
      if (o.name === 'Pacific_Palm_4_M1' && !/collision/i.test(o.name)) {
        const p = new window.__THREE.Vector3();
        o.getWorldPosition(p);
        if (p.lengthSq() > 1) hits.push({ name: o.name, pos: p.toArray(), extras: {
          templateKind: o.userData?.templateKind, geometry: o.userData?.geometry,
        }});
      }
    });
    return hits.slice(0, 5);
  });
  let palm4Cast = null;
  if (palm4[0]) {
    const p = palm4[0].pos;
    palm4Cast = await page.evaluate(({ p }) => {
      const from = [p[0] - 5, p[1] + 1.5, p[2]];
      return { from, hit: window.__castRay(from, [1, 0, 0], 10) };
    }, { p });
  }

  await save('x1_a_trees.json', {
    spawn, palm: PALM, castHit, castFrom: from, collision: coll, treeTriInfo,
    walk: {
      before: { x: beforeWalk?.x, z: beforeWalk?.z, blocked: beforeWalk?.blocked, contacts: beforeWalk?.contacts },
      after: { x: afterWalk?.x, z: afterWalk?.z, blocked: afterWalk?.blocked, contacts: afterWalk?.contacts },
      dx: (afterWalk?.x ?? 0) - (beforeWalk?.x ?? 0),
      distBefore: Math.hypot((beforeWalk?.x ?? 0) - palm[0], (beforeWalk?.z ?? 0) - palm[2]),
      distAfter: Math.hypot((afterWalk?.x ?? 0) - palm[0], (afterWalk?.z ?? 0) - palm[2]),
    },
    sweep, fireAfter, palm4, palm4Cast,
  });
} finally {
  await browser.close();
}
```

### `x1_b2_sniper.mjs` / `x1_cd.mjs`

Full copies are on disk at:

- `/home/dylan/bfstats-evidence/viewer-defects-2026-09-16/x1_out/x1_b2_sniper.mjs` (209 lines: owner probe, hip FOV, 20-frame flash/clip capture, `?fov1p=world`)
- `/home/dylan/bfstats-evidence/viewer-defects-2026-09-16/x1_out/x1_cd.mjs` (191 lines: Sherman enter, 3 s speed log, HUD draw/cull table, zoom + CrossHair leaf eval)

(Also mirrored under `/tmp/x1_*.mjs`.)
