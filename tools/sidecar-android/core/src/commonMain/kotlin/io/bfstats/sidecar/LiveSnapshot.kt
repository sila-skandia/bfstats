package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/live-snapshot.mjs; keep in step.
//
// The sidecar's live snapshot: the rows that put a page joining mid-session at
// the current instant (sidecar.mjs sends them on every page connection).
// A module of its own so a node harness can drive it
// (tests/sidecar_live_snapshot_harness.mjs).
//
// What a page needs to JOIN a session that is already running.
//
// It used to be every line recorded so far, replayed on connect. The file is a
// buffered stream, so reading it back missed whatever had not been flushed and
// a page could lose the rows naming the object it controls (live, 2026-10-16),
// so the writer kept the whole stream in memory instead. On a sidecar left
// running that is tens of thousands of rows, and joining replayed the round's
// every event in one burst, which the page then processed as if it were
// happening now: the browser crashed (owner, 2026-10-21). What a page actually
// needs is the CURRENT state, so that is what is kept: the latest row per
// object per kind, and none of the history. Memory is bounded by the object
// count rather than by the length of the round, and `--out` is untouched.
//
// Port notes: a row is a JS object (`Map<String, Any?>`, JsOps.parse's), held by
// reference as the Node copy holds it. JS Map keys that are numbers are
// `JsOps.key` doubles; string keys are built with `JsOps.str`, as the
// template strings build them. LinkedHashMap keeps a re-set key in place, as
// a JS Map does, so the delete-then-set moves below move as they do in Node.

private typealias Row = Map<String, Any?>

private fun Row.at(k: String): Any? = if (containsKey(k)) get(k) else Undefined
private fun Any?.field(k: String): Any? = if (this is Map<*, *> && containsKey(k)) get(k) else Undefined
/** `e[i]` on an entry row. */
private fun Any?.item(i: Int): Any? = if (this is List<*> && i < size) get(i) else Undefined
private fun Any?.list(): List<Any?> = if (this is List<*>) this else emptyList()
private fun k(v: Any?) = JsOps.key(v)
private fun s(v: Any?) = JsOps.str(v)
private fun eq(a: Any?, b: Any?) = JsOps.eq(a, b)
private inline fun or(a: Any?, b: () -> Any?) = JsOps.coalesce(a, b)

class LiveBody(val pid: Any?, val seat: Any?)
class LiveRound(val tid: Any?, val tmpl: Any?)

class Live {
  var head: Row? = null               // k:'h', the recording's own header
  var anim: Row? = null               // k:'anim', the stance table the `st` rows name
  val events = LinkedHashMap<String, Row>()        // `${e}|${pid}` -> the latest state event (serverInfo, setLevel, createPlayer, control)
  val objects = LinkedHashMap<Any?, Row>()         // netId -> the k:'o' row that created it
  val jointRows = LinkedHashMap<String, MutableList<Any?>>() // `${k}|${parent}` -> the k:'j'/'jn' entries naming that parent's children
  val transforms = LinkedHashMap<Any?, Any?>()     // netId -> the k:'s' entry [id, x, y, z, qx, qy, qz, qw]
  val states = LinkedHashMap<Any?, Any?>()         // netId -> the k:'st' entry
  val attrs = LinkedHashMap<Any?, Any?>()          // netId -> the k:'a' entry
  val engines = LinkedHashMap<String, Any?>()      // `${root}|${engine}` -> the k:'g' entry, one per Engine child of a hull
  val outOfScope = LinkedHashSet<Any?>()           // netIds the server took out of this client's scope (k:'d'), still in the world
  val bodies = LinkedHashMap<Any?, LiveBody>()     // soldier netId a man died in -> his pid, until the server destroys it (two of one man's can lie)
  val statics = LinkedHashMap<Any?, MutableMap<String, Any?>>() // bf42++ static id -> its createStatic row, moves and turns folded in
  val rounds = LinkedHashMap<Any?, LiveRound>()    // netId -> { tid, tmpl }: a pooled round, by the newest pool that named it
  val players = LinkedHashMap<Any?, Row>()         // pid -> the k:'ps' row
  val single = LinkedHashMap<String, Row>()        // k -> the latest whole row (tk, win)
  var t = 0.0
  var tick = 0.0
}

