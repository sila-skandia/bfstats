// What each row of the game's OPTIONS > CONTROLS screen binds.
//
// The retail pages (`menu/<Tab>ControlsPage<n>`, extracted into
// `controls-layout.json` by `extract_controls_menu_layout.py`) label each row
// with a lexicon key and read its bindings through an engine-side index that
// no file spells out. This is that index in the vocabulary the profile's
// `.con` files use: a row is a trigger (`c_PIUse`), or one half of an axis
// (`c_PIThrottle` +1 is FORWARD, -1 BACKWARD — the first key of an
// `addKeysToAxisMapping` pair drives the channel positive).
//
// Two sign choices are the game's and not obvious: `c_PIPitch` positive is
// nose *down* (the Air map's Arrow Up), so PITCH UP is the negative half; and
// `c_PIYaw` positive is right (D), so the left rudder, strafe and turn rows
// are negative.

/** Row key -> binding. `trigger` for a button row, `axis` + `sign` for a
 *  half-axis row. `context` is the control map the row's page reads. */
const T = trigger => ({ trigger });
const A = (axis, sign) => ({ axis, sign });

export const CONTROL_ROWS = {
  // COMMON 1/3
  CONTROLS_COMMON_ENTEREXIT: T('c_PIUse'),
  CONTROLS_COMMON_PARACHUTE: T('c_PIMenuSelect9'),
  CONTROLS_COMMON_CHAT: T('c_PISayAll'),
  CONTROLS_COMMON_TEAMCHAT: T('c_PISayTeam'),
  CONTROLS_COMMON_SHOW_SCOREBOARD: T('c_PIShowScoreBoard'),
  CONTROLS_COMMON_SHOW_SPAWNINTERFACE: T('c_GIInGameMenu'),
  CONTROLS_COMMON_SHOW_MAP: T('c_PIMap'),
  CONTROLS_COMMON_ZOOMMAP: T('c_PIZoomMap'),
  CONTROLS_COMMON_INSIDE: T('c_PICameraMode1'),
  CONTROLS_COMMON_CHASE_REAR: T('c_PICameraMode2'),
  CONTROLS_COMMON_CHASE_FRONT: T('c_PICameraMode3'),
  CONTROLS_COMMON_FLY_BY: T('c_PICameraMode4'),
  // COMMON 2/3
  CONTROLS_COMMON_TOGGLE_CAMERA: T('c_PIToggleCameraMode'),
  CONTROLS_COMMON_PAUSE: T('c_GITogglePause'),
  CONTROLS_COMMON_SCREENSHOT: T('c_PIScreenShot'),
  CONTROLS_COMMON_TOOLTIP: T('c_PIToolTip'),
  CONTROLS_COMMON_RADIO_1: T('c_PIRadio1'),
  CONTROLS_COMMON_RADIO_2: T('c_PIRadio2'),
  CONTROLS_COMMON_RADIO_3: T('c_PIRadio3'),
  CONTROLS_COMMON_RADIO_4: T('c_PIRadio4'),
  CONTROLS_COMMON_RADIO_5: T('c_PIRadio5'),
  CONTROLS_COMMON_RADIO_6: T('c_PIRadio6'),
  CONTROLS_COMMON_RADIO_7: T('c_PIRadio7'),
  CONTROLS_COMMON_RADIO_8: T('c_PIRadio8'),
  // COMMON 3/3
  CONTROLS_COMMON_SHOWMAPVOTE: T('c_PIShowMapVote'),
  CONTROLS_COMMON_VOTEYES: T('c_PIVoteYes'),
  CONTROLS_COMMON_VOTENO: T('c_PIVoteNo'),
  // INFANTRY 1/2
  CONTROLS_INFANTRY_FORWARD: A('c_PIThrottle', 1),
  CONTROLS_INFANTRY_BACKWARD: A('c_PIThrottle', -1),
  CONTROLS_INFANTRY_STRAFE_LEFT: A('c_PIYaw', -1),
  CONTROLS_INFANTRY_STRAFE_RIGHT: A('c_PIYaw', 1),
  CONTROLS_INFANTRY_JUMP: T('c_PIAction'),
  CONTROLS_INFANTRY_WALK: T('c_PIWalk'),
  CONTROLS_INFANTRY_DROP: T('c_PIDrop'),
  CONTROLS_INFANTRY_FIRE: T('c_PIFire'),
  CONTROLS_INFANTRY_ALT_FIRE: T('c_PIAltFire'),
  CONTROLS_INFANTRY_RELOAD: T('c_PIReload'),
  CONTROLS_INFANTRY_NEXT_WEAPON: T('c_PINextItem'),
  CONTROLS_INFANTRY_PREV_WEAPON: T('c_PIPrevItem'),
  // INFANTRY 2/2
  CONTROLS_INFANTRY_WEAPON_1: T('c_PIMenuSelect1'),
  CONTROLS_INFANTRY_WEAPON_2: T('c_PIMenuSelect2'),
  CONTROLS_INFANTRY_WEAPON_3: T('c_PIMenuSelect3'),
  CONTROLS_INFANTRY_WEAPON_4: T('c_PIMenuSelect4'),
  CONTROLS_INFANTRY_WEAPON_5: T('c_PIMenuSelect5'),
  CONTROLS_INFANTRY_WEAPON_6: T('c_PIMenuSelect6'),
  CONTROLS_INFANTRY_CROUCH: T('c_PICrouch'),
  CONTROLS_INFANTRY_PRONE: T('c_PILie'),
  // AIR 1/2
  CONTROLS_AIR_SPEEDUP: A('c_PIThrottle', 1),
  CONTROLS_AIR_SLOWDOWN: A('c_PIThrottle', -1),
  CONTROLS_AIR_STRAFE_LEFT: A('c_PIYaw', -1),
  CONTROLS_AIR_STRAFE_RIGHT: A('c_PIYaw', 1),
  CONTROLS_AIR_PITCH_UP: A('c_PIPitch', -1),
  CONTROLS_AIR_PITCH_DOWN: A('c_PIPitch', 1),
  CONTROLS_AIR_ROLL_LEFT: A('c_PIRoll', -1),
  CONTROLS_AIR_ROLL_RIGHT: A('c_PIRoll', 1),
  CONTROLS_AIR_FIRE: T('c_PIFire'),
  CONTROLS_AIR_ALT_FIRE: T('c_PIAltFire'),
  CONTROLS_AIR_TOGGLE_MOUSE: T('c_PIMouseLook'),
  CONTROLS_AIR_POS_1: T('c_PIMenuSelect1'),
  // AIR 2/2 (the game's own keys drop an S on the last three)
  CONTROLS_AIR_POS_2: T('c_PIMenuSelect2'),
  CONTROLS_AIR_POS_3: T('c_PIMenuSelect3'),
  CONTROL_AIR_POS_4: T('c_PIMenuSelect4'),
  CONTROL_AIR_POS_5: T('c_PIMenuSelect5'),
  CONTROL_AIR_POS_6: T('c_PIMenuSelect6'),
  // LAND & SEA 1/2
  CONTROLS_LANDSEA_SPEEDUP: A('c_PIThrottle', 1),
  CONTROLS_LANDSEA_SLOWDOWN: A('c_PIThrottle', -1),
  CONTROLS_LANDSEA_TURNLEFT: A('c_PIYaw', -1),
  CONTROLS_LANDSEA_TURNRIGHT: A('c_PIYaw', 1),
  CONTROLS_LANDSEA_DOWN: A('c_PIPitch', -1),
  CONTROLS_LANDSEA_UP: A('c_PIPitch', 1),
  CONTROLS_LANDSEA_FIRE: T('c_PIFire'),
  CONTROLS_LANDSEA_ALT_FIRE: T('c_PIAltFire'),
  CONTROLS_LANDSEA_POS_1: T('c_PIMenuSelect1'),
  CONTROLS_LANDSEA_POS_2: T('c_PIMenuSelect2'),
  CONTROLS_LANDSEA_POS_3: T('c_PIMenuSelect3'),
  CONTROLS_LANDSEA_POS_4: T('c_PIMenuSelect4'),
  // LAND & SEA 2/2
  CONTROLS_LANDSEA_POS_5: T('c_PIMenuSelect5'),
  CONTROLS_LANDSEA_POS_6: T('c_PIMenuSelect6'),
};

/** The layout's tab id -> the control map (`controls.js` context) its rows
 *  read. COMMON reads the common map alone. */
export const TAB_CONTEXT = { common: null, infantry: 'infantry', air: 'air', landSea: 'land' };

/** The profile variables the right-hand panel shows, per tab, under the
 *  names the layout's conditions read them by. */
export const TAB_OPTIONS = {
  common: { mouse: 'game.setCommonMouseSensitivity' },
  infantry: { mouse: 'game.setInfMouseSensitivity',
              invert: ['game.setInfMouseInvert', 'Options/Controls/Infantry/InfMouseInvert'] },
  air: { mouse: 'game.setAirMouseSensitivity', keyboard: 'game.setAirKeyboardSensitivity',
         invert: ['game.setAirMouseInvert', 'Options/Controls/Air/AirMouseInvert'] },
  landSea: { mouse: 'game.setLandSeaMouseSensitivity',
             keyboard: 'game.setLandSeaKeyboardSensitivity',
             invert: ['game.setLandSeaMouseInvert', 'Options/Controls/LandSea/LandSeaMouseInvert'] },
};
