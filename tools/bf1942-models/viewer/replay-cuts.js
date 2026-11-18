// The clip's cameras (features/replay-creator-view, "Cameras on the strip"):
// what films each stretch of a clip, as a row of blocks on the strip's
// Camera lane. A kill shot opens with three -- over the shooter's shoulder,
// the bullet chase from the trigger, and the man it killed once he is down --
// and each can be swapped for another (his eyes, facing him, a 360 round the
// round, side-on, from the victim, the game's own chase, front chase and
// fly-by, a camera of your own), split, dragged
// along or taken away. Where one camera hands over to the next is a cut, a
// glide or a whip.
//
// A hand-over is kept by what it happens at, not by its second of the round:
// the trigger, a share of the round's flight, the hit, the man down (the end
// of the hold, where bullet time lets go), or the clip's start for a clip
// with no kill. The round's flight is a tenth of a second of the round, so
// "half way through the flight" is the only way to say it that survives the
// page's round landing a little later than the strip drew it.
//
// Pure, no DOM and no three, so `tests/replay_creator_harness.mjs` runs it.

/** The cameras: `[id, label, title, glyph]`, in the order the chooser shows
 *  them. */
export const CAMS = Object.freeze([
  ['placed', 'Your camera', 'A view you place: fly the camera there and press Use this view', 'cam:placed'],
  ['eyes', 'Their eyes', 'Through the shooter\'s eyes, as they saw it', 'cam:eyes'],
  ['shoulder', 'Over the shoulder', 'Behind the shooter, looking down their line of fire', 'cam:shoulder'],
  ['front', 'Facing them', 'In front of the shooter, looking back at their muzzle', 'cam:front'],
  ['chase', 'Bullet chase', 'Right behind the round, from the muzzle to the player it kills', 'style:chase'],
  ['orbit', 'Bullet 360', 'Swings round the round in flight, and round the player as they fall', 'style:orbit'],
  ['side', 'Side-on', 'Alongside the shooter, then the round, keeping pace with it', 'style:side'],
  ['incoming', 'From the victim', 'Beside the player it kills: the shooter, then the round coming at the lens', 'style:reverse'],
  ['victim', 'Circle the victim', 'Round the player killed, as they fall', 'cam:victim'],
  ['gamechase', 'Game chase', 'The game\'s own chase camera (F10): behind what they drive, or over their shoulder on foot', 'cam:gamechase'],
  ['gamefront', 'Game front chase', 'The game\'s front chase camera (F11): ahead of what they drive, looking back at it; on foot, their chase', 'cam:gamefront'],
  ['gameflyby', 'Game fly-by', 'The game\'s fly-by camera (F12): a tripod ahead of what they drive as it passes; on foot, their chase', 'cam:gameflyby'],
  ['free', 'Replay camera', 'The replay\'s own camera, as it is: whoever it follows', 'cam:free'],
  ['follow', 'Follow a player', 'The replay\'s camera on a player you pick: behind them, through their eyes or the game\'s chase. Click a player on the monitor to cut to them', 'cam:follow'],
]);

export const CAM_IDS = Object.freeze(CAMS.map(([id]) => id));
const camRow = id => CAMS.find(([c]) => c === id) ?? null;
export const camLabel = id => camRow(id)?.[1] ?? 'Camera';
export const camTitle = id => camRow(id)?.[2] ?? '';
export const camGlyph = id => camRow(id)?.[3] ?? 'cam:free';

/** The cameras that need a kill shot's take (a shooter, a round, a man it
 *  kills), and the one that needs no take at all. */
const NEEDS_TAKE = new Set(['eyes', 'shoulder', 'front', 'chase', 'orbit', 'side', 'incoming', 'victim',
  'gamechase', 'gamefront', 'gameflyby']);
const NEEDS_VICTIM = new Set(['incoming', 'victim']);

