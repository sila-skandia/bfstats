import { test, expect } from '@playwright/test'

test.describe('Arcade higher or lower', () => {
  test('shows an aligned prompt and plays a matchup', async ({ page }) => {
    await page.goto('/v4/arcade')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Arcade', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Higher or Lower' })).toBeVisible()

    const prompt = page.getByTestId('hl-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText(/higher or lower/i)
    await expect(page.getByTestId('hl-prompt-detail')).toBeVisible()
    await expect(page.getByTestId('hl-prompt-detail')).not.toHaveText('')

    const pickA = page.getByTestId('hl-pick-a')
    const pickB = page.getByTestId('hl-pick-b')
    await expect(pickA).toBeVisible()
    await expect(pickB).toBeVisible()

    await pickA.click()
    await expect(page.getByTestId('hl-outcome')).toBeVisible()
    await page.getByRole('button', { name: 'Next Matchup' }).click()
    await expect(page.getByTestId('hl-prompt-detail')).toBeVisible()
  })
})
