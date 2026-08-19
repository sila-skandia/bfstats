import { test, expect } from '@playwright/test';

const wakeServer = {
  guid: 'wake-1',
  name: 'Wake Island Host',
  ip: '10.0.0.1',
  port: 14567,
  numPlayers: 24,
  maxPlayers: 64,
  mapName: 'Wake Island',
  gameType: 'Conquest',
  joinLink: 'bf1942://10.0.0.1:14567',
  roundTimeRemain: 400,
  tickets1: 200,
  tickets2: 180,
  players: [],
  teams: [],
  country: 'US',
  password: false,
  gameVersion: '1.61',
};

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function mockLandingServers(page: import('@playwright/test').Page) {
  await page.route('**/stats/liveservers/bf1942/servers**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ servers: [wakeServer], lastUpdated: new Date().toISOString() }),
    });
  });
}

test.describe('Server 1-Click Connect & Copy Action', () => {
  test('desktop Play Now menu opens away from the server name', async ({ page }) => {
    await mockLandingServers(page);
    await page.goto('/v4/servers/bf1942');
    await page.waitForLoadState('networkidle');

    const row = page.locator('tr.lb-row', { has: page.getByRole('link', { name: 'Wake Island Host' }) });
    await expect(row).toBeVisible();

    const connectAction = row.locator('.mm-connect');
    const playNowLink = connectAction.getByTestId('server-connect-join');
    await expect(playNowLink).toBeVisible();
    expect(await playNowLink.getAttribute('href')).toMatch(/^bf1942:\/\//);

    await connectAction.locator('button.mm-connect__btn--copy').click();

    const menu = page.getByTestId('server-connect-menu');
    await expect(menu).toBeVisible();
    await expect(menu).not.toHaveClass(/mm-connect__menu--sheet/);
    await expect(menu.locator('.mm-connect__item', { hasText: /copy ip/i })).toBeVisible();
    await expect(menu.locator('.mm-connect__item', { hasText: /launch argument/i })).toBeVisible();
    await expect(menu.locator('.mm-connect__item', { hasText: /launch game/i })).toBeVisible();

    const nameCell = row.locator('.lb-name-cell');
    await expect(nameCell).toBeVisible();
    const menuBox = await menu.boundingBox();
    const nameBox = await nameCell.boundingBox();
    expect(menuBox).toBeTruthy();
    expect(nameBox).toBeTruthy();
    expect(boxesOverlap(menuBox!, nameBox!)).toBe(false);
  });

  test('should display Connect button in Server Details page hero', async ({ page }) => {
    await page.goto('/v4/servers/bf1942');
    await page.waitForLoadState('networkidle');

    const serverRow = page.locator('.mm-list tbody tr').first();
    if (await serverRow.isVisible()) {
      await page.goto('/v4/servers/search');
      await page.waitForLoadState('networkidle');

      const firstLink = page.locator('a[href*="/v4/servers/detail/"]').first();
      if (await firstLink.isVisible()) {
        await firstLink.click();
        await page.waitForLoadState('networkidle');

        const connectAction = page.locator('.mm-server-hero__links .mm-connect');
        if (await connectAction.isVisible()) {
          const playLink = connectAction.locator('a.mm-connect__btn--primary');
          await expect(playLink).toBeVisible();
          const href = await playLink.getAttribute('href');
          expect(href).toMatch(/^bf1942:\/\//);
        }
      }
    }
  });
});
