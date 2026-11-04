import { test, expect, type Page } from '@playwright/test'

// The BattleView page's Watch now button, latest round, Shorts strip and install link
// (features/battleview-install-page). Both feeds are stubbed: the E2E database has no
// recordings or Shorts to serve.

function card(slug: string, over: Record<string, unknown> = {}) {
  return {
    slug,
    title: `Round ${slug}`,
    uploaderName: 'Bravo Player',
    level: 'wake',
    mod: 'bf1942',
    gameMode: 'conquest',
    serverName: 'E2E Test Server',
    recordedLocal: '2026-10-01T20:00:00',
    durationSeconds: 1234,
    playerCount: 32,
    viewCount: 7,
    commentCount: 0,
    createdAt: '2026-10-01T10:00:00Z',
    recordingUrl: `/stats/recordings/${slug}.ndjson`,
    serverLogUrl: null,
    thumbnailUrl: null,
    uploaderPlayer: null,
    round: null,
    roundCard: null,
    source: 'client',
    ...over,
  }
}

function short(slug: string, over: Record<string, unknown> = {}) {
  return {
    slug,
    recordingSlug: 'aaaaaaaaaa',
    killTime: 100,
    victimPid: 3,
    key: `aaaaaaaaaa:100.00:3`,
    kind: 'air-to-air',
    title: `Short ${slug}`,
    killer: 'Alpha',
    victim: 'Bravo',
    weapon: 'MG',
    killerVehicle: null,
    victimVehicle: null,
    distance: 120,
    lengthSeconds: 18,
    level: 'midway',
    mod: 'bf1942',
    createdAt: '2026-10-01T10:00:00Z',
    views: 2,
    videoUrl: `/stats/shorts/${slug}.mp4`,
    posterUrl: `/stats/shorts/${slug}.jpg`,
    creatorName: null,
    ...over,
  }
}

async function stub(page: Page, recordings: unknown[], shorts: unknown[]) {
  await page.route(/\/stats\/recordings\?/, route =>
    route.fulfill({ json: { items: recordings, totalCount: recordings.length, page: 1, pageSize: 6, totalPages: 1 } }))
  await page.route(/\/stats\/shorts\?/, route =>
    route.fulfill({ json: { items: shorts, total: shorts.length, page: 1, pageSize: 6 } }))
  await page.route(/\/stats\/shorts\/\w+\.(jpg|mp4)$/, route => route.fulfill({ status: 404 }))
}

test.describe('BattleView replays', () => {
  test('Watch now opens the replays, the latest round has its own link, and Shorts are listed', async ({ page }) => {
    await stub(page, [card('aaaaaaaaaa', { title: 'Newest round' })], [short('ssssssssss'), short('tttttttttt', { kind: 'long-shot' })])

    await page.goto('/battleview')

    await expect(page.getByTestId('battleview-watch-now')).toHaveAttribute('href', 'https://play.bfstats.io/play/?tab=replay')
    const latest = page.getByTestId('battleview-latest')
    await expect(latest).toContainText('Newest round')
    await expect(latest).toHaveAttribute('href', 'https://play.bfstats.io/map.html?mod=bf1942&map=wake&replay=/stats/recordings/aaaaaaaaaa.ndjson')

    await page.locator('.mm-shorts-slot').scrollIntoViewIfNeeded()
    const strip = page.getByTestId('shorts-strip')
    await expect(strip.getByTestId('short-card')).toHaveCount(2)
    await expect(strip.getByRole('link', { name: 'Watch the Short: Short ssssssssss' }))
      .toHaveAttribute('href', 'https://play.bfstats.io/play/?tab=replay&short=ssssssssss')
    await expect(strip).toContainText('Long shot')

    // The install steps are the page's point: no recordings list to wade through first.
    await expect(page.getByTestId('recordings-panel')).toHaveCount(0)
  })

  test('Install BattleView scrolls down to the install steps', async ({ page }) => {
    await stub(page, [], [])

    await page.goto('/battleview')
    await page.getByTestId('battleview-install-link').click()
    await expect(page.locator('#bv-install')).toBeInViewport()
  })

  test('with nothing shared, there is no latest round and no Shorts strip', async ({ page }) => {
    await stub(page, [], [])

    await page.goto('/battleview')

    await expect(page.getByTestId('battleview-watch-now')).toBeVisible()
    await expect(page.getByTestId('battleview-latest')).toHaveCount(0)
    await page.locator('.mm-shorts-slot').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('shorts-strip')).toHaveCount(0)
  })
})