/** The cameras a clip can have: every one for a kill shot (less those that
 *  need the man it killed, when it killed nobody), else yours and the
 *  replay's own. */
export function camsFor(take) {
  if (!take) return ['placed', 'free', 'follow'];
  const victim = take.kill?.victim !== null && take.kill?.victim !== undefined;
  // The replay's own camera too: a clip trimmed down round one of its kills
  // turns into that kill's kill shot, and its Replay camera parts stay.
  return CAM_IDS.filter(id => victim || !NEEDS_VICTIM.has(id));
}

/**
 * How a Follow camera films its player (features/replay-creator-view, "Follow
 * cameras and chases on any kill"): `[id, label, the replay camera's mode]`.
 */
export const FOLLOW_HOW = Object.freeze([
  ['orbit', 'Behind them', 'orbit'],
  ['pov', 'Their eyes', 'pov'],
  ['chase', 'Game chase', 'chase'],
]);
export const followHowOf = id => (FOLLOW_HOW.some(([h]) => h === id) ? id : 'orbit');
export const followHowLabel = id => FOLLOW_HOW.find(([h]) => h === followHowOf(id))[1];

/** What camera `c` can be swapped for: the clip's cameras (`camsFor`), and
 *  for one riding a kill of its own (`on`) the other cameras that can. */
export function camChoices(take, c = null) {
  const base = camsFor(take);
  if (!Number.isFinite(c?.on)) return base;
  return CAM_IDS.filter(id => KILL_CAMS.has(id) || base.includes(id));
}

/** The cameras that can ride any kill in a clip, not only its kill shot's
 *  (`on`, the kill's time): the round's own and the victim's circle. */
export const KILL_CAMS = new Set(['chase', 'orbit', 'side', 'incoming', 'victim']);
/** How long a chase on a kill starts before its shot, seconds of the round:
 *  over the shooter's shoulder as the clock slows for the trigger. */
export const CHASE_LEAD = 0.6;
/** How long after the victim goes down a chase hands back. */
export const CHASE_TAIL = 0.25;
/** A kill's key in the clip's moments (`ev.kills`). */
export const killKey = k => Number(k).toFixed(3);

/** The game's own cameras (replay-camera.js's outside views, F10-F12): the
 *  replay's camera films them on the shooter, as it films his eyes. */
export const GAME_VIEW = Object.freeze({ gamechase: 'chase', gamefront: 'front', gameflyby: 'flyby' });
/** The cameras the replay's own camera films rather than the clip's rig:
 *  a drag and the wheel are its. */
export const PAGE_FILMED = new Set(['eyes', 'free', 'follow', ...Object.keys(GAME_VIEW)]);

/** The shot style of the round cam each round camera borrows (replay-
 *  shotstyle.js): over the shoulder is the chase before the trigger, facing
 *  him is Chase 360's. */
export const ROUND_STYLE = Object.freeze({
  shoulder: 'chase', front: 'orbit', chase: 'chase', orbit: 'orbit', side: 'side', incoming: 'reverse',
});
/** The ones that stay waiting on the shooter whatever the clock says. */
export const ARMED_CAMS = new Set(['shoulder', 'front']);
/** The camera on the round's flight for each of the round cam's shot styles
 *  (the plate's style button, G). */
export const STYLE_CAM = Object.freeze({ chase: 'chase', orbit: 'orbit', side: 'side', reverse: 'incoming' });

/** How one camera hands over to the next: `[id, label, title]`, and how long
 *  each takes, seconds of the video. */
export const HAND_OVERS = Object.freeze([
  ['cut', 'Cut', 'Snaps to the next camera at once'],
  ['glide', 'Glide', 'Eases from one camera into the next'],
  ['whip', 'Whip', 'Holds, then whips across to the next camera'],
]);
export const HAND_OVER_LEN = Object.freeze({ cut: 0, glide: 0.8, whip: 0.5 });
export const handOverOf = id => (HAND_OVERS.some(([h]) => h === id) ? id : 'cut');
export const handOverLabel = id => HAND_OVERS.find(([h]) => h === handOverOf(id))[1];

