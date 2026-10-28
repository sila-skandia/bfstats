package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/derive-children.mjs; keep in step.
// (The Node copy's command line, which prints a level's specs off the install,
// is not ported: the install half is the desktop's, see TemplateTable.)
//
// Derive a level's composite-ghost specs, hull widths and soldier widths from
// the template graph its load builds.
//
// A vehicle's ghost body is the hull's SimpleObjectNetworkable body followed
// by the body of every child networkable in its object tree. Which children,
// in what order, and the template widths inside their bodies are not on the
// wire; they are this file's output, per level.
//
// THE RULE (features/udp-sidecar/decodes/vehicle-children.md, section 1).
// NetworkManager::_analyseObject 0x0842d2f0 walks the object tree depth-first,
// pre-order, in addTemplate order, pushes each object whose networkable
// component is set and skips a PlayerControlObject child entirely (a seat is a
// descriptor of its own). An object gets a networkable when its class has an
// initNetworkableComp (the letter table below) and setNetworkableComp
// 0x081d70d0 finds its template's networkableInfo non-empty and registered.
//
// Then NetworkManager::analyseObject 0x0842d620 folds that list into groups
// and sends one networkable per group (groupNodes below): two objects whose
// templates match under compareProperties 0x0842d3e0 are one networkable on
// the wire, unless the networkableInfo is setIsUnique. The same loop leaves
// out an object below the root whose info is setForceNetworkableId and a
// parented Projectile (vehicle-children.md 6.1).
//
// THE WIDTHS, from the binary (decompiled 2026-10-16):
//   gearBits  rangedBits(0, clamp(setNumberOfGears ?? 1, 1, 5)) (0x08227da0,
//             EngineTemplate ctor 0x0823efc0, setNumberOfGears 0x0823fd10)
//   mags      wA = rangedBits(0, magSize + 1), wB = rangedBits(0, numOfMag + 1)
//             (getNetUpdate 0x08228e50, FireArmsTemplate::makeScript 0x0828e3b0)
//   hpBits    rangedBits(0, the armour's maximum), HP-17's
//             max(min(maxHitPoints, 128), hitPoints), each word ceil'd and
//             10 when the .con never sets it (armorMax below).

import io.bfstats.sidecar.Math
import io.bfstats.sidecar.Js
import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.asList
import io.bfstats.sidecar.asObj
import io.bfstats.sidecar.g

object DeriveChildren {
  // Template class (lower case) -> networkable letter: the initNetworkableComp
  // at vtable slot +0xcc of each class's object (lnxded/vt.py, 2026-10-17;
  // class-map.md section 2). See the Node copy for the addresses.
  val LETTER: Map<String, String> = linkedMapOf(
    "engine" to "E",
    "spring" to "S",
    "rotationalbundle" to "R", "camera" to "R", "floatingbundle" to "R", "landinggear" to "R", "wing" to "R",
    "firearms" to "F", "handfirearms" to "F",
    "simpleobject" to "O", "bundle" to "O", "entrypoint" to "O", "seatobject" to "O", "animatedbundle" to "O",
    "supplydepot" to "O", "spawnpoint" to "O", "objectspawner" to "O", "firearmsbundle" to "O",
    "sonarobject" to "O", "emitter" to "O", "effectbundle" to "O", "lensflare" to "O", "light" to "O",
    "flagbase" to "O", "kitpart" to "O", "activekitpart" to "O", "obstacle" to "O", "areaobject" to "O",
    "item" to "I", "flag" to "I", "kit" to "K", "controlpoint" to "C", "projectile" to "P", "bfsoldier" to "D",
    "freecamera" to "X", "destroytargetobjectivetemplate" to "B", "andcompositeobjectivetemplate" to "B",
    "timerobjectivetemplate" to "B",
  )

  // ---- the graph ------------------------------------------------------------

  class Child(val name: Any?, val pos: Any?, val rot: Any?)
  class Tmpl(val name: String, val cls: String, val info: Any?, val props: Map<String, Any?>, val children: List<Child>)
  class Graph(val templates: LinkedHashMap<String, Tmpl>, val infos: Set<String>, val unique: Set<String>, val forced: Set<String>)

