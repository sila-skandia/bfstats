import { test, expect } from '@playwright/test'

test.describe('Arcade theater', () => {
  test('renders the operations scope and keeps games playable', async ({ page }) => {
    await page.goto('/v4/arcade')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Arcade', exact: true })).toBeVisible()
    await expect(page.getByTestId('arcade-theater-scope')).toBeVisible()
    await expect(page.getByRole('button', { name: /headquarters, global network/i })).toBeVisible()

    await page.getByRole('button', { name: /headquarters, global network/i }).click()
    await expect(page.getByRole('heading', { name: 'Global network' })).toBeVisible()

    await page.getByRole('button', { name: 'Mystery Soldier' }).click()
    await expect(page).toHaveURL(/game=mystery/)
  })
})
