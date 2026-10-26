package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/page-team.mjs; keep in step.
//
// The page's side choice (its `?team=`, the room protocol's `join` row), as
// the sidecar answers it.
//
// Retail's client chooses its side once the server can take it: SetTeam goes
// out from the spawn screen, after the world dump, never during a connect. A
// page may connect at any time, though: during the sidecar's first connect or
// a rejoin, before the server has a player for it. The choice used to be
// refused then and never sent again, so a page that loaded during the connect
// lost its `?team=` (browser.md, "The join"). It is now held, and sent at the
// session's join.
//
// Only before the player has ever spawned: a SetTeam kills whoever it moves,
// and a page carries its `?team=` in the URL, so every hard refresh would
// re-assert it (live, 2026-10-17: the owner, playing Axis, was switched back
// to Allies and killed by a reload alone). A side chosen after the first
// spawn is the deploy screen's business: its `spawn` row carries the team and
// the server changes sides there, where a death is expected.

private fun side(t: Double): Int = if (t == 1.0 || t == 2.0) t.toInt() else 0

/** `{ joined, team, everSpawned }`: whether the server has the player now, the
 *  side it has him on, and whether he has ever deployed. */
class TeamState(val joined: Boolean, val team: Any?, val everSpawned: Boolean)

/**
 * `send(team)` puts the SetTeam on the wire; `log(line)` reports. `offer` is
 * for the page's row and `joined` for each session's join. Each returns what
 * it did: `sent`, `held`, `kept` (a switch now would kill him), `same` or
 * `none`.
 */
class PageTeam(private val send: (Int) -> Unit, private val log: (String) -> Unit = {}) {
  var held = 0
    private set

  private fun apply(team: Int, state: TeamState): String {
    if (team == 0) return "none"
    if (JsOps.eq(team, state.team)) return "same"
    if (state.everSpawned) {
      log("page asked for team $team, keeping ${JsOps.str(state.team)}: a switch now would kill him")
      return "kept"
    }
    send(team)
    return "sent"
  }

  fun offer(team: Any?, state: TeamState): String {
    val t = side(JsOps.toNumber(team))
    if (!state.joined) {
      // The newest page's word wins; a page that names no side clears
      // nothing a page before it asked for.
      if (t != 0) held = t
      if (t != 0) log("page asked for team $t: held until the server has the player")
      return if (t != 0) "held" else "none"
    }
    held = 0
    return apply(t, state)
  }

  fun joined(state: TeamState): String {
    val t = held
    held = 0
    return apply(t, state)
  }
}

fun createPageTeam(send: (Int) -> Unit, log: (String) -> Unit = {}) = PageTeam(send, log)
