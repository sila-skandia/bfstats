# The demokit icon's missing sprite

## Problem

The ExpPack and the Detonator showed the medkit icon in the soldier ammo
panel, and the engineer's slot 4 showed the wrong art in the weapon bar. Every
nation is affected, not the Russian engineer: every engineer kit's
`loadouts.json` row pairs its ExpPack with the demokit art. A US engineer on
any map had the same bug; the report named the nation the reporter was
playing.

## Cause

Vanilla ships two different images that share a basename: `Ammo/Icon_demokit.dds`
(2176 bytes, the ammo panel icon `setAmmoIcon` points at) and
`Weapon/Icon_demokit.dds` (4224 bytes, the weapon bar icon `addWeaponIcon`
points at). `extract_hud_pack.py` found that collision by hashing, and files
the pair qualified by their source directory: `ammo_icon_demokit` and
`weapon_icon_demokit`. They are the only two vanilla sprites keyed that way.

`hud.js`'s live-path lookup resolves a texture path to its lowercased
basename alone, so the ExpPack's live `Ammo/Icon_demokit.tga` asked the pack
for `icon_demokit`, found nothing, and fell to the leaf's literal default,
`icon_medkit_64x32`. The medkit icon on the demo kit was the fallback
resolution doing what it was built to do.

## Fix

`viewer/hud.js`'s `resolveTexture` now tries the live path dir-qualified
first, then bare: `ammo_icon_demokit`, then `icon_demokit`. That is
`kit-icon.js`'s `kitIconCandidates`, the reader half of the extractor's
qualification rule, restated locally because `hud.js` ships to
`tests/test_hud.py`'s harness alone and imports nothing (the header's
FREE-STANDING note). Both halve of the rule already existed; this wires the
ammo panel and the weapon bar to it.

Unqualified icons are untouched: a basename packed under one directory is
found on the second candidate, which is `kit-icon.js`'s own stated cost
model. The `Weapon/` and `Ammo/` variants also have the right shapes for
their rects, so the weapon bar's 64x64 demokit plate and the ammo panel's
64x32 one each get their own image.

## Verification

`tests/test_hud.py`, `tests/test_hud_pack_js.py` and `tests/test_kit_icon_js.py`
pass. On the live page: medic and engineer kits, hold the ExpPack, the
plunger and the medpack in turn; the ammo panel icon follows each weapon, and
the engineer's weapon bar shows the demokit art in slot 4.
