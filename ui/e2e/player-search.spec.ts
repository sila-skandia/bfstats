import { test, expect, type Page } from '@playwright/test';

/**
 * `/players` redirects to the V4 players page, which filters by accessible
 * name rather than the old "Search players" placeholder. The global header
 * search (aria-label "Search players") also lives on this page, so the
 * page-level filter must be addressed by its own accessible name.
 */
const filterBox = (page: Page) =>
  page.getByRole('textbox', { name: /filter players by name/i });

const resultRows = (page: Page) => page.locator('table.mm-list tbody tr');

test.describe('Player Search Flow', () => {
  test('should navigate to players page', async ({ page }) => {
    await page.goto('/players');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1', { hasText: 'Players' })).toBeVisible();
    await expect(filterBox(page)).toBeVisible();
  });

  test('should search as you type with debounce', async ({ page }) => {
    await page.goto('/players');
    await page.waitForLoadState('networkidle');

    const searchInput = filterBox(page);
    await expect(searchInput).toBeVisible();

    // Results arrive without pressing Enter — the debounced watcher pushes
    // `q` into the URL and refetches.
    await searchInput.fill('player');

    await page.waitForURL(/q=player/, { timeout: 10000 });
    await expect(page.locator('.mm-skeleton')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('.mm-empty', { hasText: /temporarily unavailable/i })).toHaveCount(0);
  });

  test('should display player results in a table', async ({ page }) => {
    await page.goto('/players');
    await page.waitForLoadState('networkidle');

    await filterBox(page).fill('a');

    await expect(page.locator('table.mm-list')).toBeVisible({ timeout: 15000 });
    expect(await resultRows(page).count()).toBeGreaterThan(0);
  });

  test('should navigate to player details when clicking a result row', async ({ page }) => {
    await page.goto('/players');
    await page.waitForLoadState('networkidle');

    await filterBox(page).fill('a');

    await expect(page.locator('table.mm-list')).toBeVisible({ timeout: 15000 });
    await resultRows(page).first().click();

    await page.waitForURL(/\/players\/[^/]+/, { timeout: 10000 });
    expect(page.url().toLowerCase()).toMatch(/\/players\//);
  });
});
