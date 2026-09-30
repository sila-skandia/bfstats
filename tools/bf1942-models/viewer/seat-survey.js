// One vehicle's seat table: the survey of its assembled node tree into
// seats (root plus every nested `PlayerControlObject`), each seat's
// classification (SEAT-*/GUN-10) and the mouse-aim axes it is wired to.
// Split out of `seats.js`, which re-exports everything here.

import { applyCameraPivot } from './camera-pivot.js';

// --- seat survey -------------------------------------------------------

export const AXES = ['yaw', 'pitch', 'roll'];

/** Root seat kinds that own a drivetrain object. `'ship'` joined them when
 *  `c_ETShip` turned out to be the aircraft thrust law (see `classifySeat`). */
export const DRIVE_KINDS = ['air', 'ground', 'tank', 'ship'];

/** The two inputs a player's mouse actually reaches an aim axis through
 *  (GUN-2). Everything else a `RotationalBundle` can bind — a steered front
 *  wheel's `c_PIYaw`, a minigun barrel's `c_PIFire` spin — is somebody else's
 *  to pose, and `TurretRig`/`hasAimAxes` both key off exactly this pair. */
export const AIM_INPUTS = ['c_PIMouseLookX', 'c_PIMouseLookY'];
export const isAimAxis = spec => AIM_INPUTS.includes(spec?.input);

/** Does this seat give the player something to aim with the mouse? True for
 *  every manned gun, and also for a tank's own driving seat — a Sherman's
 *  driver traverses `ShermanTower` (`c_PIMouseLookX`, free, 35 deg/s) and
 *  elevates `ShermanGunBase` (`c_PIMouseLookY`, -20..+5 at 20 deg/s) off the
 *  same mouse, which is why this asks what the seat is WIRED to rather than
 *  what `classifySeat` calls it. */
export function hasAimAxes(seat) {
  return !!seat && AXES.some(name => isAimAxis(seat.axes?.[name]?.spec));
}

/**
 * Every node one `TurretAxis` drives for a surveyed axis entry, winner first.
 *
 * A `seat.axes[name]` entry is `{ node, spec, peers }` where `peers` already
 * includes `node` (first bundle per slot seeds `peers: [obj]`; later
 * same-input bundles append). This unwraps that shape into a de-duplicated
 * node list so callers never have to know whether `peers` includes the
 * winner or not, and tolerates a bare `{ node, spec }` entry from older
 * callers by falling back to `[node]`.
 *
 * Coordinator note (Issue 4, `map.html` `cameraRidesTurret`): replace
 *
 *   const aimed = Object.values(seat.axes)
 *     .filter(axis => AIM_INPUTS.includes(axis?.spec?.input))
 *     .map(axis => axis.node);
 *
 * with
 *
 *   import { axisPeerNodes } from './seats.js';
 *   const aimed = Object.values(seat.axes)
 *     .filter(axis => AIM_INPUTS.includes(axis?.spec?.input))
 *     .flatMap(axis => axisPeerNodes(axis));
 *
 * so a camera hung under a peer turret (Fletcher aft pair) still counts as
 * riding the turret. Do NOT compare by name: peer nodes are distinct
 * `Object3D`s. This file is the helper's home; `map.html` itself is owned by
 * Agent 4 and is not touched here.
 */
