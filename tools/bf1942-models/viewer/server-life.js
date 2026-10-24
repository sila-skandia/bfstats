// A life the server already has: the page joined (or was reloaded) while the
// player's soldier on a real server was alive. The sidecar stays connected
// across a page reload, so the server's soldier never died; the page must take
// that life up where it stands rather than open the spawn screen and ask for a
// spawn the server ignores (a real BF1942 server drops a SpawnRequest from a
// live player). The owner, 2026-10-22: a reload mid-life opened the spawn
// screen, and the commit stood the soldier where he had been with the kit the
// screen had selected (Engineer) while the server's soldier was Anti-Tank.
//
// Pure decisions, no page: `net-room.js` asks `shouldResumeServerLife` on each
// snapshot and `spawning.js` `resumeServerLife` stands the body with the kit
// `deployRowForKit` names.

/** The deploy screen's kit rows, in the engine's slot order (`deploy-screen.js`
 *  `KITS`, `game.setKit <team> <slot> <kit>`). */
export const KIT_ROWS = ['scout', 'assault', 'antitank', 'medic', 'engineer'];

/** The class label `extract_kits.py` writes from a kit's `setType`, per row
 *  (`kit-loadout.js` `KIT_CLASS`). */
const ROW_CLASS = {
  scout: 'Scout', assault: 'Assault', antitank: 'Anti-tank', medic: 'Medic', engineer: 'Engineer',
};

/**
 * Whether the snapshot's own row is a life for the page to take up.
 *
 * Only for a page with no body that has not yet had a life on this level
 * (`joined` false): once the page has spawned, every later life is its own
 * request answered (`awaitingServerSpawn`), and a death leaves a corpse. A
 * page in the middle of asking (`awaiting`, `waiting`) is the normal spawn
 * path's, and a page flying (`pilot`) has chosen not to be on foot.
 */
export function shouldResumeServerLife({
  row, hasSoldier = false, awaiting = false, waiting = false, joined = false,
  pilot = false, worldReady = false,
} = {}) {
  if (!row || !row.alive) return false;
  if (hasSoldier || awaiting || waiting || joined || pilot || !worldReady) return false;
  return Number.isFinite(row.x) && Number.isFinite(row.z);
}

const lower = (s) => String(s ?? '').toLowerCase();

/** The loadouts key for `template`, by case (`UsMarine_AT` and `USMarine_AT`
 *  are one template to the engine). */
function kitKey(kits, template) {
  if (!kits || !template) return null;
  if (kits[template]) return template;
  const want = lower(template);
  return Object.keys(kits).find((k) => lower(k) === want) ?? null;
}

/**
 * The deploy row and kit for the kit template the server says the player
 * carries (`pickupKit`, net-sidecar.js `st.kits`).
 *
 * `{ row, kit, carried }`: `row` the deploy screen's kit row (`KIT_ROWS`),
 * `kit` the template as `loadouts.kits` keys it, and `carried` true when it is
 * not the kit the level binds to that row for `team` -- a kit picked up off
 * the ground, worn through `equipKit` the way a pickup is. Null when the
 * template is unknown to the level's loadouts and names no class.
 *
 * `loadouts` is `_shared/loadouts.json` as the level sees it, `dir` the
 * level's folder, `team` 1 Axis or 2 Allied.
 */
export function deployRowForKit(loadouts, dir, team, template) {
  if (!template) return null;
  const want = lower(template);
  const level = loadouts?.levels?.[dir] ?? null;
  const own = level?.[team]?.slots ?? null;
  for (const [slot, name] of Object.entries(own ?? {})) {
    const row = KIT_ROWS[Number(slot)];
    if (row && lower(name) === want) {
      return { row, kit: kitKey(loadouts?.kits, name) ?? name, carried: false };
    }
  }
  // Not his own side's row for it: a kit he picked up. The row for the next
  // spawn is the one of the same class (or the same slot on the other side).
  const key = kitKey(loadouts?.kits, template);
  const cls = key ? loadouts.kits[key]?.class : null;
  let row = cls ? KIT_ROWS.find((r) => ROW_CLASS[r] === cls) ?? null : null;
  if (!row && level) {
    for (const side of Object.values(level)) {
      for (const [slot, name] of Object.entries(side?.slots ?? {})) {
        if (lower(name) === want && KIT_ROWS[Number(slot)]) row = KIT_ROWS[Number(slot)];
      }
    }
  }
  if (!row) return null;
  return { row, kit: key ?? template, carried: true };
}

/**
 * The flag a resumed life is filed under: the nearest offered land flag of
 * his side that has spawn points, else the nearest offered one. The flag decides
 * the side's weapon and soldier on the page (`ensureHandWeapon(flag)`), not
 * where he stands -- the server's pose does that. An index into `flags`, or -1
 * only when the level offers no flag at all.
 *
 * The server already has him alive, so the page's own bookkeeping of a flag
 * (its points, where it stands, whether its carrier is drawn yet) never makes
 * this fail: a flag with no points, or no position, is still a flag to file
 * him under when nothing better is left (a side whose only spawns ride ships,
 * Japan on Wake, before the page has bound them; browser.md "The join").
 */
export function nearestFlagIndex(flags, team, x, z) {
  let best = -1;
  let bestScore = Infinity;
  (flags ?? []).forEach((flag, index) => {
    if (!flag || flag.captureOnly) return;
    const p = flag.position ?? flag.spawns?.find((s) => s?.position)?.position;
    // No points, or nowhere to measure from: after every flag of his side
    // that has them, still before any of the other side's.
    const bare = !flag.spawns?.length || !p;
    const d = p ? Math.hypot(p[0] - x, p[2] - z) : 0;
    // His side first, whatever the distance; a ship's deck or a seat point
    // only when nothing else is left (a body stood there would be taken
    // aboard or seated before the server's pose moves it).
    const seat = flag.vehicle || (!bare && flag.spawns.every((s) => s?.enterOnSpawn));
    const score = (flag.team === team ? 0 : 1e12) + (bare ? 1e10 : 0) + (seat ? 1e7 : 0) + d;
    if (score < bestScore) { bestScore = score; best = index; }
  });
  return best;
}
