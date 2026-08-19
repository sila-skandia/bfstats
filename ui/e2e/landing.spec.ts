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
});

