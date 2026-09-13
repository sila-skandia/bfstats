// Renders extracted models to deterministic PNGs without needing a visible browser.
//
//   node shoot.mjs [--url http://localhost:5273] [--out shots] [--views 3] [--variants]
//                  [--software]
//   node shoot.mjs --thumbs        # browse-view thumbnails, straight into models/
//
// Uses the Playwright chromium already installed for the E2E suite. By default this
// uses hardware-accelerated GPU rendering. Pass --software to fall back to SwiftShader
// CPU rendering for CI environments that lack a GPU.

import { chromium } from '../../ui/node_modules/playwright/index.mjs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const jobsArg = () => {
  const idx = process.argv.indexOf('-j');
  if (idx > -1) return process.argv[idx + 1];
  return arg('jobs', 1);
};
const jobs = Math.max(1, Number(jobsArg()));
const skipExisting = process.argv.includes('--skip-existing');
const exists = async path => {
  try { await stat(path); return true; } catch { return false; }
};

const url = arg('url', 'http://localhost:5273');
const out = arg('out', 'shots');
const views = Number(arg('views', 3));
const only = arg('only', null);
const allVariants = process.argv.includes('--variants');
const collision = process.argv.includes('--collision');
const useSoftware = process.argv.includes('--software');
const thumbs = process.argv.includes('--thumbs');

const slug = value => String(value || 'base')
  .replace(/[^a-z0-9]+/gi, '-')
  .replace(/^-|-$/g, '')
  .toLowerCase();

await mkdir(out, { recursive: true });

const launchArgs = useSoftware
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : [];
const browser = await chromium.launch({ args: launchArgs });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', error => console.error('page error:', error.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__modelInspector?.getCurrent());

const models = await page.evaluate(() => window.__modelInspector.manifest.map(entry => ({
  index: entry.index,
  name: entry.name,
  defaultVariant: Math.max(
    0,
    entry.variants.findIndex(variant => variant.glb === entry.glb),
  ),
  variants: entry.variants.map(variant => variant.index),
})));

