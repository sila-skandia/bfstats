/**
 * ObjectiveMode's objectives: what ends the round, and how far each side has
 * got (ledger OBJ-1..OBJ-6, read out of the Linux server 2026-10-07).
 *
 * An ObjectiveMode level declares its objectives as object templates of three
 * kinds and places one `ObjectSpawner` per objective (`scene.json.modes.
 * ObjectiveMode.objectives`, `bf42/level.py` `ObjectiveSetup`):
 *
 *  - `DestroyTarget` watches an object by name: the object a named pad last
 *    stood up (`getTargetObject` 0x08285990). It is met once that object's
 *    Armor `isDestroyed` (`evaluate` 0x08285690); its completion is the
 *    damage the object has taken, `1 - hp / maxHp`, and 1 once met or with
 *    no object to watch (`getCompletion` 0x082858a0);
 *  - `ANDComposite` is met once every objective its member spawners hold is
 *    met (`evaluate` 0x08282ab0); its completion is the mean of theirs
 *    (0x08282810);
 *  - `Timer` is met once its playing time passes `timeLimit` times
 *    `game.objectiveAttackerTicketsMod` / 100 (0x08326660; the shipped
 *    `ServerSettings.con` sets 100); its completion is the time over the
 *    limit, at most 1 (0x083265e0).
 *
 * Every objective runs the same frame (`Objective::handleUpdate` 0x083112e0),
 * only while the round plays: it asks `evaluate` until that answers yes, then
 * pays its immediate award and starts its delay clock at that frame's dt; it
 * stops asking, and the frame its clock passes `objectiveDelay` it is done and
 * pays its award. So a target destroyed is a met objective a second later
 * (`setObjectiveDelay 1.0`), and the composite over the five of Battle of
 * Britain three seconds after the last.
 *
 * The awards (OBJ-3): a DestroyTarget pays its destroyer at once, the score
 * table's `objective` when he is of the objective's own side and its
 * `objectiveTK` when he is not (`PlayerAward::give` / `givePenalty`, score
 * events 8 / 9). A Composite or a Timer wins the round for its side when it
 * is done (`TeamWinsAward::give` 0x08310c20: `setWinner(team)`,
 * `setVictoryType(3)`, EndGame). The page's round takes that through
 * `onWin(team)`.
 *
 * Each side's tickets on the HUD are its real count scaled by the enemy's
 * progress (OBJ-5): `trunc(real * (1 - completion(root of the other side)))`,
 * where `setRootObjectSpawner <team> <spawner>` names each side's root. That
 * is `round-state.js`'s; `completion(team)` here answers it.
 *
 * Pure: no `three`, no DOM. `tests/objectives_harness.mjs` drives it.
 */

/** The shipped `game.objectiveAttackerTicketsMod` (`Mods/bf1942/Settings/
 *  ServerSettings.con`): a percentage, `Setup+0x34c`. */
export const ATTACKER_TICKETS_MOD = 100;

/** `ScoreMsg` 8 and 9, what `PlayerAward` pays (round-state.js `SCORE_MSG`). */
export const AWARD = Object.freeze({ objective: 'objective', penalty: 'objectiveTk' });

/**
 * The pad each DestroyTarget's object stands on: `targets` is the report's
 * list (`{ name, spawner, position }`, glTF axes), `pads` the page's vehicle
 * pads (`level-statics.js` records, `{ spawn: { spawner, position } }`). A
 * target matches the pad of its spawner's template standing within a metre of
 * its position, the one the exporter placed for it. Returns name (lower case)
 * -> pad record; a target with no pad is left out.
 */
export function matchTargets(targets, pads) {
  const out = new Map();
  for (const target of targets ?? []) {
    const at = target?.position;
    if (!target?.name || !Array.isArray(at)) continue;
    const want = String(target.spawner ?? '').toLowerCase();
    let best = null, bestDistance = 1;
    for (const record of pads ?? []) {
      const spawn = record?.spawn;
      const p = spawn?.position;
      if (!Array.isArray(p) || String(spawn.spawner ?? '').toLowerCase() !== want) continue;
      const d = Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]);
      if (d < bestDistance) { best = record; bestDistance = d; }
    }
    if (best) out.set(String(target.name).toLowerCase(), best);
  }
  return out;
}

/**
 * The live objectives of one ObjectiveMode round. `spec` is the layer's
 * `objectives` report. `hooks`:
 *
 *  - `target(name)` -> `{ hp, maxHp, destroyed, attacker, attackerTeam }`
 *    for the object a named pad last stood up, or null when there is none
 *    (no such pad, or its object is gone);
 *  - `onAward({ player, team, kind })` for a DestroyTarget's pay, `kind` an
 *    `AWARD` value;
 *  - `onWin(team)` when a Composite or a Timer wins the round.
 *
 * `attackerTicketsMod` is the server's percentage (`ATTACKER_TICKETS_MOD`).
 */