  /** The graph bf42/template_table.py `object_graph` prints. */
  fun graphFromJson(json: Any?): Graph {
    val templates = LinkedHashMap<String, Tmpl>()
    for (row in json.g("templates").asList() ?: emptyList<Any?>()) {
      val a = row.asList()!!
      val name = a[0] as String
      val children = (a.getOrNull(4).asList() ?: emptyList<Any?>()).map { c ->
        val cl = c.asList()!!
        Child(cl.getOrNull(0), cl.getOrNull(1).let { if (JsOps.nullish(it)) null else it }, cl.getOrNull(2).let { if (JsOps.nullish(it)) null else it })
      }
      templates[name.lowercase()] = Tmpl(name, JsOps.str(a.getOrNull(1)).lowercase(),
        a.getOrNull(2).let { if (JsOps.nullish(it)) null else it }, a.getOrNull(3).asObj() ?: emptyMap(), children)
    }
    fun set(k: String) = (json.g(k).asList() ?: emptyList<Any?>()).map { (it as String).lowercase() }.toHashSet()
    return Graph(templates, set("infos"), set("unique"), set("forced"))
  }

  private fun lastArgs(t: Tmpl?, op: String): List<Any?>? = t?.props?.get(op).asList()?.lastOrNull().asList()

  private fun num(t: Tmpl?, op: String, dflt: Double?): Double? {
    val v = lastArgs(t, op)?.getOrNull(0)
    return if (JsOps.nullish(v)) dflt else JsOps.toNumber(v)
  }

  // ---- the walk -----------------------------------------------------------

  private fun networkable(t: Tmpl, g: Graph): String? {
    val letter = LETTER[t.cls] ?: return null
    if (!JsOps.truthy(t.info) || !g.infos.contains(JsOps.str(t.info).lowercase())) return null
    if (g.forced.contains(JsOps.str(t.info).lowercase()) || letter == "P") return null
    return letter
  }

  /** The armour's maximum hit points a template spawns with (HP-17). */
  fun armorMax(t: Tmpl?): Double {
    fun word(op: String): Double { val v = num(t, op, null); return if (v != null && v.isFinite()) Math.ceil(v) else 10.0 }
    return Math.max(Math.min(word("maxhitpoints"), 128.0), word("hitpoints"))
  }
  private fun hasArmor(t: Tmpl?) = JsOps.truthy(num(t, "hasarmor", 0.0))

  private val RB_CLASSES = setOf("rotationalbundle", "engine", "wing", "camera", "landinggear", "floatingbundle")
  private fun vec(t: Tmpl, op: String, dflt: List<Double>): List<Double> {
    val a = lastArgs(t, op)?.getOrNull(0)
    if (JsOps.nullish(a)) return dflt
    val v = JsOps.str(a).split("/").map { JsOps.toNumber(it) }
    return (0..2).map { k -> v.getOrNull(k)?.takeIf { it.isFinite() } ?: dflt[k] }
  }
  // The engine's PlayerInput names map to ids; absent is c_PINone (GUN-1).
  private fun input(t: Tmpl, op: String): String = JsOps.str(lastArgs(t, op)?.getOrNull(0).let { if (JsOps.nullish(it)) "c_PINone" else it }).lowercase()
  private fun rbProps(t: Tmpl): String = Js.stringify(listOf(
    if (JsOps.truthy(num(t, "setautomaticreset", 0.0))) 1.0 else 0.0,
    input(t, "setinputtoyaw"), input(t, "setinputtopitch"), input(t, "setinputtoroll"),
    vec(t, "setmaxrotation", listOf(0.0, 0.0, 0.0)), vec(t, "setminrotation", listOf(0.0, 0.0, 0.0)),
    vec(t, "setmaxspeed", listOf(1.0, 1.0, 1.0)), vec(t, "setacceleration", listOf(0.1, 0.1, 0.1)),
  ))

  class Node(val letter: String, val name: String, val cls: String, val tmpl: Tmpl, val rot: Any?, val parent: Node?) {
    var groupedWith: String? = null
    var members: List<String>? = null
    fun copy(members: List<String>?) = Node(letter, name, cls, tmpl, rot, parent).also { it.groupedWith = groupedWith; it.members = members }
  }

