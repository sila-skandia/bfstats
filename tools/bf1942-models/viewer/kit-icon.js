/* Which packed sprite a kit's own photograph resolves to.
 *
 * `_shared/loadouts.json` records each kit's `kitIcon.icon` exactly as
 * `ObjectTemplate.setKitIcon <slot> "<path>"` spells it in the mod's own
 * `.con` files -- vanilla's `kits/Icon_antitank_allies_selected.tga`, Eve of
 * Destruction's `kits/arvn/at_selected.dds`, Road to Rome's 1.6-patch
 * `kits/Icon_assault_breda_axis_selected.tga` and Secret Weapons'
 * `kits/Kit_AlliesAssault_Bren.dds` -- and neither the casing nor the
 * declared extension can be trusted: the game reads a `.dds` off a path
 * that spells `.tga` as often as it spells the real one.
 *
 * `extract_hud_pack.py` packs a kit photograph under its lowercased
 * basename alone (`at_selected`) unless two files under `Kits/` collide on
 * that basename, in which case `dir_glob_renames` qualifies every one of
 * them with its own immediate parent directory (`nva_at_selected`,
 * `arvn_at_selected`, ...) -- Eve of Destruction alone puts a dozen
 * nations' worth of `assault_selected.dds` under `Kits/<Nation>/`. That is
 * the same rule that already separates `Ammo/Icon_demokit.dds` from
 * `Weapon/Icon_demokit.dds`; see the extractor's own comments.
 *
 * This is the reader's half of that rule: given the authored path, the
 * candidate sprite keys the pack might have filed it under, most specific
 * first. Only one of the two is ever actually in a given pack (whichever
 * the extractor decided at build time), so trying the qualified name and
 * falling back to the bare one costs nothing when it is not needed --
 * vanilla's root-level photographs, which never collide, are always found
 * on the second try.
 */

/** `"kits/arvn/at_selected.dds"` -> `["arvn_at_selected", "at_selected"]`;
 *  `"kits/Icon_antitank_allies_selected.tga"` ->
 *  `["kits_icon_antitank_allies_selected", "icon_antitank_allies_selected"]`
 *  (nothing ever qualifies with `kits` itself, so only the second candidate
 *  is ever real, but computing it uniformly needs no special case for the
 *  root). Case-insensitive and extension-blind throughout, matching
 *  `hud.js`'s `spriteKeyFromRef` and `extract_hud_pack.py`'s own basenaming
 *  -- backslashes are normalised the same way `icon_key()` does there.
 */
export function kitIconCandidates(iconPath) {
  if (typeof iconPath !== 'string' || !iconPath) return [];
  const parts = iconPath.replace(/\\/g, '/').toLowerCase()
    .split('/').filter(Boolean);
  if (parts.length === 0) return [];
  const stripExt = name => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };
  const basename = stripExt(parts[parts.length - 1]);
  if (parts.length < 2) return [basename];
  const dir = parts[parts.length - 2];
  return [`${dir}_${basename}`, basename];
}

/** The sprite key a loaded pack actually has for a kit icon path, trying
 *  each candidate in turn, or null when neither is packed (a mod's icon
 *  the pack has not caught up to, or a kit with no `kitIcon` at all). `has`
 *  is a `(key) => boolean` test against the loaded pack -- `hudPack.sprites`
 *  (a `Map`) in `map.html`, a plain `Set` in tests. */
export function resolveKitIcon(iconPath, has) {
  for (const candidate of kitIconCandidates(iconPath)) {
    if (has(candidate)) return candidate;
  }
  return null;
}
