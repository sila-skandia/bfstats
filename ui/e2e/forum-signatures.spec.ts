import { test, expect, type Page } from '@playwright/test';

// The forum signature builders (features/forum-signatures): the mod strip and scene
// cards come from the API's art catalogue, a pick goes into the signature URL, and the
// API answers that URL with a PNG of the size asked for.

const PLAYER = 'Alpha Player';
const SERVER = 'E2E Test Server';
// The seed has per-server stats only (lifetime totals come from the hourly aggregate job),
// so the player's signatures here are scoped to the seeded server.
const SERVER_GUID = 'e2e-server-1';

async function previewSize(page: Page, selector: string) {
  const img = page.locator(selector);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), { timeout: 20000 })
    .toBeGreaterThan(0);
  return img.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight, src: el.getAttribute('src') ?? '' }));
}

test.describe('Forum signatures', () => {
  test('a player picks a mod and a scene and gets that signature', async ({ page }) => {
    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`);
    await page.getByRole('button', { name: 'Signature' }).first().click();
    await page.locator('#mm-sig-server').selectOption(SERVER_GUID);

    const mods = page.getByRole('radiogroup', { name: 'Mod' }).getByRole('radio');
    await expect(mods).toHaveCount(9);

    await mods.filter({ hasText: 'FHSW' }).click();
    const scenes = page.getByRole('radiogroup', { name: /Forgotten Hope: Secret Weapon scenes/ }).getByRole('radio');
    await expect(scenes.first()).toBeVisible();
    await scenes.filter({ hasText: 'King Tiger fires' }).click();
    await page.getByRole('radio', { name: /Large/ }).click();

    const preview = await previewSize(page, '.mm-sig__img');
    expect(preview.src).toContain('mod=fhsw');
    expect(preview.src).toContain('scene=armour');
    expect(preview.src).toContain(`server=${SERVER_GUID}`);
    expect(preview).toMatchObject({ w: 1280, h: 320 });
    await expect(page.locator('.mm-sig__share-input').first()).toHaveValue(/\[img\].*mod=fhsw.*\[\/img\]/);
  });

  test('a server signature wears the server\'s own mod until another is picked', async ({ page }) => {
    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`);
    const own = page.getByRole('radio', { name: "Server's mod" });
    await own.scrollIntoViewIfNeeded();
    await expect(own).toHaveAttribute('aria-checked', 'true');

    let preview = await previewSize(page, '.mm-sig__img');
    expect(preview.src).not.toContain('mod=');
    expect(preview).toMatchObject({ w: 800, h: 200 });

    await page.getByRole('radiogroup', { name: 'Mod' }).getByRole('radio').filter({ hasText: 'GC' }).click();
    await expect(page.locator('.mm-sig__img')).toHaveAttribute('src', /mod=gcmod/);
    preview = await previewSize(page, '.mm-sig__img');
    expect(preview.w).toBe(800);
  });

  test('old style links still render', async ({ request }) => {
    const res = await request.get(`/stats/players/${encodeURIComponent(PLAYER)}/banner.png?style=tank&server=${SERVER_GUID}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    const server = await request.get(`/stats/servers/${encodeURIComponent(SERVER)}/banner.png?style=waveform&w=960`);
    expect(server.status()).toBe(200);
  });
});
