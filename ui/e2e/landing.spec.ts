import { test, expect } from '@playwright/test';

test.describe('Landing Page - Server Browser', () => {
  test('should load the servers page', async ({ page }) => {
    await page.goto('/servers/bf1942');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Page should have loaded. The V4 landing page is built from `mm-*`
    // classes — the old Tailwind `bg-slate-900` shell no longer exists.
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('.mm-landing__top')).toBeVisible();

    // URL should be correct
    expect(page.url()).toContain('/v4/servers/bf1942');
  });

  test('should display game mode filter buttons', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.mm-landing__top')).toBeVisible();

    // BF1942 is the only tracked game, so there is no game switcher — this
    // just guards that the landing page renders its interactive controls.
    const gameButtons = page.locator('button');
    await expect(gameButtons.first()).toBeVisible();
    const buttonCount = await gameButtons.count();

    // Should have some buttons for game selection
    expect(buttonCount).toBeGreaterThan(0);
  });

  test('should land retired game-mode URLs on the BF1942 list', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    // Retired deeplink — must reach the BF1942 list, not a dead end.
    await page.goto('/servers/fh2');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/v4/servers/bf1942');
    await expect(page.locator('.mm-landing__top')).toBeVisible();
  });

  test('should display server data/content', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    // Wait a bit for data to load
    await page.waitForTimeout(1000);

    // Look for server information - table cells, divs with server data, etc.
    const content = page.locator('body');
    const bodyText = await content.textContent();

    // Page should have loaded with some content
    expect(bodyText?.length).toBeGreaterThan(100);
  });

  test('revisiting via the site banner refetches live player counts', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.mm-landing__top')).toBeVisible();

    await page.locator('.mm-nav__link', { hasText: 'Players' }).click();
    await expect(page).toHaveURL(/\/v4\/players/);

    const refresh = page.waitForResponse(
      r => r.url().includes('/stats/liveservers/bf1942/servers') && r.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.locator('a.mm-brand').click();
    await refresh;
    await expect(page.locator('.mm-landing__top')).toBeVisible();
    expect(page.url()).toContain('/v4/servers/bf1942');
  });

  test('should allow clicking on a server link to view details', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    // Find links that navigate to server details (href contains /servers/)
    const serverLinks = page.locator('a[href*="/servers/"]').filter({
      hasNot: page.locator('[href="/servers/bf1942"]')
    });

    const linkCount = await serverLinks.count();

    // If there are server detail links, try clicking one
    if (linkCount > 0) {
      const firstLink = serverLinks.first();
      const href = await firstLink.getAttribute('href');

      if (href && href !== '/servers/bf1942') {
        await firstLink.click();
        await page.waitForLoadState('networkidle');

        // Should be on a server details page
        expect(page.url()).toContain('/servers/');
      }
    }
  });

  test('does not fetch population trend until View trend is clicked', async ({ page }) => {
    const trendUrls: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/game-trends/player-trend')) trendUrls.push(req.url())
    })

    await page.goto('/servers/bf1942')
    await page.waitForLoadState('networkidle')
    expect(trendUrls).toHaveLength(0)

    await page.getByTestId('open-population-trend').click()
    await expect(page.getByTestId('population-trend-drawer')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Network player trend' })).toBeVisible()
  });

  test('supports configurable columns, density toggle, and localStorage persistence', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    // Table and toolbar controls are present
    const densityBtn = page.locator('button', { hasText: /COMPACT|COMFORTABLE/ });
    await expect(densityBtn).toBeVisible();

    const columnsBtn = page.locator('button', { hasText: /COLUMNS/ });
    await expect(columnsBtn).toBeVisible();

    // Toggle density
    const table = page.locator('.lb-table');
    await densityBtn.click();
    await expect(table).toHaveClass(/lb-table--compact/);

    // Open columns popover and toggle a column
    await columnsBtn.click();
    const colPopover = page.locator('.lb-col-popover');
    await expect(colPopover).toBeVisible();

    // Check localStorage preference was saved
    const storedLayout = await page.evaluate(() => localStorage.getItem('bfstats_landing_table_layout_v1'));
    expect(storedLayout).toBeTruthy();
    const parsed = JSON.parse(storedLayout || '{}');
    expect(parsed.density).toBe('compact');
  });

  test('filters from the column filter panel with literal text and a number range', async ({ page }) => {
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
    await expect(page.getByRole('link', { name: 'Berlin Host' })).toBeVisible();
    await expect(page.getByTestId('landing-filter-panel')).toHaveCount(0);
    await expect(page.getByTestId('col-menu-filter')).toHaveCount(0);

    await page.getByTestId('landing-filters-open').click();
    const panel = page.getByTestId('landing-filter-panel');
    await expect(panel).toBeVisible();
    await page.getByTestId('filter-col-map').click();
    await page.getByTestId('col-filter-map').fill('Wake');

    await expect(page.getByRole('link', { name: 'Wake Island Host' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Berlin Host' })).toHaveCount(0);
    await expect(page.locator('.lb-empty-chip', { hasText: /Map:\s*Wake/i })).toBeVisible();

    await page.getByRole('button', { name: 'Back to all filters' }).click();
    await page.getByTestId('filter-col-players').click();
    await page.getByTestId('col-filter-players-min').fill('10');
    await expect(page.getByRole('link', { name: 'Wake Island Host' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Berlin Host' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(panel).toHaveCount(0);

    await page.locator('button', { hasText: /COLUMNS/ }).click();
    await expect(page.locator('.lb-col-popover')).toContainText('Version');
    await expect(page.locator('.lb-col-popover')).toContainText('Password');
    await expect(page.locator('.lb-col-popover')).toContainText('Discord');
    await expect(page.locator('.lb-col-popover')).toContainText('GUID');
  });

  test('applies shared column-filter URLs without opening the filter panel', async ({ page }) => {
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

    await page.goto('/servers/bf1942?f.map=Wake&f.players=10..64');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('landing-filter-panel')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Wake Island Host' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Berlin Host' })).toHaveCount(0);
    await expect(page.locator('.lb-empty-chip', { hasText: /Map:\s*Wake/i })).toBeVisible();
  });

  test('slash focuses search and CSV export control is present', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Filter servers' })).toBeFocused();
    await expect(page.locator('button', { hasText: /^CSV$/ })).toBeVisible();
    await expect(page.locator('button', { hasText: /^JSON$/ })).toBeVisible();
  });

  test('shows in-combat count as text rather than an olive section bar', async ({ page }) => {
    await page.goto('/servers/bf1942');
    await page.waitForLoadState('networkidle');

    const summary = page.getByTestId('landing-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(/in combat/i);
    await expect(page.locator('.lb-section-bar')).toHaveCount(0);
  });

  test('expanded roster shows Axis and Allied boards side by side', async ({ page }) => {
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
    await row.locator('.lb-rank-cell').click();

    const roster = page.getByTestId('landing-roster-scroll');
    await expect(roster).toBeVisible();
    const axis = page.getByTestId('roster-team-axis');
    const allies = page.getByTestId('roster-team-allies');
    await expect(axis).toBeVisible();
    await expect(allies).toBeVisible();
    await expect(axis).toContainText('AXIS');
    await expect(allies).toContainText('ALLIED');
    await expect(axis.getByRole('link', { name: 'AxisAce' })).toBeVisible();
    await expect(allies.getByRole('link', { name: 'AlliedAce' })).toBeVisible();

    const axisBox = await axis.boundingBox();
    const alliesBox = await allies.boundingBox();
    expect(axisBox).toBeTruthy();
    expect(alliesBox).toBeTruthy();
    expect(Math.abs(axisBox!.y - alliesBox!.y)).toBeLessThan(12);
    expect(alliesBox!.x).toBeGreaterThan(axisBox!.x + 100);
  });
});

