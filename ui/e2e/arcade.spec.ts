import { test, expect, type Page } from '@playwright/test'

async function chooseArcadeServer(page: Page) {
  const popular = page.getByTestId('arcade-quick-server').first()
  await expect(popular).toBeVisible({ timeout: 20_000 })
  await popular.click()
  await expect(page.getByTestId('arcade-server-gate')).toHaveCount(0)
}

test.describe('Trivia higher or lower', () => {
  test('requires a server before games load', async ({ page }) => {
    await page.goto('/v4/arcade')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Trivia', exact: true })).toBeVisible()
    await expect(page.getByTestId('arcade-server-gate')).toBeVisible()
    await expect(page.getByTestId('hl-prompt')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /all servers|global network/i })).toHaveCount(0)
  })

  test('shows an aligned prompt and plays a matchup', async ({ page }) => {
    await page.goto('/v4/arcade')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Trivia', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Higher or Lower' })).toBeVisible()
    await expect(page.getByTestId('arcade-orbit-picker')).toBeVisible()
    await expect(page.getByRole('button', { name: /your soldier name/i })).toBeVisible()

    await chooseArcadeServer(page)

    const prompt = page.getByTestId('hl-prompt')
    await expect(prompt).toBeVisible({ timeout: 20_000 })
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

  test('does not show raw stack traces when a matchup fails', async ({ page }) => {
    await page.route('**/stats/arcade/higher-lower/next*', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: 'System.ArgumentException: An item with the same key has already been added. Key: [DGJ]ProPeller at System.Collections.Generic.Dictionary`2.TryInsert(TKey key, TValue value, InsertionBehavior behavior)\nHEADERS =======\nAccept: application/json'
      })
    })

    await page.goto('/v4/arcade')
    await page.waitForLoadState('networkidle')
    await chooseArcadeServer(page)

    const error = page.getByTestId('arcade-error')
    await expect(error).toBeVisible({ timeout: 20_000 })
    await expect(error).toContainText(/Failed to load matchup/i)
    await expect(error).not.toContainText('ArgumentException')
    await expect(error).not.toContainText('TryInsert')
    await expect(error).not.toContainText('HEADERS')
    await expect(error).not.toContainText('[DGJ]ProPeller')
  })
})
