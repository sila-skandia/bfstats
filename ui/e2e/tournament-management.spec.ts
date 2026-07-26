import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Tournament Management Suite (Admin)', () => {
  test('should redirect unauthenticated users away from tournament management', async ({ page }) => {
    // Clear any existing tokens
    await page.goto('/servers/bf1942');
    await page.evaluate(() => {
      localStorage.removeItem('authToken');
      localStorage.removeItem('userProfile');
    });

    // Attempt to access tournament management route
    await page.goto('/v4/manage/tournaments');
    await page.waitForLoadState('networkidle');

    // Should be redirected away from admin management (to /v4/servers/bf1942)
    expect(page.url()).not.toContain('/v4/manage/tournaments');
  });

  test('should allow authenticated admin to access tournament management dashboard', async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto('/v4/manage/tournaments');
    await page.waitForLoadState('networkidle');

    // Check header
    const heading = page.locator('h1', { hasText: 'Tournaments' });
    await expect(heading).toBeVisible();

    // Check create tournament button
    const createBtn = page.locator('button', { hasText: 'Create Tournament' }).first();
    await expect(createBtn).toBeVisible();
  });

  test('should support full tournament creation, navigation through all 6 tabs, and cleanup', async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto('/v4/manage/tournaments');
    await page.waitForLoadState('networkidle');

    const testTournamentName = `E2E Cup ${Date.now()}`;

    // 1. Create a new tournament
    const createBtn = page.locator('button', { hasText: 'Create Tournament' }).first();
    await createBtn.click();

    // Fill form inside modal
    await page.fill('input[placeholder*="BF1942 Summer Cup"]', testTournamentName);
    await page.fill('input[placeholder*="Community Staff"]', 'Admin');

    // Submit form
    const submitBtn = page.locator('button[type="submit"]', { hasText: /Create|Save/i }).first();
    await submitBtn.click();

    // Wait for auto-redirect to tournament detail route
    await page.waitForURL(url => url.pathname.includes('/tournaments/'), { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Verify header matches created tournament name
    await expect(page.locator('h1', { hasText: testTournamentName })).toBeVisible();

    // 2. Test Navigation across all 6 sub-tabs
    // Tab 1: Matches
    const matchesTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Matches' });
    await matchesTabBtn.click();
    expect(page.url()).toContain('/matches');
    await expect(page.locator('.mm-admin-panel')).toBeVisible();

    // Tab 2: Teams
    const teamsTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Teams' });
    await teamsTabBtn.click();
    expect(page.url()).toContain('/teams');
    await expect(page.locator('button', { hasText: 'Add Team' })).toBeVisible();

    // Tab 3: Weeks
    const weeksTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Weeks' });
    await weeksTabBtn.click();
    expect(page.url()).toContain('/weeks');
    await expect(page.locator('button', { hasText: /Add Week|Create Week/i }).first()).toBeVisible();

    // Tab 4: Files
    const filesTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Files' });
    await filesTabBtn.click();
    expect(page.url()).toContain('/files');
    await expect(page.locator('button', { hasText: /Upload File|Add File/i }).first()).toBeVisible();

    // Tab 5: Posts
    const postsTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Posts' });
    await postsTabBtn.click();
    expect(page.url()).toContain('/posts');
    await expect(page.locator('button', { hasText: /New Announcement|Create Post|New Post/i }).first()).toBeVisible();

    // Tab 6: Settings
    const settingsTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Settings' });
    await settingsTabBtn.click();
    expect(page.url()).toContain('/settings');

    // 3. Save Settings in Settings Tab
    const saveSettingsBtn = page.locator('button', { hasText: 'Save Settings' });
    await expect(saveSettingsBtn).toBeVisible();
    await saveSettingsBtn.click();
    await page.waitForTimeout(500);

    // 4. Return to Tournament Overview & Delete the created tournament
    const backBtn = page.locator('button', { hasText: '← Tournaments' });
    await backBtn.click();
    await page.waitForLoadState('networkidle');

    // Locate the created tournament card
    const tournamentCard = page.locator('.mm-tournament-card', { hasText: testTournamentName });
    await expect(tournamentCard).toBeVisible();

    const deleteBtn = tournamentCard.locator('button', { hasText: 'Delete' });
    await deleteBtn.click();

    // Confirm deletion inside modal
    const confirmDeleteBtn = page.locator('button.mm-admin-btn--danger', { hasText: 'Delete Tournament' });
    await expect(confirmDeleteBtn).toBeVisible();
    await confirmDeleteBtn.click();

    await page.waitForLoadState('networkidle');
    // Verify deleted card is removed
    await expect(tournamentCard).not.toBeVisible();
  });
});
