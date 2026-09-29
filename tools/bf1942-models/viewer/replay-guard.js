// The replay's frame in stages that cannot stop one another
// (features/round-replay-resilience).
//
// map.html's loop skips the rest of a frame that throws, the render and the
// HUD with it, so one piece of the replay that throws every frame froze the
// whole view, the Escape menu included (the owner, 2026-09-29: "it just
// freezes and I can't quit it"). Each stage of the replay's frame runs here
// instead: a throw is a console warning the first time a stage throws that
// message, the stage's fallback stands in for its value, and the rest of the
// frame draws. A stage that keeps throwing is told so (`streak`), so the
// camera can give up a view it cannot place and a hull can be put away.

/** Frames in a row a stage or an item may throw before its fallback treats
 *  it as broken rather than unlucky. */
export const FAULT_STREAK = 3;

/** Distinct messages a stage warns about before it only counts. */
const WARN_MESSAGES = 6;

export class ReplayGuard {
  constructor(warn = (...args) => console.warn(...args)) {
    this.warn = warn;
    this.stages = new Map();     // name -> { total, streak, seen: Set<message> }
    this.streaks = new WeakMap(); // item -> frames in a row it has thrown
  }

  stage(name) {
    let stage = this.stages.get(name);
    if (!stage) this.stages.set(name, stage = { total: 0, streak: 0, seen: new Set() });
    return stage;
  }

  /** `fn()` as stage `name`: its value, or when it throws `fallback(error,
   *  streak)`'s (a plain `fallback` value as it is). */
  run(name, fn, fallback) {
    const stage = this.stage(name);
    try {
      const value = fn();
      stage.streak = 0;
      return value;
    } catch (error) {
      stage.streak += 1;
      this.note(name, stage, error);
      return typeof fallback === 'function' ? fallback(error, stage.streak) : fallback;
    }
  }

  /** `fn()` for one of many things a stage walks (a hull, a soldier), whose
   *  throws are counted on the thing itself: `onFault(error, streak)` when it
   *  throws, and false; true when it ran. */
  item(name, item, fn, onFault = null) {
    try {
      fn();
      if (this.streaks.has(item)) this.streaks.delete(item);
      return true;
    } catch (error) {
      const streak = (this.streaks.get(item) ?? 0) + 1;
      this.streaks.set(item, streak);
      this.note(name, this.stage(name), error);
      try {
        onFault?.(error, streak);
      } catch (inner) {
        this.note(`${name} (putting it away)`, this.stage(`${name} (putting it away)`), inner);
      }
      return false;
    }
  }

  note(name, stage, error) {
    stage.total += 1;
    const message = String(error?.message ?? error);
    if (stage.seen.has(message) || stage.seen.size >= WARN_MESSAGES) return;
    stage.seen.add(message);
    try {
      this.warn(`replay: ${name} threw; the rest of the frame goes on`, error);
    } catch {
      // A console that cannot take it is no reason to stop.
    }
  }

  /** Every stage that has thrown: `{ name: { total, streak, messages } }`,
   *  for a look from the console (`replay.guard.report()`). */
  report() {
    const out = {};
    for (const [name, stage] of this.stages) {
      if (stage.total) out[name] = { total: stage.total, streak: stage.streak, messages: [...stage.seen] };
    }
    return out;
  }
}

/** Whether every number in `values` is finite. */
export const finite = (...values) => values.every(Number.isFinite);

/** A three.js vector or quaternion with every component finite. */
export function finiteVector(v) {
  return Boolean(v) && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
    && (v.w === undefined || Number.isFinite(v.w));
}
