// tests/test_dynamic_shadows.py: `viewer/dynamic-shadows.js` under node.
import * as law from '../viewer/dynamic-shadows.js';
import { DEFAULT_VIDEO, PRESETS } from '../viewer/video-settings.js';

const out = {};
out.constants = {
  range: law.SHADOW_RANGE, texture: law.SHADOW_TEXTURE, pool: law.SHADOW_POOL,
  maxHeight: law.SHADOW_MAX_HEIGHT, radiusScale: law.SHADOW_RADIUS_SCALE, radiusMax: law.SHADOW_RADIUS_MAX,
  redraw: law.SHADOW_REDRAW_DIST2, band: law.SHADOW_FADE_BAND, minY: law.LIGHT_MIN_Y, setY: law.LIGHT_SET_Y,
  color: law.DEFAULT_SHADOW_COLOR,
};
const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
out.light = {
  // El Alamein's `sky.sunLightDirectionVec -0.75/0.46/0.46`, Wake's, a noon sun, a sun under the horizon.
  alamein: law.shadowLight(unit([-0.75, 0.46, 0.46])),
  wake: law.shadowLight(unit([-0.295, 0.496, -0.816])),
  noon: law.shadowLight([0, 1, 0]),
  steep: law.shadowLight(unit([0.3, 0.9, 0.1])),
  under: law.shadowLight(unit([0.6, -0.5, 0.6])),
};
out.radius = [law.shadowRadius(1), law.shadowRadius(8.28), law.shadowRadius(99), law.shadowRadius(400)];
out.heightByte = [0, 1, 5, 9.99, 10, 10.01, -3, 12].map(h => law.heightByte(h));
out.fade = [[1.5, 10], [1.5, 46.5], [1.5, 49], [1.5, 51.5], [1.5, 60], [8, 55.5]].map(([r, d]) => law.rangeFade(r, d));
out.alpha = {
  ground: law.shadowAlpha({ colorAlpha: 0.55, byte: 255, radius: 2, distance: 10 }),
  halfway: law.shadowAlpha({ colorAlpha: 0.55, byte: law.heightByte(5), radius: 2, distance: 10 }),
  edge: law.shadowAlpha({ colorAlpha: 0.55, byte: 255, radius: 2, distance: 49.5 }),
  past: law.shadowAlpha({ colorAlpha: 0.55, byte: 255, radius: 2, distance: 52 }),
  high: law.shadowAlpha({ colorAlpha: 0.55, byte: law.heightByte(11), radius: 2, distance: 10 }),
  solid: law.shadowAlpha({ byte: 255, radius: 2, distance: 10 }),
};
out.color = {
  one: law.parseShadowColor('0.550000'), bare: law.parseShadowColor('.4'), three: law.parseShadowColor('0.36/0.36/0.38'),
  four: law.parseShadowColor('0.2/0.3/0.6/0.9'), number: law.parseShadowColor(0.55), list: law.parseShadowColor([0.36, 0.36, 0.38, 0.38]),
  short: law.parseShadowColor([0.3, 0.3, 0.36]), none: law.parseShadowColor(null), junk: law.parseShadowColor('x'),
};
out.camera = law.shadowCamera([10, 20, 30], [0, 1, 0], 2);
{
  const pool = new law.ShadowPool(3);
  const step = keys => Object.fromEntries(pool.claim(keys));
  out.pool = [
    step(['a', 'b']),            // two take slots
    step(['a', 'b', 'c', 'd']),  // c takes the last; d goes without
    step(['d', 'a']),            // b and c idle: d takes the one idle longest (they tie; the first)
    step(['b', 'a', 'd']),       // b lost its slot to d? it takes c's
    step([]),
    step(['a']),                 // a finds its own slot again
  ];
}
{
  const set = law.shadowTemplates({ templates: ['Willy', 'm10', 'britsoldier3pbody'] });
  out.casts = {
    exact: law.castsShadow(set, 'M10'), dup: law.castsShadow(set, 'Willy_2'), part: law.castsShadow(set, 'M10Tower'),
    none: law.castsShadow(null, 'M10'), missing: law.shadowTemplates({}) === null,
  };
}
{
  // A scene as the page builds one, in plain objects: what the walk gathers.
  const node = (name, userData = {}, children = [], extra = {}) => {
    const n = { name, userData, children, ...extra };
    for (const c of children) c.parent = n;
    return n;
  };
  const pco = name => node(name, { templateKind: 'PlayerControlObject', name: name.replace(/_\d+$/, '') },
    [node(`${name}PassengerPCO`, { templateKind: 'PlayerControlObject', name: 'Willy' })]);
  const rig = () => node('', {}, [node('USSoldier holding Thompson', { soldier: {}, rig: {} })]);
  let deep = pco('Willy_9');
  for (let i = 0; i < 8; i++) deep = node(`deep${i}`, {}, [deep]);
  const scene = node('scene', {}, [
    node('effects', {}, [pco('Willy_fx')]),
    node('sky', { kind: 'sky' }, [pco('Willy_sky')]),
    node('', { staticObjectsConMarked: true }, [                      // the level root
      node('Tx00x00', { kind: 'terrain' }, [], { isMesh: true }),
      pco('Sherman'),                                                 // baked straight under the level
      node('spawners', { kind: 'spawners' }, [pco('Willy'), pco('Willy_1'), pco('Fletcher'), pco('Defgun')]),
      node('controlPoints', { kind: 'controlPoints' }, []),
      node('afr_house1', { templateKind: 'SimpleObject', name: 'afr_house1' }, [pco('Willy_inStatic')]),
      node('hangar', {}, [pco('Willy_inMesh')], { isMesh: true }),
      node('lods', {}, [pco('Willy_inLod')], { isLOD: true }),
    ]),
    node('remote-room', {}, [node('remote vehicle 2 Willy', {}, [node('', {}, [pco('Willy')])]), node('remote soldier 3', {}, [rig()])]),
    node('replay', {}, [node('replay Tiger 521', {}, [node('', {}, [pco('Tiger')])])]),
    node('bot-renderers', {}, [node('bot A', {}, [rig()])]),
    deep,
  ]);
  const templates = law.shadowTemplates({ templates: ['willy', 'sherman', 'tiger'] });
  const found = [];
  law.gatherCasters(scene, templates, (root, kind) => {
    const chain = []; for (let p = root.parent; p && p !== scene; p = p.parent) chain.push(p.name || '(level)');
    found.push(`${kind}:${root.name || '(rig group)'} < ${chain.join(' < ')}`);
  });
  const skipped = [];
  law.gatherCasters(scene, templates, root => skipped.push(root.name), scene.children[3]);
  out.gather = { found, withoutRoom: skipped.length, depth: law.CASTER_WALK_DEPTH, groups: [...law.CASTER_SKIP_GROUPS] };
}
out.video = { default: DEFAULT_VIDEO.shadows, presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p.shadows])) };
console.log(JSON.stringify(out));