if (thumbs) {
  // A square viewport, a fixed camera distance in bounding-sphere radii, and no
  // per-model reframing: that combination is what lets the browse view's scale
  // lineup draw these at a common scale by size alone.
  const dir = arg('out', 'viewer/models/thumbs');
  await mkdir(dir, { recursive: true });
  const written = [];

  const targetModels = models.filter(m => !only || m.name.toLowerCase() === only.toLowerCase());
  let nextIndex = 0;

  const pages = [page];
  for (let i = 1; i < Math.min(jobs, targetModels.length); i++) {
    const p = await browser.newPage();
    p.on('pageerror', error => console.error('page error:', error.message));
    await p.goto(url, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => window.__modelInspector?.getCurrent());
    pages.push(p);
  }

  async function worker(workerPage) {
    await workerPage.setViewportSize({ width: 820, height: 500 });
    const canvas = workerPage.locator('main canvas');
    while (true) {
      const idx = nextIndex++;
      if (idx >= targetModels.length) break;
      const model = targetModels[idx];
      const file = `${slug(model.name)}.png`;
      const outPath = `${dir}/${file}`;
      if (skipExisting && (await exists(outPath))) {
        written.push([model.name, `thumbs/${file}`]);
        continue;
      }
      try {
        await workerPage.evaluate(
          ([modelIndex, variantIndex]) =>
            window.__modelInspector.showVariant(modelIndex, variantIndex),
          [model.index, model.defaultVariant],
        );
        await workerPage.evaluate(() => window.__modelInspector.setPortrait(true));
        await workerPage.waitForTimeout(160);
        await canvas.screenshot({ path: outPath, omitBackground: false });
        written.push([model.name, `thumbs/${file}`]);
      } catch (err) {
        console.error(`[thumbs] failed ${model.name}:`, err.message);
      }
      if (written.length % 50 === 0 || written.length === targetModels.length) {
        console.log(`[thumbs] ${written.length}/${targetModels.length} (${Math.round(written.length / targetModels.length * 100)}%)`);
      }
    }
  }

  await Promise.all(pages.map(p => worker(p)));
  await browser.close();

  // Stamp the paths into the manifest so the viewer knows they exist. The
  // extractor rewrites models.json wholesale, so this runs after extraction.
  // A mod's manifest is the same file one directory deeper, and the page it
  // was shot from is the same page with `?mod=<id>`:
  //   node shoot.mjs --thumbs --url http://localhost:5273/?mod=eod \
  //     --out viewer/models/mods/eod/thumbs \
  //     --manifest viewer/models/mods/eod/models.json
  const manifestPath = arg('manifest', 'viewer/models/models.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const byName = new Map(written);
  for (const entry of manifest) {
    const thumb = byName.get(entry.name);
    if (thumb) entry.thumb = thumb;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${written.length} thumbnails to ${dir}/ and stamped ${manifestPath}`);
  process.exit(0);
}

for (const model of models) {
  if (only && model.name.toLowerCase() !== only.toLowerCase()) continue;
  const variantIndexes = allVariants ? model.variants : [model.defaultVariant];

  for (const variantIndex of variantIndexes) {
    await page.evaluate(
      ([modelIndex, selectedVariant]) =>
        window.__modelInspector.showVariant(modelIndex, selectedVariant),
      [model.index, variantIndex],
    );
    await page.waitForTimeout(150);

    const current = await page.evaluate(() => window.__modelInspector.getCurrent());
    const prefix = [
      slug(current.model),
      slug(current.configuration),
      slug(current.level),
    ].join('-');
    if (collision) {
      const collisionState = await page.evaluate(() => {
        window.__modelInspector.setCollision(true);
        return window.__modelInspector.getCollision();
      });
      if (!collisionState.roots || !collisionState.targets) {
        throw new Error(`${current.model} has no exported collision geometry`);
      }
      const legendButtons = page.locator('#legend-materials [data-material]');
      if (await legendButtons.count() > 1) {
        await legendButtons.first().click();
        const filtered = await page.evaluate(
          () => window.__modelInspector.getCollision(),
        );
        if (filtered.selectedMaterial === null
          || !filtered.visibleTargets
          || filtered.visibleTargets >= filtered.targets) {
          throw new Error(`${current.model} material legend did not isolate a region`);
        }
        await legendButtons.first().click();
        const restored = await page.evaluate(
          () => window.__modelInspector.getCollision(),
        );
        if (restored.selectedMaterial !== null
          || restored.visibleTargets !== restored.targets) {
          throw new Error(`${current.model} material legend did not restore all regions`);
        }
      }
    }

    if (process.argv.includes('--rig')) {
      // Every player input on every seat, driven through the inspector rather
      // than the crew console: a traverse dial or a drive pad has no value
      // attribute to set, and a pad drives two inputs that each deserve a shot.
      const inputs = await page.evaluate(() => window.__modelInspector.getInputs());
      for (const input of inputs) {
        // Gear is a 0 (down) .. 1 (up) pose pair, not a signed input.
        for (const value of input.gear ? [0, 1] : [-1, 0, 1]) {
          await page.evaluate(
            ([modelIndex, selectedVariant]) =>
              window.__modelInspector.showVariant(modelIndex, selectedVariant),
            [model.index, variantIndex],
          );
          await page.evaluate(
            ([key, nextValue]) => window.__modelInspector.setInput(key, nextValue),
            [input.key, value],
          );
          await page.waitForTimeout(250);
          await page.screenshot({
            path: `${out}/${prefix}-rig-${slug(input.label)}-${value}.png`,
          });
        }
      }
      continue;
    }

    for (let view = 0; view < views; view++) {
      await page.evaluate(
        ([index, total]) => window.__modelInspector.setView(index, total),
        [view, views],
      );
      if (collision) {
        // Each view asserts the unset baseline ("select a weapon") and then
        // picks a weapon to read hit points from. Without clearing it here the
        // second view inherits the first view's choice and the check fails.
        await page.evaluate(() => window.__modelInspector.setWeapon(null));
        const canvas = page.locator('main canvas');
        const bounds = await canvas.boundingBox();
        await page.mouse.click(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        );
        await page.waitForFunction(
          () => window.__modelInspector.getCollision().hit !== null,
        );
        const hit = await page.evaluate(
          () => window.__modelInspector.getCollision().hit,
        );
        if (Math.abs(hit.angle) > 0.001 || Math.abs(hit.angleFactor - 1) > 0.001) {
          throw new Error(
            `${current.model} collision inspection did not start at maximum impact`,
          );
        }
        const damageLabels = await page.locator(
          '#impact-label, .hp-loss span:last-child',
        ).allTextContents();
        if (damageLabels[0] !== 'Damage' || damageLabels[1] !== 'select a weapon') {
          throw new Error(`${current.model} collision damage labels are unclear`);
        }
        // With the damage tables present, a weapon turns the reading into hit
        // points; the model's own heaviest gun is the natural first choice.
        const damage = await page.evaluate(() => {
          const inspector = window.__modelInspector;
          const tables = inspector.getDamageTables();
          if (!tables) return null;
          const own = inspector.manifest.find(entry => entry.name === inspector.getCurrent().model)?.weapons || [];
          const baseOf = name => {
            const weapon = tables.weapons.find(candidate => candidate.name === name);
            return tables.materials[weapon?.material]?.damage ?? -1;
          };
          const weapon = [...own].sort((a, b) => baseOf(b) - baseOf(a))[0] || inspector.getWeapons()[0];
          if (!weapon) return null;
          inspector.setWeapon(weapon);
          return inspector.getDamage();
        });
        if (damage && damage.base == null) {
          throw new Error(`${current.model}: ${damage.weapon} has no materialDamage in the tables`);
        }
        if (damage) {
          const reading = await page.locator('#impact-value').textContent();
          if (!/^\d/.test(reading.trim())) {
            throw new Error(`${current.model} did not show hit points for ${damage.weapon}`);
          }
        }
        const handle = await page.evaluate(
          () => window.__modelInspector.getCollision().handle,
        );
        const dragDistance = handle.x > bounds.x + bounds.width / 2 ? -60 : 60;
        await page.mouse.move(handle.x, handle.y);
        await page.mouse.down();
        await page.mouse.move(handle.x + dragDistance, handle.y, { steps: 4 });
        await page.mouse.up();
        await page.waitForFunction(
          () => Math.abs(window.__modelInspector.getCollision().hit.angle) > 5,
        );
        const controlsEnabled = await page.evaluate(
          () => window.__controls.enabled,
        );
        if (!controlsEnabled) {
          throw new Error(`${current.model} orbit controls stayed disabled after angle drag`);
        }
        await page.evaluate(() => window.__modelInspector.setImpactAngle(0));
      }
      await page.waitForTimeout(120);
      const mode = collision ? '-collision' : '';
      await page.screenshot({ path: `${out}/${prefix}${mode}-view${view}.png` });
    }
  }
}

await browser.close();
console.log(`wrote ${out}/`);
