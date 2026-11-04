import { test, expect, type Page, type Route } from '@playwright/test'

// Replay Shorts on bfstats.io's server and player pages (features/replay-shorts, "On the
// stats pages"): the first row of the replays panel, above the rounds, as on the REPLAY feed.
// Both lists are stubbed: the API's filters are covered by ShortsControllerTests and
// RecordingServiceTests, and the E2E database has neither.

const SERVER = 'E2E Test Server'
const PLAYER = 'Alpha Player'

function short(slug: string, over: Record<string, unknown> = {}) {
  return {
    slug,
    recordingSlug: 'aaaaaaaaaa',
    killTime: 100,
    victimPid: 3,
    key: `aaaaaaaaaa:100.00:3`,
    kind: 'streak',
    title: `${PLAYER}: a 9-kill streak on Wake Island`,
    killer: PLAYER,
    victim: '',
    weapon: '',
    killerVehicle: null,
    victimVehicle: null,
    distance: 0,
    lengthSeconds: 45,
    level: 'wake',
    mod: 'bf1942',
    createdAt: '2026-11-01T10:00:00Z',
    views: 3,
    videoUrl: `/stats/shorts/${slug}.mp4`,
    posterUrl: `/stats/shorts/${slug}.jpg`,
    creatorName: null,
    ...over,
  }
}

function recording(slug: string) {
  return {
    slug,
    title: `Wake Island on ${SERVER}`,
    uploaderName: 'Bravo Player',
    level: 'wake',
    mod: 'bf1942',
    gameMode: 'conquest',
    serverName: SERVER,
    recordedLocal: '2026-10-01T20:00:00',
    durationSeconds: 1234,
    playerCount: 32,
    viewCount: 7,
    commentCount: 0,
    createdAt: '2026-10-01T10:00:00Z',
    recordingUrl: `/stats/recordings/${slug}.ndjson`,
    serverLogUrl: null,
    thumbnailUrl: null,
    uploaderPlayer: 'Bravo Player',
    round: null,
    roundCard: null,
    canManage: false,
  }
}

/** The rounds: `rounds` recordings on every tab, or none. */
async function stubRecordings(page: Page, rounds: number) {
  const items = Array.from({ length: rounds }, (_, i) => recording(`rec${String(i).padStart(7, 'a')}`))
  await page.route(/\/stats\/recordings\?/, route => route.fulfill({
    json: { items, totalCount: items.length, page: 1, pageSize: 6, totalPages: 1, storage: { usedBytes: 0, quotaBytes: 1 }, recordingCount: items.length },
  }))
}

async function stubShorts(page: Page, answer: (q: URLSearchParams) => unknown[], rounds = 0) {
  await stubRecordings(page, rounds)
  const asked: URLSearchParams[] = []
  await page.route(/\/stats\/shorts\?/, async (route: Route) => {
    const q = new URL(route.request().url()).searchParams
    asked.push(q)
    const all = answer(q)
    const size = Number(q.get('pageSize') ?? 8)
    const at = Number(q.get('page') ?? 1)
    await route.fulfill({ json: { items: all.slice((at - 1) * size, at * size), total: all.length, page: at, pageSize: size } })
  })
  // Posters and clips: an empty answer, so nothing reaches the network.
  await page.route(/\/stats\/shorts\/[a-z0-9]+\.(jpg|mp4)/, route => route.fulfill({ status: 404, body: '' }))
  return asked
}

async function reveal(page: Page) {
  await page.locator('.mm-recs-slot').first().scrollIntoViewIfNeeded()
}

test.describe('Shorts on stats pages', () => {
  test('a server page lists the Shorts filmed from its recordings', async ({ page }) => {
    const asked = await stubShorts(page, q => (q.get('server') === SERVER ? [short('shortaaaaa'), short('shortbbbbb', { kind: 'air-to-air', title: 'Spitfire downs BF109' })] : []), 3)

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await reveal(page)

    const panel = page.getByTestId('recordings-panel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.mm-pbar__m')).toHaveText('2 shorts · 3 rounds')
    await expect(panel.getByTestId('short-card')).toHaveCount(2)
    await expect(panel.getByTestId('recording-card')).toHaveCount(3)
    await expect(panel.getByTestId('shorts-row')).toContainText('Air to air')
    // Shorts first, the rounds under them.
    const shortsTop = (await panel.getByTestId('shorts-row').boundingBox())!.y
    const roundsTop = (await panel.getByTestId('recording-card').first().boundingBox())!.y
    expect(shortsTop).toBeLessThan(roundsTop)
    const q = asked.find(a => a.get('server') === SERVER)!
    expect(Number(q.get('days'))).toBeGreaterThan(365)
    await expect(panel.getByRole('link', { name: 'Spitfire downs BF109', exact: true }))
      .toHaveAttribute('href', 'https://play.bfstats.io/play/?tab=replay&short=shortbbbbb')
  })

  test('a player page lists the Shorts they are in, and says how', async ({ page }) => {
    await stubShorts(page, q => (q.get('player') === PLAYER
      ? [short('ownaaaaaaa'), short('diedaaaaaa', { killer: 'Bravo Player', title: 'Bravo Player: 5 kills on Wake Island' })]
      : []))

    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`)
    await reveal(page)

    // No rounds of theirs: the panel is there for the Shorts alone.
    const panel = page.getByTestId('recordings-panel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.mm-pbar__m')).toHaveText('2 shorts')
    await expect(panel.getByTestId('recording-card')).toHaveCount(0)
    await expect(panel.getByTestId('short-card')).toHaveCount(2)
    await expect(panel.getByTestId('short-card').nth(0).locator('.mm-short__role')).toHaveCount(0)
    await expect(panel.getByTestId('short-card').nth(1).locator('.mm-short__role')).toHaveText('Killed in it')
    await expect(panel.getByRole('link', { name: /In the Shorts feed/ }))
      .toHaveAttribute('href', `https://play.bfstats.io/play/?tab=replay&shortsBy=${encodeURIComponent(PLAYER)}`)
  })

  test('pages through more than eight', async ({ page }) => {
    const all = Array.from({ length: 11 }, (_, i) => short(`short${String(i).padStart(5, 'a')}`, { title: `Clip ${i + 1}` }))
    await stubShorts(page, q => (q.get('server') === SERVER ? all : []))

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await reveal(page)

    const panel = page.getByTestId('shorts-row')
    await expect(panel.getByTestId('short-card')).toHaveCount(8)
    await panel.getByTestId('shorts-next').click()
    await expect(panel.getByTestId('short-card')).toHaveCount(3)
    await expect(panel).toContainText('9–11 of 11')
  })

  test('leaves the row out when there are none, and the panel when there are no rounds either', async ({ page }) => {
    const asked = await stubShorts(page, () => [], 2)

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await reveal(page)

    const panel = page.getByTestId('recordings-panel')
    await expect(panel.getByTestId('recording-card')).toHaveCount(2)
    await expect.poll(() => asked.length).toBeGreaterThan(0)
    await expect(panel.getByTestId('shorts-row')).toHaveCount(0)
    await expect(panel.locator('.mm-pbar__m')).toHaveText('2 rounds')

    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await stubShorts(page, () => [], 0)
    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`)
    await reveal(page)
    await expect(page.getByTestId('recordings-panel')).toBeHidden()
  })
})
