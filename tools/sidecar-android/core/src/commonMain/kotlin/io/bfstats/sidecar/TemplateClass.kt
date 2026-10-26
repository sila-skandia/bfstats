package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/template-class.mjs; keep in step.
//
// An object's class, from the template class the level load gave its template.
//
// The wire names neither: a createObject carries the template's id. The
// sidecar has the table because TemplateTable replays the level load and
// keeps each id's template class, the `ObjectTemplate.create <Class>` word
// (TEMPLATE_CLASSES, ledger LOAD-19). The object class follows from the
// template class and the networkable class from the object class's
// initNetworkableComp, the vtable slot +0xcc of each class
// (features/udp-sidecar/decodes/class-map.md section 2):
//
//   SimpleObject::initNetworkableComp 0x081daaf0   SimpleObjectNetworkable
//   RotationalBundle 0x081d85e0                    RotationalBundleNetworkable
//   Engine 0x0823ebe0, Spring 0x0824f660, FireArms 0x0828dca0, Item 0x08295c40,
//   Kit 0x08296910, ControlPoint 0x08284500, Projectile 0x0831f800,
//   Objective 0x08311440, BFSoldier 0x0827a1c0, FreeCamera 0x081afc60
//   PlayerControlObject 0x08316ea0: SimpleObjectNetworkable while the object's
//     +0x50 is 0, which every hull ever captured is
//   none: LodObject, SpriteParticle, Particle (an empty `ret`, 0x081935d0)
//
// Only when the table could not be computed does a name stand in for it, and
// then loudly (Names): the level's control points, the vanilla hulls of the
// fallback specs and the template families `...Soldier`, `...Projectile`,
// `...Camera`, the kit roles.

import io.bfstats.sidecar.ghost.Children

object TemplateClass {
  private const val SO = "SimpleObjectNetworkable"
  private const val RB = "RotationalBundleNetworkable"
  private val NETWORKABLE: Map<String, String?> = linkedMapOf(
    "SimpleObject" to SO, "Bundle" to SO, "EntryPoint" to SO,
    "SeatObject" to SO, "AnimatedBundle" to SO, "SupplyDepot" to SO,
    "SpawnPoint" to SO, "ObjectSpawner" to SO, "FireArmsBundle" to SO,
    "SonarObject" to SO, "Emitter" to SO, "EffectBundle" to SO,
    "LensFlare" to SO, "Light" to SO, "FlagBase" to SO,
    "KitPart" to SO, "ActiveKitPart" to SO, "Obstacle" to SO,
    "AreaObject" to SO, "PlayerControlObject" to SO,
    "RotationalBundle" to RB, "Camera" to RB,
    "FloatingBundle" to RB, "LandingGear" to RB, "Wing" to RB,
    "Engine" to "EngineNetworkable", "Spring" to "SpringNetworkable",
    "FireArms" to "FireArmsNetworkable", "HandFireArms" to "FireArmsNetworkable",
    "Item" to "ItemNetworkable", "Flag" to "ItemNetworkable", "Kit" to "KitNetworkable",
    "ControlPoint" to "ControlPointNetworkable", "Projectile" to "ProjectileNetworkable",
    "DestroyTargetObjectiveTemplate" to "ObjectiveNetworkable", "ANDCompositeObjectiveTemplate" to "ObjectiveNetworkable",
    "TimerObjectiveTemplate" to "ObjectiveNetworkable",
    "BFSoldier" to "BFSoldierNetworkable", "FreeCamera" to "FreeCameraNetworkable",
    "LodObject" to null, "SpriteParticle" to null, "Particle" to null,
  )
  private val BY_LOWER = NETWORKABLE.keys.associateBy { it.lowercase() }

  /** {objectClass, networkableClass} for a template class (any case), or null. */
  fun classFromTemplateClass(cls: Any?): MutableMap<String, Any?>? {
    if (!JsOps.truthy(cls)) return null
    val objectClass = BY_LOWER[JsOps.str(cls).lowercase()] ?: return null
    return linkedMapOf("objectClass" to objectClass, "networkableClass" to NETWORKABLE[objectClass])
  }

  private fun fam(cls: String) = classFromTemplateClass(cls)
  private val KIT_RE = Regex("(^|_)(AT|Assault|Engineer|Medic|Scout)(_[A-Za-z]+)?\\z", RegexOption.IGNORE_CASE)

  /** The control point templates of a level, lower case. */
  fun controlPointTemplates(level: Any?, cpNames: Any? = null): Set<String> =
    (cpNames.asObj()?.keys ?: emptySet()).mapTo(LinkedHashSet()) { it.lowercase() }

  /** {objectClass, networkableClass} for a template: its computed template
   *  class when there is one, else the fallback guesses from its name. */
  fun classForTemplate(tmpl: Any?, cpTemplates: Set<String>? = null, cls: Any? = null): MutableMap<String, Any?>? {
    if (JsOps.truthy(cls)) return fam(JsOps.str(cls))
    if (!JsOps.truthy(tmpl)) return null
    val t = JsOps.str(tmpl)
    val key = t.lowercase()
    if (cpTemplates?.contains(key) == true) return fam("ControlPoint")
    if (Children.fallbackHull(t)) return fam("PlayerControlObject")
    if (t.endsWith("soldier", ignoreCase = true)) return fam("BFSoldier")
    if (t.endsWith("projectile", ignoreCase = true)) return fam("Projectile")
    if (t.endsWith("camera", ignoreCase = true)) return fam("FreeCamera")
    if (KIT_RE.containsMatchIn(t)) return fam("Kit")
    return null
  }
}
