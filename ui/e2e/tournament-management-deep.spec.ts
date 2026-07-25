import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Deep Tournament Management Editing & Deletion Suite (Admin)', () => {
  test('should support deep editing and complete item deletion cleanup across all sections', async ({ page }) => {
    // Set test timeout for deep multi-step workflow
    test.setTimeout(90000);

    // 0. Setup & Login
    await loginAsAdmin(page);
    await page.goto('/v4/manage/tournaments');
    await page.waitForLoadState('networkidle');

    const timestamp = Date.now();
    const tournamentName = `Deep E2E Tournament ${timestamp}`;

    // 1. Create Tournament
    const createBtn = page.locator('button', { hasText: 'Create Tournament' }).first();
    await createBtn.click();
    await page.fill('input[placeholder*="BF1942 Summer Cup"]', tournamentName);
    await page.fill('input[placeholder*="Community Staff"]', 'Admin');

    const submitCreateBtn = page.locator('button[type="submit"]', { hasText: /Create|Save/i }).first();
    await submitCreateBtn.click();

    // Wait for auto-redirect to tournament detail page
    await page.waitForURL(url => url.pathname.includes('/tournaments/'), { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1', { hasText: tournamentName })).toBeVisible();

    // ----------------------------------------------------
    // STEP 1: Teams & Roster Deep Editing
    // ----------------------------------------------------
    const teamsTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Teams' });
    await teamsTabBtn.click();
    expect(page.url()).toContain('/teams');

    // Add Team 1 (Alpha Squad)
    await page.locator('button', { hasText: 'Add Team' }).click();
    await page.fill('input[placeholder*="Skandia or Black Knights"]', 'Alpha Squad');
    await page.fill('input[placeholder*="[sK]"]', '[ALPHA]');

    // Add player 'American Lion' to Team 1 roster using MultiPlayerSelector
    const playerSearchInput = page.locator('input[placeholder*="Search players"], input[placeholder*="Add player"]').first();
    if (await playerSearchInput.isVisible()) {
      await playerSearchInput.fill('American Lion');
      await page.waitForTimeout(400); // Debounce
      const playerOption = page.locator('div', { hasText: 'American Lion' }).first();
      if (await playerOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await playerOption.click();
      }
      const addSelectedBtn = page.locator('button', { hasText: /Add Selected|Add Players/i }).first();
      if (await addSelectedBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await addSelectedBtn.click();
      }
    }
    await page.locator('button', { hasText: 'Save Team' }).click();
    await page.waitForLoadState('networkidle');

    const alphaTeamCard = page.locator('.mm-admin-card__body .mm-admin-card', { hasText: 'Alpha Squad' });
    await expect(alphaTeamCard).toBeVisible();

    // Add Team 2 (Bravo Team)
    await page.locator('button', { hasText: 'Add Team' }).click();
    await page.fill('input[placeholder*="Skandia or Black Knights"]', 'Bravo Team');
    await page.fill('input[placeholder*="[sK]"]', '[BRAVO]');
    await page.locator('button', { hasText: 'Save Team' }).click();
    await page.waitForLoadState('networkidle');

    const bravoTeamCard = page.locator('.mm-admin-card__body .mm-admin-card', { hasText: 'Bravo Team' });
    await expect(bravoTeamCard).toBeVisible();

    // Edit Team 1 Details
    await alphaTeamCard.locator('button', { hasText: /Edit Team|Edit/i }).first().click();
    await page.fill('input[placeholder*="[sK]"]', '[ALPH]');
    await page.locator('button', { hasText: 'Update Team' }).click();
    await page.waitForLoadState('networkidle');

    const updatedAlphaCard = page.locator('.mm-admin-card__body .mm-admin-card', { hasText: 'Alpha Squad' });
    await expect(updatedAlphaCard).toBeVisible();

    // ----------------------------------------------------
    // STEP 2: Weeks & Schedule Boundaries Editing
    // ----------------------------------------------------
    const weeksTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Weeks' });
    await weeksTabBtn.click();
    expect(page.url()).toContain('/weeks');

    // Create Week 1
    await page.locator('button', { hasText: /Add Week|Create Week/i }).first().click();
    await page.fill('input[placeholder*="Week 1"]', 'Week 1 · Omaha Beach');
    const dateInputs = page.locator('input[type="date"]');
    if (await dateInputs.count() >= 2) {
      await dateInputs.nth(0).fill('2026-08-01');
      await dateInputs.nth(1).fill('2026-08-07');
    }
    await page.locator('button', { hasText: /Save Week|Create Week/i }).first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.mm-admin-card__body .mm-admin-card, tr', { hasText: 'Week 1 · Omaha Beach' })).toBeVisible();

    // Edit Week 1
    const weekItem = page.locator('.mm-admin-card__body .mm-admin-card, tr', { hasText: 'Week 1 · Omaha Beach' });
    const editWeekBtn = weekItem.locator('button', { hasText: 'Edit' });
    if (await editWeekBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editWeekBtn.click();
      await page.fill('input[placeholder*="Week 1"]', 'Week 1 · Normandy Landing');
      await page.locator('button', { hasText: /Update Week|Save/i }).first().click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.mm-admin-card__body .mm-admin-card, tr', { hasText: 'Week 1 · Normandy Landing' })).toBeVisible();
    }

    // ----------------------------------------------------
    // STEP 3: Matches Scheduling, Editing & Results Form
    // ----------------------------------------------------
    const matchesTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Matches' });
    await matchesTabBtn.click();
    expect(page.url()).toContain('/matches');

    // Schedule Match (Team 1 vs Team 2)
    const scheduleMatchBtn = page.locator('button', { hasText: 'Schedule Match' });
    await scheduleMatchBtn.click();
    await page.waitForLoadState('networkidle');

    // Select Team 1 & Team 2 in form
    const teamSelects = page.locator('.teams-selector select');
    if (await teamSelects.count() >= 2) {
      await teamSelects.nth(0).selectOption({ index: 1 });
      await teamSelects.nth(1).selectOption({ index: 1 });
    }

    // Fill Map Name (required for valid form)
    const mapInput = page.locator('input[placeholder*="Wake Island"]').first();
    if (await mapInput.isVisible()) {
      await mapInput.fill('Omaha Beach');
    }

    const matchDateInput = page.locator('input[type="datetime-local"]').first();
    if (await matchDateInput.isVisible()) {
      await matchDateInput.fill('2026-08-01T18:00');
    }

    const saveMatchBtn = page.locator('button', { hasText: /Schedule Match|Save Match|Update Match/i }).first();
    await saveMatchBtn.click();
    await page.waitForLoadState('networkidle');

    // Verify scheduled match row appears in table
    const matchRow = page.locator('.matches-table tr, .mm-admin-table tr', { hasText: /Alpha Squad|Bravo Team/i }).first();
    await expect(matchRow).toBeVisible();

    // Open Results View for the match if action button is visible
    const resultsActionBtn = matchRow.locator('button', { hasText: /Results|Scores|Enter/i }).first();
    if (await resultsActionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await resultsActionBtn.click();
      await page.waitForLoadState('networkidle');

      // Verify Match Results Form view
      const manualEntryBtn = page.locator('button', { hasText: '+ Manual' }).first();
      if (await manualEntryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await manualEntryBtn.click();

        // Fill scores
        const scoreInputs = page.locator('input[type="number"]');
        if (await scoreInputs.count() >= 2) {
          await scoreInputs.nth(0).fill('120');
          await scoreInputs.nth(1).fill('85');
        }
        const updateResultBtn = page.locator('button', { hasText: /Save|Update/i }).first();
        if (await updateResultBtn.isVisible()) {
          await updateResultBtn.click();
          await page.waitForTimeout(500);
        }
      }

      // Return back to matches calendar view
      const backToMatchesBtn = page.locator('button', { hasText: '← Back to Matches' });
      if (await backToMatchesBtn.isVisible()) {
        await backToMatchesBtn.click();
        await page.waitForLoadState('networkidle');
      }
    }

    // Delete Match (Testing Match Deletion)
    const deleteMatchBtn = page.locator('.matches-table tr, .mm-admin-table tr', { hasText: /Alpha Squad|Bravo Team/i }).locator('button', { hasText: /Delete|Remove/i }).first();
    if (await deleteMatchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      page.once('dialog', dialog => dialog.accept());
      await deleteMatchBtn.click();
      const confirmMatchDelete = page.locator('.mm-modal__panel button', { hasText: /Delete/i }).first();
      if (await confirmMatchDelete.isVisible({ timeout: 1500 }).catch(() => false)) {
        await confirmMatchDelete.click();
      }
      await page.waitForLoadState('networkidle');
    }

    // ----------------------------------------------------
    // STEP 4: Tournament Files Resource Editing & Deletion
    // ----------------------------------------------------
    const filesTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Files' });
    await filesTabBtn.click();
    expect(page.url()).toContain('/files');

    // Add File Resource
    await page.locator('button', { hasText: /Upload File|Add File/i }).first().click();
    await page.fill('input[placeholder*="mappack-v3.zip"]', 'skandia-mappack-v1.zip');
    await page.fill('input[placeholder*="https://"]', 'https://bfstats.io/files/mappack-v1.zip');
    await page.locator('button', { hasText: /Save File|Upload File/i }).first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.mm-admin-card__body .mm-admin-card, tr', { hasText: 'skandia-mappack-v1.zip' })).toBeVisible();

    // Edit File Resource
    const fileCard = page.locator('.mm-admin-card__body .mm-admin-card, tr', { hasText: 'skandia-mappack-v1.zip' });
    await fileCard.locator('button', { hasText: 'Edit' }).click();
    const fileCategorySelect = page.locator('select').first();
    if (await fileCategorySelect.isVisible()) {
      await fileCategorySelect.selectOption('Rulebook');
    }
    await page.locator('button', { hasText: /Update File|Save/i }).first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.mm-admin-card__body .mm-admin-card, tr', { hasText: 'Rulebook' })).toBeVisible();

    // Delete File Resource
    const updatedFileCard = page.locator('.mm-admin-card__body .mm-admin-card, tr', { hasText: 'skandia-mappack-v1.zip' });
    await updatedFileCard.locator('button', { hasText: 'Delete' }).click();
    const confirmFileDeleteBtn = page.locator('.mm-modal__panel button', { hasText: 'Delete File' });
    await expect(confirmFileDeleteBtn).toBeVisible();
    await confirmFileDeleteBtn.click();
    await page.waitForLoadState('networkidle');
    await expect(updatedFileCard).not.toBeVisible();

    // ----------------------------------------------------
    // STEP 5: News & Announcements (Posts) Editing & Deletion
    // ----------------------------------------------------
    const postsTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Posts' });
    await postsTabBtn.click();
    expect(page.url()).toContain('/posts');

    // Create Announcement Post
    await page.locator('button', { hasText: /New Announcement|Create Post/i }).first().click();
    await page.fill('input[placeholder*="Playoff bracket seeded"]', 'Season Opening Kickoff');
    await page.fill('textarea', '## Welcome Players!\nTournament matches begin this Friday. Good luck!');
    await page.locator('button.mm-admin-btn--primary', { hasText: 'Publish' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.mm-admin-card__body .mm-admin-card', { hasText: 'Season Opening Kickoff' })).toBeVisible();

    // Edit Announcement Post
    const postCard = page.locator('.mm-admin-card__body .mm-admin-card', { hasText: 'Season Opening Kickoff' });
    await postCard.locator('button', { hasText: 'Edit' }).click();
    await page.fill('input[placeholder*="Playoff bracket seeded"]', 'Season Opening Kickoff (Updated)');
    await page.locator('button.mm-admin-btn--primary', { hasText: 'Update Post' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.mm-admin-card__body .mm-admin-card', { hasText: 'Season Opening Kickoff (Updated)' })).toBeVisible();

    // Delete Announcement Post
    const updatedPostCard = page.locator('.mm-admin-card__body .mm-admin-card', { hasText: 'Season Opening Kickoff (Updated)' });
    await updatedPostCard.locator('button', { hasText: 'Delete' }).click();
    const confirmPostDeleteBtn = page.locator('.mm-modal__panel button', { hasText: 'Delete Post' });
    await expect(confirmPostDeleteBtn).toBeVisible();
    await confirmPostDeleteBtn.click();
    await page.waitForLoadState('networkidle');
    await expect(updatedPostCard).not.toBeVisible();

    // ----------------------------------------------------
    // STEP 6: Deleting Teams & Weeks Sub-items
    // ----------------------------------------------------
    // Delete Weeks
    await weeksTabBtn.click();
    const weekDeleteBtn = page.locator('.mm-admin-card__body .mm-admin-card, tr', { hasText: 'Week 1' }).locator('button', { hasText: 'Delete' });
    if (await weekDeleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await weekDeleteBtn.click();
      const confirmWeekDelete = page.locator('.mm-modal__panel button', { hasText: 'Delete Week' });
      if (await confirmWeekDelete.isVisible({ timeout: 1500 }).catch(() => false)) {
        await confirmWeekDelete.click();
      }
      await page.waitForLoadState('networkidle');
    }

    // Delete Teams
    await teamsTabBtn.click();
    const teamDeleteBtn = page.locator('.mm-admin-card__body .mm-admin-card', { hasText: 'Alpha Squad' }).locator('button', { hasText: 'Delete' });
    if (await teamDeleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await teamDeleteBtn.click();
      const confirmTeamDelete = page.locator('.mm-modal__panel button', { hasText: 'Delete Team' });
      if (await confirmTeamDelete.isVisible({ timeout: 1500 }).catch(() => false)) {
        await confirmTeamDelete.click();
      }
      await page.waitForLoadState('networkidle');
    }

    // ----------------------------------------------------
    // STEP 7: Settings & Tournament Cleanup
    // ----------------------------------------------------
    const settingsTabBtn = page.locator('button.mm-admin-tab', { hasText: 'Settings' });
    await settingsTabBtn.click();
    expect(page.url()).toContain('/settings');

    const discordInput = page.locator('input[placeholder*="discord.gg"]').first();
    if (await discordInput.isVisible()) {
      await discordInput.fill('https://discord.gg/bfstats');
    }

    const saveSettingsBtn = page.locator('button', { hasText: 'Save Settings' });
    await saveSettingsBtn.click();
    await page.waitForTimeout(500);

    // Refresh page and verify saved settings persist
    await page.reload();
    await page.waitForLoadState('networkidle');
    if (await discordInput.isVisible()) {
      await expect(discordInput).toHaveValue('https://discord.gg/bfstats');
    }

    // Return to Overview & Delete Entire Tournament
    const backBtn = page.locator('button', { hasText: '← Tournaments' });
    await backBtn.click();
    await page.waitForLoadState('networkidle');

    const finalTournamentCard = page.locator('.mm-tournament-card', { hasText: tournamentName });
    await expect(finalTournamentCard).toBeVisible();

    const deleteTournamentBtn = finalTournamentCard.locator('button', { hasText: 'Delete' });
    await deleteTournamentBtn.click();

    const confirmModalDeleteBtn = page.locator('.mm-modal__panel button', { hasText: 'Delete Tournament' });
    await expect(confirmModalDeleteBtn).toBeVisible();
    await confirmModalDeleteBtn.click();

    await page.waitForLoadState('networkidle');
    await expect(finalTournamentCard).not.toBeVisible();
  });
});
