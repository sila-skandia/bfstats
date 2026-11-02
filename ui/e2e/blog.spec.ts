import { test, expect } from '@playwright/test'

// The example post is a draft: E2E runs `npm run dev`, where drafts show.
// features/blog/README.md

test.describe('Blog', () => {
  test('lists posts and opens one', async ({ page }) => {
    await page.goto('/blog')
    await expect(page.getByRole('heading', { name: "How it's built", level: 1 })).toBeVisible()
    await page.getByRole('link', { name: /Example post/ }).click()
    await expect(page).toHaveURL(/\/blog\/example-post$/)
    await expect(page.getByRole('heading', { name: 'Example post', level: 1 })).toBeVisible()
    await expect(page).toHaveTitle(/Example post/)
  })

  test('draws every piece of the format', async ({ page }) => {
    await page.goto('/blog/example-post')

    // Headings, steps with heads, cards side by side.
    await expect(page.getByRole('heading', { name: 'A section heading', level: 2 })).toBeVisible()
    await expect(page.locator('.mm-steps .mm-steps__head')).toHaveText(['Install', 'Turn it on', 'Share it'])
    await expect(page.getByRole('heading', { name: 'The client recorder' })).toBeVisible()
    await expect(page.locator('.mm-article-card')).toHaveCount(2)

    // Code blocks carry a Copy button; external links open in a new tab.
    await expect(page.locator('.mm-code-block')).toHaveCount(2)
    await expect(page.getByRole('link', { name: 'an external link' })).toHaveAttribute('target', '_blank')

    // Every figure's file resolved: no missing-file markers.
    await expect(page.locator('.mm-article__missing')).toHaveCount(0)
    await expect(page.locator('.mm-figure figcaption .mm-figure__label')).toHaveText(['Tank kill', 'Still one', 'Still two'])

    // A figure opens full screen and Escape closes it.
    await page.getByRole('button', { name: 'Full screen: Still one' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('an unknown slug says so', async ({ page }) => {
    await page.goto('/blog/no-such-post')
    await expect(page.getByRole('heading', { name: 'Post not found' })).toBeVisible()
  })

  test('fits a phone without sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/blog/example-post')
    await expect(page.getByRole('heading', { name: 'Example post', level: 1 })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow).toBe(false)
  })
})
