// Drives `viewer/kit-graft.js` outside a browser and prints one JSON blob.
// The module imports nothing, so the copied file is the whole harness.
import { SLOT_ROTATION, slotRotation, quatMul, kitPartRotation,
         wornGrafts, bonePattern, kitsByTemplate } from './kit-graft.mjs';

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

console.log(JSON.stringify(out, null, 1));
