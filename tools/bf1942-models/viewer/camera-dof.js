// Which guns fire from the player's camera instead of their own barrel, and
// which camera that is.
//
// Imports nothing, so `tests/camera_dof_harness.mjs` runs it under node.
//
// THE RULE. `FireArms::Fire` (lnxded 0x0828a090) builds the matrix every
// barrel of the shot is launched from. At 0x0828a1c1 it tests the template's
// `fireInCameraDof` byte (`FireArmsTemplate+0x264`: `makeScript` writes
// `ObjectTemplate.fireInCameraDof 1` from it at 0x0828e942, both constructors
// clear it at 0x0828d686 / 0x0828da66). Set, it takes the firing player's
// camera -- `BFPlayer::getCamera()` 0x08054ce0, the camera object the player
// looks through, i.e. the seat's Camera -- and uses that object's
// `getAbsoluteTransformation()`; clear, it uses the FireArms' own. Then
// `FireArms::fireBarrel` 0x0828aba0 places the round at that matrix's
// position plus `projectilePosition` (and a barrel's own offset and turn) in
// that matrix's frame, and sends it down that matrix's forward. So a
// `fireInCameraDof` gun puts its round exactly under the crosshair, which is
// drawn at the centre of the camera's view, and any other gun puts it where
// its barrel points. The engine's AI aims through the same switch:
// `WeaponFireArmReal::getPosition` / `getAbsoluteTransformation`
// (0x085ef6e0 / 0x085ef6c0) call `FireArms::getFireArmsPosition` /
// `getFireArmsTransformation` (0x0828ce90 / 0x0828cdc0), which test the same
// byte and return the camera's.
//
// WHICH GUNS. Surveyed out of the retail archives (vanilla 1.6 `Objects.rfa`,
// XPack1 and XPack2 `objects.rfa`, and every level archive): the word is
// declared on every armed hand weapon, and on the FireArms below and no
// others. No tank's main gun is on it: the T-34's cannon launches from its
// barrel, 0.789 m right of `T34Camera` (`setPosition -0.789/0/0.04` under
// `T34GunBase`), so its shell lands right of the crosshair by that much at
// every range -- which is the parallax retail has, and why the old players'
// tip says to aim a tank gun a little left at close range. Its coaxial MG is
// on it, so its rounds go where the crosshair is.
//
// A glb exported after 2026-09-25 carries the word itself, on the FireArms
// node's `fireArms` extras (`bf42/assemble.py`); one baked before it does
// not, and the table answers for it by template name.

/**
 * The non-hand FireArms templates that declare `fireInCameraDof 1`, lower
 * case. Where each comes from:
 *   bf1942 `Objects/Stationary_Weapons/*`: browning, browning_air,
 *     browning_unlimited, coaxial_browning, coaxial_mg42, mg42, mg42_air,
 *     mg42_unlimited; `Objects/Vehicles/Sea/Elco80|Type38/Weapons.con`:
 *     elco80_sidegunner, type38_oerlikon; the Battle of Britain level's own
 *     `Objects/Ju88A/Weapons.con`: the Ju88's three gunner guns.
 *   XPack1 `objects/Vehicles/Land/M11-39|M3Grant/Weapons.con`: m11-39gunright,
 *     m11-39gunleft, m3grantgun; the two bayonet stabs.
 *   XPack2 `Objects/Vehicles/Land/Flakpanzer/Weapons.con`: flakpanzer_mg42;
 *     `HD_XA42/Objects.con`: hdbrowning; the Raid on Agheila level's Willy:
 *     m1919a4; the two knife stabs.
 */
export const CAMERA_DOF_FIREARMS = Object.freeze(new Set([
  // bf1942
  'browning', 'browning_air', 'browning_unlimited', 'coaxial_browning',
  'coaxial_mg42', 'mg42', 'mg42_air', 'mg42_unlimited',
  'elco80_sidegunner', 'type38_oerlikon',
  'ju88a_nosegunner_gun', 'ju88a_reargunner_leftgun', 'ju88a_reargunner_rightgun',
  // XPack1
  'm11-39gunright', 'm11-39gunleft', 'm3grantgun',
  'k98bayonetstabfirearm', 'no4bayonetstabfirearm',
  // XPack2
  'flakpanzer_mg42', 'hdbrowning', 'm1919a4',
  'commandoknifestab', 'eliteknifestab',
]));

/**
 * Does this gun fire from the player's camera?
 *
 * @param {object | null | undefined} stats the FireArms node's `fireArms`
 *   extras; its `fireInCameraDof`, when the exporter wrote one, is the answer
 * @param {string | null | undefined} name the FireArms node's name: the
 *   template's, possibly with the level bake's `_N` suffix
 */
export function firesFromCamera(stats, name) {
  if (typeof stats?.fireInCameraDof === 'boolean') return stats.fireInCameraDof;
  if (!name) return false;
  const key = String(name).toLowerCase();
  return CAMERA_DOF_FIREARMS.has(key) || CAMERA_DOF_FIREARMS.has(key.replace(/_\d+$/, ''));
}

/**
 * The Camera the seat that owns `node` looks through: the first `Camera`
 * node, in traversal order, tagged with the same `control` as the gun,
 * searched from the nearest `PlayerControlObject` of that control -- the
 * same first-one-wins rule the seat survey uses (`seat-survey.js`). The gun
 * and its seat's camera always share a PCO (a tank's coax and `T34Camera`
 * under `T34GunBase`; a hull gunner's Browning and `ShermanCamera2` under
 * `shermanBrowning_PCO1`). Null when there is none, and the gun then fires
 * from its own barrel.
 */
export function seatCameraOf(node) {
  const control = node?.userData?.control;
  if (!control) return null;
  let top = null;
  for (let at = node; at; at = at.parent) {
    const data = at.userData;
    if (data?.templateKind === 'PlayerControlObject' && data.control === control) {
      top = at;
      break;
    }
  }
  if (!top) return null;
  let found = null;
  top.traverse(obj => {
    if (found) return;
    const data = obj.userData;
    if (data?.templateKind === 'Camera' && data.control === control) found = obj;
  });
  return found;
}
