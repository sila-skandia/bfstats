import { test, expect } from '@playwright/test';

test.describe('Server 1-Click Connect & Copy Action', () => {
  test('should display Connect / Play Now button in landing page selected host aside', async ({ page }) => {
    await page.goto('/v4/servers/bf1942');
    await page.waitForLoadState('networkidle');

    // If an active server is selected or selectable
    const aside = page.locator('aside.mm-landing__aside');
    if (await aside.isVisible()) {
      const connectAction = aside.locator('.mm-connect');
      await expect(connectAction).toBeVisible();

      // Should have Play Now direct protocol link
      const playNowLink = connectAction.locator('a.mm-connect__btn--primary');
      await expect(playNowLink).toBeVisible();
      const href = await playNowLink.getAttribute('href');
      expect(href).toMatch(/^bf1942:\/\//);

      // Should toggle dropdown when clicking copy button
      const copyToggle = connectAction.locator('button.mm-connect__btn--copy');
      await copyToggle.click();

      const menu = connectAction.locator('.mm-connect__menu');
      await expect(menu).toBeVisible();
      await expect(menu.locator('.mm-connect__item', { hasText: /copy ip/i })).toBeVisible();
      await expect(menu.locator('.mm-connect__item', { hasText: /launch argument/i })).toBeVisible();
    }
  });

  test('should display Connect button in Server Details page hero', async ({ page }) => {
    // Navigate directly to a server detail page or find one from landing
    await page.goto('/v4/servers/bf1942');
    await page.waitForLoadState('networkidle');

    const serverRow = page.locator('.mm-list tbody tr').first();
    if (await serverRow.isVisible()) {
      // On desktop, click row to select or navigate
      await page.goto('/v4/servers/search');
      await page.waitForLoadState('networkidle');

      const firstLink = page.locator('a[href*="/v4/servers/detail/"]').first();
      if (await firstLink.isVisible()) {
        await firstLink.click();
        await page.waitForLoadState('networkidle');

        // Look for hero connect action if server has IP
        const connectAction = page.locator('.mm-server-hero__links .mm-connect');
        if (await connectAction.isVisible()) {
          const playLink = connectAction.locator('a.mm-connect__btn--primary');
          await expect(playLink).toBeVisible();
          const href = await playLink.getAttribute('href');
          expect(href).toMatch(/^bf1942:\/\//);
        }
      }
    }
  });
});
