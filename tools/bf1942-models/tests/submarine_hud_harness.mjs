// Drives `viewer/submarine-hud.js` and the submarine half of `viewer/hud.js`
// outside a browser and prints one JSON blob for `test_submarine_hud.py`.
//
// The Gato's numbers are her `Objects.con` (`submarineData 0.009 0.03 1 10
// 19.5 40 5`, `setSubmarineHudDepthModifier 5.9`, `setSubmarineHudDirModifier
// 0.01`), typed in, not read from a glb.
import {
  submarineSpec, isSubmarine, submarineReadout, DepthLatch, DepthHudFade,
  createSubmarineHud,
} from './submarine-hud.js';
import { evalExpr, shiftOf, scrollPictureBand } from './hud.js';

const GATO = {
  vehicleType: 'VTSubmarine',
  submarineData: [0.009, 0.03, 1, 10, 19.5, 40, 5],
  submarineHudDepthModifier: 5.9,
  submarineHudDirModifier: 0.01,
};
// Desert Combat's M1A1: the crush word on a land hull.
const M1A1 = { vehicleType: 'VTTank', submarineData: [0, 0, 0, 0, 0, 1.5, 5] };
const spec = submarineSpec(GATO);
const out = {};

out.spec = spec;
out.isSubmarine = { gato: isSubmarine(GATO), m1a1: isSubmarine(M1A1), none: isSubmarine({}) };
out.offSpec = submarineSpec({ submarineData: [0, 0, 0, 0, 0, 0, 0] });

out.surface = submarineReadout(spec, { depth: 7.85, waterColumn: 20.4, setpoint: 0, oxygen: 1, bearing: 0 });
out.deepInDeepWater = submarineReadout(spec, { depth: 30, waterColumn: 60.9, setpoint: 50, oxygen: 0.456, bearing: 0.5 });
out.shallowSetpoint = submarineReadout(spec, { depth: 3, waterColumn: 20, setpoint: 50, oxygen: 1 });
out.noCrushSpec = submarineReadout({ ...spec, crushDepth: -1 }, { depth: 3, waterColumn: 33.7 });
out.belowSurface = submarineReadout(spec, { depth: 2, waterColumn: 20 });

// The latch: down through 19.5 and back up.
{
  const latch = new DepthLatch();
  const path = [10, 19.5, 19.6, 25, 19.5, 19.2, 19.09, 19.0];
  out.latch = path.map(depth => ({ depth, ...latch.update(spec, depth) }));
}

// The fade, at 1/30 s frames, for 3 s deep and then back up.
{
  const fade = new DepthHudFade();
  const frames = [];
  const dt = 1 / 30;
  for (let i = 0; i < 90; i++) frames.push({ t: +((i + 1) * dt).toFixed(4), ...fade.step(dt, true) });
  frames.push({ t: 'up', ...fade.step(dt, false) });
  out.fade = frames;
}

// The page feed end to end: the map opens on the fade and closes on the way up.
{
  const vars = {};
  const map = [];
  let boat = { physics: GATO, depth: 7.85, waterColumn: 40, setpoint: 0, oxygen: 1, bearing: 0, firstPerson: true };
  const hud = createSubmarineHud({ read: () => boat, vars: () => vars, setFullscreenMap: on => map.push(on) });
  hud.update(1 / 30);
  out.feedSurface = {
    show: vars['Submarine/ShowSubmarine'], periscope: vars['Submarine/ShowPeriscope'],
    deep: vars['Submarine/ShowDepthHud'], kit: vars['Kit/ShowKit'],
  };
  boat = { ...boat, firstPerson: false };
  hud.update(1 / 30);
  out.feedThirdPerson = vars['Submarine/ShowPeriscope'];
  boat = { ...boat, depth: 25, firstPerson: true };
  for (let i = 0; i < 60; i++) hud.update(1 / 30);
  out.feedDeep = {
    periscope: vars['Submarine/ShowPeriscope'], deep: vars['Submarine/ShowDepthHud'],
    cockpit: vars['Submarine/DepthHud/ShowSubmarineCockpit'], map: [...map],
  };
  boat = { ...boat, depth: 10 };
  hud.update(1 / 30);
  out.feedUp = { deep: vars['Submarine/ShowDepthHud'], cockpit: vars['Submarine/DepthHud/ShowSubmarineCockpit'], map: [...map] };
  boat = null;
  hud.update(1 / 30);
  out.feedOut = { show: vars['Submarine/ShowSubmarine'], depth: vars['Submarine/Depth'] ?? null, map: [...map] };
}

// The painter's halves: an expression, a shift, and a tape's band.
{
  const vars = { 'Submarine/Depth': 10, 'Submarine/MaximumDepth': 40, 'Submarine/DirectionAngle': -0.5 };
  out.expr = evalExpr({ op: 'mul', a: { op: 'div', a: { var: 'Submarine/Depth' }, b: { var: 'Submarine/MaximumDepth' } }, b: 64 }, vars);
  out.exprDivZero = evalExpr({ op: 'div', a: 3, b: { var: 'missing' } }, vars);
  out.shift = shiftOf({ shift: [{ x: { op: 'mul', a: { var: 'Submarine/DirectionAngle' }, b: 42 }, y: 0 }] }, vars);
  const tape = { valueVar: 'Submarine/Depth', maxVar: 'Submarine/MaximumDepth', yOffset: 0, size: 64, maintain: 0, fromBottom: false };
  const green = { ...tape, maintainVar: 'Submarine/PeriscopeDepth', maintain: 10 };
  const red = { ...tape, maintainVar: 'Submarine/MaxDepth', maintain: 50, fromBottom: true };
  const v = { ...vars, 'Submarine/PeriscopeDepth': 10, 'Submarine/MaxDepth': 34.1 };
  out.band = {
    tape: scrollPictureBand(tape, v, 527, 256),
    green: scrollPictureBand(green, v, 527, 256),
    red: scrollPictureBand(red, v, 527, 256),
    greenDeep: scrollPictureBand(green, { ...v, 'Submarine/Depth': 30 }, 527, 256),
    redShallow: scrollPictureBand(red, { ...v, 'Submarine/Depth': 0 }, 527, 256),
    noMax: scrollPictureBand(tape, { ...v, 'Submarine/MaximumDepth': 0 }, 527, 256),
  };
}

console.log(JSON.stringify(out));
