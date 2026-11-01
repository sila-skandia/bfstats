import { test, expect } from '@playwright/test';

// The name-first server pages (features/seo-featured-servers). The E2E data set
// may not carry these servers live, so the known names must show either way.
test.describe('Featured server pages', () => {
  test('hub links every community', async ({ page }) => {
    await page.goto('/bf1942-servers');
    await expect(page.locator('h1')).toHaveText('Battlefield 1942 servers');
    await expect(page).toHaveTitle(/BF1942 servers/);
    const links = page.locator('[data-testid="featured-communities"] a');
    await expect(links).toHaveCount(5);
    await expect(links.first()).toHaveAttribute('href', '/bf1942-servers/simple');
  });

  test('a community page names its servers and carries its own head', async ({ page }) => {
    await page.goto('/bf1942-servers/simple');
    await expect(page.locator('h1')).toHaveText('SiMPLE Battlefield 1942 servers');
    await expect(page).toHaveTitle(/^SiMPLE BF1942 servers/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://bfstats.io/bf1942-servers/simple');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /37\.187\.92\.162/);

    const servers = page.locator('[data-testid="community-servers"]');
    await expect(servers).toContainText('SiMPLE | BF1942');
    await expect(servers).toContainText('SiMPLE | RtR+SW');

    const ld = JSON.parse((await page.locator('#seo-jsonld').textContent()) ?? '{}');
    expect(ld['@type']).toBe('CollectionPage');
    expect(ld.mainEntity.itemListElement.length).toBeGreaterThan(0);
  });

  test('JSON-LD is dropped on pages without it', async ({ page }) => {
    await page.goto('/bf1942-servers/moongamers');
    await expect(page.locator('#seo-jsonld')).toHaveCount(1);
    await page.getByRole('link', { name: 'Every live Battlefield 1942 server' }).click();
    await expect(page).toHaveURL(/\/v4\/servers\/bf1942/);
    await expect(page.locator('#seo-jsonld')).toHaveCount(0);
  });

  test('an unknown community is noindex', async ({ page }) => {
    await page.goto('/bf1942-servers/nope');
    await expect(page.locator('h1')).toHaveText('Server group not found');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});
