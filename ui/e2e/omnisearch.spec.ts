import { test, expect } from '@playwright/test';

test.describe('Global Omnisearch / Command Palette (⌘K)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/v4/servers/bf1942');
    await page.waitForLoadState('networkidle');
  });

  test('should open omnisearch modal when clicking header search bar', async ({ page }) => {
    const searchTrigger = page.locator('button.mm-search--trigger');
    await expect(searchTrigger).toBeVisible();

    await searchTrigger.click();

    const modal = page.locator('.mm-omni-modal');
    await expect(modal).toBeVisible();

    const input = page.locator('.mm-omni-input');
    await expect(input).toBeFocused();
  });

  test('should open omnisearch modal via keyboard shortcut Ctrl+K / Meta+K', async ({ page }) => {
    await page.keyboard.press('Control+KeyK');

    const modal = page.locator('.mm-omni-modal');
    await expect(modal).toBeVisible();

    const input = page.locator('.mm-omni-input');
    await expect(input).toBeFocused();

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });

  test('should display quick navigation shortcuts on empty query', async ({ page }) => {
    await page.locator('button.mm-search--trigger').click();
    const modal = page.locator('.mm-omni-modal');
    await expect(modal).toBeVisible();

    // Check quick navigation section
    await expect(page.locator('.mm-omni-section-title', { hasText: /quick navigation/i })).toBeVisible();
    await expect(page.locator('.mm-omni-item', { hasText: 'Live Servers' })).toBeVisible();
    await expect(page.locator('.mm-omni-item', { hasText: 'Compare Players' })).toBeVisible();
  });

  test('should live-search and display player/server results', async ({ page }) => {
    await page.locator('button.mm-search--trigger').click();
    const input = page.locator('.mm-omni-input');

    await input.fill('server');

    // Wait for debounced search response
    await page.waitForTimeout(400);

    const items = page.locator('.mm-omni-item');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
  });

  test('should open player results on the filtered leaderboard', async ({ page }) => {
    const playerName = 'Omni Test Player';
    await page.route('**/stats/Players/search?**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{ playerName, totalPlayTimeMinutes: 120 }],
      }),
    }));
    await page.route('**/stats/servers/search?**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    }));

    await page.locator('button.mm-search--trigger').click();
    await page.locator('.mm-omni-input').fill(playerName);
    await page.locator('.mm-omni-item', { hasText: playerName }).click();

    await expect(page).toHaveURL((url) =>
      url.pathname === '/v4/leaderboard' && url.searchParams.get('q') === playerName,
    );
  });

  test('should navigate using arrow keys and Enter', async ({ page }) => {
    await page.locator('button.mm-search--trigger').click();
    const input = page.locator('.mm-omni-input');

    await input.fill('compare');
    await page.waitForTimeout(300);

    // Press ArrowDown to highlight the compare item
    await page.keyboard.press('ArrowDown');

    // Press Enter to navigate
    await page.keyboard.press('Enter');

    await page.waitForURL(/\/players\/compare/, { timeout: 10000 });
    expect(page.url()).toContain('/players/compare');
  });

  test('should not display dashboard link when signed out', async ({ page }) => {
    await page.locator('button.mm-search--trigger').click();
    const modal = page.locator('.mm-omni-modal');
    await expect(modal).toBeVisible();

    const input = page.locator('.mm-omni-input');
    await input.fill('dashboard');
    await page.waitForTimeout(200);

    // Dashboard navigation item should not be present when logged out
    const dashboardNav = page.locator('.mm-omni-item', { hasText: 'Dashboard' });
    await expect(dashboardNav).toHaveCount(0);
  });
});
