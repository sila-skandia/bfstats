import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

// Game profiles on the account (features/game-profiles): import the game's
// Settings/Profiles folder on the dashboard, list, set active, re-import and
// delete. The fixture folder holds two synthetic profiles laid out as the game
// writes them, plus a Video.con the import must leave behind.

const here = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.join(here, 'fixtures', 'game-profiles', 'Profiles');
const API = '/stats/account/game-profiles';

async function authHeaders(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('authToken'));
  return { Authorization: `Bearer ${token}` };
}

async function storedProfiles(page: Page) {
  const response = await page.request.get(API, { headers: await authHeaders(page) });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { name: string; playerName: string; isActive: boolean; files: Record<string, string> }[];
}

test.describe('Game profiles on the dashboard', () => {
  // One signed-in dev account is shared by every spec: the steps run in order.
  test.describe.configure({ mode: 'serial' });

  test('import a Profiles folder, set active, re-import and delete', async ({ page }, testInfo) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);
    for (const p of await storedProfiles(page)) {
      await page.request.delete(`${API}/${encodeURIComponent(p.name)}`, { headers });
    }

    await page.goto('/v4/dashboard');
    await page.getByRole('button', { name: /^Game profiles/ }).click();
    await expect(page.getByText('No game profiles yet.')).toBeVisible();

    // The Profiles folder: every profile in it, before anything is uploaded.
    await page.getByTestId('game-profiles-picker').setInputFiles(PROFILES_DIR);
    const preview = page.getByTestId('game-profiles-preview');
    await expect(preview).toContainText('Found 2 profiles');
    await expect(preview.locator('[data-profile="E2eRommel"]')).toContainText('Plays as E2E Rommel');
    await expect(preview.locator('[data-profile="E2ePatton"]')).toContainText('Plays as E2E Patton');
    await expect(preview.locator('[data-profile="E2ePatton"] .mm-gp__file--missing')).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath('game-profiles-preview.png'), fullPage: true });

    await page.getByTestId('game-profiles-upload').click();
    const list = page.getByTestId('game-profiles-list');
    await expect(list.locator('li')).toHaveCount(2);
    await expect(page.getByRole('status')).toContainText('Uploaded 2 profiles');

    const rommel = list.locator('[data-profile="E2eRommel"]');
    const patton = list.locator('[data-profile="E2ePatton"]');
    await expect(rommel).toContainText('Plays as E2E Rommel');
    // The first one uploaded (in name order) is the active one.
    await expect(patton.getByTestId('game-profile-active')).toBeVisible();
    await expect(rommel.getByTestId('game-profile-active')).toHaveCount(0);

    // Only the five profile files went up.
    const afterImport = await storedProfiles(page);
    const stored = afterImport.find(p => p.name === 'E2eRommel')!;
    expect(stored.playerName).toBe('E2E Rommel');
    expect(Object.keys(stored.files).sort()).toEqual([
      'Controls/Air.con', 'Controls/Common.con', 'Controls/Infantry.con', 'Controls/Land.con', 'GeneralOptions.con',
    ]);

    await rommel.getByRole('button', { name: 'Set active' }).click();
    await expect(rommel.getByTestId('game-profile-active')).toBeVisible();
    await expect(patton.getByTestId('game-profile-active')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('game-profiles-list.png'), fullPage: true });

    // Re-import from one profile's own folder.
    await patton.getByRole('button', { name: 'Re-import' }).click();
    await page.getByTestId('game-profiles-picker').setInputFiles(path.join(PROFILES_DIR, 'E2ePatton'));
    await expect(preview).toContainText('Re-import E2ePatton');
    await expect(preview).toContainText('Replaces stored');
    await page.getByTestId('game-profiles-upload').click();
    await expect(page.getByRole('status')).toContainText('Uploaded 1 profile');
    await expect(list.locator('li')).toHaveCount(2);

    // Mobile: the row's actions wrap under it, nothing scrolls sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByText('Where is the folder?').click();
    await expect(page.getByText('Mods/<mod>/Settings/Profiles')).toBeVisible();
    await expect(rommel.getByRole('button', { name: 'Delete' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('game-profiles-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    // Deleting the active one makes the most recently updated remaining one active.
    page.once('dialog', dialog => dialog.accept());
    await rommel.getByRole('button', { name: 'Delete' }).click();
    await expect(list.locator('li')).toHaveCount(1);
    await expect(patton.getByTestId('game-profile-active')).toBeVisible();

    page.once('dialog', dialog => dialog.accept());
    await patton.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('No game profiles yet.')).toBeVisible();
    expect(await storedProfiles(page)).toEqual([]);
  });

  test('the API refuses files outside the profile set', async ({ page }) => {
    await loginAsAdmin(page);
    const response = await page.request.put(`${API}/E2eRefused`, {
      headers: await authHeaders(page),
      data: { files: { 'Video.con': 'renderer.setFullScreen 1' } },
    });
    expect(response.status()).toBe(400);
  });
});