// A state event the page must know to render the world it is joining. Anything
// else on the `e` stream is history (a spawn that already happened, a hit mark,
// a hud line) and replaying it is what made the page crash.
// `projPool` is state too: a CreateMultipleObjects names the netIds of a pool
// of rounds and is the only word that they are rounds. A page that joined
// without it took the first grenade thrown for a classless object and stood it
// on the field as a hull (2026-10-22).
// `enterVehicle` too, per player and only while he sits: who is in which
// hull is state. A page that joined after the bots boarded thought every
// crewed enemy hull was empty and marked it on its map, where retail hides a
// hull with an enemy in it (MMAP-3; the owner, 2026-10-22).
// `cp` per control point, `setTeam` per player, and the round's `gameStatus`,
// `gameRules` and `clock`, each the latest only. Without `cp` a page that
// joined after a capture drew every flag at the level's starting side and
// offered spawns at flags the enemy held; the server refused each one, so
// the deploy timer ran out and nothing happened (Wake, 2026-10-22: the US
// held only the Village, the page showed all five).
// `pickupKit` per player: the kit each one carries. A page reloaded mid-life
// drew its own soldier, and every remote one, with no kit the server named.
// `spawnGroups`, the newest: the spawn manager's whole table (each group's
// side, whether a human can spawn on it, its ring), which the server sends
// once at the join and then only where it changes (ghost-writer.mjs).
// `createObject` per netId, while the object lives: the server's object table.
// A page that joined mid-round learnt of a hull only when it came into its
// ghost scope (the `o` row), so its hull-model prewarm missed every hull out of
// scope and the deck wait was all that held a spawn onto an unloaded carrier
// (features/udp-sidecar/browser.md, "The join"). A SetLevel clears them with
// the rest of the old world, and a DestroyObject takes its own. Measured on the
// owner's four 64-player recordings (Midway, Tobruk), at most 715 rows and
// 90 KB, at the end of the world dump; about 300 rows and 40 KB in play.
// `projPool` is kept per round rather than per event (`live.rounds`): the
// server hands a freed pool's netIds to the next pool, which can start
// where the old one did and be shorter, so the newest pool over each id is
// the one that names it.
private val LIVE_EVENTS = setOf("serverInfo", "serverName", "setLevel", "createPlayer", "control", "enterVehicle",
  "cp", "setTeam", "gameStatus", "gameRules", "clock", "pickupKit", "createObject", "spawnGroups")
// The ones whose latest word is moved to the end of the snapshot, so it lands
// after what it amends: a setTeam after its player's createPlayer.
private val LIVE_REORDER = setOf("setTeam", "gameStatus", "gameRules", "clock", "cp", "control", "pickupKit", "spawnGroups")
private val KEEP_AT_LEVEL = Regex("^(serverInfo|serverName|setLevel)\\|")

class LiveState {
  val live = Live()

