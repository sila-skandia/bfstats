import { test, expect, type Page } from '@playwright/test';

/**
 * The V4 players page (`src/views/v4/PlayersV4.vue`, reached via the
 * `/players` → `/v4/players` redirect) renders a *filter* box, not the old
 * "Search players" card grid.
 *
 * Two textboxes are present on this page: the global header search
 * (aria-label "Search players") and the page's own filter
 * (aria-label "Filter players by name"). Always target the latter by its
 * accessible name — a placeholder substring match is both ambiguous between
 * the two and silently breaks whenever the copy is reworded.
 */
const filterBox = (page: Page) =>
  page.getByRole('textbox', { name: /filter players by name/i });

const resultsTable = (page: Page) => page.locator('table.mm-list');
const resultRows = (page: Page) => resultsTable(page).locator('tbody tr');

/**
 * Type into the filter and wait for the resulting API round-trip.
 *
 * This has to wait on the response, not just on the DOM: the page shows its
 * "No players match that filter." branch the moment the box is non-empty —
 * a full 350ms debounce *before* any request is sent — so an assertion made
 * straight after `fill()` will happily match that flash and read an empty
 * result set as a real one.
 */
async function applyFilter(page: Page, term: string) {
  const settled = page.waitForResponse(r => r.url().includes('/stats/players'), {
    timeout: 20000,
  });
  await filterBox(page).fill(term);
  await settled;
  await expect(page.locator('.mm-skeleton')).toHaveCount(0, { timeout: 15000 });
}

/**
 * Assert the list reached a *valid* terminal state: either rows came back or
 * the page says nothing matched. The "Player feed temporarily unavailable."
 * branch is an API failure and must not be mistaken for a pass.
 */
async function expectSettledResults(page: Page) {
  const noMatch = page.locator('.mm-empty', { hasText: /no players match/i });

  await expect
    .poll(async () => (await resultRows(page).count()) > 0 || (await noMatch.count()) > 0, {
      timeout: 15000,
    })
    .toBe(true);

  await expect(page.locator('.mm-empty', { hasText: /temporarily unavailable/i })).toHaveCount(0);
}