/** How a camera of your own moves while it films: `[id, label, title]`. */
export const MOTIONS = Object.freeze([
  ['still', 'Still', 'Stays exactly as you framed it'],
  ['track', 'Follow the action', 'Stays put and turns to keep the shooter, then the round, then the player it kills in frame'],
  ['push', 'Push in', 'Moves in on what it looks at'],
  ['pull', 'Pull back', 'Backs away and up from what it looks at'],
  ['spin', 'Circle', 'Circles what it looks at, a full turn'],
  ['crane', 'Crane up', 'Rises high over what it looks at'],
]);
export const motionOf = id => (MOTIONS.some(([m]) => m === id) ? id : 'still');
export const motionLabel = id => MOTIONS.find(([m]) => m === motionOf(id))[1];

/** How a camera of your own with an end camera goes from its start view (A)
 *  to its end view (B) over its stretch: `[id, label, title]`, the moves of
 *  replay-camtrack.js TrackRig between two keys. */
export const AB_MOVES = Object.freeze([
  ['glide', 'Glide', 'Eases from the start camera to the end camera'],
  ['orbit', 'Orbit', 'Swings round the action from the start camera to the end camera'],
  ['orbit360', '360', 'A full turn round the action on the way to the end camera'],
  ['whip', 'Whip', 'Holds the start camera, then whips to the end camera at the last moment'],
]);
export const abMoveOf = id => (AB_MOVES.some(([m]) => m === id) ? id : 'glide');
export const abMoveLabel = id => AB_MOVES.find(([m]) => m === abMoveOf(id))[1];

/** The fewest seconds of the round a camera films before the next takes
 *  over: less is the same moment. */
export const CAM_MIN = 0.02;

/** What a hand-over can be kept at: a moment of the round's own clock (a
 *  clip with no take), or a moment of the take. */
const EVENTS = new Set(['time', 'start', 'shot', 'flight', 'hit', 'down']);

/**
 * When `at` happens, seconds of the round, in the clip's moments `ev`
 * (`{ start, end, shot, hit, down }`, the last three null with no take):
 * the clip's start or a moment of the take plus `dt`, or `p` of the way
 * through the round's flight.
 */
export function timeOf(at, ev) {
  if (!at) return ev.start;
  // A moment of another kill in the clip (a chase on it): its own moments.
  if (finite(at.k)) {
    const m = ev.kills?.[killKey(at.k)] ?? { shot: at.k, hit: at.k, down: at.k };
    return timeOf({ ...at, k: undefined }, { ...ev, kills: undefined, shot: m.shot, hit: m.hit ?? m.shot, down: m.down ?? m.hit ?? m.shot });
  }
  const shot = ev.shot ?? ev.start;
  const hit = ev.hit ?? shot;
  switch (at.ev) {
    case 'time': return at.t;
    case 'shot': return shot + (at.dt ?? 0);
    case 'flight': return shot + (hit - shot) * (at.p ?? 0);
    case 'hit': return hit + (at.dt ?? 0);
    case 'down': return (ev.down ?? hit) + (at.dt ?? 0);
    default: return ev.start + (at.dt ?? 0);
  }
}

/**
 * What a moment `t` of the round is kept as: the moment of the take it falls
 * after (before the trigger, the trigger; inside the flight, its share of it;
 * during the hold, the hit; after it, the man down), or the round's own
 * clock for a clip with no take (trimming the clip leaves it where it is).
 * Within `snap` seconds of a moment it is that moment.
 */