  fun sameProperties(a: Node, b: Node): Boolean {
    if (a.tmpl === b.tmpl) return true
    if (a.cls != b.cls || !RB_CLASSES.contains(a.cls)) return false
    return rbProps(a.tmpl) == rbProps(b.tmpl)
  }
  private fun groupNodes(nodes: List<Node>, g: Graph): MutableList<Node> {
    val groups = ArrayList<MutableList<Node>>()
    for (n in nodes) {
      val unique = g.unique.contains((if (JsOps.truthy(n.tmpl.info)) JsOps.str(n.tmpl.info) else "").lowercase())
      val gr = if (unique) null else groups.find { sameProperties(it[0], n) }
      if (gr != null) { gr.add(n); n.groupedWith = gr[0].name } else groups.add(mutableListOf(n))
    }
    return groups.mapTo(ArrayList()) { gr -> gr[0].copy(if (gr.size > 1) gr.map { it.name } else null) }
  }

  class Seat(val name: String, var nodes: MutableList<Node>)
  class Walk(val root: Tmpl, val nodes: MutableList<Node>, val seats: List<Seat>, val missing: List<Any?>)

  /** Walk `rootName`'s tree: the root's descriptor (its child networkables)
   *  and the seats (nested PlayerControlObjects, DFS pre-order). */
  fun walk(g: Graph, rootName: String): Walk? {
    val root = g.templates[rootName.lowercase()] ?: return null
    val seats = ArrayList<Seat>()
    val missing = LinkedHashSet<Any?>()
    fun visit(t: Tmpl, out: MutableList<Node>, depth: Int, parentNode: Node?) {
      for (c in t.children) {
        val ct = g.templates[(if (JsOps.truthy(c.name)) JsOps.str(c.name) else "").lowercase()]
        if (ct == null) { missing.add(c.name); continue }
        if (ct.cls == "playercontrolobject") {
          val seat = Seat(ct.name, ArrayList())
          seats.add(seat)
          visit(ct, seat.nodes, depth + 1, null)
          continue
        }
        if (depth > 40) continue
        val letter = networkable(ct, g)
        val node = if (letter != null) Node(letter, ct.name, ct.cls, ct, c.rot, parentNode) else null
        if (node != null) out.add(node)
        visit(ct, out, depth + 1, node ?: parentNode)
      }
    }
    val nodes = ArrayList<Node>()
    visit(root, nodes, 0, null)
    for (seat in seats) seat.nodes = groupNodes(seat.nodes, g)
    return Walk(root, groupNodes(nodes, g), seats, missing.toList())
  }

  // ---- the spec -----------------------------------------------------------

  private class GunSpec(val mag: List<Any?>, val rof: Double?, val muzzles: Double)
  private fun gunSpec(g: Graph, name: String): GunSpec {
    val t = g.templates[name.lowercase()]
    val magSize = num(t, "magsize", -1.0)!!
    val numOfMag = num(t, "numofmag", -1.0)!!
    val rof = num(t, "roundoffire", null)
    val positions = (t!!.props["addfirearmsposition"].asList() ?: emptyList<Any?>()).size
    val async = num(t, "setasynchronyfire", 0.0)!!
    return GunSpec(mutableListOf(JsOps.rangedBits(0.0, magSize + 1).toDouble(), JsOps.rangedBits(0.0, numOfMag + 1).toDouble()),
      rof, if (positions >= 2 && !JsOps.truthy(async)) positions.toDouble() else 1.0)
  }