test.describe('Players Page - Extended Tests', () => {
  test.describe('Page Structure', () => {
    test('should display the name filter', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await expect(filterBox(page)).toBeVisible();
    });

    test('should not load the player registry before a filter is entered', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      // The page deliberately does not fetch the full player list on mount —
      // no results table, no empty state, no result count until the user types.
      await expect(filterBox(page)).toHaveValue('');
      await expect(resultsTable(page)).toHaveCount(0);
      await expect(page.locator('.mm-empty')).toHaveCount(0);
      await expect(page.getByText(/\d+ results/)).toHaveCount(0);
    });
  });

  test.describe('Search Functionality', () => {
    test('should keep the typed value while debouncing', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      const searchInput = filterBox(page);
      await expect(searchInput).toBeVisible();

      // Type rapidly — the input is not cleared or reset by the debounce.
      await searchInput.pressSequentially('test', { delay: 50 });

      await expect(searchInput).toHaveValue('test');
    });

    test('should show a result count once a filter is applied', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await applyFilter(page, 'a');

      await expect(page.getByText(/Page \d+ of \d+ · [\d,]+ results/)).toBeVisible({
        timeout: 15000,
      });
    });

    test('should return to the pre-search state when the filter is emptied', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      const searchInput = filterBox(page);
      await applyFilter(page, 'a');
      await expectSettledResults(page);

      await searchInput.fill('');

      await expect(searchInput).toHaveValue('');
      await expect(resultsTable(page)).toHaveCount(0);
      await expect(page.getByText(/\d+ results/)).toHaveCount(0);
      // The `q` param is dropped from the URL too.
      await expect.poll(() => new URL(page.url()).searchParams.has('q')).toBe(false);
    });

    test('should handle special characters in search', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      // Regex-significant characters must not blow up the name highlighter.
      await applyFilter(page, '[TAG]Player');

      await expectSettledResults(page);
    });

    test('should show an empty state for a filter that matches nothing', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await applyFilter(page, 'xyznonexistentplayer12345');

      await expect(page.locator('.mm-empty', { hasText: /no players match/i })).toBeVisible({
        timeout: 15000,
      });
      await expect(resultsTable(page)).toHaveCount(0);
    });
  });

  test.describe('Player Results', () => {
    test('should display player results in the rankings table', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await applyFilter(page, 'a');
      await expectSettledResults(page);

      await expect(resultsTable(page)).toBeVisible();
      expect(await resultRows(page).count()).toBeGreaterThan(0);
    });

    test('should render the expected result columns', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await applyFilter(page, 'a');
      await expectSettledResults(page);

      // Strip the ↑/↓ indicator the active sort column carries.
      const headings = (await resultsTable(page).locator('thead th').allTextContents()).map(t =>
        t.replace(/[↑↓]/g, '').trim(),
      );

      expect(headings).toEqual(
        expect.arrayContaining(['Player', 'Status', 'Playtime', 'K/D', 'Rounds', 'Last seen']),
      );
    });

    test('should re-sort when a sortable column header is clicked', async ({ page }) => {
      // Column-header sorting is a desktop-only affordance: the design system
      // hides `thead` below 721px (`.mm-list--dense thead { display: none }`),
      // so there is no header to click in the Mobile Chrome project.
      await page.setViewportSize({ width: 1280, height: 800 });

      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await applyFilter(page, 'a');
      await expectSettledResults(page);

      // Playtime is the default sort (descending) — clicking it flips the
      // direction, which is reflected in the URL.
      await resultsTable(page).locator('thead th', { hasText: 'Playtime' }).click();

      await page.waitForURL(/sortOrder=asc/, { timeout: 10000 });
      await expectSettledResults(page);
    });
  });

  test.describe('Player Navigation', () => {
    test('should navigate to player details when clicking a result row', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await applyFilter(page, 'a');
      await expectSettledResults(page);

      await resultRows(page).first().click();

      await page.waitForURL(/\/players\/[^/]+/, { timeout: 10000 });
      expect(page.url()).toContain('/players/');
    });

    test('should maintain search state in URL', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await filterBox(page).fill('test');

      await page.waitForURL(/q=test/, { timeout: 10000 });
    });
  });

  test.describe('Responsive Design', () => {
    test('should display the name filter on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await expect(filterBox(page)).toBeVisible();
    });

    test('should allow searching on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      const searchInput = filterBox(page);
      await searchInput.fill('test');

      await expect(searchInput).toHaveValue('test');
      await page.waitForURL(/q=test/, { timeout: 10000 });
    });

    test('should display results properly on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await applyFilter(page, 'a');
      await expectSettledResults(page);
    });

    test('should handle tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await expect(filterBox(page)).toBeVisible();
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should be able to type in the filter', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      const searchInput = filterBox(page);
      await searchInput.focus();

      await page.keyboard.type('test');

      await expect(searchInput).toHaveValue('test');
    });

    test('should not lose the filter when Enter is pressed', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      const searchInput = filterBox(page);
      await applyFilter(page, 'player');
      await page.keyboard.press('Enter');

      // There is no submit handler — Enter must not clear the box or reload.
      await expect(searchInput).toHaveValue('player');
      await expectSettledResults(page);
    });
  });

  test.describe('Loading States', () => {
    test('should replace the loading skeleton with results', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      await applyFilter(page, 'a');

      await expectSettledResults(page);
      await expect(page.locator('.mm-skeleton')).toHaveCount(0);
    });
  });

  test.describe('URL Handling', () => {
    test('should load players page from direct URL', async ({ page }) => {
      await page.goto('/players');
      await page.waitForLoadState('networkidle');

      expect(page.url()).toContain('/players');
      await expect(filterBox(page)).toBeVisible();
    });

    test('should restore search from URL query param', async ({ page }) => {
      // `/players` redirects to `/v4/players`; the query has to survive it.
      await page.goto('/players?q=testplayer');
      await page.waitForLoadState('networkidle');

      await expect(filterBox(page)).toHaveValue('testplayer');
    });
  });
});