export function anchorAt(t, ev, snap = 1e-4) {
  if (ev.shot === null || ev.shot === undefined) return { ev: 'time', t };
  const shot = ev.shot;
  const hit = ev.hit ?? shot;
  const down = ev.down ?? null;
  if (Math.abs(t - shot) <= snap) return { ev: 'shot', dt: 0 };
  if (Math.abs(t - hit) <= snap) return { ev: 'hit', dt: 0 };
  if (down !== null && Math.abs(t - down) <= snap) return { ev: 'down', dt: 0 };
  if (t < shot) return { ev: 'shot', dt: t - shot };
  if (hit > shot && t < hit) return { ev: 'flight', p: (t - shot) / (hit - shot) };
  if (down !== null && t < down) return { ev: 'hit', dt: t - hit };
  return { ev: 'down', dt: t - (down ?? hit) };
}

/**
 * A hand-over at `t` that follows camera `prev`, kept by what it happens
 * at: as `anchorAt`, but one after a camera kept by the man going down is
 * kept by that too, never by the hit. The moment he goes down moves with the
 * slow motion over the hold and the hit does not, so a camera kept by the hit
 * after the victim's circle (kept by his going down) slid in front of it once
 * the slow motion changed, and the circle was squeezed to nothing: the
 * owner's "it cut to them prior to the attack" (2026-11-09).
 */
export function anchorAfter(t, ev, prev) {
  const at = anchorAt(t, ev);
  if (at.ev !== 'hit' || prev?.at?.ev !== 'down' || ev.down === null || ev.down === undefined) return at;
  return { ev: 'down', dt: t - ev.down };
}

/** A clip's cameras before anything is changed: a kill shot is over the
 *  shoulder, the bullet chase from the trigger, and the man it killed once
 *  he is down; any other clip is the replay's own camera. */
export function defaultCams(take = null) {
  if (!take) return [{ cam: 'free' }];
  const out = [{ cam: 'shoulder' }, { cam: 'chase', at: { ev: 'shot', dt: 0 }, into: 'cut' }];
  if (take.kill?.victim !== null && take.kill?.victim !== undefined) out.push({ cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'glide' });
  return out;
}

/**
 * Camera recipes: a whole kill shot's cameras in one click, `[id, label,
 * title, cams]`. None places a camera of your own: there is no view to keep.
 */
export const CAM_RECIPES = Object.freeze([
  ['killcam', 'Kill cam', 'Over their shoulder, the round chased, then the player it killed', [
    { cam: 'shoulder' }, { cam: 'chase', at: { ev: 'shot', dt: 0 }, into: 'cut' }, { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'glide' }]],
  ['eyes', 'Through their eyes', 'Their own view as they fire, cut to the round, then the player it killed', [
    { cam: 'eyes' }, { cam: 'chase', at: { ev: 'shot', dt: 0 }, into: 'cut' }, { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'glide' }]],
  ['incoming', 'Incoming', 'The round chased half way, then from the victim as it arrives', [
    { cam: 'shoulder' }, { cam: 'chase', at: { ev: 'shot', dt: 0 }, into: 'cut' }, { cam: 'incoming', at: { ev: 'flight', p: 0.5 }, into: 'cut' },
    { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'glide' }]],
  ['spin', 'Full 360', 'Facing them as they fire, round the round in flight and on round the player', [
    { cam: 'front' }, { cam: 'orbit', at: { ev: 'shot', dt: 0 }, into: 'cut' }, { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'glide' }]],
  ['side', 'Side-on', 'Beside them as they fire, alongside the round, then the player it killed', [
    { cam: 'side' }, { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'glide' }]],
  ['victim', 'Their side', 'From beside the player it kills: the shooter, the round coming, the fall', [
    { cam: 'incoming' }, { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'glide' }]],
  ['gamechase', 'Game chase', 'The game\'s chase camera on them as they fire, the round chased, then the player it killed', [
    { cam: 'gamechase' }, { cam: 'chase', at: { ev: 'shot', dt: 0 }, into: 'cut' }, { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'glide' }]],
  ['gamefront', 'Game front chase', 'The game\'s front chase on them as they fire, the round chased, then the player it killed', [
    { cam: 'gamefront' }, { cam: 'chase', at: { ev: 'shot', dt: 0 }, into: 'cut' }, { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'glide' }]],
  ['gameflyby', 'Game fly-by', 'The game\'s fly-by on them as they fire, then the player it killed', [
    { cam: 'gameflyby' }, { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'glide' }]],
]);

