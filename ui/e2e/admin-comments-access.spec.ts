import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Admin Comments and Access tabs', () => {
  test('lists server and player comments newest first, and Access shows join and login dates', async ({ page }) => {
    await loginAsAdmin(page);
    const token = (await page.evaluate(() => localStorage.getItem('authToken'))) ?? '';
    const headers = { Authorization: `Bearer ${token}` };

    // A linked profile is required to author a comment.
    const author = `E2E_AdminComments_${Date.now()}`;
    await page.request.post('/stats/auth/player-names', { headers, data: { playerName: author } });

    const serverText = `server note ${Date.now()}`;
    const playerText = `player note ${Date.now()}`;
    const serverPost = await page.request.post(`/stats/servers/${encodeURIComponent('E2E Test Server')}/comments`, {
      headers,
      data: { content: `<p>${serverText}</p>`, authorPlayerName: author },
    });
    expect(serverPost.ok(), await serverPost.text()).toBeTruthy();
    // Posted second, so it lists first.
    const playerPost = await page.request.post(`/stats/players/${encodeURIComponent('Alpha Player')}/comments`, {
      headers,
      data: { content: `<p>${playerText}</p>`, authorPlayerName: author },
    });
    expect(playerPost.ok(), await playerPost.text()).toBeTruthy();

    await page.goto('/v4/admin/data?tab=comments');
    const rows = page.locator('.mm-admin-comments__row');
    await expect(rows.first()).toContainText(playerText);
    await expect(rows.first()).toContainText('Alpha Player');
    await expect(rows.nth(1)).toContainText(serverText);
    await expect(rows.nth(1)).toContainText('E2E Test Server');

    // Filter to servers only.
    await page.locator('.mm-admin-chip', { hasText: 'Servers' }).click();
    await expect(rows.first()).toContainText(serverText);
    await expect(page.locator('.mm-admin-comments__row', { hasText: playerText })).toHaveCount(0);

    // Expand a row to read the full comment.
    await rows.first().click();
    await expect(page.locator('.mm-admin-comments__body').first()).toContainText(serverText);

    // Access tab: new columns, and the seeded admin has both dates.
    await page.locator('button.mm-admin-tab', { hasText: 'Access' }).click();
    const table = page.locator('.mm-admin-table').filter({ has: page.locator('th', { hasText: 'Joined' }) });
    await expect(table.locator('th', { hasText: 'Last login' })).toBeVisible();
    const adminRow = table.locator('tbody tr', { hasText: 'admin@bfstats.io' });
    await expect(adminRow.locator('.mm-admin-access__date').first()).not.toHaveText('—');
    await expect(adminRow.locator('.mm-admin-access__date').nth(1)).toContainText(/ago|Just now/);
  });
});