  fun remember(o: Row) {
    val ot = o.at("t")
    if (JsOps.isFiniteNum(ot) && (ot as Number).toDouble() > live.t) live.t = ot.toDouble()
    when (o.at("k")) {
      "h" -> { live.head = o; return }
      "anim" -> { live.anim = o; return }
      "o" -> {
        live.objects[k(o.at("id"))] = o
        live.outOfScope.remove(k(o.at("id")))
        return
      }
      "d" -> {
        // Out of this client's scope (ghost action 3), not out of the world:
        // the retail client only disables the object (GhostManager::readData
        // 0x08141ed0), and the page keeps what it knows of it -- its class,
        // its side, its hit points, its stance -- and drops only its pose
        // (net-sidecar.js, the 'd' case). A joining page is handed the same:
        // the object's k:"o" and the last of its state, then a k:"d" after
        // all of it. Dropping the k:"o" here lost every kit a player carried
        // out of scope (its template is the kit object's) and every hull's
        // standing damage until it came back.
        val id = k(o.at("id"))
        if (live.objects.containsKey(id)) live.outOfScope.add(id)
        live.transforms.remove(id)
        return
      }
      "s" -> {
        val tick = o.at("tick")
        if (JsOps.isFiniteNum(tick) && (tick as Number).toDouble() > live.tick) live.tick = tick.toDouble()
        for (e in or(o.at("o")) { emptyList<Any?>() }.list()) live.transforms[k(e.item(0))] = e
        return
      }
      "st" -> { for (e in or(o.at("o")) { emptyList<Any?>() }.list()) live.states[k(e.item(0))] = e; return }
      "a" -> { for (e in or(o.at("a")) { emptyList<Any?>() }.list()) live.attrs[k(e.item(0))] = e; return }
      "g" -> {
        // An engine row is `[root, revs, throttle, flags, gear, engine]`, one
        // per Engine child: keyed by the hull alone, a B17's four engines
        // came to a joining page as the last one to change.
        for (e in or(o.at("o")) { emptyList<Any?>() }.list()) {
          live.engines["${s(e.item(0))}|${s(if (JsOps.isInt(e.item(5))) e.item(5) else 0)}"] = e
        }
        return
      }
      "j", "jn" -> {
        for (e in or(o.at("o")) { emptyList<Any?>() }.list()) {
          val key = "${s(o.at("k"))}|${s(e.item(0))}"
          val entries = live.jointRows[key] ?: ArrayList()
          val at = entries.indexOfFirst { eq(it.item(1), e.item(1)) }
          if (at >= 0) entries[at] = e else entries.add(e)
          live.jointRows[key] = entries
        }
        return
      }
      "ps" -> { if (JsOps.isInt(o.at("pid"))) live.players[k(o.at("pid"))] = o; return }
      "tk", "win" -> { live.single[o.at("k") as String] = o; return }
      "e" -> rememberEvent(o)
      // Rounds (k:'f'), deaths (k:'d' handled above as an object row), hud
      // text, projectile pools and every other event: not state.
      else -> return
    }
  }