const finite = v => typeof v === 'number' && Number.isFinite(v);

/** A camera of your own's view, as kept: `{ pos, quat, fov? }`, or null. */
export function viewOf(v) {
  if (!v || !Array.isArray(v.pos) || v.pos.length !== 3 || !Array.isArray(v.quat) || v.quat.length !== 4) return null;
  if (![...v.pos, ...v.quat].every(finite) || Math.hypot(...v.quat) < 1e-6) return null;
  const out = { pos: [...v.pos], quat: [...v.quat] };
  if (finite(v.fov) && v.fov > 1 && v.fov < 179) out.fov = v.fov;
  return out;
}

/** A hand-over's moment as kept, or null. */
function anchorOf(at) {
  if (!at || !EVENTS.has(at.ev)) return null;
  // Kept by a kill of its own (a chase on it): that kill's time with it.
  const k = finite(at.k) && at.k >= 0 && at.ev !== 'time' ? { k: at.k } : {};
  if (at.ev === 'flight') return finite(at.p) && at.p > 0 && at.p < 1 ? { ev: 'flight', p: at.p, ...k } : null;
  if (at.ev === 'time') return finite(at.t) && at.t >= 0 ? { ev: 'time', t: at.t } : null;
  return finite(at.dt) && Math.abs(at.dt) <= 600 ? { ev: at.ev, dt: at.dt, ...k } : null;
}

/** One camera as kept: its id, and its view and move for one of your own. */
function camOf(raw, first, allowed) {
  if (!raw || typeof raw !== 'object') return null;
  // One riding a kill of its own (`on`) needs no kill shot on the clip.
  const on = finite(raw.on) && raw.on >= 0 && KILL_CAMS.has(raw.cam) ? raw.on : null;
  if (on === null && !allowed.includes(raw.cam)) return null;
  const out = { cam: raw.cam };
  if (on !== null) out.on = on;
  if (raw.cam === 'follow') {
    if (!Number.isInteger(raw.pid) || raw.pid < 0) return null;
    out.pid = raw.pid;
    out.how = followHowOf(raw.how);
  }
  if (!first) {
    const at = anchorOf(raw.at);
    if (!at) return null;
    out.at = at;
    out.into = handOverOf(raw.into);
  }
  if (raw.cam === 'placed') {
    const view = viewOf(raw.view);
    if (!view) return null;
    out.view = view;
    out.motion = motionOf(raw.motion);
    // An end camera: the camera moves from its start view to it.
    const end = viewOf(raw.end);
    if (end) {
      out.end = end;
      out.move = abMoveOf(raw.move);
      // When it arrives there, if not at the end of its part: it holds the
      // end camera from then on.
      const endAt = anchorOf(raw.endAt);
      if (endAt) out.endAt = endAt;
    }
  }
  return out;
}

/** A clip's cameras read back (from the browser's storage, a kept clip, an
 *  undo): unknown or broken ones dropped, at least one left, none a take
 *  alone can film on a clip with no take. Null for none kept at all. */
export function camsOf(raw, take = null) {
  if (!Array.isArray(raw)) return null;
  const allowed = camsFor(take);
  const out = [];
  for (const c of raw.slice(0, 24)) {
    const cam = camOf(c, out.length === 0, allowed);
    if (cam) out.push(cam);
  }
  return out.length ? out : null;
}

/** The cameras with their stretches of the clip, `[{ ...cam, i, t0, t1 }]`,
 *  in the clip's moments `ev`: kept in their order and inside the clip. One
 *  of yours with an end camera also has `tEnd`, when it gets there (the end
 *  of its part unless its end camera was dragged earlier). */
