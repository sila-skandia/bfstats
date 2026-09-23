import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5299';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/map.html?map=Wake&shots&sound=off&effects=off`, { timeout: 120000 });
await page.waitForFunction('typeof __renderOnce === "function"', null, { timeout: 120000 });
await page.waitForFunction('__vehicles().length > 0', null, { timeout: 120000 });
await page.evaluate(() => __deploy.spawn());
await page.evaluate(() => __enterOwner(__vehicles().find(v => v.name === 'Corsair').owner));
await page.waitForFunction('__plane()', null, { timeout: 30000 });
await page.evaluate(() => __cockpitReady());
await page.waitForTimeout(1500);
// spool with the real rAF loop only
await page.evaluate('__plane().setInput("c_PIThrottle", 1)');
const samples = [];
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(1000);
  samples.push(await page.evaluate(() => {
    let out = null;
    __scene.traverse(obj => {
      if (out || obj.name !== 'lodCorsairPropeller') return;
      const blur = obj.userData.propellerBlur;
      const st = obj.children.find(c => c.name === blur.static);
      const bl = obj.children.find(c => c.name === blur.blurred);
      out = { s: st.visible, b: bl.visible };
    });
    return out;
  }));
}
console.log(JSON.stringify(samples));
await page.screenshot({ path: '/tmp/kilo/cockpit-full.png' });
await browser.close();
console.log('DONE');