  private fun rememberEvent(o: Row) {
    val ev = o.at("e")
    val netId = o.at("netId")
    // A new level is a new world: its pools are numbered afresh, and nothing
    // of the old one survives it. A level change is a new connection
    // (RECON-2) whose server never destroys the last session's objects, so
    // a page that connected after a rejoin was handed the old level's
    // players, objects and poses beside the new one's.
    if (ev == "setLevel") {
      for (key in live.events.keys.toList()) if (!KEEP_AT_LEVEL.containsMatchIn(key)) live.events.remove(key)
      live.objects.clear(); live.jointRows.clear(); live.transforms.clear(); live.states.clear(); live.attrs.clear()
      live.engines.clear(); live.outOfScope.clear(); live.bodies.clear(); live.statics.clear(); live.rounds.clear()
      live.players.clear(); live.single.clear()
    }
    // A dead man's body is the soldier he was controlling when his death
    // row came, and it lies until the server destroys that object
    // (net-sidecar.js, the 'score' case; DIE-9). The death row itself is
    // history, so a joining page is told of the body alone (k:"e"
    // e:"body").
    if (ev == "score" && (eq(o.at("kind"), 4) || eq(o.at("kind"), 5)) && JsOps.isInt(o.at("pid"))) {
      val pid = o.at("pid")
      // His control object: the newest `control`, or the one his
      // createPlayer named (the world dump sends no SetDefaultVehicle for
      // a player already alive; net-sidecar.js takes vehNetId the same way).
      val nid = or(live.events["control|${s(pid)}"].field("netId")) { live.events["createPlayer|${s(pid)}"].field("vehNetId") }
      // A man killed in a seat lies in it (DIE-11, net-sidecar.js
      // `bodySeats`), so his row names the seat.
      val seat = live.events["enterVehicle|${s(pid)}"].field("netId")
      // Keyed by the body, as net-sidecar.js keys it: a man killed again
      // inside his first body's 10 s has two lying at once.
      if (JsOps.isInt(nid)) {
        live.bodies.remove(k(nid))
        live.bodies[k(nid)] = LiveBody(pid, if (JsOps.isInt(seat)) seat else null)
      }
    }
    if (ev == "destroyObject") live.bodies.remove(k(netId))
    // A kit object the server destroys (a dead man's, 10 s on) takes its
    // template with it, and the page reads a player's kit from it
    // (net-sidecar.js `kitOf`). The page that saw the pickup keeps the
    // name; the joining page is handed it on the pickup row.
    if (ev == "destroyObject") {
      val tmpl = or(live.events["createObject|${s(netId)}"].field("tmpl")) { live.objects[k(netId)].field("tmpl") }
      if (JsOps.truthy(tmpl)) for ((key, row) in live.events.entries.toList()) {
        if (key.startsWith("pickupKit|") && eq(row.at("netId"), netId) && !JsOps.truthy(row.at("kitTmpl"))) {
          live.events[key] = LinkedHashMap(row).also { it["kitTmpl"] = tmpl }
        }
      }
    }
    if (ev == "destroyPlayer") for ((nid, b) in live.bodies.entries.toList()) if (eq(b.pid, o.at("pid"))) live.bodies.remove(nid)
    // A round that went off is out until its next throw (the ghost writer
    // writes no more samples for it, ghost-writer.mjs): its last pose is
    // not where a joining page should draw it.
    if (ev == "detonate" && JsOps.isInt(o.at("id"))) live.transforms.remove(k(o.at("id")))
    // A round restart without a level load (GameStatus back to 3 from
    // play or the end, ROUND-10): the server resets every control point
    // and sends one again only where it changed, so a point's old row is
    // the last round's (net-sidecar.js clears its sides the same way).
    if (ev == "gameStatus") {
      val was = live.events["gameStatus|"].field("status")
      if (eq(o.at("status"), 3) && (eq(was, 1) || eq(was, 2))) for (key in live.events.keys.toList()) if (key.startsWith("cp|")) live.events.remove(key)
    }
    // bf42++'s server-made statics (wire.md section 30): what the server
    // created for this level, as the page's reconciler reads it
    // (server-statics.js). A move or a turn is folded into its create
    // row; a delete takes it.
    val count = o.at("count")
    // A count that is not a number (a string "3" passed `> 0`) is no pool.
    if (ev == "projPool" && JsOps.isInt(netId) && count is Number && count.toDouble() > 0) {
      // An id the pool takes over is its round now: a k:"o" kept from the
      // object that had the id before names it as the pool does, and
      // carries no class of its own (a joining page reads it as a round,
      // as the page that saw the pool does; net-sidecar.js, 'projPool').
      var i = 0.0
      while (i < Math.min(count.toDouble(), 16.0)) {
        val nid = k((netId as Number).toDouble() + i)
        val tid = or(o.at("tid")) { 0 }
        val tmpl = or(o.at("tmpl")) { "" }
        live.rounds.remove(nid); live.rounds[nid] = LiveRound(tid, tmpl)
        val was = live.objects[nid]
        if (was != null) live.objects[nid] = linkedMapOf("k" to "o", "t" to was.at("t"), "id" to nid, "tid" to tid, "tmpl" to tmpl,
          "team" to or(was.at("team")) { 0 })
        i++
      }
    }
    if ((ev == "destroyObject" || ev == "createObject") && JsOps.isInt(netId)) live.rounds.remove(k(netId))
    if (ev == "createStatic" && JsOps.isInt(o.at("id"))) {
      live.statics.remove(k(o.at("id"))); live.statics[k(o.at("id"))] = LinkedHashMap(o)
    }
    if (ev == "updateStatic" && live.statics.containsKey(k(o.at("id")))) {
      val row = live.statics[k(o.at("id"))]!!
      val action = o.at("action")
      if (action == "delete") live.statics.remove(k(o.at("id")))
      else if (action == "move" && o.at("value") is List<*>) row["pos"] = o.at("value")
      else if (action == "rotate" && o.at("value") is List<*>) row["rot"] = o.at("value")
    }
    // Out of his seat, or gone: the seat row goes, and a player the server
    // destroyed takes his roster row with him.
    if (ev == "exitVehicle") live.events.remove("enterVehicle|${s(o.at("pid"))}")
    if (ev == "destroyPlayer") for (e in listOf("enterVehicle", "createPlayer", "control", "setTeam", "pickupKit")) live.events.remove("$e|${s(o.at("pid"))}")
    if (ev == "destroyObject") for ((key, row) in live.events.entries.toList()) if (key.startsWith("enterVehicle|") && eq(row.at("netId"), netId)) live.events.remove(key)
    // Destroyed: no longer part of the world a page joins. A hull the
    // server re-makes under the same netId (a round restart) comes back
    // into scope with its own k:"o" (ghost-writer.mjs).
    if (ev == "destroyObject") {
      val id = k(netId)
      live.objects.remove(id); live.transforms.remove(id)
      live.states.remove(id); live.attrs.remove(id)
      live.outOfScope.remove(id)
      for (key in live.engines.keys.toList()) if (key.startsWith("${s(netId)}|")) live.engines.remove(key)
      live.events.remove("createObject|${s(netId)}")
    }
    // A netId made again (a round restart re-makes every hull under its
    // old id, ROUND-10) goes to the end, after whatever else names it.
    if (ev == "createObject") live.events.remove("createObject|${s(netId)}")
    // And whatever the old object under that id left behind is not this
    // one's: a k:"o" written before it (tid 0 for a pool's round) would
    // come after this createObject in the snapshot and unname the new
    // object on the joining page.
    if (ev == "createObject") {
      val id = k(netId)
      live.objects.remove(id); live.outOfScope.remove(id)
      live.transforms.remove(id); live.states.remove(id); live.attrs.remove(id)
    }
    if (ev is String && ev in LIVE_EVENTS) {
      val key = "$ev|${s(or(o.at("pid")) { or(netId) { or(o.at("id")) { "" } } })}"
      if (ev in LIVE_REORDER) live.events.remove(key)
      live.events[key] = o
    }
  }