  // The turning parts the replay drives, for the R children that carry a gun.
  private fun jointParts(g: Graph, nodes: List<Node>): MutableList<Any?>? {
    val rs = nodes.filter { it.letter == "R" }
    val gunRs = LinkedHashSet<String>()
    for (n in nodes) {
      if (n.letter != "F") continue
      var p = n.parent
      while (p != null) { if (p.letter == "R") gunRs.add(p.name); p = p.parent }
    }
    if (gunRs.isEmpty()) return null
    val parts = ArrayList<MutableList<Any?>>()
    var i = 0
    while (i < rs.size && parts.size < gunRs.size) {
      if (!gunRs.contains(rs[i].name)) return null
      val t = g.templates[rs[i].name.lowercase()]!!
      val role = if (t.props.containsKey("setinputtoyaw") && JsOps.truthy(t.props["setinputtoyaw"])) "yaw" else "pitch"
      // A yaw part placed turned about the vertical starts from that turn,
      // in (-180, 180]: the M3A1's .50 holder, placed at -180, rests at 180.
      val rot = rs[i].rot
      var rest = if (role == "yaw" && JsOps.truthy(rot)) JsOps.round(JsOps.toNumber(JsOps.at(rot, 0.0))) else 0.0
      rest = ((rest % 360) + 360) % 360
      if (rest > 180) rest -= 360
      parts.add(if (JsOps.truthy(rest)) mutableListOf(rs[i].name, role, rest) else mutableListOf(rs[i].name, role))
      i++
    }
    if (parts.size < 2 || parts[0][1] != "yaw" || parts[1][1] != "pitch") return null
    return parts.toMutableList()
  }

  private fun descriptorSpec(g: Graph, nodes: List<Node>): MutableMap<String, Any?> {
    val children = nodes.mapTo(ArrayList<Any?>()) { it.letter }
    val guns = nodes.filter { it.letter == "F" }.map { it.name }
    val gs = guns.map { gunSpec(g, it) }
    val engine = nodes.find { it.letter == "E" }
    val spec = linkedMapOf<String, Any?>("children" to children, "nodes" to nodes.mapTo(ArrayList<Any?>()) { it.members?.joinToString("=") ?: it.name })
    if (engine != null) {
      val et = g.templates[engine.name.lowercase()]
      val gears = Math.min(5.0, Math.max(1.0, num(et, "setnumberofgears", 1.0)!!))
      spec["gearBits"] = JsOps.rangedBits(0.0, gears).toDouble()
      spec["gears"] = gears
    }
    // An 'O' child's own widths: hit points rangedBits(0, maxHp) of its own
    // armour and absent (0 bits) without one; controller vectors per its own
    // hasMobilePhysics.
    val objs = nodes.filter { it.letter == "O" }.map { n ->
      val t = n.tmpl
      linkedMapOf<String, Any?>("hpBits" to (if (hasArmor(t)) JsOps.rangedBits(0.0, armorMax(t)).toDouble() else 0.0),
        "mobile" to JsOps.truthy(num(t, "hasmobilephysics", 0.0)))
    }
    if (objs.isNotEmpty()) spec["objects"] = objs.toMutableList<Any?>()
    if (guns.isNotEmpty()) {
      spec["mags"] = gs.mapTo(ArrayList<Any?>()) { it.mag }
      spec["rof"] = gs.mapTo(ArrayList<Any?>()) { it.rof ?: 0.0 }
      spec["guns"] = guns.toMutableList<Any?>()
      if (gs.any { it.muzzles > 1 }) spec["muzzles"] = gs.mapTo(ArrayList<Any?>()) { it.muzzles }
    }
    return spec
  }