export function axisPeerNodes(axisEntry) {
  if (!axisEntry) return [];
  const raw = axisEntry.peers || (axisEntry.node ? [axisEntry.node] : []);
  const out = [];
  if (axisEntry.node) out.push(axisEntry.node);
  for (const n of raw) {
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Same as `axisPeerNodes` but looked up by seat + axis name:
 * `turretPeerNodes(seat, 'yaw')` returns every node the seat's yaw axis
 * drives. Returns `[]` when the seat has no such axis entry.
 */
export function turretPeerNodes(seat, axisName) {
  if (!seat?.axes || !axisName) return [];
  return axisPeerNodes(seat.axes[axisName]);
}

/**
 * Every seat of one vehicle, keyed by the name of the `PlayerControlObject`
 * that owns it -- the root's own name for the root seat, a nested PCO's own
 * name for each of the others.
 *
 * The grouping key already exists in the data: `assemble.py` stamps every
 * non-PCO node's `extras.control` with the name of its nearest enclosing
 * `PlayerControlObject` (`control_scope`, `bf42/con.py`), and does the same
 * for `EntryPoint`/`SeatObject` under `extras.seat.control`. A single
 * `root.traverse()` bucketing every descendant by that tag therefore respects
 * PCO boundaries automatically -- a hull gunner's own RotationalBundle is
 * never attributed to the driver's seat, and vice versa -- without this
 * module re-deriving the tree structure `classifyVehicle`'s old stack-walk
 * used to.
 *
 * `order` lists seat ids in the order their PlayerControlObject node is first
 * seen (root always first). SEAT-22/23 (verify-r5.md) confirm the real engine
 * builds a `position id -> seat` map once per vehicle and switches seats with
 * `c_PIMenuSelect1..9` -> position 0..8, but the *position* integer itself is
 * assigned by client-side helpers this data does not expose. Declaration
 * order is the approximation: it reproduces the one pair the report checked
 * against real data exactly (Sherman: root/driver = position 0 = key 1,
 * `shermanBrowning_PCO1` = position 1 = key 2, SEAT-24), and generalises the
 * same way to M3A1 and the ship gun mounts. OPEN (SEAT-22): whether a vehicle
 * whose `.con` declares seats in a different order than the node tree walks
 * them would disagree with the real position map.
 */
export function surveyVehicle(root) {
  const rootId = root.userData?.control || root.name || 'vehicle';
  const seats = new Map();
  const order = [];
  function seatFor(id, node) {
    let seat = seats.get(id);
    if (!seat) {
      seat = {
        id, node: node || null, entryPoints: [], seatObjects: [],
        camera: null, axes: {}, fireArms: [], engineType: null, engineTypes: [], hud: null,
        poseAnimation: null, cameraViewModes: null,
        // `ObjectTemplate.setVehicleCategory` of the seat's own PCO: VCLand,
        // VCSea or VCAir, and how many `c_PGFEngineGrip` springs the tree
        // carries. Read for the root only (`rootDriveKind`).
        vehicleCategory: node?.userData?.physics?.vehicleCategory ?? null,
        drivenSprings: 0,
      };
      seats.set(id, seat);
      order.push(id);
    } else if (node && !seat.node) {
      seat.node = node;
    }
    return seat;
  }
  seatFor(rootId, root);
  root.traverse(obj => {
    const data = obj.userData;
    if (!data) return;
    const kind = data.templateKind;
    if (kind === 'PlayerControlObject') {
      // Bucket by `data.control`, not `obj.name`: a nested PCO's *node* name
      // gets a scene-wide disambiguating suffix whenever more than one
      // instance of its vehicle is placed on the level (Wake's own two
      // Shermans -- confirmed against the live scene, headless, this round:
      // `shermanBrowning_PCO1`'s own node is named `shermanBrowning_PCO1_1`
      // on the first Sherman), but its `control` tag -- the same string
      // every one of ITS OWN descendants report as their `owner` two lines
      // below -- is not. Keying this bucket by the node name instead split
      // one seat into two: an empty one under the suffixed name (this PCO's
      // `.node`, no entryPoints/axes/fireArms/camera -- none of its children
      // ever resolve `owner` to that string) and a fully-populated one under
      // the bare name (every child, but `.node` never set) -- shifting the
      // Sherman's own gunner from seat position 1 to 2 and leaving position 1
      // an unfireable dead seat, breaking exactly the `switchSeat` path
      // SEAT-23/24 describes. `data.control` is what a PCO's own descendants
      // already use to name it, so using it here too is the one dependable
      // key, not an approximation.
      const id = data.control || obj.name;
      if (obj !== root) seatFor(id, obj);
      if (data.hud) seatFor(obj === root ? rootId : id, obj).hud = data.hud;
      return;
    }
    const owner = data.control || rootId;
    if (kind === 'EntryPoint') {
      seatFor(owner).entryPoints.push(obj);
    } else if (kind === 'SeatObject') {
      const seat = seatFor(owner);
      seat.seatObjects.push(obj);
      // SEAT-9: the passenger seat's own pose animation strings, if declared.
      // `extras.seat.poseAnimation` comes straight off `seatAnimationUpperBody/`
      // `seatAnimationLowerBody` in the `.con` — the same names
      // `BFSoldier::setUseSeat` resolves (engine reference SEAT-9). Empty on a
      // driver seat or a manned gun: those fall back to the soldier's own
      // template, and `poseAnimation` staying null is the "no override" signal.
      if (data.seat?.poseAnimation && !seat.poseAnimation) {
        seat.poseAnimation = data.seat.poseAnimation;
      }
    } else if (kind === 'Camera') {
      // Retail's eye is the node plus its `setPivotPosition` (camera-pivot.js):
      // the half-track's ring-mount Browning backs out 1 m behind the receiver.
      applyCameraPivot(obj);
      const seat = seatFor(owner);
      if (!seat.camera) seat.camera = obj;   // first one wins, same rule Vehicle.collect() uses
      // camera-modes.md §3: CVM* booleans say which views the seat offers.
      // Omitted flags default on; only the ones actually declared land here.
      if (data.cameraView?.cvm) seat.cameraViewModes = data.cameraView.cvm;
    } else if (kind === 'RotationalBundle' && data.rig?.axes) {
      const seat = seatFor(owner);
      for (const axis of AXES) {
        const spec = data.rig.axes[axis];
        if (!spec) continue;
        // First bundle per axis name wins, EXCEPT:
        // 1. An axis the mouse actually reaches beats one it does not (V-100:
        //    turret vs steered front wheel under the same control).
        // 2. A movable aim axis (`maxSpeed > 0`) beats a zero-speed dummy on
        //    the same input (Stationary Browning: Point declares pitch at
        //    maxSpeed 0; Rotation owns the real elevation). First-wins alone
        //    bound pitch to Point and left elevation dead.
        // Losing the `seat.axes` slot costs the other bundle nothing:
        // `Vehicle.collect`/`applyRig` pose every declared bundle on their own.
        const held = seat.axes[axis];
        if (held) {
          const aimUpgrade = isAimAxis(spec) && !isAimAxis(held.spec);
          const speedUpgrade = isAimAxis(spec) && isAimAxis(held.spec)
            && Math.abs(held.spec.maxSpeed || 0) === 0
            && Math.abs(spec.maxSpeed || 0) > 0;
          // Same-axis-same-input: peering only ever groups bundles driven by
          // the SAME PlayerInput on the SAME axis name. The V-100's driving
          // seat declares `V-100FrontWheelR/L` (`c_PIYaw`) beside `V-100Turret`
          // (`c_PIMouseLookX`) under the same control, and without this guard
          // the `aimUpgrade` arm peered the steered wheels under the turret —
          // welding them to the turret angle every `_apply`. A losing bundle
          // on a different input is left to `Vehicle.collect`/`applyRig`, not
          // peered. Replacement still happens (the aim axis wins the slot);
          // only the PEERING is gated. `speedUpgrade` keeps its behaviour
          // otherwise — its pair already shares the input in practice
          // (Stationary Browning pitch, both `c_PIMouseLookY`), and the same
          // guard applies to it.
          const sameInput = spec.input === held.spec.input;
          if (aimUpgrade || speedUpgrade) {
            // The new bundle replaces the winner; the old is kept as a peer
            // only when it shares the input.
            const mergedSpec = spec.automaticReset === undefined && data.rig.automaticReset
              ? { ...spec, automaticReset: true } : spec;
            const oldPeers = sameInput ? (held.peers || [held.node]) : [];
            seat.axes[axis] = {
              node: obj,
              spec: mergedSpec,
              peers: [...oldPeers, obj],
            };
          } else {
            // This bundle does not win, but when it shares the winner's input
            // it is a peer of it — same axis, same seat, same rig. A Fletcher
            // with two turret bundles under the same PCO needs both to track.
            // Different input: ignore for peering (steering vs turret).
            if (!sameInput) continue;
            if (!held.peers) held.peers = [held.node];
            held.peers.push(obj);
          }
          continue;
        }
        // `automaticReset` is declared once per BUNDLE, not per axis (`con.py`
        // emits it beside `axes`), but it selects the whole control law a
        // `TurretAxis` runs under (GUN-2), so it is folded into the axis's own
        // spec here rather than making every consumer carry the rig object
        // alongside. A spec that already names it -- a hand-built test
        // fixture -- keeps its own value.
        seat.axes[axis] = {
          node: obj,
          spec: spec.automaticReset === undefined && data.rig.automaticReset
            ? { ...spec, automaticReset: true } : spec,
          peers: [obj],
        };
      }
    } else if (kind === 'FireArms' && data.fireArms) {
      seatFor(owner).fireArms.push(obj);
    } else if (kind === 'Engine' && data.physics?.engineType) {
      const seat = seatFor(owner);
      seat.engineType = data.physics.engineType;
      seat.engineTypes.push(data.physics.engineType);
    } else if (kind === 'Spring' && data.physics?.grip === 'c_PGFEngineGrip') {
      seatFor(owner).drivenSprings += 1;
    }
  });
  return { rootId, order, seats };
}

/**
 * GUN-10 (verify-r6.md)'s own definition, applied per seat: an Engine wins at
 * the root (a drivable body); short of that, a RotationalBundle with real
 * motion (`maxSpeed>0` on at least one axis -- excludes a zeroed gunner
 * Camera, which is never this `templateKind` anyway, and a purely cosmetic
 * hinge) *and* a FireArms is a manned gun; anything else that reaches an
 * `EntryPoint` is a bare seat -- a passenger position.
 *
 * `c_ETShip` is `'ship'`, and the reason it took a round to get there is that
 * the engine has no ship propulsion code to find: `c_ETShip = 9` has bit 0 set
 * (`operator<<(ostream&, EngineType)` `0x0823ef60`), so a helm runs the SAME
 * `PhysicsEngine::updatePhysics` thrust body an aeroplane does, with bit 3
 * adding the water rule. `ship.js` is that plus `FloatingBundle`; a helm is a
 * drive seat like any other. A car and a tank, whose bit 0 is clear, are the
 * ones that genuinely need their own model.
 *
 * A root with more than one engine type is classified by `rootDriveKind`.
 */
export function classifySeat(seat, isRoot) {
  if (isRoot) {
    const kind = rootDriveKind(seat);
    if (kind) return kind;
  }
  const hasMotion = AXES.some(axis => seat.axes[axis] && seat.axes[axis].spec.maxSpeed > 0);
  if (hasMotion && seat.fireArms.length) return 'gun';
  return 'seat';
}

/** A root Engine's `setEngineType` to the drive kind that runs it. */
const ENGINE_DRIVE_KIND = {
  c_ETPlane: 'air', c_ETCar: 'ground', c_ETTank: 'tank', c_ETShip: 'ship',
};

/**
 * The drive kind of a root seat whose PCO carries Engines, or null.
 *
 * The engine has no vehicle class to choose. Every Engine on a hull is its own
 * `PhysicsEngine`, and all of them run every tick: a land engine (`c_ETCar`,
 * `c_ETTank`, bit 0 clear) returns at the second instruction of
 * `PhysicsEngine::updatePhysics` (`0x0824cc20`) and drives only the
 * `c_PGFEngineGrip` springs that find it walking up their ancestors
 * (`ResponsePhysics::addFriction` `0x0825c1b0`); a `c_ETShip` pushes along its
 * own axis while its node is under water and, above it with its revs off the
 * 0.02 dead band, pins them to 1.0 and pushes nothing (`0x0824cc89`,
 * `0x0824d047`); `FloatingBundle`s lift only under water. So a BMP-2 is a tank
 * on land and a boat afloat with no switch between them.
 *
 * The viewer runs one drive model per hull, so it has to pick one, and the
 * hull says which in its own data: `setVehicleCategory`. A `VCLand` hull with a
 * land engine is driven by that engine (`TrackedVehicle` / `GroundVehicle`,
 * which run the water engine, the floats and the rudders as `amphibious.js`);
 * a `VCSea` hull with a `c_ETShip` is a ship (a PT boat's `c_ETCar` beach
 * engines are its landing gear); a `VCAir` hull with a `c_ETPlane` flies.
 *
 * Until 2026-09-30 the kind was the last Engine the walk met, which put every
 * amphibian's water engine in charge (DC's BMP-2, BRDM-2, 2S1 and SA-9 and
 * XPack2's LVT and Schwimmwagen drove as boats on land) and drove vanilla's
 * Elco80 and Type38 PT boats as cars. A root with no category, or whose
 * category names an engine it does not carry, keeps that rule.
 *
 * So does a `VCLand` hull whose tree carries no `c_PGFEngineGrip` spring for
 * its land engine to drive. XPack2's LVT4 authors its two driven springs
 * (`LVT4_S_Wheel_L3/R3`) `createInvisible 1` and the exporter drops invisible
 * templates, so its extracted tree has only the twelve spin-only rollers: a
 * land model would have nothing to push it, and it stays a boat until the
 * exporter keeps them.
 */
export function rootDriveKind(seat) {
  const types = seat?.engineTypes?.length ? seat.engineTypes
    : (seat?.engineType ? [seat.engineType] : []);
  if (!types.length) return null;
  const category = seat.vehicleCategory ?? null;
  const land = types.includes('c_ETTank') ? 'tank' : types.includes('c_ETCar') ? 'ground' : null;
  if (category === 'VCLand' && land && seat.drivenSprings !== 0) return land;
  if (category === 'VCSea' && types.includes('c_ETShip')) return 'ship';
  if (category === 'VCAir' && types.includes('c_ETPlane')) return 'air';
  return ENGINE_DRIVE_KIND[types[types.length - 1]] ?? null;
}

/** `classifyVehicle`'s old contract (a root node in, one of five kinds out). */
export function classifyRoot(root) {
  if (!root) return null;
  const { rootId, seats } = surveyVehicle(root);
  return classifySeat(seats.get(rootId), true);
}