  /** The rows that put a joining page at the current instant: the level and its
   *  players, then every object that exists, then where each one is and what it
   *  is doing. No event, no round, no history. */
  fun liveSnapshot(): List<String> {
    val rows = ArrayList<Any?>()
    live.head?.let { rows.add(it) }
    live.anim?.let { rows.add(it) }
    for (e in live.events.values) rows.add(e)
    // The rounds, as the pools that name them: consecutive ids of one
    // template in one row, at most 15 a row (the wire's own 4-bit count,
    // ledger J-5), in the order their pools came.
    var run: LinkedHashMap<String, Any?>? = null
    for ((nid, r) in live.rounds) {
      if (run != null && nid is Double && nid == (run["netId"] as Double) + (run["count"] as Int) &&
        eq(r.tid, run["tid"]) && eq(r.tmpl, run["tmpl"]) && (run["count"] as Int) < 15) {
        run["count"] = (run["count"] as Int) + 1; continue
      }
      if (run != null) rows.add(run)
      run = linkedMapOf("k" to "e", "t" to live.t, "e" to "projPool", "tid" to r.tid, "tmpl" to r.tmpl, "netId" to nid, "count" to 1)
    }
    if (run != null) rows.add(run)
    for (o in live.objects.values) rows.add(o)
    for ((key, entries) in live.jointRows) {
      val kk = key.split("|")[0]
      rows.add(linkedMapOf("k" to kk, "t" to live.t, "o" to entries))
    }
    if (live.transforms.isNotEmpty()) rows.add(linkedMapOf("k" to "s", "t" to live.t, "tick" to live.tick, "o" to live.transforms.values.toList()))
    if (live.states.isNotEmpty()) rows.add(linkedMapOf("k" to "st", "t" to live.t, "o" to live.states.values.toList()))
    if (live.attrs.isNotEmpty()) rows.add(linkedMapOf("k" to "a", "t" to live.t, "a" to live.attrs.values.toList()))
    if (live.engines.isNotEmpty()) rows.add(linkedMapOf("k" to "g", "t" to live.t, "o" to live.engines.values.toList()))
    for (row in live.statics.values) rows.add(row)
    for ((netId, b) in live.bodies) {
      val row = linkedMapOf<String, Any?>("k" to "e", "t" to live.t, "e" to "body", "pid" to b.pid, "netId" to netId)
      if (!JsOps.nullish(b.seat)) row["seat"] = b.seat
      rows.add(row)
    }
    for (row in live.players.values) rows.add(row)
    for (row in live.single.values) rows.add(row)
    // Last, after every row that could have named them: the objects the
    // server has out of this client's scope.
    for (id in live.outOfScope) rows.add(linkedMapOf("k" to "d", "t" to live.t, "id" to id))
    return rows.map { Js.stringify(it) }
  }
}

fun createLiveState() = LiveState()
