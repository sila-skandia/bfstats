import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Admin-to-Public Synchronization E2E Suite', () => {
  test.setTimeout(90000);

  test('should sync Admin edits (<X>) live to Public Tournament pages (<Y>)', async ({ page }) => {
    // 0. Login & Navigate to Admin Dashboard
    await loginAsAdmin(page);
    await page.goto('/v4/manage/tournaments');
    await page.waitForLoadState('networkidle');

    const timestamp = Date.now();
    const initialName = `Sync Cup ${timestamp}`;
    const updatedName = `Updated Sync Cup ${timestamp}`;

    // 1. CREATE TOURNAMENT IN ADMIN (<X1>)
    const createBtn = page.locator('button', { hasText: 'Create Tournament' }).first();
    await createBtn.click();

    await page.fill('input[placeholder*="BF1942 Summer Cup"]', initialName);
    await page.fill('input[placeholder*="Community Staff"]', 'Admin');

    const submitCreateBtn = page.locator('button[type="submit"]', { hasText: /Create|Save/i }).first();
    await submitCreateBtn.click();

    await page.waitForURL(url => url.pathname.includes('/tournaments/'), { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const tournamentUrl = page.url();
    const tournamentIdMatch = tournamentUrl.match(/\/tournaments\/([^/]+)/);
    expect(tournamentIdMatch).not.toBeNull();
    const tournamentId = tournamentIdMatch![1];

    // ----------------------------------------------------
    // TEST 1: SETTINGS & RULES SYNC
    // Admin Edit (<X>): Update Name, Rules Markdown, and Status to Registration
    // ----------------------------------------------------
    const settingsTab = page.locator('button.mm-admin-tab', { hasText: 'Settings' });
    await settingsTab.click();
    await page.waitForLoadState('networkidle');

    // Fill Tournament Name input explicitly by label sibling locator
    const nameInput = page.locator('label:has-text("Tournament Name") ~ input').first();
    await expect(nameInput).toBeVisible();
    await nameInput.clear();
    await nameInput.fill(updatedName);

    const rulesInput = page.locator('label:has-text("Rules") ~ textarea, textarea').first();
    const sampleRules = `### Official Tournament Rules\n- Rule 1: Respect all players.\n- Rule 2: No ghosting or cheats.`;
    if (await rulesInput.isVisible()) {
      await rulesInput.fill(sampleRules);
    }

    const statusSelect = page.locator('label:has-text("Status") ~ select, select').first();
    if (await statusSelect.isVisible()) {
      await statusSelect.selectOption('registration');
    }

    const saveSettingsBtn = page.locator('button', { hasText: 'Save Settings' });
    await saveSettingsBtn.click();
    await page.waitForLoadState('networkidle');

    // Wait for success alert confirmation before navigating.
    //
    // This used to probe with `isVisible({ timeout: 5000 })`, but Playwright
    // ignores that timeout and returns immediately — so the check almost always
    // skipped and the test read the public page before the save had landed.
    const okAlert = page.locator('.mm-admin-alert--ok');
    await expect(okAlert).toContainText('Tournament settings updated successfully', {
      timeout: 10000,
    });

    // Public Expectation (<Y1>): Check Public Overview and Rules Page
    await page.goto(`/t/${tournamentId}`);
    await page.waitForLoadState('networkidle');

    // Assert Updated Name in Hero Header
    await expect(page.locator('body')).toContainText(updatedName);

    // Assert Rules Content on Public Rules page
    await page.goto(`/t/${tournamentId}/rules`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText('Respect all players');

    // ----------------------------------------------------
    // TEST 2: TEAMS SYNC
    // Admin Edit (<X>): Create Team 1 "Vanguard Knights [VK]" and Team 2 "Iron Guardians [IG]"
    // ----------------------------------------------------
    await loginAsAdmin(page); // ensure auth context for admin actions
    await page.goto(`/v4/manage/tournaments/${tournamentId}/teams`);
    await page.waitForLoadState('networkidle');

    // Add Team 1
    await page.locator('button', { hasText: 'Add Team' }).click();
    await page.fill('input[placeholder*="Skandia or Black Knights"]', 'Vanguard Knights');
    await page.fill('input[placeholder*="[sK]"]', '[VK]');
    await page.locator('button', { hasText: 'Save Team' }).click();
    // `waitForLoadState('networkidle')` does not reliably cover an in-page POST
    // — it can resolve before the team is persisted, and the public page is
    // then read too early. Confirm the admin list reflects the save instead.
    await expect(page.locator('body')).toContainText('Vanguard Knights', { timeout: 10000 });

    // Add Team 2
    await page.locator('button', { hasText: 'Add Team' }).click();
    await page.fill('input[placeholder*="Skandia or Black Knights"]', 'Iron Guardians');
    await page.fill('input[placeholder*="[sK]"]', '[IG]');
    await page.locator('button', { hasText: 'Save Team' }).click();
    await expect(page.locator('body')).toContainText('Iron Guardians', { timeout: 10000 });

    // Public Expectation (<Y2>): Verify Teams on Public Teams Tab
    await page.goto(`/t/${tournamentId}/teams`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText('Vanguard Knights');
    await expect(page.locator('body')).toContainText('Iron Guardians');

    // ----------------------------------------------------
    // TEST 3: WEEKS & MATCH SCHEDULE SYNC
    // Admin Edit (<X>): Schedule Match between Team 1 and Team 2
    // ----------------------------------------------------
    await page.goto(`/v4/manage/tournaments/${tournamentId}/matches`);
    await page.waitForLoadState('networkidle');

    // Same instant-probe problem as the announcement step: `isVisible()` and a
    // bare `count()` do not wait for the match form to render, so on a slow
    // paint every field was skipped and an empty form was submitted — leaving
    // no match, and failing the public assertion below instead of here.
    const addMatchBtn = page.locator('button', { hasText: /Schedule Match|Add Match/i }).first();
    await addMatchBtn.waitFor({ state: 'visible', timeout: 10000 });
    await addMatchBtn.click();

    // Fill scheduled date
    const dateInput = page.locator('input[type="datetime-local"]').first();
    await dateInput.waitFor({ state: 'visible', timeout: 10000 });
    await dateInput.fill('2026-09-01T20:00');

    // Select teams
    const teamSelects = page.locator('.teams-selector select');
    await expect.poll(() => teamSelects.count(), { timeout: 10000 }).toBeGreaterThanOrEqual(2);
    await teamSelects.nth(0).selectOption({ index: 1 }); // Team 1: Vanguard Knights
    await teamSelects.nth(1).selectOption({ index: 1 }); // Team 2: Iron Guardians

    // Fill map name required for form validation
    const mapInput = page.locator('input[placeholder*="Wake Island"]').first();
    await mapInput.waitFor({ state: 'visible', timeout: 10000 });
    await mapInput.fill('Omaha Beach');

    const saveMatchBtn = page.locator('button', { hasText: /Schedule Match|Update Match|Save Match/i }).last();
    await expect(saveMatchBtn).toBeEnabled();
    await saveMatchBtn.scrollIntoViewIfNeeded();

    // Assert on the network call. A `toContainText('Vanguard Knights')` check
    // here is worthless: the team names are `<option>` text in the match form's
    // own team selects, so it passes whether or not a match was ever created.
    const matchCreated = page.waitForResponse(
      r => /\/stats\/admin\/tournaments\/\d+\/matches$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 15000 }
    );
    await saveMatchBtn.click();
    expect((await matchCreated).status()).toBe(201);

    // Public Expectation (<Y3>): Verify Match Schedule on Public Matches Tab
    await page.goto(`/t/${tournamentId}/matches`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText('Vanguard Knights');

    // ----------------------------------------------------
    // TEST 4: ANNOUNCEMENTS / POSTS SYNC
    // Admin Edit (<X>): Publish Announcement Post
    // ----------------------------------------------------
    await page.goto(`/v4/manage/tournaments/${tournamentId}/posts`);
    await page.waitForLoadState('networkidle');

    // Every step here used a bare `isVisible()` guard. That is an *instant*
    // check — it does not wait for the post modal to render — so on a slow
    // paint the title was never filled, the announcement was never created,
    // and the public assertion below failed with no indication why. Wait for
    // each control instead, so a genuine regression fails here rather than
    // two navigations later.
    const newPostBtn = page.locator('button', { hasText: /New Announcement|Create Post|New Post/i }).first();
    await newPostBtn.waitFor({ state: 'visible', timeout: 10000 });
    await newPostBtn.click();

    const titleInput = page.locator('label:has-text("Title") ~ input, input[placeholder*="Playoff"]').first();
    await titleInput.waitFor({ state: 'visible', timeout: 10000 });
    await titleInput.fill('Registration is Live!');

    const bodyTextarea = page.locator('textarea').first();
    await bodyTextarea.waitFor({ state: 'visible', timeout: 10000 });
    await bodyTextarea.fill('Signups are now officially open for all teams.');

    const publishBtn = page.locator('button', { hasText: 'Publish' }).first();
    await publishBtn.waitFor({ state: 'visible', timeout: 10000 });
    // On the narrow Mobile Chrome viewport the submit button sits below the
    // fold; without this the click silently fails to submit the form.
    await publishBtn.scrollIntoViewIfNeeded();

    // Assert on the network call, not on page text: the title lives in a form
    // input whose value `toContainText` cannot see, so a text assertion here
    // passes off the typed-but-unsubmitted form and hides a failed publish.
    const postCreated = page.waitForResponse(
      r => /\/stats\/admin\/tournaments\/\d+\/posts$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 15000 }
    );
    await publishBtn.click();
    expect((await postCreated).status()).toBe(201);

    // Public Expectation (<Y4>): Verify News Post on Public Overview
    await page.goto(`/t/${tournamentId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText('Registration is Live!');

    // ----------------------------------------------------
    // CLEANUP
    // Delete created test tournament
    // ----------------------------------------------------
    await page.goto(`/v4/manage/tournaments/${tournamentId}/settings`);
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
