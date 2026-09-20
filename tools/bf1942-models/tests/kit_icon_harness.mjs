// Drives `viewer/kit-icon.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_kit_icon_js.py` copies
// the viewer module in under its own name, so the file under test is the
// file the page loads, byte for byte. The module touches no DOM and no
// `three` import, so it runs under plain node with no shimming.

import { kitIconCandidates, resolveKitIcon } from './kit-icon.js';

const results = {};

// --- candidates --------------------------------------------------------

results.candidates = {
  // Eve of Destruction: a nation-subdirectory path, qualified candidate first.
  eodNested: kitIconCandidates('kits/arvn/at_selected.dds'),
  // Vanilla: nothing to qualify with but "kits" itself, so only the second
  // candidate is ever real -- computed uniformly rather than special-cased.
  vanillaRoot: kitIconCandidates('kits/Icon_antitank_allies_selected.tga'),
  // Road to Rome's 1.6 patch and Secret Weapons: root-level, unique, `.tga`
  // authored over a `.dds` file and vice versa -- extension is never trusted.
  xpack1Patch: kitIconCandidates('kits/Icon_assault_breda_axis_selected.tga'),
  xpack2Own: kitIconCandidates('kits/Kit_AlliesAssault_Bren.dds'),
  // Casing varies by mod and must not change the answer.
  upperCase: kitIconCandidates('Kits/NVA/Assault_Selected.DDS'),
  // Backslashes, the way `hud.js`'s spriteKeyFromRef and extract_hud_pack.py's
  // icon_key() both already have to normalise them.
  backslashes: kitIconCandidates('kits\\arvn\\at_selected.dds'),
  // No directory at all -- defensive, never actually shipped this way.
  bare: kitIconCandidates('at_selected.dds'),
  // No extension.
  noExt: kitIconCandidates('kits/arvn/at_selected'),
};

results.degenerate = {
  empty: kitIconCandidates(''),
  nullish: kitIconCandidates(null),
  undef: kitIconCandidates(undefined),
  number: kitIconCandidates(42),
};

// --- resolveKitIcon ------------------------------------------------------

const pack = new Set([
  'nva_at_selected', 'vietcong_at_selected',
  'icon_antitank_allies_selected',
  'icon_assault_breda_axis_selected',
  'kit_alliesassault_bren',
]);
const has = key => pack.has(key);

results.resolve = {
  // The qualified candidate is the one actually packed.
  eodQualified: resolveKitIcon('kits/nva/at_selected.dds', has),
  // Vanilla: only the bare basename is ever packed.
  vanillaBare: resolveKitIcon('kits/Icon_antitank_allies_selected.tga', has),
  // Root-level mod icons, unique, no qualifier ever produced for them.
  xpack1: resolveKitIcon('kits/Icon_assault_breda_axis_selected.tga', has),
  xpack2: resolveKitIcon('kits/Kit_AlliesAssault_Bren.dds', has),
  // Neither candidate is in the pack -- a kit the pack has not caught up to.
  missing: resolveKitIcon('kits/french/medic_selected.dds', has),
  // No icon at all recorded for the kit.
  noIcon: resolveKitIcon(null, has),
  noIconUndefined: resolveKitIcon(undefined, has),
};

console.log(JSON.stringify(results, null, 1));