  // The chain of placements from a hull's root to where each of its guns
  // launches (`launch[seat][gun]`), for GhostWriter `muzzle`: the FireArms
  // itself, or for a `fireInCameraDof` gun its seat's camera, whose matrix
  // `FireArms::Fire` launches from (viewer/camera-dof.js; ledger XHIT-12).
  // Each link is [pos, rot, ref]: the addTemplate placement (null for none)
  // and, for a turning part the ghost aims, [seat, i], its place in that
  // seat's `joints`. The seats are walk()'s, in its order; a seat's chain
  // runs through the PCOs above it, and a gun's through any part another
  // seat aims (a Sherman's pintle .50 rides the gunner's tower). Without it
  // the writer measured from the pitch part's pivot alone: the M3A1's .50
  // and the Aichi Val's rear MG, turned 180 degrees on their mounts, were
  // written flying backwards (a Midway lab round, 2026-10-28).
  private class Found(val guns: LinkedHashMap<String, List<Any?>> = LinkedHashMap(), var camera: List<Any?>? = null)
  private fun launchChains(g: Graph, root: Tmpl, spec: Map<String, Any?>): MutableMap<String, Any?>? {
    val templates = g.templates
    fun lowerNames(v: Any?) = (v.asList() ?: emptyList<Any?>()).map { JsOps.str(it).lowercase() }
    val want = LinkedHashMap<Int, List<String>>()   // seat -> [lower gun names]
    want[0] = lowerNames(spec["guns"])
    for ((i, ss) in spec["seats"].asObj() ?: emptyMap()) want[JsOps.toNumber(i).toInt()] = lowerNames(ss.g("guns"))
    val refs = HashMap<String, List<Any?>>()   // lower part name -> [seat, i]
    for ((seat, parts) in spec["joints"].asObj() ?: emptyMap()) {
      (parts.asList() ?: emptyList<Any?>()).forEachIndexed { i, pt ->
        val n = JsOps.str(JsOps.at(pt, 0.0)).lowercase()
        if (!refs.containsKey(n)) refs[n] = listOf(JsOps.toNumber(seat), i.toDouble())
      }
    }
    val found = HashMap<Int, Found>()   // seat -> its guns' chains and its camera's
    var seats = 0
    fun visit(t: Tmpl, links: List<Any?>, seat: Int, depth: Int) {
      for (c in t.children) {
        val ct = templates[(if (JsOps.truthy(c.name)) JsOps.str(c.name) else "").lowercase()] ?: continue
        val lname = ct.name.lowercase()
        val link = listOf(c.pos, c.rot, refs[lname])
        val here = links + listOf<Any?>(link)
        var s = seat
        if (ct.cls == "playercontrolobject") s = ++seats
        else if (depth > 40) continue
        val f = found.getOrPut(s) { Found() }
        if (LETTER[ct.cls] == "F" && (want[s] ?: emptyList()).contains(lname) && !f.guns.containsKey(lname)) f.guns[lname] = here
        if (ct.cls == "camera" && f.camera == null) {
          // The camera's matrix is its placement then its pivotPosition, in
          // its own turned frame: the M3A1's .50 leaves M3A1Camera2's pivot,
          // 0.3 m up and 1 m back along the gun (lab, 2026-10-28; wire.md 50).
          val pv = vec(ct, "setpivotposition", listOf(0.0, 0.0, 0.0))
          f.camera = if (pv.any { it != 0.0 }) here + listOf<Any?>(listOf(pv, null, null)) else here
        }
        visit(ct, here, s, depth + 1)
      }
    }
    visit(root, emptyList(), 0, 0)
    val out = LinkedHashMap<String, Any?>()
    for ((seat, names) in want) {
      val f = found[seat]
      if (f == null || names.isEmpty()) continue
      val chains = names.mapTo(ArrayList<Any?>()) { n ->
        val gun = f.guns[n]
        if (gun == null) null
        else {
          val camera = if (JsOps.truthy(num(templates[n], "fireincameradof", 0.0))) f.camera else null
          camera ?: gun
        }
      }
      if (chains.any { it != null }) out[seat.toString()] = chains
    }
    return if (out.isNotEmpty()) JsOps.jsOrder(out) else null
  }

  fun deriveSpec(g: Graph, name: String): MutableMap<String, Any?>? {
    val w = walk(g, name) ?: return null
    val spec = descriptorSpec(g, w.nodes)
    if (JsOps.nullish(spec["gearBits"])) spec["gearBits"] = 2.0
    spec["hpBits"] = JsOps.rangedBits(0.0, armorMax(w.root)).toDouble()
    spec["template"] = w.root.name
    val joints = LinkedHashMap<String, Any?>()
    jointParts(g, w.nodes)?.let { joints["0"] = it }
    val seats = LinkedHashMap<String, Any?>()
    w.seats.forEachIndexed { i, s ->
      val ss = descriptorSpec(g, s.nodes)
      ss["seat"] = s.name
      seats[(i + 1).toString()] = ss
      jointParts(g, s.nodes)?.let { joints[(i + 1).toString()] = it }
    }
    if (seats.isNotEmpty()) spec["seats"] = seats
    if (joints.isNotEmpty()) spec["joints"] = JsOps.jsOrder(joints)
    launchChains(g, w.root, spec)?.let { spec["launch"] = it }
    // An aircraft gunner's round leaves from the hull as the tick before left
    // it; a land or sea hull gunner's from where that tick moved it
    // (GhostWriter fires; a lab Midway round, 2026-10-28, wire.md section 50).
    if (JsOps.str(lastArgs(w.root, "setvehiclecategory")?.getOrNull(0) ?: "").lowercase() == "vcair") spec["air"] = 1.0
    if (w.missing.isNotEmpty()) spec["missing"] = w.missing.toMutableList()
    return spec
  }