export function resolveCams(cams, ev) {
  const out = [];
  let prev = ev.start;
  for (const [i, c] of cams.entries()) {
    let t0 = i === 0 ? ev.start : timeOf(c.at, ev);
    t0 = Math.min(ev.end, Math.max(prev, t0));
    prev = t0;
    out.push({ ...c, i, t0, t1: ev.end });
  }
  for (let i = 0; i < out.length - 1; i++) out[i].t1 = out[i + 1].t0;
  for (const c of out) {
    if (!c.end) continue;
    const want = c.endAt ? timeOf(c.endAt, ev) : c.t1;
    c.tEnd = Math.max(c.t0 + Math.min(CAM_MIN, (c.t1 - c.t0) / 2), Math.min(c.t1, want));
  }
  return out;
}

/** Whether camera `c` (resolveCams) gets to its end camera before its part
 *  ends, and holds it from there. */
export const holdsEnd = c => Boolean(c?.end && Number.isFinite(c.tEnd) && c.t1 - c.tEnd > CAM_MIN);

/**
 * `cams` with camera `i`'s end camera reached at `t` (its icon dragged along
 * the strip), held between its own start and end: kept by what it happens
 * at, like a hand-over. At its part's end (within `CAM_MIN`) it is the part's
 * end again, wherever that goes.
 */
export function moveEnd(cams, i, t, ev) {
  const c = resolveCams(cams, ev)[i];
  if (!c?.end) return cams;
  const at = Math.min(c.t1, Math.max(c.t0 + CAM_MIN, t));
  return cams.map((x, j) => {
    if (j !== i) return x;
    const next = { ...x };
    if (c.t1 - at <= CAM_MIN) delete next.endAt;
    else next.endAt = anchorAt(at, ev);
    return next;
  });
}

/** Which of `list` (resolveCams) films `t`: the last to start at or before
 *  it. */
export function camIndexAt(list, t) {
  let i = 0;
  while (i + 1 < list.length && list[i + 1].t0 <= t + 1e-9) i++;
  return i;
}

/** How a new camera hands over by default: a glide, smooth, but a cut into
 *  his eyes (the page's own first person cannot be blended into). */
const intoFor = cam => (cam === 'eyes' ? 'cut' : 'glide');

/**
 * `cams` with camera `cam` from `t` on (dropped from the strip's tray, the
 * chooser's "a new camera from here"): the camera filming `t` is cut there
 * and the new one films until the next hand-over. Close to a hand-over (or
 * the clip's start), that camera is swapped instead. `extra` carries a view
 * and its move.
 */
export function insertCam(cams, t, cam, ev, extra = {}) {
  const list = resolveCams(cams, ev);
  const i = camIndexAt(list, t);
  const near = t - list[i].t0 <= CAM_MIN;
  if (near) return setCam(cams, i, cam, extra);
  const out = cams.map(c => ({ ...c }));
  out.splice(i + 1, 0, { cam, at: anchorAfter(t, ev, out[i]), into: intoFor(cam), ...extra });
  return out;
}

/** `cams` with camera `i` swapped for `cam` (and a view and its move). */
export function setCam(cams, i, cam, extra = {}) {
  return cams.map((c, j) => {
    if (j !== i) return c;
    const next = { cam, ...(c.at ? { at: c.at, into: cam === 'eyes' ? 'cut' : c.into } : {}), ...extra };
    // A camera riding a kill keeps it while it is swapped for another that
    // can; a Follow camera keeps its player while it stays one.
    if (Number.isFinite(c.on) && KILL_CAMS.has(cam) && extra.on === undefined) next.on = c.on;
    if (!KILL_CAMS.has(cam)) delete next.on;
    if (cam === 'follow' && extra.pid === undefined && c.cam === 'follow') {
      next.pid = c.pid;
      next.how = c.how;
    }
    if (cam !== 'follow') {
      delete next.pid;
      delete next.how;
    }
    if (cam !== 'placed') {
      delete next.view;
      delete next.motion;
      delete next.end;
      delete next.move;
      delete next.endAt;
    }
    return next;
  });
}

