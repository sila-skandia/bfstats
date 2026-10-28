package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/ghost-writer.mjs; keep in step.
//
// Turn decoded ghost blocks into v5 recording rows the replay viewer reads
// (viewer/replay-recording.js): k:"o" when an object comes into scope, k:"d"
// when it leaves (ghost action 3), k:"s" transform samples, k:"st" soldier
// state rows, k:"a" hull hit points, and k:"f" a round leaving a vehicle gun.
//
// Shared by the live sidecar and the offline rebuild (Rebuild), so both write
// the same file from the same records.

import io.bfstats.sidecar.JsOps.eq
import io.bfstats.sidecar.JsOps.nullish
import io.bfstats.sidecar.JsOps.str
import io.bfstats.sidecar.JsOps.truthy
import io.bfstats.sidecar.ghost.Children
import io.bfstats.sidecar.ghost.Player
import io.bfstats.sidecar.ghost.ScoreManager

object GhostRows {
  // The soldier's camera off his body (BFSoldier::handleUpdate 0x08271f68,
  // ledger VIEW-14): degrees of view pitch per degree of the aimA register,
  // and degrees of view yaw per unit of the twist.
  const val VIEW_PITCH_PER_AIM = 2.5
  const val VIEW_TWIST_PER_AIM = 3.0

  // The soldier's eye over his origin by pose, up his body's axis: the
  // template's `setPoseCameraPos` (ledger VIEW-14).
  val EYE_HEIGHT = linkedMapOf("stand" to 0.65, "crouch" to 0.12, "prone" to -0.7)
  // An upper-body state that fires (`Ub_Fire`, `Ub_LieFireNo4Sniper`, ...),
  // as the page reads it (net-sidecar.js isFireState).
  val FIRE_STATE = Regex("^Ub_(Lie|Crouch)?Fire")

  class Fit(val k: Double, val goBack: Boolean)

  /** How many ticks ago a round left, from the recoil counter `counter` seen
   *  `ticks` after the last state: 19 - k for a weapon that goes back, 7 - k
   *  for one that keeps its kick (0 <= k < ticks). `goBack` is preferred when
   *  both fit. null when neither fits. */
  fun recoilAgo(counter: Double, ticks: Double, goBack: Boolean? = null): Fit? {
    val fits = listOf(Fit(19 - counter, true), Fit(7 - counter, false)).filter { it.k >= 0 && it.k < ticks }
    if (fits.isEmpty()) return null
    return fits.find { it.goBack == goBack } ?: fits.sortedBy { it.k }[0]
  }

  /** animName for GhostWriter from a run's `anim` table ([[index, name, ...]]),
   *  read through `table()` each time so a table replaced at a level change is
   *  the one used. */
  fun animNamer(table: () -> Any?): (Any?) -> Any? {
    var seen: Any? = null
    var seenSet = false
    var byIndex = HashMap<Any?, Any?>()
    return { i ->
      val tb = table()
      if (!seenSet || tb !== seen) {
        seen = tb; seenSet = true
        byIndex = HashMap()
        for (e in (tb as? List<*>) ?: emptyList<Any?>()) { val a = e as? List<*>; byIndex[JsOps.key(a?.getOrNull(0) ?: Undefined)] = a?.getOrNull(1) ?: Undefined }
      }
      val v = if (byIndex.containsKey(JsOps.key(i))) byIndex[JsOps.key(i)] else Undefined
      if (nullish(v)) "" else v
    }
  }

  val PLAYER_STATS = listOf("kills", "deaths", "teamKills", "captures", "attacks", "defences", "objectives", "objectiveTeamKills", "ping")

  /** The ammunition of the guns of the object this client controls, from its
   *  control-object state: `[[gunTemplate, rounds, magazines], ...]` per
   *  FireArms child in the template's order, or null when it has none
   *  (FireArmsNetworkable::getNetUpdate 0x08228e50 writes each plus one;
   *  ledger SEAT-36). Each field is carried forward from `prev`. */
  fun controlMagazines(children: Any?, tmpl: Any?, seat: Double = 0.0, prev: Any? = null): MutableList<Any?>? {
    val fires = (children as? List<*>)?.filter { it.g("type") == "F" } ?: emptyList<Any?>()
    if (fires.isEmpty()) return null
    return fires.mapIndexedTo(ArrayList<Any?>()) { i, f ->
      val before = JsOps.at(prev, i.toDouble()).let { if (nullish(it)) null else it }
      val magA = f.g("magA"); val magB = f.g("magB")
      val rounds = if (JsOps.isFiniteNum(magA)) JsOps.num(magA)!! - 1 else JsOps.at(before, 1.0).let { if (nullish(it)) null else it }
      val mags = if (JsOps.isFiniteNum(magB)) JsOps.num(magB)!! - 1 else JsOps.at(before, 2.0).let { if (nullish(it)) null else it }
      val name = Children.gunFor(tmpl, seat, i.toDouble()).name ?: JsOps.at(before, 0.0).let { if (nullish(it)) null else it }
      mutableListOf(name, rounds, mags)
    }
  }

  // Keep the last few seconds of a per-object history (poses, aims), enough
  // for a round dated one interval back (a tank gun's 2.86 s, an Aichi Val's
  // bomb rack 5.03 s, a torpedo's 10.03 s).
  private const val HISTORY = 11.0
  fun <E : Timed> pushRecent(map: HashMap<Any?, ArrayList<E>>, key: Any?, entry: E, t: Double) {
    val l = map.getOrPut(key) { ArrayList() }
    l.add(entry)
    while (l.size > 2 && l[0].t < t - HISTORY) l.removeAt(0)
  }
  // The entry in force at `t`: the last at or before it, else the first after.
  fun <E : Timed> recentAt(list: List<E>?, t: Double): E? {
    if (list.isNullOrEmpty()) return null
    var best: E? = null
    for (e in list) { if (e.t <= t + 1e-6) best = e else break }
    return best ?: list[0]
  }
  interface Timed { val t: Double }

  fun qNlerp(a: DoubleArray, b: DoubleArray, f: Double): DoubleArray {
    if (f == 0.0) return a
    val s = if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) -1.0 else 1.0
    val q = DoubleArray(4) { i -> a[i] + (s * b[i] - a[i]) * f }
    val n = JsOps.hypot(*q).let { if (it == 0.0 || it.isNaN()) 1.0 else it }
    return DoubleArray(4) { q[it] / n }
  }
  fun qMul(a: DoubleArray, b: DoubleArray): DoubleArray {
    val (ax, ay, az, aw) = a.toList(); val (bx, by, bz, bw) = b.toList()
    return doubleArrayOf(aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz)
  }
  fun qRotate(q: DoubleArray, v: DoubleArray): DoubleArray {
    val x = q[0]; val y = q[1]; val z = q[2]; val w = q[3]; val vx = v[0]; val vy = v[1]; val vz = v[2]
    val tx = 2 * (y * vz - z * vy); val ty = 2 * (z * vx - x * vz); val tz = 2 * (x * vy - y * vx)
    return doubleArrayOf(vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx))
  }
}

