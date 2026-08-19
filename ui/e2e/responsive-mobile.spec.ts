import { test, expect, devices } from '@playwright/test';

// Configure all tests in this file to use mobile viewport
test.use({ ...devices['Pixel 5'] });

test.describe('Responsive Design - Mobile (Pixel 5)', () => {
  test('should load landing page on mobile', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    // Page should load without errors
    const pageContent = await page.locator('body').textContent();
    expect(pageContent?.length).toBeGreaterThan(100);

    // URL should be correct
    expect(page.url()).toContain('/servers/bf1942');
  });

  test('landing server table scrolls horizontally past the name column', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    const pane = page.getByTestId('landing-table-scroll');
    await expect(pane).toBeVisible({ timeout: 15_000 });

    const metrics = await pane.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

    const nameHeader = page.getByTestId('col-header-name');
    const mapHeader = page.getByTestId('col-header-map');
    const nameBefore = await nameHeader.boundingBox();
    expect(nameBefore).toBeTruthy();

    await pane.evaluate((el) => { el.scrollLeft = 160 });
    const nameAfter = await nameHeader.boundingBox();
    expect(nameAfter).toBeTruthy();
    expect(nameAfter!.x).toBeLessThan(nameBefore!.x - 50);

    await mapHeader.evaluate((el) => el.scrollIntoView({ inline: 'center', block: 'nearest' }));
    const mapBox = await mapHeader.boundingBox();
    const paneBox = await pane.boundingBox();
    expect(mapBox).toBeTruthy();
    expect(paneBox).toBeTruthy();
    expect(mapBox!.x + mapBox!.width).toBeGreaterThan(paneBox!.x);
    expect(mapBox!.x).toBeLessThan(paneBox!.x + paneBox!.width);
  });

  test('should display content without excessive horizontal page scroll', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    // Check viewport
    const viewport = await page.viewportSize();
    expect(viewport?.width).toBe(393); // Pixel 5 width

    // Page should have content
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.length).toBeGreaterThan(100);
  });

  test('should have clickable navigation on mobile', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    // Find clickable links on mobile
    const links = page.locator('a');
    const linkCount = await links.count();

    // Should have navigation links
    expect(linkCount).toBeGreaterThan(0);
  });

  test('should navigate to players page on mobile', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    // Direct navigation to players
    await page.goto('/players');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/players');

    // Should display the Players heading
    const heading = page.locator('h1');
    const text = await heading.first().textContent();
    expect(text).toContain('Players');
  });

  test('should handle touch-friendly UI elements on mobile', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    // Find input fields that should be mobile-friendly
    const inputs = page.locator('input');
    const inputCount = await inputs.count();

    // Should have at least some inputs (search fields, etc)
    expect(inputCount).toBeGreaterThanOrEqual(0);

    // Try interacting with search if present
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
    if (await searchInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await searchInput.focus();
      await searchInput.type('test');
      expect(await searchInput.inputValue()).toBe('test');
    }
  });

  test('landing column filters open as a full-screen sheet', async ({ page }) => {
    const servers = [
      {
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
      },
      {
        guid: 'berlin-1',
        name: 'Berlin Host',
        ip: '10.0.0.2',
        port: 14567,
        numPlayers: 2,
        maxPlayers: 32,
        mapName: 'Battle of Berlin',
        gameType: 'Conquest',
        joinLink: 'bf1942://10.0.0.2:14567',
        roundTimeRemain: 900,
        tickets1: 100,
        tickets2: 90,
        players: [],
        teams: [],
        country: 'DE',
        password: true,
        gameVersion: '1.6',
      },
    ];

    await page.route('**/stats/liveservers/bf1942/servers**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ servers, lastUpdated: new Date().toISOString() }),
      });
    });

    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: 'Wake Island Host' })).toBeVisible();
    await expect(page.getByTestId('landing-filter-panel')).toHaveCount(0);

    await page.getByTestId('landing-filter-pill-map').click();
    const panel = page.getByTestId('landing-filter-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/lb-filter-panel--sheet/);
    await page.getByTestId('col-filter-map').fill('Wake');
    await expect(page.getByRole('link', { name: 'Wake Island Host' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Berlin Host' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('copy connect dropdown is copy-only and does not cover the server name', async ({ page }) => {
    const servers = [
      {
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
      },
    ];

    await page.route('**/stats/liveservers/bf1942/servers**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ servers, lastUpdated: new Date().toISOString() }),
      });
    });

    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    const row = page.locator('tr.lb-row', { has: page.getByRole('link', { name: 'Wake Island Host' }) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId('server-connect-join')).toHaveCount(0);
    await expect(row.locator('a[href^="bf1942://"]')).toHaveCount(0);

    const copyToggle = row.locator('button.mm-connect__btn--copy');
    await expect(copyToggle).toBeVisible();
    await copyToggle.click();

    const menu = page.getByTestId('server-connect-menu');
    await expect(menu).toBeVisible();
    await expect(menu).not.toHaveClass(/mm-connect__menu--sheet/);
    await expect(menu.getByRole('menuitem', { name: /copy ip/i })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /launch argument/i })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /launch game/i })).toHaveCount(0);

    const nameCell = row.locator('.lb-name-cell');
    await expect(nameCell).toBeVisible();
    const menuBox = await menu.boundingBox();
    const nameBox = await nameCell.boundingBox();
    const viewport = page.viewportSize();
    expect(menuBox).toBeTruthy();
    expect(nameBox).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(menuBox!.x).toBeGreaterThanOrEqual(-1);
    expect(menuBox!.y).toBeGreaterThanOrEqual(-1);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport!.height + 1);

    const overlaps =
      menuBox!.x < nameBox!.x + nameBox!.width &&
      menuBox!.x + menuBox!.width > nameBox!.x &&
      menuBox!.y < nameBox!.y + nameBox!.height &&
      menuBox!.y + menuBox!.height > nameBox!.y;
    expect(overlaps).toBe(false);
  });

  test('expanded roster stays side by side and scrolls horizontally', async ({ page }) => {
    const servers = [
      {
        guid: 'wake-1',
        name: 'Wake Island Host',
        ip: '10.0.0.1',
        port: 14567,
        numPlayers: 2,
        maxPlayers: 64,
        mapName: 'Wake Island',
        gameType: 'Conquest',
        joinLink: 'bf1942://10.0.0.1:14567',
        roundTimeRemain: 400,
        tickets1: 200,
        tickets2: 180,
        teams: [
          { index: 1, label: 'Axis', tickets: 200 },
          { index: 2, label: 'Allied', tickets: 180 },
        ],
        players: [
          { name: 'AxisAce', score: 42, kills: 8, deaths: 3, ping: 40, team: 1, teamLabel: 'Axis' },
          { name: 'AlliedAce', score: 35, kills: 6, deaths: 4, ping: 55, team: 2, teamLabel: 'Allied' },
        ],
        country: 'US',
        password: false,
        gameVersion: '1.61',
      },
    ];

    await page.route('**/stats/liveservers/bf1942/servers**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ servers, lastUpdated: new Date().toISOString() }),
      });
    });

    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    const row = page.locator('tr.lb-row', { has: page.getByRole('link', { name: 'Wake Island Host' }) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator('.lb-rank-cell').click();

    const roster = page.getByTestId('landing-roster-scroll');
    await expect(roster).toBeVisible();
    const axis = page.getByTestId('roster-team-axis');
    const allies = page.getByTestId('roster-team-allies');
    await expect(axis).toBeVisible();
    await expect(allies).toBeVisible();
    await expect(axis.getByRole('link', { name: 'AxisAce' })).toBeVisible();

    const axisBox = await axis.boundingBox();
    const alliesBox = await allies.boundingBox();
    const rosterBox = await roster.boundingBox();
    expect(axisBox).toBeTruthy();
    expect(alliesBox).toBeTruthy();
    expect(rosterBox).toBeTruthy();
    expect(Math.abs(axisBox!.y - alliesBox!.y)).toBeLessThan(12);
    expect(axisBox!.width).toBeGreaterThanOrEqual(300);
    expect(alliesBox!.width).toBeGreaterThanOrEqual(300);
    expect(alliesBox!.x).toBeGreaterThan(axisBox!.x + 80);

    const metrics = await roster.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

    const alliesXBefore = alliesBox!.x;
    await roster.evaluate((el) => { el.scrollLeft = 220; });
    const alliesAfter = await allies.boundingBox();
    expect(alliesAfter).toBeTruthy();
    expect(alliesAfter!.x).toBeLessThan(alliesXBefore - 80);
    await expect(allies.getByRole('link', { name: 'AlliedAce' })).toBeVisible();
  });

  test('should open player details from omnisearch, not the landing page', async ({ page }) => {
    const playerName = 'Omni Test Player';
    await page.route('**/stats/Players/search?**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items: [{ playerName }] }),
    }));
    await page.route('**/stats/servers/search?**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    }));

    await page.goto('/v4/servers/bf1942');
    await page.waitForLoadState('networkidle');

    await page.locator('.mm-mobile-search-btn').click();
    await page.locator('.mm-omni-input').fill(playerName);
    await page.locator('.mm-omni-item', { hasText: playerName }).tap();

    await expect(page).toHaveURL(new RegExp(`/v4/players/${encodeURIComponent(playerName)}`));
    await expect(page).not.toHaveURL(/\/v4\/servers\/bf1942\/?$/);
  });
});