  // ---- a level --------------------------------------------------------------

  /** Where each named part's pivot sits at rest in the root's frame. */
  fun partPivots(g: Graph, root: Tmpl, names: Set<String>): MutableMap<String, Any?> {
    val want = names.map { it.lowercase() }.toSet()
    val out = LinkedHashMap<String, Any?>()
    val seen = HashSet<Tmpl>()
    fun visit(t: Tmpl, at: List<Double>, depth: Int) {
      if (depth > 40 || seen.contains(t)) return
      seen.add(t)
      for (c in t.children) {
        val cname = if (JsOps.truthy(c.name)) JsOps.str(c.name) else ""
        val ct = g.templates[cname.lowercase()]
        val p = if (JsOps.nullish(c.pos)) listOf<Any?>(0.0, 0.0, 0.0) else c.pos.asList() ?: listOf<Any?>()
        fun pk(k: Int): Double { val v = JsOps.at(p, k.toDouble()); return if (JsOps.truthy(v)) JsOps.num(v) ?: JsOps.toNumber(v) else 0.0 }
        val here = listOf(at[0] + pk(0), at[1] + pk(1), at[2] + pk(2))
        val name = ct?.name ?: JsOps.str(c.name)
        if (want.contains(cname.lowercase()) && !out.containsKey(name)) out[name] = here.mapTo(ArrayList<Any?>()) { JsOps.toFixed(it, 3) }
        if (ct != null) visit(ct, here, depth + 1)
      }
      seen.remove(t)
    }
    visit(root, listOf(0.0, 0.0, 0.0), 0)
    return JsOps.jsOrder(out)
  }

  // The aim limit a soldier body's aim field is scaled by: max(|a|, |b|).
  private fun limit(t: Tmpl, op: String): Any? {
    val args = lastArgs(t, op)
    if (args.isNullOrEmpty()) return null
    val v = args.take(2).map { JsOps.toNumber(it) }.filter { it.isFinite() }.map { Math.abs(it) }
    return if (v.isNotEmpty()) v.max() else null
  }

  /** Everything a level's ghost bodies take from its templates:
   *  { specs, hulls, soldiers } (see the Node copy for each field). */
  fun deriveLevel(json: Any?): MutableMap<String, Any?> {
    val g = graphFromJson(json)
    val specs = LinkedHashMap<String, Any?>(); val hulls = LinkedHashMap<String, Any?>(); val soldiers = LinkedHashMap<String, Any?>()
    for (t in g.templates.values) {
      if (t.cls == "bfsoldier") {
        soldiers[t.name] = linkedMapOf("maxHp" to armorMax(t), "aimTwist" to limit(t, "setturnleftrightangle"), "aimPitch" to limit(t, "setpointupdownangle"))
        continue
      }
      val pco = t.cls == "playercontrolobject"
      val spec = if (pco) deriveSpec(g, t.name) else null
      if (spec != null) specs[t.name] = spec
      if (!hasArmor(t) || !(pco || LETTER[t.cls] == "O")) continue
      val hull = linkedMapOf<String, Any?>("maxHp" to armorMax(t))
      if (!JsOps.truthy(num(t, "hasmobilephysics", 0.0))) hull["mobile"] = false
      if (spec != null) {
        val names = LinkedHashSet<String>()
        val w = walk(g, t.name)!!
        for (n in w.nodes + w.seats.flatMap { it.nodes }) if (n.letter == "R") names.add(n.name)
        val parts = if (names.isNotEmpty()) partPivots(g, t, names) else null
        if (parts != null && parts.isNotEmpty()) hull["parts"] = parts
      }
      hulls[t.name] = hull
    }
    return linkedMapOf("specs" to JsOps.jsOrder(specs), "hulls" to JsOps.jsOrder(hulls), "soldiers" to JsOps.jsOrder(soldiers))
  }
}
