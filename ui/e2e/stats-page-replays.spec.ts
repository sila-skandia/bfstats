import { test, expect, type Page, type Route } from '@playwright/test'

// Shared replays on bfstats.io's server and player pages (features/replay-on-stats-pages).
// The feed is stubbed: the API's filters are covered by RecordingServiceTests, and the E2E
// database has no recording files to serve.

const SERVER = 'E2E Test Server'
const PLAYER = 'Alpha Player'

function card(slug: string, over: Record<string, unknown> = {}) {
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
    ...over,
  }
}

function page_(items: unknown[], page = 1, totalCount = items.length, totalPages = 1) {
  return { items, totalCount, page, pageSize: 6, totalPages, storage: { usedBytes: 0, quotaBytes: 1 }, recordingCount: totalCount }
}

/** Answers the feed by its filter; records every query asked. */
async function stubFeed(page: Page, answer: (q: URLSearchParams) => unknown) {
  const asked: URLSearchParams[] = []
  await page.route(/\/stats\/recordings\?/, async (route: Route) => {
    const q = new URL(route.request().url()).searchParams
    asked.push(q)
    await route.fulfill({ json: answer(q) })
  })
  return asked
}

async function revealPanelSlot(page: Page) {
  await page.locator('.mm-recs-slot').first().scrollIntoViewIfNeeded()
}

test.describe('Replays on stats pages', () => {
  test('a server page lists the rounds recorded there and links to the feed', async ({ page }) => {
    const asked = await stubFeed(page, q =>
      q.get('server') === SERVER ? page_([card('aaaaaaaaaa'), card('bbbbbbbbbb', { title: 'Second round' })]) : page_([]))

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await revealPanelSlot(page)

    const panel = page.getByTestId('recordings-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('recording-card')).toHaveCount(2)
    await expect(panel).toContainText('Showing 1–2 of 2')
    expect(asked.some(q => q.get('server') === SERVER)).toBe(true)

    const cover = panel.getByRole('link', { name: `Watch Wake Island on ${SERVER}` })
    await expect(cover).toHaveAttribute('href', /^https:\/\/play\.bfstats\.io\/map\.html\?mod=bf1942&map=wake&replay=\/stats\/recordings\/aaaaaaaaaa\.ndjson$/)
    await expect(panel.getByRole('link', { name: 'Second round', exact: true }))
      .toHaveAttribute('href', 'https://play.bfstats.io/play/?tab=replay&rec=bbbbbbbbbb')
    await expect(panel.getByRole('link', { name: /In the replay feed/ }))
      .toHaveAttribute('href', `https://play.bfstats.io/play/?tab=replay&server=${encodeURIComponent(SERVER)}`)
    // On the server's own page a card does not repeat the server.
    await expect(panel.locator('.mm-rec__server')).toHaveCount(0)
  })

  test('a player page splits rounds played in from rounds shared', async ({ page }) => {
    const asked = await stubFeed(page, q => {
      if (q.get('player') === PLAYER) return page_([card('playedinaa', { title: 'Played round' })])
      if (q.get('uploader') === PLAYER) return page_([card('sharedaaaa', { title: 'Shared round', uploaderName: PLAYER, uploaderPlayer: PLAYER })])
      return page_([])
    })

    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`)
    await revealPanelSlot(page)

    const panel = page.getByTestId('recordings-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('recordings-tab-played')).toHaveText('Played in · 1')
    await expect(panel.getByTestId('recording-card')).toHaveCount(1)
    await expect(panel).toContainText('Played round')
    // The server links to its page on this site.
    await expect(panel.locator('.mm-rec__server')).toHaveAttribute('href', `/v4/servers/detail/${encodeURIComponent(SERVER)}`)

    await panel.getByTestId('recordings-tab-shared').click()
    await expect(panel).toContainText('Shared round')
    await expect(panel).not.toContainText('Played round')
    await expect(panel.getByRole('link', { name: /In the replay feed/ }))
      .toHaveAttribute('href', `https://play.bfstats.io/play/?tab=replay&uploader=${encodeURIComponent(PLAYER)}`)

    expect(asked.some(q => q.get('player') === PLAYER)).toBe(true)
    expect(asked.some(q => q.get('uploader') === PLAYER)).toBe(true)
  })

  test('a round several players recorded plays merged from its card', async ({ page }) => {
    await stubFeed(page, q => q.get('server') === SERVER
      ? page_([card('leadaaaaaa', {
          round: [
            { slug: 'otheraaaaa', uploaderName: 'Charlie', recordingUrl: '/stats/recordings/otheraaaaa.ndjson', serverLogUrl: null },
            { slug: 'leadaaaaaa', uploaderName: 'Bravo Player', recordingUrl: '/stats/recordings/leadaaaaaa.ndjson', serverLogUrl: null },
          ],
          roundCard: { recordings: 2, durationSeconds: 1500, uploaders: ['Charlie', 'Bravo Player'], viewCount: 9, commentCount: 0, createdAt: '2026-10-01T10:00:00Z', thumbnailUrl: null, weak: false },
        })])
      : page_([]))

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await revealPanelSlot(page)

    const panel = page.getByTestId('recordings-panel')
    await expect(panel.locator('.mm-rec__povs')).toHaveText('2 recordings')
    await expect(panel.locator('.mm-rec__len')).toHaveText('25:00')
    await expect(panel.locator('.mm-rec__cover')).toHaveAttribute('href',
      'https://play.bfstats.io/map.html?mod=bf1942&map=wake&replay=/stats/recordings/leadaaaaaa.ndjson&replay=/stats/recordings/otheraaaaa.ndjson')
    await expect(panel.locator('.mm-rec__by')).toContainText('Charlie')
  })

  test('pages through more than one page of replays', async ({ page }) => {
    const asked = await stubFeed(page, q => {
      if (q.get('server') !== SERVER) return page_([])
      const n = Number(q.get('page'))
      return n === 2
        ? page_([card('pagetwoaaa', { title: 'On page two' })], 2, 7, 2)
        : page_(Array.from({ length: 6 }, (_, i) => card(`pageone${i}aa`, { title: `On page one ${i}` })), 1, 7, 2)
    })

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await revealPanelSlot(page)

    const panel = page.getByTestId('recordings-panel')
    await expect(panel.getByTestId('recording-card')).toHaveCount(6)
    await expect(panel).toContainText('Showing 1–6 of 7')
    await panel.getByRole('button', { name: '2', exact: true }).click()
    await expect(panel.getByTestId('recording-card')).toHaveCount(1)
    await expect(panel).toContainText('On page two')
    await expect(panel).toContainText('Showing 7–7 of 7')
    expect(asked.some(q => q.get('page') === '2' && q.get('pageSize') === '6')).toBe(true)
  })

  test('stays out of the page when there is nothing to show', async ({ page }) => {
    const asked = await stubFeed(page, () => page_([]))

    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`)
    await revealPanelSlot(page)

    await expect.poll(() => asked.length).toBe(2)
    await expect(page.getByTestId('recordings-panel')).toHaveCount(0)
  })

  test('one card to a row on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stubFeed(page, q => q.get('server') === SERVER ? page_([card('aaaaaaaaaa'), card('bbbbbbbbbb')]) : page_([]))

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await revealPanelSlot(page)

    const cards = page.getByTestId('recording-card')
    await expect(cards).toHaveCount(2)
    const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()])
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