/** `cams` without camera `i`: the one before films on in its place (the one
 *  after, for the first). The last camera left is never taken away. */
export function removeCam(cams, i) {
  if (cams.length <= 1 || i < 0 || i >= cams.length) return cams;
  const out = cams.filter((_, j) => j !== i).map(c => ({ ...c }));
  if (i === 0) {
    delete out[0].at;
    delete out[0].into;
  }
  return out;
}

/** `cams` with the hand-over into camera `i` moved to `t`, held between
 *  its neighbours'. */
export function moveCut(cams, i, t, ev) {
  if (i < 1 || i >= cams.length) return cams;
  const list = resolveCams(cams, ev);
  const lo = list[i - 1].t0 + CAM_MIN;
  const hi = (list[i + 1]?.t0 ?? ev.end) - CAM_MIN;
  const at = Math.min(hi, Math.max(lo, t));
  const k = cams[i].at?.k;
  return cams.map((c, j) => (j === i ? { ...c, at: finite(k) ? killAnchor(at, k, ev) : anchorAfter(at, ev, cams[i - 1]) } : c));
}

/** A moment `t` kept by the kill at `k` (a chase's hand-over dragged): as
 *  `anchorAt` over that kill's own moments. */
export function killAnchor(t, k, ev) {
  const m = ev.kills?.[killKey(k)] ?? { shot: k, hit: k, down: k };
  const at = anchorAt(t, { ...ev, shot: m.shot, hit: m.hit ?? m.shot, down: m.down ?? m.hit ?? m.shot });
  return at.ev === 'time' ? at : { ...at, k };
}

/** `cams` with camera `i` handing over its way (`into`). */
export function setHandOver(cams, i, into) {
  if (i < 1 || i >= cams.length) return cams;
  return cams.map((c, j) => (j === i ? { ...c, into: handOverOf(into) } : c));
}

/** `cams` with camera `i` one of yours, its start view, its move with no
 *  end camera, its end camera (null takes it away) or its move from start to
 *  end set. */
export function setPlaced(cams, i, { view, motion, end, move } = {}) {
  return cams.map((c, j) => {
    if (j !== i) return c;
    const next = { ...c, cam: 'placed' };
    if (view !== undefined) next.view = viewOf(view);
    next.motion = motionOf(motion ?? c.motion);
    if (end !== undefined) {
      const e = viewOf(end);
      if (e) next.end = e;
      else delete next.end;
    }
    if (next.end) next.move = abMoveOf(move ?? c.move);
    else {
      delete next.move;
      delete next.endAt;
    }
    return next;
  });
}

/**
 * `cams` with a bullet chase on the kill at `k` (its moments `m`, `{ shot,
 * hit, down }`, seconds of the round): `cam` (the chase, or another camera
 * that can ride a kill) from CHASE_LEAD before its shot, kept by that kill's
 * moments, and the camera that was filming as the victim goes down back
 * CHASE_TAIL after it. Cameras that started inside that stretch give way to
 * it; nothing outside it moves. The same kill chased again is swapped.
 */
