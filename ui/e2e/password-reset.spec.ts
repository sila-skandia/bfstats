import { expect, test } from '@playwright/test';

// Password reset by email (features/password-reset). The E2E API sends no mail,
// so the link the email would carry is seeded: E2eDatabaseSeed re-arms
// e2e-reset's token on every boot.

const USERNAME = 'e2e-reset';
const TOKEN = 'e2e-reset-token-0123456789abcdefghijklmnopqrstuv';

test.describe('Password reset', () => {
  test('the forgot form answers the same whatever is typed', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(page.getByText('Signed up without an email?')).toBeVisible();

    await page.getByLabel('Username').fill('nobody-by-this-name');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('If the username and email match an account')).toBeVisible();
  });

  test('a bad link is refused and offers a new one', async ({ page }) => {
    await page.goto('/auth/reset-password?token=not-a-real-token');
    await page.getByLabel('New password', { exact: true }).fill('a-new-password');
    await page.getByLabel('Confirm new password').fill('a-new-password');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('This reset link has expired or was already used')).toBeVisible();

    await page.getByRole('button', { name: 'Ask for a new link' }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
  });

  test('a link with no token says so', async ({ page }) => {
    await page.goto('/auth/reset-password');
    await expect(page.getByText('This reset link is incomplete')).toBeVisible();
  });

  test('the emailed link sets a new password that signs in, once', async ({ page }) => {
    const password = `reset-${Date.now()}`;
    await page.goto(`/auth/reset-password?token=${TOKEN}`);
    await expect(page).toHaveTitle(/Reset password/);

    await page.getByLabel('New password', { exact: true }).fill(password);
    await page.getByLabel('Confirm new password').fill('does-not-match');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('Passwords do not match')).toBeVisible();

    await page.getByLabel('Confirm new password').fill(password);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByTestId('reset-done')).toBeVisible();

    await page.getByRole('link', { name: 'Sign in' }).last().click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await page.getByLabel('Username').fill(USERNAME);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/v4\/dashboard/);

    // Spent: the same link does nothing a second time.
    const again = await page.request.post('/stats/auth/reset-password', {
      data: { token: TOKEN, newPassword: 'another-password' },
    });
    expect(again.status()).toBe(400);
  });
});