/** write(row) appends one recording row; objInfo is netId -> {tid, tmpl, team}.
 *  animName(i) names an animation state (the run's `anim` table), for a
 *  soldier's stance and fire state; without it every soldier is standing. */
class GhostWriter(
  val write: (MutableMap<String, Any?>) -> Unit,
  val objInfo: MutableMap<Any?, MutableMap<String, Any?>>,
  val cpNames: Any? = LinkedHashMap<String, Any?>(),
  val animName: ((Any?) -> Any?)? = null,
) {
  private fun k(v: Any?) = JsOps.key(v)
  private fun d(v: Any?): DoubleArray = (v as List<*>).let { l -> DoubleArray(l.size) { JsOps.num(l[it]) ?: Double.NaN } }
  private fun fx(v: Double, n: Int) = JsOps.toFixed(v, n)

  val stance = SoldierStateTracker()
  val inScope = LinkedHashSet<Any?>()
  val hp = HashMap<Any?, Any?>()          // netId -> last hit points written
  val cpTeam = HashMap<Any?, Any?>()      // control point netId -> last side written
  var spawnGroups: MutableList<MutableList<Any?>>? = null // the spawn manager's table by group ordinal
  val tickets = mutableListOf<Any?>(null, null)
  var ticketsKey: String? = null
  val result = mutableListOf<Any?>(0.0, 0.0)    // the ScoreManager's winner and victory type
  val roundsWon = mutableListOf<Any?>(0.0, 0.0) // each side's rounds won (ints 10 and 21)
  var resultKey: String? = null
  val playerPid = HashMap<Any?, Any?>()   // a BFPlayer's netId -> pid
  val playerKey = HashMap<Any?, MutableMap<String, Any?>>() // pid -> last 'ps' row written
  val mags = HashMap<String, Any?>()      // `${netId}:${fireArmsIndex}` -> last magA
  val lastStep = HashMap<String, Double>()
  class JointState(var x: Double, var y: Double)
  val jointState = HashMap<String, JointState>()
  val engineState = HashMap<String, MutableMap<String, Any?>>()
  val jointNamed = HashSet<String>()
  val jointLast = HashMap<String, String>()
  val occupant = LinkedHashMap<Any?, Any?>() // controlled netId -> pid
  class Seated(val t: Any?, val pid: Any?)
  val seated = HashMap<Any?, ArrayList<Seated>>() // controlled netId -> [{ t, pid | null }]
  val soldier = HashMap<Any?, Any?>()     // pid -> his on-foot soldier's netId
  val camera = HashMap<Any?, Any?>()      // pid -> his free camera's netId
  class Pose(override val t: Double, val pos: DoubleArray, val q: DoubleArray, override val tick: Double? = null) : Ticked
  val poses = HashMap<Any?, ArrayList<Pose>>()
  // The server tick of the block being read (block), kept with each pose and aim.
  private var blockTick: Double? = null
  interface Ticked : GhostRows.Timed { val tick: Double? }
  class Fire(
    val tick: Double?, val pos: DoubleArray?, val q: DoubleArray?, val pitch: Double, val twist: Double, val stance: String,
    val fire: Boolean, var eye: Double, val counter: Double, var goBack: Boolean?, var prev: Fire?,
  )
  val fireTrack = HashMap<Any?, Fire>()
  class Aim(override val t: Double, val yaw: Double, val pitch: Double, override val tick: Double? = null) : Ticked
  val aims = HashMap<Any?, ArrayList<Aim>>()
  class RoundState(var inactive: Boolean, var reset: Any?, var u4: Any?)
  val roundState = HashMap<Any?, RoundState>()
  val stats = linkedMapOf<String, Any?>("objects" to 0.0, "samples" to 0.0, "stances" to 0.0, "hp" to 0.0, "fires" to 0.0, "scopeOuts" to 0.0, "detonations" to 0.0)
  private fun bump(s: String) { stats[s] = (stats[s] as Double) + 1 }

  /** Event rows, for who sits where. Returns the event rows to write after
   *  this one: getting out of a vehicle hands the player back his soldier
   *  (the server sends no SetDefaultVehicle for that). `derived` marks a row
   *  the server never sent. */
  fun note(row: Any?, t: Any? = row.g("t")): MutableList<MutableMap<String, Any?>> {
    if (row !is Map<*, *>) return ArrayList()
    val extra = ArrayList<MutableMap<String, Any?>>()
    val e = row.g("e")
    val pid = row.g("pid")
    val netId = row.g("netId")
    // A new level (or a rejoin of this one) sends the spawn manager whole
    // again, and that first send must be written even where it matches.
    if (e == "setLevel") spawnGroups = null
    if (e == "createPlayer") {
      if (!nullish(row.g("camNetId"))) camera[k(pid)] = row.g("camNetId")
      if (!nullish(netId)) playerPid[k(netId)] = pid
      // What he controls as we join (`vehNetId`): a player already alive when
      // the sidecar joins gets no control event until he next spawns or boards
      // (Midway, 2026-10-24: 500 of a bot's rounds dropped).
      val veh = row.g("vehNetId")
      if (truthy(veh) && !eq(veh, row.g("camNetId"))) {
        soldier[k(pid)] = veh
        leave(pid, t)
        sit(veh, pid, t)
      }
    } else if (e == "control") {
      if (!nullish(netId) && !eq(netId, camera[k(pid)] ?: Undefined)) soldier[k(pid)] = netId
      else soldier.remove(k(pid))
    } else if (e == "destroyPlayer") {
      soldier.remove(k(pid))
    } else if (e == "exitVehicle" && !truthy(row.g("flag")) && soldier.containsKey(k(pid))) {
      extra.add(linkedMapOf("e" to "control", "pid" to pid, "netId" to soldier[k(pid)], "derived" to 1.0))
    }
    // A map reset (ResetMapEvent) empties this client's ghost scope (Wake,
    // 2026-10-16).
    if (e == "raw" && row.g("name") == "ResetMap") {
      for (id in inScope) { bump("scopeOuts"); write(linkedMapOf("k" to "d", "t" to t, "id" to id)); hp.remove(k(id)) }
      inScope.clear()
    }
    // A destroyed object takes its scope with it (GhostManager::readData:
    // action 3 clears `+0xc` at 0x08141fae; a CreateObject under the same
    // netId is a fresh object, created disabled; Wake, 2026-10-24).
    if (e == "destroyObject" && !nullish(netId)) {
      roundState.remove(k(netId))
      if (inScope.remove(k(netId))) { bump("scopeOuts"); write(linkedMapOf("k" to "d", "t" to t, "id" to netId)) }
      hp.remove(k(netId))
      poses.remove(k(netId))
    }
    if (e == "enterVehicle" || e == "control") {
      leave(pid, t)
      if (!nullish(netId)) sit(netId, pid, t)
    } else if (e == "exitVehicle" || e == "destroyPlayer") {
      leave(pid, t)
    }
    return extra
  }

  private fun sit(nid: Any?, pid: Any?, t: Any?) {
    occupant[k(nid)] = pid
    seated.getOrPut(k(nid)) { ArrayList() }.add(Seated(t, pid))
  }

  private fun leave(pid: Any?, t: Any?) {
    val it = occupant.entries.iterator()
    while (it.hasNext()) {
      val (nid, p) = it.next()
      if (!eq(p, pid)) continue
      it.remove()
      seated[nid]?.add(Seated(t, null))
    }
  }

  // Who sat in `nid` at time `t`.
  private fun occupantAt(nid: Any?, t: Double): Any? {
    var pid: Any? = null
    for (s in seated[k(nid)] ?: emptyList<Seated>()) {
      val st = JsOps.num(s.t) ?: Double.NaN
      if (!(st <= t)) break
      pid = s.pid
    }
    return pid
  }

  /** `tick` is the server's own tick for the block (the ghost header's u32,
   *  30 a second): the time the samples describe. */
  fun block(t: Double, records: List<MutableMap<String, Any?>>, tick: Any? = null) {
    // The block's tick rides each pose and aim kept for the rounds (fires).
    blockTick = if (JsOps.isInt(tick)) JsOps.num(tick) else null
    val moved = ArrayList<Any?>()
    val stances = ArrayList<Any?>()
    val hps = ArrayList<Any?>()
    val joints = ArrayList<Any?>()
    val named = ArrayList<Any?>()
    val engines = ArrayList<Any?>()
    for (r in records) {
      val netId = r.g("netId")
      val action = r.g("action")
      // Action 3: the server took the object out of this client's scope
      // (GhostManager::readData 0x08141ed0 calls disableObject).
      if (eq(action, 3.0)) {
        if (inScope.remove(k(netId))) { bump("scopeOuts"); write(linkedMapOf("k" to "d", "t" to t, "id" to netId)) }
        // The next hit points for it are written again even when unchanged.
        hp.remove(k(netId))
        continue
      }
      if (!eq(action, 1.0)) continue
      // A seat is drawn as part of its hull, so it gets no k:"o" of its own;
      // a seat in scope keeps its hull drawn.
      val seat = r.g("seat")
      val shown = if (truthy(seat)) seat.g("root") else netId
      val scopeIn = !inScope.contains(k(shown))
      if (!inScope.contains(k(shown)) && (!truthy(seat) || objInfo.containsKey(k(shown)))) {
        inScope.add(k(shown))
        val inf = objInfo[k(shown)] ?: linkedMapOf("tid" to 0.0, "tmpl" to "", "team" to 0.0)
        bump("objects")
        val row = linkedMapOf<String, Any?>("k" to "o", "t" to t, "id" to shown, "tid" to JsOps.get(inf, "tid"), "tmpl" to JsOps.get(inf, "tmpl"), "team" to JsOps.get(inf, "team"))
        if (truthy(r.g("cls")) && !truthy(seat)) row["cls"] = r.g("cls")
        write(row)
      }
      val cls = r.g("cls")
      val body = r.g("body").let { if (it === Undefined) null else it }
      // A round's end is its own word, and the client keeps its own copy of
      // whether the round is out (ProjectileNetworkable::setNetUpdate
      // 0x08232be0; the reset bool Projectile+0x10d, the detonate bool +0x10e;
      // resetProjectile 0x082331e8 / 0x08232edc, activate 0x08233202 /
      // 0x0823305a, Projectile::detonate 0x08233032 and its +0x10d test
      // 0x0831e688). An out round gets no samples: it is in its pool.
      if (cls == "ProjectileNetworkable" && truthy(body)) {
        val b = body!!
        val was = roundState[k(netId)]
        val s = was ?: RoundState(true, false, null)
        if (!nullish(b.g("reset"))) s.reset = b.g("reset")
        val counted = !nullish(b.g("u4")) && !nullish(s.u4) && !eq(b.g("u4"), s.u4)
        if (!nullish(b.g("u4"))) s.u4 = b.g("u4")
        if (scopeIn || was == null) s.inactive = truthy(s.reset)
        else {
          if (counted) s.inactive = true
          if (!truthy(s.reset)) s.inactive = false
        }
        if ((JsOps.toInt32(JsOps.num(b.g("mask")) ?: 0.0) and 0x08) != 0 && b.g("detonate") == true && !s.inactive) {
          s.inactive = true
          bump("detonations")
          // Where it went off: this body's position, else the last it had.
          val p: DoubleArray? = r.g("pos").let { if (!nullish(it)) d(it) else poses[k(netId)]?.lastOrNull()?.pos }
          val row = linkedMapOf<String, Any?>("k" to "e", "t" to t, "e" to "detonate", "id" to netId)
          if (p != null) row["pos"] = mutableListOf<Any?>(fx(p[0], 3), fx(p[1], 3), fx(p[2], 3))
          write(row)
        }
        roundState[k(netId)] = s
        if (s.inactive) continue
      }
      val rpos = r.g("pos")
      if (truthy(rpos)) {
        bump("samples")
        val rr = r.g("rot")
        val q = if (truthy(rr)) d(rr) else doubleArrayOf(0.0, 0.0, 0.0, 1.0)
        val p = d(rpos)
        GhostRows.pushRecent(poses, k(netId), Pose(t, p, q, blockTick), t)
        // Millimetres, the wire's own resolution (wire.md section 16).
        moved.add(mutableListOf<Any?>(netId, fx(p[0], 3), fx(p[1], 3), fx(p[2], 3), fx(q[0], 4), fx(q[1], 4), fx(q[2], 4), fx(q[3], 4)))
      }
      if (!truthy(body)) continue
      val b = body.asObj()!!
      if (cls == "BFSoldierNetworkable") {
        val row = stance.update(netId, b)
        if (row != null) { bump("stances"); stances.add(row) }
        handFire(t, r, b, tick)
        if (!nullish(b["hp"]) && !eq(hp[k(netId)] ?: Undefined, b["hp"])) {
          hp[k(netId)] = b["hp"]
          bump("hp")
          hps.add(mutableListOf(netId, b["hp"]))
        }
        continue
      }
      // Both sides' tickets (the ScoreManager's ints 9 and 20): the replay's
      // `tk` row, written when either moves.
      if (cls == "ScoreManager") {
        val ints = b["ints"]
        for ((team, i) in ScoreManager.TICKETS) { val v = JsOps.at(ints, i.toDouble()); if (!nullish(v)) tickets[team.toInt() - 1] = v }
        val key = tickets.joinToString(",") { if (nullish(it)) "" else str(it) }
        if (key != ticketsKey && tickets.all { !nullish(it) }) {
          ticketsKey = key
          write(linkedMapOf("k" to "tk", "t" to t, "v" to tickets.toMutableList()))
        }
        // The round's result: setWinner (0x08161b80) writes +0x5c and
        // setVictoryType (0x08161be0) +0x5d, and setNetUpdate (0x08162770)
        // reads mask bits 22 and 23 into exactly those two bytes. A 3-bit
        // signed read holds `none` (4) as -4, hence the & 7.
        val bytes = b["bytes"]
        JsOps.at(bytes, 0.0).let { if (!nullish(it)) result[0] = (JsOps.toInt32(JsOps.toNumber(it)) and 7).toDouble() }
        JsOps.at(bytes, 1.0).let { if (!nullish(it)) result[1] = (JsOps.toInt32(JsOps.toNumber(it)) and 7).toDouble() }
        for ((team, i) in ScoreManager.ROUNDS_WON) { val v = JsOps.at(ints, i.toDouble()); if (!nullish(v)) roundsWon[team.toInt() - 1] = v }
        val res = "${str(result)}|${str(roundsWon)}"
        if (res != resultKey) {
          resultKey = res
          write(linkedMapOf("k" to "win", "t" to t, "w" to result[0], "vt" to result[1], "rw" to roundsWon.toMutableList()))
        }
        continue
      }
      // A player's stats and medals (BFPlayer::setNetUpdate 0x08053a40): one
      // row whenever any of them moves (ghost/player, THE STAT BLOCK;
      // GameServer::giveMedal 0x081533f0 for the medals).
      if (cls == "BFPlayer" && playerPid.containsKey(k(netId))) {
        val pid = playerPid[k(netId)]
        val prev: MutableMap<String, Any?> = playerKey[k(pid)] ?: LinkedHashMap<String, Any?>().also { p ->
          p["sc"] = 0.0; p["md"] = mutableListOf<Any?>(0.0, 0.0, 0.0); for (s in GhostRows.PLAYER_STATS) p[s] = 0.0
        }
        fun cz(v: Any?, d: Any?) = if (nullish(v)) d else v
        val pmd = prev["md"] as List<*>
        val now = linkedMapOf<String, Any?>(
          "sc" to cz(JsOps.get(b, Player.STAT_FIELDS["score"]!!), JsOps.get(prev, "sc")),
          "md" to mutableListOf(cz(JsOps.get(b, "score_e8"), pmd[0]), cz(JsOps.get(b, "score_ec"), pmd[1]), cz(JsOps.get(b, "score_f0"), pmd[2])),
        )
        for (s in GhostRows.PLAYER_STATS) now[s] = cz(JsOps.get(b, Player.STAT_FIELDS[s]!!), JsOps.get(prev, s))
        // The respawn wait (+0x8c): the server's own TIME TO SPAWN, whole
        // seconds. Only once a body has carried it.
        val sw = cz(JsOps.get(b, "spawnWait"), JsOps.get(prev, "sw"))
        if (!nullish(sw)) now["sw"] = sw
        val nmd = now["md"] as List<*>
        if (!eq(now["sc"], prev["sc"]) || !eq(JsOps.get(now, "sw"), JsOps.get(prev, "sw")) || nmd.indices.any { !eq(nmd[it], pmd[it]) } ||
            GhostRows.PLAYER_STATS.any { !eq(now[it], JsOps.get(prev, it)) }) {
          playerKey[k(pid)] = now
          val row = linkedMapOf<String, Any?>("k" to "ps", "t" to t, "pid" to pid)
          row.putAll(now)
          row["md"] = nmd.toMutableList()
          write(row)
        }
        continue
      }
      // The spawn manager's groups (ghost/spawn-manager): the whole table
      // whenever any entry moves, so a row is the state.
      if (cls == "SpawnPointManager") {
        val n = JsOps.num(b["n"]) ?: Double.NaN
        if (spawnGroups == null || spawnGroups!!.size.toDouble() != n) spawnGroups = MutableList(if (n.isNaN() || n < 0) 0 else n.toInt()) { mutableListOf<Any?>(0.0, 0.0, 0.0, 0.0) }
        var changed = false
        for (row in b["rows"] as List<*>) {
          val (i, team, active, qx, qz) = row as List<*>
          val g = spawnGroups!![(i as Double).toInt()]
          if (!eq(g[0], team) || !eq(g[1], active) || !eq(g[2], qx) || !eq(g[3], qz)) { spawnGroups!![i.toInt()] = mutableListOf(team, active, qx, qz); changed = true }
        }
        if (changed) write(linkedMapOf("k" to "e", "t" to t, "e" to "spawnGroups", "netId" to netId, "n" to b["n"],
          "g" to spawnGroups!!.mapTo(ArrayList<Any?>()) { it.toMutableList() }))
        continue
      }
      // A control point's side (ControlPointNetworkable's team field): the
      // replay's `cp` row, which it reads as the flag's state and captures.
      if (cls == "ControlPointNetworkable" && !nullish(b["team"]) && !eq(cpTeam[k(netId)] ?: Undefined, b["team"])) {
        cpTeam[k(netId)] = b["team"]
        val inf = objInfo[k(netId)]
        val row = linkedMapOf<String, Any?>("k" to "e", "t" to t, "e" to "cp", "id" to netId, "team" to b["team"])
        val tmpl = inf?.let { JsOps.get(it, "tmpl") }
        if (truthy(tmpl)) { row["tmpl"] = tmpl; row["name"] = GameTables.cpNameOf(cpNames, tmpl).let { if (nullish(it)) tmpl else it } }
        write(row)
        continue
      }
      if (cls == "SimpleObjectNetworkable" && !nullish(b["hp"]) && !eq(hp[k(netId)] ?: Undefined, b["hp"])) {
        hp[k(netId)] = b["hp"]
        bump("hp")
        hps.add(mutableListOf(netId, b["hp"]))
      }
      if (cls == "SimpleObjectNetworkable" || cls == "Seat") { joints(t, r, b, joints, named); fires(t, r, b); engines(t, r, b, engines) }
    }
    // The block's tick rides every row a page times a sample by (the `s`,
    // `st` and `j` rows).
    fun at(m: MutableMap<String, Any?>): MutableMap<String, Any?> { if (JsOps.isInt(tick)) m["tick"] = tick; return m }
    if (moved.isNotEmpty()) write(at(linkedMapOf("k" to "s", "t" to t)).also { it["o"] = moved })
    if (stances.isNotEmpty()) write(at(linkedMapOf("k" to "st", "t" to t)).also { it["o"] = stances })
    if (hps.isNotEmpty()) write(linkedMapOf("k" to "a", "t" to t, "a" to hps))
    if (named.isNotEmpty()) write(linkedMapOf("k" to "jn", "t" to t, "o" to named))
    if (joints.isNotEmpty()) write(at(linkedMapOf("k" to "j", "t" to t)).also { it["o"] = joints })
    if (engines.isNotEmpty()) write(linkedMapOf("k" to "g", "t" to t, "o" to engines))
  }

  /** The hit points of the hull this client drives, from its control-object
   *  state (wire.md section 41; lab, 2026-10-25), as the ghost's own k:"a" row,
   *  deduplicated against it. */
  fun controlHp(t: Any?, netId: Any?, hpv: Any?): Boolean {
    if (!JsOps.isInt(netId) || !JsOps.isFiniteNum(hpv) || eq(hp[k(netId)] ?: Undefined, hpv)) return false
    hp[k(netId)] = hpv
    bump("hp")
    write(linkedMapOf("k" to "a", "t" to t, "a" to mutableListOf<Any?>(mutableListOf(netId, hpv))))
    return true
  }

  // A hull's engines, as the recorder's own `g` rows
  // (`[root, revs, throttle, flags, gear, engine]`, flags 1 running /
  // 2 disabled), one entry per `E` child in template tree order. On the wire:
  // EngineNetworkable::updateStateMask (0x08227620), setNetUpdate
  // (0x08227da0), PHY-30. The revs are 80% of the server's (TANK-12), passed on
  // as they arrive. There is no throttle on the wire, so it is null.
  private fun engines(t: Double, r: Map<String, Any?>, b: Map<String, Any?>, out: MutableList<Any?>) {
    val seat = r.g("seat")
    val root = if (truthy(seat)) seat.g("root") else r.g("netId")
    var ei = 0
    for (c in (b["children"] as? List<*>) ?: emptyList<Any?>()) {
      if (c.g("type") != "E") continue
      val i = ei++
      if (nullish(c.g("revs")) && nullish(c.g("running")) && nullish(c.g("disabled")) && nullish(c.g("gear"))) continue
      val key = "${str(r.g("netId"))}:$i"
      val prev = engineState[key] ?: linkedMapOf("revs" to 0.0, "wire" to null, "disabled" to false, "gear" to 0.0)
      fun cz(v: Any?, d: Any?) = if (nullish(v)) d else v
      val revs = cz(c.g("revs"), prev["revs"])
      // Mask bit 0x004 is sent only when it CHANGES: where the wire has not
      // said, the revs say it (held at 0 while `Engine+0x142` is clear, PHY-14).
      val now = linkedMapOf<String, Any?>("revs" to revs, "wire" to cz(c.g("running"), prev["wire"]), "disabled" to cz(c.g("disabled"), prev["disabled"]), "gear" to cz(c.g("gear"), prev["gear"]))
      now["running"] = if (nullish(now["wire"])) !eq(revs, 0.0) else now["wire"]
      val nr = JsOps.num(now["revs"]) ?: Double.NaN; val pr = JsOps.num(prev["revs"]) ?: Double.NaN
      if (Math.abs(nr - pr) < 0.001 && eq(now["running"], JsOps.get(prev, "running")) && eq(now["disabled"], prev["disabled"]) && eq(now["gear"], prev["gear"])) continue
      engineState[key] = now
      out.add(mutableListOf(root, fx(nr, 3), null, ((if (truthy(now["running"])) 1 else 0) or (if (truthy(now["disabled"])) 2 else 0)).toDouble(), now["gear"], i.toDouble()))
    }
  }

  // A turret's traverse and a gun's elevation (the R children's angles,
  // readSignedFloat(16) * 180), as the replay's joint rows: a yaw part turns
  // about Y by angleX, a pitch part by angleY about X on top of the part
  // before it.
  private fun joints(t: Double, r: Map<String, Any?>, b: Map<String, Any?>, joints: MutableList<Any?>, named: MutableList<Any?>) {
    val seatV = r.g("seat")
    val root = if (truthy(seatV)) seatV.g("root") else r.g("netId")
    val seat = if (truthy(seatV)) JsOps.num(seatV.g("seat")) ?: Double.NaN else 0.0
    val tmpl = objInfo[k(root)]?.let { JsOps.get(it, "tmpl") }.let { if (nullish(it)) null else it }
    val parts = Children.jointPartsFor(tmpl, seat) as? List<*> ?: return
    val bundles = ((b["children"] as? List<*>) ?: emptyList<Any?>()).filter { it.g("type") == "R" }
    var yaw: Double
    var prevQ: DoubleArray? = null
    val aimKey = "${str(root)}:${str(seat)}"
    for ((i, part) in parts.withIndex()) {
      val pl = part as List<*>
      val name = pl.getOrNull(0)
      val role = pl.getOrNull(1)
      val rest = pl.getOrNull(2).let { if (it == null && pl.size <= 2 || it === Undefined) 0.0 else it }
      val values = bundles.getOrNull(i).g("values").let { if (nullish(it)) emptyList<Any?>() else it as List<*> }
      val key = "${str(root)}:${str(seat)}:$i"
      val st = jointState[key] ?: JointState(0.0, 0.0)
      values.getOrNull(0).let { if (!nullish(it)) st.x = JsOps.num(it)!! * 180 }
      values.getOrNull(1).let { if (!nullish(it)) st.y = JsOps.num(it)!! * 180 }
      jointState[key] = st
      val rad = Math.PI / 180
      // Each part rides the one before it (a gun base on its tower, a
      // Daihatsu's outer ramp leaf on its inner one).
      val local: DoubleArray
      if (role == "yaw") {
        yaw = JsOps.toNumber(rest) + st.x
        local = doubleArrayOf(0.0, JsOps.sin(yaw * rad / 2), 0.0, JsOps.cos(yaw * rad / 2))
      } else local = doubleArrayOf(JsOps.sin(st.y * rad / 2), 0.0, 0.0, JsOps.cos(st.y * rad / 2))
      val q = prevQ?.let { GhostRows.qMul(it, local) } ?: local
      prevQ = q
      val nid = 1000 + seat * 10 + i
      val nk = "${str(root)}:${str(nid)}"
      if (jointNamed.add(nk)) named.add(mutableListOf(root, nid, name))
      val row = mutableListOf<Any?>(root, nid, fx(q[0], 4), fx(q[1], 4), fx(q[2], 4), fx(q[3], 4))
      val k2 = row.joinToString(",") { if (nullish(it)) "" else str(it) }
      if (jointLast[nk] == k2) continue
      jointLast[nk] = k2
      joints.add(row)
    }
    // The seat's aim as of this record (its yaw part's traverse and its pitch
    // part's elevation), for the rounds it fires.
    val yawSt = jointState["$aimKey:0"]; val pitchSt = jointState["$aimKey:1"]
    GhostRows.pushRecent(aims, aimKey, Aim(t, yawSt?.x ?: 0.0, pitchSt?.y ?: 0.0, blockTick), t)
  }

  // A round from a soldier's hand weapon, read off bits 8-12 of his state
  // bits: his recoil ride's counter (BFSoldier +0x544, `recoil.js`), which
  // `getRecoilState` (0x0827e280) packs there; `calcRecoil` arms it at 20
  // (goes back) or 8 (keeps its kick) and `handlePlayerInput` takes one off a
  // tick (wire.md section 44). A weapon with no recoil is read off his upper
  // body entering a fire state. The line is the server's (lab, 2026-10-25):
  // the view of the tick before the round's, from his `setPoseCameraPos` eye.
  private fun handFire(t: Double, r: Map<String, Any?>, b: Map<String, Any?>, tick: Any?) {
    val netId = r.g("netId")
    val last = stance.last[k(netId)]
    val bits = last?.bits.let { if (nullish(it)) b["stateBits"] else it }
    val P = fireTrack[k(netId)]
    val lower = str(animName?.invoke(last?.lower ?: Undefined).let { if (nullish(it)) "" else it })
    val upper = str(animName?.invoke(last?.upper ?: Undefined).let { if (nullish(it)) "" else it })
    val st = if (Regex("Lie|Crawl").containsMatchIn(lower)) "prone" else if (lower.contains("Crouch")) "crouch" else "stand"
    val tk = if (JsOps.isInt(tick)) JsOps.num(tick) else null
    val rpos = r.g("pos"); val rrot = r.g("rot")
    val bitsN = if (nullish(bits)) null else JsOps.toNumber(bits)
    val cur = Fire(
      tick = tk, pos = if (!nullish(rpos)) d(rpos) else P?.pos, q = if (!nullish(rrot)) d(rrot) else P?.q,
      pitch = last?.pitch ?: 0.0, twist = last?.twist ?: 0.0, stance = st, fire = GhostRows.FIRE_STATE.containsMatchIn(upper),
      eye = GhostRows.EYE_HEIGHT[st]!!, counter = if (bitsN != null) ((JsOps.toInt32(bitsN) shr 8) and 0x1f).toDouble() else (P?.counter ?: 0.0),
      goBack = P?.goBack, prev = P,
    )
    if (P?.tick != null && tk != null && tk > P.tick) cur.eye = GhostRows.EYE_HEIGHT[st]!! + (P.eye - GhostRows.EYE_HEIGHT[st]!!) * JsOps.pow(0.5, tk - P.tick)
    fireTrack[k(netId)] = cur
    if (P?.prev != null) P.prev!!.prev = null // two states back is all a round reads
    if (P == null) return
    val ticks = if (P.tick != null && tk != null) tk - P.tick else null
    var ago: Double? = null // ticks from the round's tick to this state's
    if (ticks == null) {
      // No server tick to count with: a rise is a round.
      if (cur.counter > P.counter) ago = 0.0
    } else if (ticks > 0 && cur.counter > 0 && cur.counter != Math.max(0.0, P.counter - ticks)) {
      val fit = GhostRows.recoilAgo(cur.counter, ticks, P.goBack)
      if (fit != null) { ago = fit.k; cur.goBack = fit.goBack }
    }
    if (ago == null && ticks != 0.0 && cur.counter == 0.0 && P.counter == 0.0 && cur.fire && !P.fire) ago = 0.0
    if (ago == null) return
    val pid = occupantAt(netId, t)
    if (nullish(pid)) return
    val row = linkedMapOf<String, Any?>("k" to "f", "t" to (if (ticks != null) fx(t - ago / 30, 3) else t), "pid" to pid, "id" to netId)
    val line = handLine(P, cur, ago)
    if (line != null) { row["p"] = line.first; row["d"] = line.second }
    bump("fires")
    write(row)
  }

  // Where the server's round left and which way, `ago` ticks before `cur`:
  // his view and eye on the tick before the round's, which falls between the
  // last state `P` and this one (see the Node copy for the measurements).
  private fun handLine(P: Fire, cur: Fire, ago: Double): Pair<MutableList<Any?>, MutableList<Any?>>? {
    if (P.pos == null || P.q == null || cur.q == null || cur.pos == null) return null
    if (P.tick == null || cur.tick == null) return lineFrom(cur.pos, cur.q, cur.pitch, cur.twist, cur.eye)
    val T = cur.tick - ago - 1
    val PP = P.prev
    fun near(u: DoubleArray?, v: DoubleArray?, e: Double) = u != null && v != null && u.indices.all { Math.abs(u[it] - v.getOrElse(it) { Double.NaN }) <= e }
    val still = P.counter == 0.0 && PP != null && near(P.pos, PP.pos, 0.002) && near(P.q, PP.q, 0.0005) &&
      (PP.counter > 0 || (Math.abs(P.pitch - PP.pitch) < 0.002 && Math.abs(P.twist - PP.twist) < 0.002))
    val a = if (still) Math.max(P.tick, cur.tick - 2) else P.tick
    val f = if (T > a && cur.tick > a) Math.min(1.0, (T - a) / (cur.tick - a)) else 0.0
    var q = GhostRows.qNlerp(P.q, cur.q, f)
    var pos = DoubleArray(3) { i -> P.pos[i] + (cur.pos[i] - P.pos[i]) * f }
    var twist = P.twist + (cur.twist - P.twist) * f
    if (!still && T > P.tick && PP?.tick != null && PP.q != null && PP.pos != null && P.tick - PP.tick > 0 && P.tick - PP.tick <= 8) {
      val g = (T - P.tick) / (P.tick - PP.tick)
      q = GhostRows.qNlerp(PP.q, P.q, 1 + g)
      val ppos = PP.pos
      pos = DoubleArray(3) { i -> P.pos[i] + (P.pos[i] - ppos[i]) * g }
      twist = P.twist + (P.twist - PP.twist) * g
    }
    var pitch = P.pitch
    if (T > a && !still && PP?.tick != null && P.counter == 0.0 && PP.counter == 0.0 && P.tick - PP.tick > 0 && P.tick - PP.tick <= 8) {
      pitch += (P.pitch - PP.pitch) / (P.tick - PP.tick) * (T - a)
    }
    val target = GhostRows.EYE_HEIGHT[if (T > a) cur.stance else P.stance]!!
    val eye = target + (P.eye - target) * JsOps.pow(0.5, Math.max(0.0, T - P.tick))
    return lineFrom(pos, q, pitch, twist, eye)
  }

  // Down his camera (ledger VIEW-14): from his eye up his body's own axis,
  // along the body turned by the camera's rotateYDeg(-3 x twist) and
  // rotateXDeg(-2.5 x aimA) (BFSoldier::handleUpdate 0x08271f68).
  private fun lineFrom(pos: DoubleArray, q: DoubleArray, aim: Double, twist: Double, eye: Double): Pair<MutableList<Any?>, MutableList<Any?>> {
    val pitch = aim * GhostRows.VIEW_PITCH_PER_AIM * Math.PI / 180
    val yaw = -twist * GhostRows.VIEW_TWIST_PER_AIM * Math.PI / 180
    val d = GhostRows.qRotate(q, doubleArrayOf(JsOps.sin(yaw) * JsOps.cos(pitch), JsOps.sin(pitch), JsOps.cos(yaw) * JsOps.cos(pitch)))
    val up = GhostRows.qRotate(q, doubleArrayOf(0.0, eye, 0.0))
    return pos.indices.mapTo(ArrayList<Any?>()) { fx(pos[it] + up[it], 3) } to d.mapTo(ArrayList<Any?>()) { fx(it, 4) }
  }

  // Where a round from `root`'s seat left and which way, at time `at`: the
  // hull's pose then, turned by the seat's traverse and elevation, from its
  // pitch part's pivot. null while the hull's pose is unknown.
  internal fun muzzle(root: Any?, seat: Double, tmpl: Any?, at: Double, gun: Double = 0.0, tick: Double? = null, poseTick: Double? = tick): Pair<MutableList<Any?>, MutableList<Any?>>? {
    val pose = poseAt(poses[k(root)], at, poseTick) ?: return null
    val pos = pose.pos; val qHull = pose.q
    val chain = Children.launchFor(tmpl, seat, gun)
    if (chain != null) return launchFrame(root, tmpl, at, pos, qHull, chain, tick)
    val parts = (Children.jointPartsFor(tmpl, seat) as? List<*>) ?: emptyList<Any?>()
    val aim = if (parts.isNotEmpty()) aimAt(aims["${str(root)}:${str(seat)}"], at, tick) else null
    val p0 = parts.getOrNull(0) as? List<*>
    val rest = p0?.getOrNull(2).let { if (nullish(it)) 0.0 else JsOps.toNumber(it) }
    val yaw = aim?.yaw ?: 0.0; val pitch = aim?.pitch ?: 0.0
    val rad = Math.PI / 180
    // The gun's frame in the hull's: Ry(rest + traverse) * Rx(elevation).
    val a = (rest + yaw) * rad / 2; val bb = pitch * rad / 2
    val qGun = doubleArrayOf(JsOps.cos(a) * JsOps.sin(bb), JsOps.sin(a) * JsOps.cos(bb), -JsOps.sin(a) * JsOps.sin(bb), JsOps.cos(a) * JsOps.cos(bb))
    val dd = GhostRows.qRotate(GhostRows.qMul(qHull, qGun), doubleArrayOf(0.0, 0.0, 1.0))
    val pv = Children.hullFor(tmpl)?.get("parts").asObj() ?: emptyMap<String, Any?>()
    fun pivot(p: Any?): DoubleArray? { if (p == null) return null; val v = JsOps.at(pv, (p as List<*>)[0]); return if (truthy(v)) d(v) else null }
    val yawPv = pivot(p0); val pitchPv = pivot(parts.getOrNull(1))
    var local = doubleArrayOf(0.0, 0.0, 0.0)
    if (yawPv != null && pitchPv != null) {
      // The pitch part rides the yaw part: its pivot turns with the traverse.
      val ay = yaw * rad / 2
      val off = GhostRows.qRotate(doubleArrayOf(0.0, JsOps.sin(ay), 0.0, JsOps.cos(ay)), doubleArrayOf(pitchPv[0] - yawPv[0], pitchPv[1] - yawPv[1], pitchPv[2] - yawPv[2]))
      local = doubleArrayOf(yawPv[0] + off[0], yawPv[1] + off[1], yawPv[2] + off[2])
    } else if (pitchPv != null || yawPv != null) local = pitchPv ?: yawPv!!
    val w = GhostRows.qRotate(qHull, local)
    return mutableListOf<Any?>(fx(pos[0] + w[0], 3), fx(pos[1] + w[1], 3), fx(pos[2] + w[2], 3)) to dd.mapTo(ArrayList<Any?>()) { fx(it, 3) }
  }

  // The server's launch matrix for one gun (`fireBarrel`'s, XHIT-16): the
  // hull's pose carried down the template's placements to the FireArms, or to
  // its seat's camera for a `fireInCameraDof` gun (DeriveChildren
  // `launchChains`), each turning part on the chain turned by its seat's aim
  // as the joint rows turn it. `p` is that matrix's position, `d` its +Z.
  // On a Midway lab round (2026-10-28) against the server recorder's own
  // rows it puts the M3A1's .50 and the Aichi Val's rear MG along the
  // server's line (they were 178 and 157 degrees off: both are turned 180 on
  // their mounts) and the SBD's nose guns on the server's point (0.80 m short).
  private fun launchFrame(root: Any?, tmpl: Any?, at: Double, pos: DoubleArray, qHull: DoubleArray, chain: Any?, tick: Double? = null): Pair<MutableList<Any?>, MutableList<Any?>> {
    val rad = Math.PI / 180
    var q = qHull
    var p = pos.copyOf()
    for (link in chain as List<*>) {
      val lp = JsOps.at(link, 0.0); val lr = JsOps.at(link, 1.0); val ref = JsOps.at(link, 2.0)
      if (truthy(lp)) {
        val w = GhostRows.qRotate(q, d(lp))
        p = doubleArrayOf(p[0] + w[0], p[1] + w[1], p[2] + w[2])
      }
      if (truthy(lr)) {
        fun or0(v: Any?) = if (nullish(v)) 0.0 else JsOps.toNumber(v)
        q = GhostRows.qMul(q, qYpr(JsOps.toNumber(JsOps.at(lr, 0.0)) * rad, or0(JsOps.at(lr, 1.0)) * rad, or0(JsOps.at(lr, 2.0)) * rad))
      }
      if (truthy(ref)) {
        val seat = JsOps.at(ref, 0.0); val i = JsOps.at(ref, 1.0)
        val role = JsOps.at(JsOps.at(Children.jointPartsFor(tmpl, JsOps.toNumber(seat)), i), 1.0)
        val aim = aimAt(aims["${str(root)}:${str(seat)}"], at, tick)
        val a = (if (eq(i, 0.0)) aim?.yaw else aim?.pitch) ?: 0.0
        if (role == "yaw") q = GhostRows.qMul(q, doubleArrayOf(0.0, JsOps.sin(a * rad / 2), 0.0, JsOps.cos(a * rad / 2)))
        else if (role == "pitch") q = GhostRows.qMul(q, doubleArrayOf(JsOps.sin(a * rad / 2), 0.0, 0.0, JsOps.cos(a * rad / 2)))
      }
    }
    return p.mapTo(ArrayList<Any?>()) { fx(it, 3) } to GhostRows.qRotate(q, doubleArrayOf(0.0, 0.0, 1.0)).mapTo(ArrayList<Any?>()) { fx(it, 3) }
  }

  // The pose at server tick `tick`: the entry of that tick, else the two
  // either side blended (a hull's blocks are one or two ticks apart), else
  // the nearest. Without a tick, or a history without ticks (a fixture's
  // single pose), the latest at or before time `t`.
  private fun poseAt(list: List<Pose>?, t: Double, tick: Double?): Pose? {
    val s = tickSpan(list, tick) ?: return GhostRows.recentAt(list, t)
    val (a, b, f) = s
    if (f == 0.0) return a
    val pos = DoubleArray(a.pos.size) { i -> a.pos[i] + (b.pos[i] - a.pos[i]) * f }
    return Pose(a.t + (b.t - a.t) * f, pos, GhostRows.qNlerp(a.q, b.q, f), tick)
  }
  // A seat's aim the same way, each angle the short way round.
  private fun aimAt(list: List<Aim>?, t: Double, tick: Double?): Aim? {
    val s = tickSpan(list, tick) ?: return GhostRows.recentAt(list, t)
    val (a, b, f) = s
    if (f == 0.0) return a
    fun turn(u: Double, v: Double) = u + ((((v - u) % 360) + 540) % 360 - 180) * f
    return Aim(a.t + (b.t - a.t) * f, turn(a.yaw, b.yaw), turn(a.pitch, b.pitch), tick)
  }
  private fun <E : Ticked> tickSpan(list: List<E>?, tick: Double?): Triple<E, E, Double>? {
    if (tick == null || list.isNullOrEmpty() || list.last().tick == null) return null
    var a: E? = null; var b: E? = null
    for (e in list) {
      val et = e.tick ?: continue
      if (et <= tick) a = e else { b = e; break }
    }
    if (a == null) return if (b != null) Triple(b, b, 0.0) else null
    if (b == null || a.tick == tick) return Triple(a, a, 0.0)
    return Triple(a, b, (tick - a.tick!!) / (b.tick!! - a.tick!!))
  }

  // Refractor's setRotation (yaw, pitch, roll): Ry(yaw) * Rx(pitch) * Rz(roll),
  // radians (bf42/gltf.py quat_from_ypr, before its z flip).
  private fun qYpr(y: Double, p: Double, r: Double): DoubleArray =
    GhostRows.qMul(GhostRows.qMul(doubleArrayOf(0.0, JsOps.sin(y / 2), 0.0, JsOps.cos(y / 2)), doubleArrayOf(JsOps.sin(p / 2), 0.0, 0.0, JsOps.cos(p / 2))),
      doubleArrayOf(0.0, 0.0, JsOps.sin(r / 2), JsOps.cos(r / 2)))

  // A FireArms child's magA is a round counter: it steps down once per round
  // and up on a reload or the counter's wrap. Each step down is a k:"f",
  // dated one round interval before the step (Children.fireLagFor). Only a
  // step down is a round (Wake, 2026-10-16).
  private fun fires(t: Double, r: Map<String, Any?>, b: Map<String, Any?>) {
    val seatV = r.g("seat")
    val root = if (truthy(seatV)) seatV.g("root") else r.g("netId")
    val seat = if (truthy(seatV)) JsOps.num(seatV.g("seat")) ?: Double.NaN else 0.0
    val tmpl = objInfo[k(root)]?.let { JsOps.get(it, "tmpl") }.let { if (nullish(it)) null else it }
    var fi = 0
    for (c in (b["children"] as? List<*>) ?: emptyList<Any?>()) {
      if (c.g("type") != "F") continue
      val key = "${str(r.g("netId"))}:$fi"
      val kind = if (fi == 0) 1 else 2 // a hull's second gun is its alternate trigger (the coaxial MG)
      fi++
      val magA = c.g("magA")
      if (nullish(magA)) continue
      val prev = mags[key]
      mags[key] = magA
      if (nullish(prev) || eq(magA, prev)) continue
      val lag = Children.fireLagFor(tmpl, seat, (fi - 1).toDouble())
      val ma = JsOps.toNumber(magA); val pv = JsOps.toNumber(prev)
      if (ma > pv) continue
      val gun = Children.gunFor(tmpl, seat, (fi - 1).toDouble())
      val rounds = Math.min(Math.max(1.0, JsOps.round((pv - ma) / gun.muzzles)), 10.0)
      lastStep[key] = t
      val at = fx(t - lag, 3)
      val pid = occupantAt(r.g("netId"), at)
      // The aim the round left with is the seat's `lag` ticks before the
      // block that shows the step, by the server's own ticks, and so is the
      // hull's pose, but for a gunner's seat on a land or sea hull: that
      // round leaves from the hull as the server moved it that tick, on the
      // gun as it was turned the tick before. The server recorder's own
      // rows: a Daihatsu's and an M3A1's gunner from the hull of that tick,
      // 284 of 295 and 216 of 218; a Sherman's coaxial (the driver's seat)
      // and an Aichi Val's rear gunner from the tick before, 3 of 3 and 27
      // of 27; every gun on its turret of the tick before. Read by arrival
      // time instead (`at`), a bomb rack's 101 ticks put an SBD's bombs a
      // tick early, 1.5 m back along its flight, in five releases of seven:
      // blocks are one or two ticks apart while they arrive evenly (lab
      // Midway, 2026-10-28; wire.md section 50).
      val tick = blockTick?.let { it - JsOps.round(lag * 30) }
      val poseTick = if (tick != null && truthy(seat) && !Children.launchesBeforeMove(tmpl)) tick + 1 else tick
      val mz = muzzle(root, seat, tmpl, at, (fi - 1).toDouble(), tick, poseTick)
      var i = 0
      while (i < rounds) {
        i++
        bump("fires")
        // With the gunner known, the viewer finds the seat through him.
        val row = if (!nullish(pid)) linkedMapOf<String, Any?>("k" to "f", "t" to at, "pid" to pid, "id" to root) else linkedMapOf<String, Any?>("k" to "f", "t" to at, "id" to root)
        if (truthy(gun.name)) row["w"] = gun.name
        if (mz != null) { row["p"] = mz.first; row["d"] = mz.second }
        if (kind == 2) row["alt"] = 1.0
        if (nullish(pid) && truthy(seat)) continue // a seat's round with nobody known in it has no gun to leave
        write(row)
      }
    }
  }
}