export function createObjectives(spec, hooks = {}, { attackerTicketsMod = ATTACKER_TICKETS_MOD } = {}) {
  const entries = Array.isArray(spec?.objectives) ? spec.objectives : [];
  const roots = spec?.roots ?? {};
  const mod = Number.isFinite(Number(attackerTicketsMod)) ? Number(attackerTicketsMod) : ATTACKER_TICKETS_MOD;
  /** Spawner name (lower case) -> its objective's live state. */
  const bySpawner = new Map();
  const list = [];

  function fresh(entry) {
    return {
      spawner: String(entry.spawner ?? ''),
      template: entry.template ?? null,
      kind: entry.kind,
      team: Number(entry.team) || 0,
      delay: Number.isFinite(Number(entry.delay)) ? Number(entry.delay) : 0,
      target: entry.target ?? null,
      members: Array.isArray(entry.members) ? entry.members.map(String) : [],
      timeLimit: Number(entry.timeLimit) || 0,
      objectiveName: entry.objectiveName ?? null,
      // `Objective` +0x10c (the delay clock), +0x114 (done), +0x104 (the
      // completion last asked), Timer +0x11c (its playing time).
      timer: 0,
      done: false,
      elapsed: 0,
      completion: 0,
    };
  }

  for (const entry of entries) {
    if (!entry || !entry.kind || entry.spawner == null) continue;
    const state = fresh(entry);
    bySpawner.set(state.spawner.toLowerCase(), state);
    list.push(state);
  }

  const objectiveOf = name => bySpawner.get(String(name ?? '').toLowerCase()) ?? null;

  /** The Timer's limit: `objectiveAttackerTicketsMod * timeLimit * 0.01`. */
  function limitOf(state) {
    return mod * state.timeLimit * 0.01;
  }

  function completion(state) {
    if (!state) return 0;
    if (state.kind === 'Timer') {
      const limit = limitOf(state);
      state.completion = Math.min(1, limit > 0 ? state.elapsed / limit : 1);
    } else if (state.kind === 'DestroyTarget') {
      const target = state.done ? null : hooks.target?.(state.target) ?? null;
      const max = Number(target?.maxHp);
      state.completion = target && max > 0
        ? 1 - Math.max(0, Number(target.hp) || 0) / max : 1;
    } else if (state.kind === 'ANDComposite') {
      let sum = 0, n = 0;
      for (const member of state.members) {
        const sub = objectiveOf(member);
        if (!sub) continue;
        sum += completion(sub);
        n += 1;
      }
      state.completion = n > 0 ? sum / n : 0;
    }
    return state.completion;
  }

  /** `evaluate`: whether the objective is met this frame. */
  function evaluate(state, dt) {
    if (state.kind === 'Timer') {
      state.elapsed += dt;
      return limitOf(state) < state.elapsed;
    }
    if (state.kind === 'DestroyTarget') {
      const target = hooks.target?.(state.target) ?? null;
      if (!target || !target.destroyed) return false;
      state.attacker = target.attacker ?? null;
      state.attackerTeam = target.attackerTeam ?? 0;
      return true;
    }
    if (state.kind === 'ANDComposite') {
      if (!state.members.length) return false;
      for (const member of state.members) {
        const sub = objectiveOf(member);
        if (!sub || !sub.done) return false;
      }
      return true;
    }
    return false;
  }

  /** The award paid the frame `evaluate` first answers yes. Only a
   *  DestroyTarget pays anything there (the others' `giveVocal` is empty on
   *  the server), and only with a destroyer to pay. */
  function immediateAward(state) {
    if (state.kind !== 'DestroyTarget' || state.attacker == null) return;
    const own = state.attackerTeam === state.team;
    hooks.onAward?.({ player: state.attacker, team: state.attackerTeam,
                      kind: own ? AWARD.objective : AWARD.penalty, objective: state.spawner });
    state.attacker = null;
  }

  /** The award paid when the delay has run: a side's win for a Composite or
   *  a Timer, nothing for a DestroyTarget. */
  function award(state) {
    if (state.kind === 'ANDComposite' || state.kind === 'Timer') hooks.onWin?.(state.team, state);
  }

  /**
   * One frame of every objective (`Objective::handleUpdate`), in spawn order.
   * The caller runs it only while the round plays (`getGameStatus() == 1`).
   * The per-objective rule: done ones do nothing; until its delay clock is
   * past `objectiveDelay` it either asks `evaluate` (clock at 0) or counts
   * the clock on; past it, it is done and pays.
   */
  function tick(dt) {
    if (!(dt > 0)) return;
    for (const state of list) {
      if (!(state.delay < state.timer)) {
        if (state.done) continue;
        if (state.timer <= 0) {
          if (!evaluate(state, dt)) continue;
          immediateAward(state);
          state.timer = dt;
          continue;
        }
        state.timer += dt;
        continue;
      }
      state.done = true;
      state.timer = 0;
      award(state);
    }
  }

  /** `getRootObjective(team)`'s completion, 0 when the side has no root
   *  (the `fldz` at 0x0815207a). */
  function rootCompletion(team) {
    const root = objectiveOf(roots[String(team)]);
    return root ? completion(root) : 0;
  }

  /** `restartMap` destroys every objective and their spawners make them
   *  anew (OBJ-6): a fresh state for each. */
  function reset() {
    for (const state of list) {
      Object.assign(state, { timer: 0, done: false, elapsed: 0, completion: 0, attacker: null, attackerTeam: 0 });
    }
  }

  /** What each objective stands at, for the test hooks and the HUD. */
  function state() {
    return list.map(s => ({
      spawner: s.spawner, kind: s.kind, team: s.team, done: s.done,
      completion: Math.round(completion(s) * 1e4) / 1e4,
      elapsed: Math.round(s.elapsed * 100) / 100, target: s.target,
      objectiveName: s.objectiveName,
    }));
  }

  return {
    get list() { return list; },
    defender: Number(spec?.defender) || 0,
    defenderLoseTicketsOnDeath: !!spec?.defenderLoseTicketsOnDeath,
    attackerLoseTicketsOnDeath: spec?.attackerLoseTicketsOnDeath !== false,
    targets: Array.isArray(spec?.targets) ? spec.targets : [],
    objectiveOf, completion, rootCompletion, tick, reset, state,
  };
}
