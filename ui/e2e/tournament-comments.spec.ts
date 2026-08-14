import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Tournament Comments', () => {
  let tournamentId: string;
  let matchId: number;
  let authToken: string;
  const tournamentName = `Comments E2E Cup ${Date.now()}`;
  const linkedPlayerName = `E2E_Commenter_${Date.now()}`;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAsAdmin(page);

    // Create a tournament via the admin UI (defaults to the v2 league layout)
    await page.goto('/v4/manage/tournaments');
    await page.waitForLoadState('networkidle');
    await page.locator('button', { hasText: 'Create Tournament' }).first().click();
    await page.fill('input[placeholder*="BF1942 Summer Cup"]', tournamentName);
    // The organizer must resolve to an existing player — the API rejects the
    // create with 400 "Player '<name>' not found" otherwise, which leaves the
    // modal open and looks like a mysterious navigation timeout. Every other
    // tournament spec uses 'Admin' for the same reason.
    await page.fill('input[placeholder*="Community Staff"]', 'Admin');
    await page.locator('button[type="submit"]', { hasText: /Create|Save/i }).first().click();
    await page.waitForURL(url => url.pathname.includes('/tournaments/'), { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const urlMatch = page.url().match(/\/tournaments\/([^/]+)/);
    if (!urlMatch) throw new Error('Failed to determine created tournament id');
    tournamentId = urlMatch[1];

    authToken = (await page.evaluate(() => localStorage.getItem('authToken'))) ?? '';
    const authHeaders = { Authorization: `Bearer ${authToken}` };

    // Link a player profile so the test user can author comments
    await page.request.post('/stats/auth/player-names', {
      headers: authHeaders,
      data: { playerName: linkedPlayerName },
    });

    // Create two teams and a scheduled match for match-level comment coverage
    const team1Resp = await page.request.post(`/stats/admin/tournaments/${tournamentId}/teams`, {
      headers: authHeaders,
      data: { name: `Comment Test Alpha ${Date.now()}` },
    });
    const team1Id = (await team1Resp.json()).id;

    const team2Resp = await page.request.post(`/stats/admin/tournaments/${tournamentId}/teams`, {
      headers: authHeaders,
      data: { name: `Comment Test Bravo ${Date.now()}` },
    });
    const team2Id = (await team2Resp.json()).id;

    const matchResp = await page.request.post(`/stats/admin/tournaments/${tournamentId}/matches`, {
      headers: authHeaders,
      data: {
        scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        team1Id,
        team2Id,
        maps: [{ mapName: 'Wake Island' }],
      },
    });
    const match = await matchResp.json();
    matchId = match.id;

    // Report a round for the match's first map.
    //
    // `T2Matches.vue` derives `scheduled` from the round count, and the public
    // match card only renders its "Match details & demos" link (the only way
    // into the match modal, and therefore the match comment thread) for
    // matches that are NOT scheduled. A result-less fixture leaves the match
    // showing as "Upcoming" with no way to open it.
    const mapId = match.maps?.[0]?.id;
    if (!mapId) throw new Error('Match fixture has no map to report a result against');

    const resultResp = await page.request.post(
      `/stats/admin/tournaments/${tournamentId}/matches/${matchId}/maps/${mapId}/result`,
      {
        headers: authHeaders,
        data: { mapId, team1Id, team2Id, team1Tickets: 120, team2Tickets: 85 },
      }
    );
    if (!resultResp.ok()) {
      throw new Error(
        `Failed to seed match result: ${resultResp.status()} ${await resultResp.text()}`
      );
    }

    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!tournamentId) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAsAdmin(page);
    await page.goto(`/v4/manage/tournaments/${tournamentId}/settings`);
    await page.waitForLoadState('networkidle');
    const deleteBtn = page.locator('button', { hasText: 'Delete Tournament' });
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      const confirmBtn = page.locator('button', { hasText: /Confirm|Yes, Delete/i });
      if (await confirmBtn.isVisible()) await confirmBtn.click();
    }
    await context.close();
  });

  test('anonymous visitors see a sign-in prompt instead of the comment form', async ({ page }) => {
    await page.goto(`/t/${tournamentId}`);
    await page.waitForLoadState('networkidle');

    const panel = page.locator('.t2-comments').first();
    await expect(panel).toBeVisible();
    await expect(panel.locator('button', { hasText: 'Sign in' })).toBeVisible();
    await expect(panel.locator('.t2-comments__form')).toHaveCount(0);
  });

  test('signed-in user can post a tournament-level comment, see it in the panel, then edit and delete it', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/t/${tournamentId}`);
    await page.waitForLoadState('networkidle');

    const panel = page.locator('.t2-comments').first();
    await expect(panel.locator('.t2-comments__postas')).toBeVisible();

    const commentText = `Hello from e2e ${Date.now()}`;
    await panel.locator('.t2-comments__form .t2-comments__editor-input').fill(commentText);
    await panel.locator('.t2-comments__form button[type="submit"]').click();

    const posted = panel.locator('.t2-comments__item', { hasText: commentText });
    await expect(posted).toBeVisible();
    await expect(posted.locator('button', { hasText: 'Edit' })).toBeVisible();

    // Reload to confirm the comment persisted server-side rather than only
    // landing in local state.
    //
    // This used to also assert the comment showed up as a `.t2-feed__item` in
    // the overview's activity feed. ddd47a5 removed tournament comments from
    // that feed deliberately — the API no longer queries TournamentComments and
    // T2Overview.vue dropped the branch that rendered them — so that assertion
    // is gone. The panel is now the only surface for comments.
    await page.goto(`/t/${tournamentId}`);
    await expect(posted).toBeVisible();

    // Edit — `posted` re-resolves against the reloaded page.
    await expect(posted).toBeVisible();
    await posted.locator('button', { hasText: 'Edit' }).click();
    const editedText = `${commentText} (edited)`;
    const editEditor = posted.locator('.t2-comments__edit .t2-comments__editor-input');
    await editEditor.fill(editedText);
    await posted.locator('.t2-comments__edit button', { hasText: 'Save' }).click();

    await expect(panel.locator('.t2-comments__item', { hasText: editedText })).toBeVisible();
    await expect(panel.locator('.t2-comments__item', { hasText: 'edited' })).toBeVisible();

    // Delete
    const editedItem = panel.locator('.t2-comments__item', { hasText: editedText });
    await editedItem.locator('button', { hasText: 'Del' }).click();
    await expect(panel.locator('.t2-comments__item', { hasText: editedText })).toHaveCount(0);
  });

  test('match-level comments are isolated to their match', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/t/${tournamentId}/matches`);
    await page.waitForLoadState('networkidle');

    await page.locator('.t2-match__details-link').first().click();
    const modal = page.locator('.t2-modal');
    await expect(modal).toBeVisible();

    const matchPanel = modal.locator('.t2-comments').first();
    await expect(matchPanel.locator('.t2-comments__postas')).toBeVisible();

    const matchCommentText = `Match comment e2e ${Date.now()}`;
    await matchPanel.locator('.t2-comments__form .t2-comments__editor-input').fill(matchCommentText);
    await matchPanel.locator('.t2-comments__form button[type="submit"]').click();

    await expect(matchPanel.locator('.t2-comments__item', { hasText: matchCommentText })).toBeVisible();

    // Confirm it is stored as a match-level comment (not visible on the tournament-level thread)
    const listResp = await page.request.get(
      `/stats/tournaments/${tournamentId}/comments?matchId=${matchId}`
    );
    const paged = await listResp.json();
    expect(paged.items.some((c: { content: string }) => c.content.includes(matchCommentText))).toBe(true);

    const tournamentLevelResp = await page.request.get(`/stats/tournaments/${tournamentId}/comments`);
    const tournamentLevelPaged = await tournamentLevelResp.json();
    expect(tournamentLevelPaged.items.some((c: { content: string }) => c.content.includes(matchCommentText))).toBe(false);

    await modal.locator('.t2-modal__close').click();
    await expect(modal).toBeHidden();

    // The trailing assertion here checked the overview feed rendered the comment
    // with its match label. ddd47a5 removed comments from that feed, so the
    // match-isolation checks above (the two API reads) are what this test is now
    // for. See the note in the tournament-level comment test.
  });
});
