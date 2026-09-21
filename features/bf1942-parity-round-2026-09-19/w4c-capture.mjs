// W4-C capture: a vehicle in an external view, the turret at 0 and traversed.
//
//   node w4c_capture.mjs <tag> <vehicleName> <mode> [chaseOption] [traverseDeg]
//
// Writes <tag>-t0.png and, for a turreted vehicle, <tag>-t90.png, plus
// <tag>.json with the numbers the pictures are meant to show.
import { chromium } from '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright/index.mjs';
import { writeFile, mkdir } from 'node:fs/promises';

const [tag, vehicleName, mode = 'chase', chaseOpt = '', traverse = '90'] = process.argv.slice(2);
const OUT = (process.env.W4C_OUT || '/tmp/w4c-camera') + '/';
const url = `http://localhost:5323/map.html?mod=bf1942&map=el_alamein&shots&noaudio`
  + (chaseOpt ? `&chase=${chaseOpt}` : '');
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  args: process.env.W4C_SOFT ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => typeof window.__renderOnce === 'function', null, { timeout: 180000 });
await page.evaluate(() => window.__warmup?.());

// The world only ticks an occupied vehicle for a player it knows: deploy first.
await page.evaluate(() => { window.__setOnFoot(true); });
await page.evaluate(() => window.__deploy?.spawn?.());
const owner = await page.evaluate(name => window.__vehicles().find(v => v.name === name)?.owner ?? null, vehicleName);
if (owner == null) throw new Error(`no ${vehicleName} in the level`);
await page.evaluate(o => window.__enterOwner(o), owner);
await page.evaluate(() => window.__cockpitReady?.());
await page.evaluate(m => window.__setView(m), mode);

const step = (n, dt = 0.1) => page.evaluate(([count, d]) => {
  for (let i = 0; i < count; i += 1) window.__renderOnce(1280, 800, d);
}, [n, dt]);
const read = () => page.evaluate(() => {
  const T = window.__THREE;
  const cam = window.__camera;
  const car = window.__car || window.__aircraft;
  const fwd = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const hull = new T.Vector3(0, 0, -1).applyQuaternion(car.state.orientation);
  const deg = v => Math.round(Math.atan2(-v.x, -v.z) * 18000 / Math.PI) / 100;
  const r = n => Math.round(n * 1000) / 1000;
  return {
    view: window.__view.mode,
    chase: window.__chase(),
    turret: window.__occupancy?.turretAxes ?? null,
    hullPos: car.state.position.toArray().map(r),
    hullHeadingDeg: deg(hull),
    cameraPos: cam.position.toArray().map(r),
    cameraHeadingDeg: deg(fwd),
    cameraMinusHullDeg: Math.round((((deg(fwd) - deg(hull)) + 540) % 360 - 180) * 100) / 100,
  };
});
const shot = async name => {
  const data = await page.evaluate(() => window.__renderer.domElement.toDataURL('image/png'));
  await writeFile(`${OUT}${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  return `${OUT}${name}.png`;
};

const result = { tag, vehicleName, mode, chaseOpt: chaseOpt || '(default)', errors, files: [] };
await step(20); await step(20);                       // 4 s: the swoop out has settled
result.t0 = await read();
result.files.push(await shot(`${tag}-t0`));

if (result.t0.turret && Number(traverse)) {
  // Traverse through the real input path: pointer counts into the mouse stage,
  // one frame at a time, until the yaw axis reads the wanted angle.
  const want = Number(traverse);
  for (let i = 0; i < 400; i += 1) {
    const yaw = await page.evaluate(() => window.__occupancy.turretAxes.find(a => a.axis === 'yaw')?.angle ?? 0);
    if (Math.abs(yaw) >= want) break;
    await page.evaluate(() => { window.__mouseLook(40, 0); window.__renderOnce(1280, 800, 1 / 30); });
  }
  await step(20); await step(20);                     // let the view settle again
  result.t90 = await read();
  result.files.push(await shot(`${tag}-t90`));
}
await writeFile(`${OUT}${tag}.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
await browser.close();
