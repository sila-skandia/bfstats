import { test, expect, type Page, type Route } from '@playwright/test'

// Replay Shorts on bfstats.io's server and player pages (features/replay-shorts, "On the
// stats pages"). The list is stubbed: the API's server and player filters are covered by
// ShortsControllerTests, and the E2E database has no Shorts.

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

async function stubShorts(page: Page, answer: (q: URLSearchParams) => unknown[]) {
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
  await page.locator('[data-testid="shorts-panel"], .mm-shorts-slot').first().scrollIntoViewIfNeeded()
}

test.describe('Shorts on stats pages', () => {
  test('a server page lists the Shorts filmed from its recordings', async ({ page }) => {
    const asked = await stubShorts(page, q => (q.get('server') === SERVER ? [short('shortaaaaa'), short('shortbbbbb', { kind: 'air-to-air', title: 'Spitfire downs BF109' })] : []))

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await reveal(page)

    const panel = page.getByTestId('shorts-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('short-card')).toHaveCount(2)
    await expect(panel).toContainText('2 clips filmed here')
    await expect(panel).toContainText('Air to air')
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

    const panel = page.getByTestId('shorts-panel')
    await expect(panel).toBeVisible()
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

    const panel = page.getByTestId('shorts-panel')
    await expect(panel.getByTestId('short-card')).toHaveCount(8)
    await panel.getByTestId('shorts-next').click()
    await expect(panel.getByTestId('short-card')).toHaveCount(3)
    await expect(panel).toContainText('9–11 of 11')
  })

  test('stays out of the page when there are none', async ({ page }) => {
    const asked = await stubShorts(page, () => [])

    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`)
    await reveal(page)

    await expect.poll(() => asked.length).toBeGreaterThan(0)
    await expect(page.getByTestId('shorts-panel')).toHaveCount(0)
  })
})