export function chaseOnKill(cams, k, m, ev, cam = 'chase') {
  if (!finite(k) || !m || !finite(m.shot)) return cams;
  const down = m.down ?? m.hit ?? m.shot;
  const t0 = Math.max(ev.start, m.shot - CHASE_LEAD);
  const t1 = down + CHASE_TAIL;
  if (!(t0 < ev.end)) return cams;
  const list = resolveCams(cams, ev);
  // What films as the chase hands back: the camera there now, unless it is
  // a chase on this kill already.
  let back = null;
  for (let i = camIndexAt(list, Math.min(t1, ev.end)); i >= 0; i--) {
    if (list[i].on !== k) {
      back = list[i];
      break;
    }
  }
  const keep = list.filter(c => c.i === 0 || c.t0 < t0 - CAM_MIN || c.t0 > t1 + CAM_MIN);
  const out = keep.map(c => {
    const { i, t0: a, t1: b, tEnd, ...rest } = c;
    return rest;
  });
  const chase = { cam, on: k, at: { ev: 'shot', dt: t0 - m.shot, k }, into: 'glide' };
  // The clip's very start in the chase: it is the first camera.
  if (t0 <= ev.start + CAM_MIN) {
    delete chase.at;
    delete chase.into;
    out[0] = chase;
  } else {
    let j = out.findIndex((c, n) => n > 0 && timeOf(c.at, ev) > t0);
    if (j < 0) j = out.length;
    out.splice(j, 0, chase);
  }
  if (back && t1 < ev.end - CAM_MIN) {
    const { i, t0: a, t1: b, tEnd, at, into, ...rest } = back;
    const ret = { ...rest, at: { ev: 'down', dt: CHASE_TAIL, k }, into: 'glide' };
    let j = out.findIndex((c, n) => n > 0 && timeOf(c.at, ev) > t1);
    if (j < 0) j = out.length;
    out.splice(j, 0, ret);
  }
  return out;
}

/** The kills the clip's cameras ride (`on`, or a hand-over kept by one),
 *  their times, once each, in order. */
export function chasedKills(cams) {
  const out = new Set();
  for (const c of cams ?? []) {
    if (finite(c.on)) out.add(c.on);
    if (finite(c.at?.k)) out.add(c.at.k);
  }
  return [...out].sort((a, b) => a - b);
}

/** `cams` with a Follow camera on `pid` from `t` (a player clicked on the
 *  monitor), filming `how`, gliding in. */
export function followAt(cams, t, pid, ev, how = 'orbit') {
  return insertCam(cams, t, 'follow', ev, { pid, how: followHowOf(how) });
}

/** Whether two camera lists are the same. */
export const sameCams = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Cameras from keyframes kept before cameras (features/replay-creator-view,
 * "Keyframes on the strip"): each keyframe a camera of your own from its
 * moment, its move to the end as its move and its move to the next as how
 * it hands over; a kill shot's chase between the last before the trigger and
 * the first after it, as the lead-in, chase and lead-out had it.
 */
export function camsFromKeys(keys, take, ev) {
  const inside = (keys ?? []).filter(k => k.t >= ev.start - 1e-6 && k.t <= ev.end + 1e-6);
  if (!inside.length) return null;
  const END = { hold: 'still', spin: 'spin', push: 'push', pull: 'pull', crane: 'crane' };
  const intoOf = move => (move === 'cut' ? 'cut' : move === 'whip' ? 'whip' : 'glide');
  const view = k => viewOf(k);
  let cams = defaultCams(take);
  let prevMove = null;
  for (const k of inside) {
    const v = view(k);
    if (!v) continue;
    const t = Math.max(ev.start, k.t);
    cams = insertCam(cams, t, 'placed', ev, { view: v, motion: END[k.move] ?? 'still' });
    const i = camIndexAt(resolveCams(cams, ev), t);
    if (i > 0 && prevMove) cams = setHandOver(cams, i, intoOf(prevMove));
    prevMove = k.move ?? 'glide';
  }
  // Keyframes after the trigger were the whole lead-out: the man killed is
  // not cut to on top of them.
  if (take && ev.shot !== null && inside.some(k => k.t >= ev.shot)) {
    const i = cams.findIndex(c => c.cam === 'victim' && c.at?.ev === 'down' && c.at.dt === 0);
    if (i > 0) cams = removeCam(cams, i);
  }
  return cams;
}
