// Drives `viewer/kit-graft.js` outside a browser and prints one JSON blob.
// The module imports nothing, so the copied file is the whole harness.
import { SLOT_ROTATION, slotRotation, quatMul, kitPartRotation,
         wornGrafts, bonePattern, kitsByTemplate, kitForLevel } from './kit-graft.mjs';

const out = {};

out.slotRotation = SLOT_ROTATION;
out.unknownSlotIsIdentity = slotRotation('sporran');

// The real vanilla row, verbatim from `models/kits.json`.
const GB_AT = {
  template: 'GB_AT',
  worn: [
    { template: 'Brit_helmet', geometry: 'Brit_helmet', slot: 'head',
      bone: 'A', position: [0, 0, 0], rotation: [0, 0, 0],
      glb: 'Brit_helmet.kit.glb' },
    { template: 'Brit_backpack', slot: 'back', bone: 'backpack',
      glb: 'Brit_backpack.kit.glb' },
    { template: 'Brit_hippack', slot: 'hip', bone: 'HipPack',
      glb: 'Brit_hippack.kit.glb' },
  ],
};
out.vanilla = wornGrafts(GB_AT);

// A worn template the extractor could not resolve has no mesh to hang.
out.noGlbIsDropped = wornGrafts({ worn: [{ slot: 'head', bone: 'A' }] });

// The viewer's per-slot switches.
out.hidden = wornGrafts(GB_AT, new Set(['back', 'hip'])).map(g => g.slot);

// FH-style extra offsets compose on top of the slot rotation rather than
// replacing it.
const OFFSET = { worn: [{ glb: 'x.glb', slot: 'head', bone: 'A',
                          position: [0.01, 0.02, 0.03], rotation: [90, 0, 0] }] };
out.offset = wornGrafts(OFFSET)[0];
out.offsetEqualsComposition = JSON.stringify(out.offset.quaternion)
  === JSON.stringify(quatMul(SLOT_ROTATION.head, kitPartRotation([90, 0, 0])));

out.bones = {
  hipPackLowercase: bonePattern('HipPack').test('hippack'),
  hipPackUnderscore: bonePattern('Hip Pack').test('Hip_Pack'),
  aIsNotAnywhere: bonePattern('A').test('Bip01 Head'),
  aMatchesItself: bonePattern('A').test('A'),
};

const index = kitsByTemplate({ kits: [GB_AT, { template: 'US_Assault' }] });
out.index = { size: index.size, caseInsensitive: !!index.get('gb_at') };

// A level's own copy of the kit (`levelVariants`): its worn parts and its bag
// on that level, the mod's anywhere else.
const RATTRAP = {
  template: '3GB_SpecOpsLewesBombP', nation: 'GB', primary: 'StenMk2',
  pickup: { geometry: 'Kit_GB_SpecOps', glb: 'Kit_GB_SpecOps__pickup.kit.glb' },
  worn: GB_AT.worn,
  levelVariants: [
    { levels: ['Operation_Rattrap'], source: 'bf1942/levels/Operation_Rattrap/x.con',
      nation: null,
      pickup: { geometry: 'Kit_stenMk2_m1', glb: 'Kit_stenMk2_m1__pickup@Operation_Rattrap.kit.glb' },
      worn: [GB_AT.worn[0]] },
    { levels: ['Old_Tree'], pickup: { geometry: 'Kit_Old', glb: null }, primary: 'No4' },
  ],
};
const onRattrap = kitForLevel(RATTRAP, 'operation_rattrap');
const onOld = kitForLevel(RATTRAP, 'Old_Tree');
out.levelVariant = {
  pickup: onRattrap.pickup.glb,
  worn: wornGrafts(onRattrap).map(g => g.glb),
  nationKept: onRattrap.nation,
  sourceKept: onRattrap.source ?? null,
  elsewhere: kitForLevel(RATTRAP, 'Berlin-1945') === RATTRAP,
  noLevel: kitForLevel(RATTRAP, '') === RATTRAP,
  noGlbKeepsBag: onOld.pickup.glb,
  noGlbStillTakesTheRest: onOld.primary,
  baseUntouched: RATTRAP.pickup.glb,
};

console.log(JSON.stringify(out, null, 1));
