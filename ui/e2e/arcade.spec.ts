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

test.describe('Field Lore theater recon', () => {
  test('loads a quiz after a server is chosen', async ({ page }) => {
    await page.goto('/v4/arcade?game=trivia')
    await page.waitForLoadState('networkidle')
    await chooseArcadeServer(page)

    await expect(page.getByTestId('trivia-question')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('trivia-option')).toHaveCount(4)
  })

  test('conceals a named theater behind spawn-screen art', async ({ page }) => {
    await page.route('**/stats/arcade/trivia/quiz*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          quizToken: 'e2e-theater',
          questions: [
            {
              id: 'q1',
              category: 'Map Dominance',
              question: 'On Wake Island, which combatant has recorded the most kills?',
              options: ['Alpha Player', 'Bravo Player', 'Charlie', 'Xanadu'],
              targetMapName: 'Wake Island',
              highlights: ['Wake Island']
            }
          ]
        })
      })
    })
    await page.route('**/stats/arcade/trivia/verify-question*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          questionId: 'q1',
          isCorrect: true,
          selectedAnswer: 'Alpha Player',
          correctAnswer: 'Alpha Player',
          explanation: 'Alpha Player leads Wake Island with 12,000 confirmed kills.',
          targetPlayerName: 'Alpha Player',
          targetMapName: 'Wake Island',
          highlights: ['Alpha Player', 'Wake Island']
        })
      })
    })

    await page.goto('/v4/arcade?game=trivia')
    await page.waitForLoadState('networkidle')
    await chooseArcadeServer(page)

    const question = page.getByTestId('trivia-question')
    await expect(page.getByTestId('trivia-theater')).toBeVisible({ timeout: 20_000 })
    await expect(question).toContainText(/this theater/i)
    await expect(question).not.toContainText('Wake Island')

    await page.getByTestId('trivia-option').first().click()
    await expect(question).toContainText('Wake Island')
    await expect(page.getByTestId('trivia-theater')).toContainText('Wake Island')
  })

  test('renders map answers as unlabeled theater tiles', async ({ page }) => {
    await page.route('**/stats/arcade/trivia/quiz*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          quizToken: 'e2e-tiles',
          questions: [
            {
              id: 'q-map',
              category: 'Soldier Theaters',
              question: 'On which map has Alpha Player recorded the most kills?',
              options: ['Wake Island', 'Stalingrad', 'El Alamein', 'Iwo Jima'],
              targetMapName: 'Wake Island',
              highlights: ['Alpha Player']
            }
          ]
        })
      })
    })
    await page.route('**/stats/arcade/trivia/verify-question*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          questionId: 'q-map',
          isCorrect: true,
          selectedAnswer: 'Wake Island',
          correctAnswer: 'Wake Island',
          explanation: 'Alpha Player has 8,000 kills on Wake Island, more than on any other recorded map.',
          targetPlayerName: 'Alpha Player',
          targetMapName: 'Wake Island',
          highlights: ['Alpha Player', 'Wake Island']
        })
      })
    })

    await page.goto('/v4/arcade?game=trivia')
    await page.waitForLoadState('networkidle')
    await chooseArcadeServer(page)

    const tiles = page.getByTestId('trivia-theater-options')
    await expect(tiles).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('trivia-option')).toHaveCount(4)
    await expect(tiles).not.toContainText('Wake Island')

    await page.getByTestId('trivia-option').first().click()
    await expect(tiles).toContainText('Wake Island')
  })
})

test.describe('Arcade loading skeletons', () => {
  test('holds the quiz layout with skeletons while the quiz is in flight', async ({ page }) => {
    // Stall the quiz response so the skeleton stays up long enough to inspect. Released
    // once the assertions have run.
    let releaseQuiz: () => void = () => {}
    const quizHeld = new Promise<void>(resolve => { releaseQuiz = resolve })

    await page.route('**/stats/arcade/trivia/quiz*', async route => {
      await quizHeld
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          quizToken: 'e2e-skeleton',
          questions: [
            {
              id: 'q1',
              category: 'Combat MVP',
              question: 'Which soldier has the most first-place finishes?',
              options: ['Alpha Player', 'Bravo Player', 'Charlie', 'Delta'],
              targetPlayerName: 'Alpha Player'
            }
          ]
        })
      })
    })

    await page.goto('/v4/arcade?game=trivia')
    await page.waitForLoadState('networkidle')
    await chooseArcadeServer(page)

    // Skeleton is up, and no spinner replaced it.
    const skeleton = page.getByTestId('arcade-skeleton').first()
    await expect(skeleton).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('trivia-question')).toHaveCount(0)

    // It reserves the real layout: four option rows and a step pip per question, so
    // nothing jumps when the content lands.
    await expect(page.locator('.mm-askel__option')).toHaveCount(4)
    await expect(page.locator('.mm-askel__pip')).toHaveCount(5)

    releaseQuiz()

    await expect(page.getByTestId('trivia-question')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('arcade-skeleton')).toHaveCount(0)
  })

  test('shows a head-to-head skeleton while a matchup is in flight', async ({ page }) => {
    let releaseMatchup: () => void = () => {}
    const matchupHeld = new Promise<void>(resolve => { releaseMatchup = resolve })

    let served = false
    await page.route('**/stats/arcade/higher-lower/next*', async route => {
      // Only stall the first matchup; later ones load normally.
      if (!served) {
        served = true
        await matchupHeld
      }
      await route.continue()
    })

    await page.goto('/v4/arcade')
    await page.waitForLoadState('networkidle')
    await chooseArcadeServer(page)

    const skeleton = page.getByTestId('arcade-skeleton').first()
    await expect(skeleton).toBeVisible({ timeout: 20_000 })
    // Two combatant cards flanking the VS badge, matching the real arena.
    await expect(page.locator('.mm-askel__card')).toHaveCount(2)
    await expect(page.locator('.mm-askel__vs-circle')).toHaveCount(1)

    releaseMatchup()

    await expect(page.getByTestId('hl-prompt')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('arcade-skeleton')).toHaveCount(0)
  })
})
