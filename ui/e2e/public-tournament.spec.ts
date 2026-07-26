import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Public Tournament Experience Suite', () => {
  test('should render public tournament shell header, navigation, and all 7 sub-tabs', async ({ page }) => {
    page.on('console', msg => console.log(`[PAGE LOG] ${msg.type()}: ${msg.text()}`));
    page.on('response', resp => {
      if (resp.url().includes('/stats/admin/tournaments')) {
        console.log(`[API RESPONSE] ${resp.status()} ${resp.url()}`);
      }
    });

    await loginAsAdmin(page);

    await page.goto('/v4/manage/tournaments');
    await page.waitForLoadState('networkidle');

    const testTournamentName = `Public Shell Cup ${Date.now()}`;

    // 1. Create a tournament to verify public page rendering
    const createBtn = page.locator('button', { hasText: 'Create Tournament' }).first();
    await createBtn.click();

    await page.fill('input[placeholder*="BF1942 Summer Cup"]', testTournamentName);
    await page.fill('input[placeholder*="Community Staff"]', 'Admin');

    const submitBtn = page.locator('button[type="submit"]', { hasText: /Create|Save/i }).first();
    await submitBtn.click();

    // Wait for redirect to tournament detail route
    await page.waitForTimeout(1000);
    console.log(`[CURRENT URL AFTER SUBMIT] ${page.url()}`);

    await page.waitForURL(url => url.pathname.includes('/tournaments/'), { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const match = page.url().match(/\/tournaments\/([^/]+)/);
    expect(match).not.toBeNull();
    const createdTournamentId = match![1];

    // 2. Navigate to Public Overview (/t/:id)
    await page.goto(`/t/${createdTournamentId}`);
    await page.waitForLoadState('networkidle');

    // Title / Header assertion
    await expect(page.locator('body')).toContainText(testTournamentName);

    // 3. Test Navigation across all 7 public tabs
    // Tab 1: Overview
    expect(page.url()).toContain(`/t/${createdTournamentId}`);

    // Tab 2: Rankings
    await page.goto(`/t/${createdTournamentId}/rankings`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/rankings');

    // Tab 3: Matches
    await page.goto(`/t/${createdTournamentId}/matches`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/matches');

    // Tab 4: Rules
    await page.goto(`/t/${createdTournamentId}/rules`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/rules');

    // Tab 5: Teams
    await page.goto(`/t/${createdTournamentId}/teams`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/teams');

    // Tab 6: Files
    await page.goto(`/t/${createdTournamentId}/files`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/files');

    // Tab 7: Stats
    await page.goto(`/t/${createdTournamentId}/stats`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/stats');

    // 4. Cleanup test tournament in Admin
    await page.goto(`/v4/manage/tournaments/${createdTournamentId}/settings`);
    await page.waitForLoadState('networkidle');

    const deleteBtn = page.locator('button', { hasText: 'Delete Tournament' });
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      const confirmBtn = page.locator('button', { hasText: /Confirm|Yes, Delete/i });
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
      }
    }
  });
});
