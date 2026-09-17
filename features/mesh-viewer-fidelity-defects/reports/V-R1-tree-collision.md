## Verdict summary

12 confirmed, 1 corrected, 0 refuted, 0 unverifiable. Safe to plan the exporter rule (SCM **and** HCP=1) against; correct the HCP→StaticResponsePhysics evidence link before treating soldier-body gating as fully closed (report Open already flags that).

Bridge: `./xref.py check` → sha256 `60c9452d…` **MATCH**.

---

## Per claim

| # | Claim (abbreviated) | Verdict | What I found |
|---|---|---|---|
| 1 | Tree collider in both projectile rays and body/static collision | **CORRECTED** | Projectile path **holds**: `ObjectManager::raycast` `0x081a127a` → `getCollisionMesh` `0x0818d5b0` (IID_ICollisionMesh) → QI `IID_IVectorCollider` `0x86e6724` at `0x081a12b1`. `TreeMesh::getDistanceToGeometry` `0x083bad80` indexes template `+0x150` (LOD) / `+0x154` (IVectorCollider vector begin), `call [vtable+0xc]` → SCM `getDistanceToGeometry` `0x083c9f70` (live vptr slot; not the gcc symbol base). Body path **reaches the same interface**: `ResponsePhysics::getFaceCollision` `0x0825878b` QIs `IID_IVectorCollider` on geometry; TreeMesh thunk `0x083bbc50` (`this-8`) → `0x083bad80`. **Correction:** HCP does **not** select `StaticResponsePhysics`. `setResponsePhysicsComponent` `0x081dd1d0`: bit3 → `PointResponsePhysics`; **bit0 set** → `ResponsePhysics`; **bit0 clear** → `StaticResponsePhysics` at `0x081dd330`. HCP is **bit1** of `+0x70` and only drives ctor `updateFlags(0x200)`. |
| 2 | Tree is SimpleObject; collider on TreeMesh geometry | **CONFIRMED** | bf1942: all 108 TreeMesh-backed objects are `SimpleObject`. Palms: `create SimpleObject` + `geometry` + `setHasCollisionPhysics 1`. `TreeMesh::queryInterface` `0x083bbde0`: `IID_IGeometry`→`this`, `IID_IVectorCollider`→`this+8`, `IID_ICollisionMesh`→`this+0x10`. Load creates SCM into template vector at `+0x154` via `SmartItf::create` at `0x083bd85d`. |
| 3 | HCP sets template `+0x70` bit1; ctor `updateFlags(0x200)` | **CONFIRMED** | `ConsoleClass83::executeObjectMethod` `0x081bcd20`: setter `and $1` then `add %ebx,%ebx` (value 0/2), `and $~2` / `or` into `template+0x70`; getter `shr $1`. SimpleObject ctor `0x081da190`: `shr $1` / `test` bit1 → `0x081da420` `push $0x200` → `BCompositeObject::updateFlags`. `updateObjectInCuller` tests `$0x200` at `0x0819c5ae` / `0x0819c665`. |
| 4 | Face `u16` = SM-6 material word; vert low16 match | **CONFIRMED** | Independent survey: layout `3×u16 + u16 mat`; **4034/4034** vert low16 ∈ face mat set; face words high byte 0 (`0x00A6` etc.). Hist (byte): 166, **45**, 165, 80, **164**, 81, 82… (report under-listed 164 / ordered 165 before 45; encoding claim still right). |
| 5 | MM 166→def 165; rifle 218→wood ricochets | **CONFIRMED** | `damage.load_tables`: 166 `att/def=165`; 218 vs 165 → `e_RichoWood`; 80/81 → `RichoWoodDecal`; 82 → `e_richoWood`. Labels `None` for 80–82/165–166. |
| 6 | No tree hitpoints; hit = impact effect | **CONFIRMED** | 0/108 bf1942 TreeMesh objects with hitpoints directives. Palms are create/geometry/HCP only. Impact chain cited from settled `projectiles-and-impacts.md` (not re-decompiled here); data side solid. |
| 7 | Zero-collider ≈ bushes/ferns/plants | **CONFIRMED** | Install: **321** `.tm`, **101** zero, **220** SCM. bf1942 zeros: bush **9**, fern **3**, plant **18** (monstrea as plant) or **17** without monstrea; tree zeros = `Jungle_tree15*`. Fern `FERNSMAL_M1` HCP `0`. Qualitative claim holds; plant tally off by ≤1 vs report’s 17. |
| 8 | HCP and collider can disagree; need both | **CONFIRMED** | bf1942: HCP1+SCM **48**; HCP0+none **31**; **HCP0+SCM 27** (`Afri_bush1_M1` faces=36 mat=82; `Jungle_tree11_M1` faces=20 mat=80); **HCP1+none 2** (`Jungle_plant7/8_M1`). |
| 9 | Hull local; world Mat4 on TreeMesh; Wake scale OK | **CONFIRMED** | `getDistanceToGeometry` passes `TreeMesh+0xa0`, not caller Mat4. SCM `0x083c9f70` `rep movsl` 16 dwords copies that Mat4. Wake `StaticObjects.con`: **0** non-uniform `absoluteScale`. |
| 10 | Billboard visual-only; one collision LOD | **CONFIRMED** | All 112 TreeMesh geoms `billboard 1`; distances **111×50**, **1×150** (`PALMSHORT_M1`). `loadBillboard` `0x083be4a0` = `ret`. Load resizes collider vectors at `+0x154` and `+0x160` to **1**; `getNumCollisionLods` = that size. |
| 11 | Collision layout validates on all `.tm` | **CONFIRMED** | Re-ran parse: version always 5; **0** bad indices / tail / parse fails; **6358** faces / **4034** verts; **33** soft AABB mismatches. |
| 12 | Budget small | **CONFIRMED** | All SCM faces **6358**; bf1942 HCP=1: **48** geoms, **751** faces; Wake HCP1 placements **324** / unique faces **117**; Guadalcanal **663** / **145**. |

---

## Load-bearing inferences

- **Exporter rule HCP=1 AND SCM** — depends on claim 8 (confirmed) and on projectile/culler gating by HCP/`0x200` (confirmed). If HCP=0+SCM objects still body-block without `0x200`, skipping them is still right for the palm defect and avoids bush solids; soldier parity for those 27 would stay open (report already says so).
- **“No special tree damage / no destruction”** — rests on no hitpoints (confirmed) + shared material effect table (confirmed) + client impact draw not re-checked this round.
- **“collision.js needs no change”** — inference that exported `extras.collision` / `defenseMaterial` match existing SM statics indexing; not re-verified against viewer code beyond `assemble.py` currently skipping treemesh.

---

## Anything the report missed

- Face-material hist should include **164** (330 faces), between 80 and 81.
- `StaticResponsePhysics::checkObjectVsObject` is a **stub** (`ret`); mobile `ResponsePhysics` is what queries static geometry colliders — worth stating so implementers do not chase the stub.
- This Wine tree has **18** mod folders; `.tm` appeared in 12 of them in the survey (321 total). TM-1’s 401 remains a different corpus/count, as the report notes.
