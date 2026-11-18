import { test, expect, type Page, type Route } from '@playwright/test'

// Recorded dogfights on bfstats.io's server and player pages (features/dogfights-on-stats-pages):
// a row of the replays panel, under the Shorts and above the rounds. The list is stubbed: the
// API's filters are covered by DogfightServiceTests, and the E2E run has no dogfight index.

const SERVER = 'E2E Test Server'
const PLAYER = 'Alpha Player'

function fight(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    slug: id.slice(0, 10),
    mod: 'xpack1',
    level: 'anzio',
    recorded: '2026-11-15',
    serverName: SERVER,
    source: 'client',
    duration: 13.6,
    kind: 'dogfight',
    mutual: true,
    closest: 30,
    kill: { side: 0, t: 10.6, weapon: 'BF109' },
    end: { why: 'shot down', t: 10.6, side: 1, by: null },
    sides: [
      { name: PLAYER, team: 1, tmpl: 'BF109', aimed: 27, hits: 8, turned: 251 },
      { name: 'Bravo Player', team: 2, tmpl: 'Spitfire', aimed: 12, hits: 0, turned: 192, gunner: null },
    ],
    clip: true,
    ...over,
  }
}

/** No rounds and no Shorts; the dogfights by their filter. Records every query asked. */
async function stub(page: Page, answer: (q: URLSearchParams) => unknown[]) {
  await page.route(/\/stats\/recordings\?/, route => route.fulfill({
    json: { items: [], totalCount: 0, page: 1, pageSize: 6, totalPages: 1, storage: { usedBytes: 0, quotaBytes: 1 }, recordingCount: 0 },
  }))
  await page.route(/\/stats\/shorts\?/, route => route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 8 } }))
  const asked: URLSearchParams[] = []
  await page.route(/\/stats\/dogfights\?/, async (route: Route) => {
    const q = new URL(route.request().url()).searchParams
    asked.push(q)
    const kind = q.get('kind')
    const all = answer(q) as { kind: string; kill: unknown }[]
    const shown = kind ? all.filter(f => f.kind === kind) : all
    const size = Number(q.get('pageSize') ?? 6)
    const at = Number(q.get('page') ?? 1)
    await route.fulfill({
      json: {
        items: shown.slice((at - 1) * size, at * size), total: shown.length, page: at, pageSize: size,
        dogfights: all.filter(f => f.kind === 'dogfight').length, kills: all.filter(f => f.kill).length,
      },
    })
  })
  await page.route(/\/stats\/assets\/maps\//, route => route.fulfill({ status: 404, body: '' }))
  return asked
}

async function reveal(page: Page) {
  await page.locator('.mm-recs-slot').first().scrollIntoViewIfNeeded()
}

test.describe('Dogfights on stats pages', () => {
  test('a server page shows each fight recorded there in full', async ({ page }) => {
    const asked = await stub(page, q => (q.get('server') === SERVER
      ? [fight('aaaaaaaaaa-1'), fight('aaaaaaaaaa-2', {
          kind: 'bounce', mutual: false, kill: null, clip: false,
          end: { why: 'downed by another', t: 12.0, side: 0, by: { name: 'Charlie', weapon: 'Flak_38' } },
        })]
      : []))

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await reveal(page)

    const panel = page.getByTestId('recordings-panel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.mm-pbar__m')).toHaveText('2 air fights')
    const row = panel.getByTestId('dogfights-row')
    await expect(row.getByTestId('dogfights-tally')).toHaveText('1 dogfight · 1 kill')
    const cards = row.getByTestId('dogfight-card')
    await expect(cards).toHaveCount(2)

    const first = cards.nth(0)
    await expect(first.locator('.mm-df__title')).toHaveText(`${PLAYER} (BF109) downs Bravo Player (Spitfire)`)
    await expect(first.locator('.mm-df__kind')).toHaveText('Dogfight')
    await expect(first.locator('.mm-df__killtag')).toHaveText('Kill')
    await expect(first.locator('.mm-df__len')).toHaveText('13.6 s')
    const pilots = first.getByTestId('dogfight-pilot')
    await expect(pilots).toHaveCount(2)
    await expect(pilots.nth(0)).toContainText('BF109')
    await expect(pilots.nth(0)).toContainText('27')
    await expect(pilots.nth(0)).toContainText('30%')
    await expect(pilots.nth(0).getByRole('link', { name: PLAYER })).toHaveAttribute('href', `/v4/players/${encodeURIComponent(PLAYER)}`)
    await expect(first.getByTestId('dogfight-end')).toHaveText(`${PLAYER} shot Bravo Player down at 10.6 s`)
    await expect(first).toContainText('Anzio')
    await expect(first).toContainText('Road to Rome')
    await expect(first).toContainText('30 m closest')
    await expect(first.getByTestId('dogfight-school')).toHaveAttribute('href', 'https://play.bfstats.io/dogfight.html?fight=aaaaaaaaaa-1')
    await expect(first.getByTestId('dogfight-replay')).toHaveAttribute('href',
      'https://play.bfstats.io/map.html?mod=xpack1&map=anzio&replay=/replays/dogfights/aaaaaaaaaa-1.ndjson&clip=1&school=aaaaaaaaaa-1')
    // On the server's own page a card does not repeat the server.
    await expect(first.locator('.mm-df__server')).toHaveCount(0)

    const second = cards.nth(1)
    await expect(second.locator('.mm-df__kind')).toHaveText('Bounce')
    await expect(second.locator('.mm-df__title')).toHaveText(`${PLAYER} (BF109) v Bravo Player (Spitfire)`)
    await expect(second.getByTestId('dogfight-end')).toHaveText(`${PLAYER} shot down by Charlie with the Flak 38 at 12.0 s`)
    await expect(second.getByTestId('dogfight-replay')).toHaveCount(0)

    expect(asked.some(q => q.get('server') === SERVER)).toBe(true)
  })

  test('narrows to dogfights or bounces', async ({ page }) => {
    const asked = await stub(page, q => (q.get('server') === SERVER
      ? [fight('aaaaaaaaaa-1'), fight('aaaaaaaaaa-2', { kind: 'bounce', kill: null })]
      : []))

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await reveal(page)

    const row = page.getByTestId('dogfights-row')
    await expect(row.getByTestId('dogfight-card')).toHaveCount(2)
    await row.getByTestId('dogfights-kind-bounce').click()
    await expect(row.getByTestId('dogfight-card')).toHaveCount(1)
    await expect(row.locator('.mm-df__kind')).toHaveText('Bounce')
    expect(asked.some(q => q.get('kind') === 'bounce' && q.get('server') === SERVER)).toBe(true)
    await row.getByTestId('dogfights-kind-all').click()
    await expect(row.getByTestId('dogfight-card')).toHaveCount(2)
  })

  test('a player page shows the fights they flew, how each went, and where', async ({ page }) => {
    await stub(page, q => (q.get('player') === PLAYER
      ? [fight('aaaaaaaaaa-1'), fight('bbbbbbbbbb-1', { kill: { side: 1, t: 8, weapon: 'Spitfire' }, end: { why: 'shot down', t: 8, side: 0 } })]
      : []))

    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`)
    await reveal(page)

    const row = page.getByTestId('dogfights-row')
    const cards = row.getByTestId('dogfight-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0).getByTestId('dogfight-outcome')).toHaveText('Won')
    await expect(cards.nth(1).getByTestId('dogfight-outcome')).toHaveText('Shot down')
    await expect(cards.nth(0).locator('.mm-df__pilot--me')).toHaveCount(1)
    await expect(cards.nth(0).locator('.mm-df__server')).toHaveAttribute('href', `/v4/servers/detail/${encodeURIComponent(SERVER)}`)
  })

  test('pages through more than six', async ({ page }) => {
    const all = Array.from({ length: 8 }, (_, i) => fight(`aaaaaaaaaa-${i + 1}`))
    await stub(page, q => (q.get('server') === SERVER ? all : []))

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await reveal(page)

    const row = page.getByTestId('dogfights-row')
    await expect(row.getByTestId('dogfight-card')).toHaveCount(6)
    await row.getByTestId('dogfights-next').click()
    await expect(row.getByTestId('dogfight-card')).toHaveCount(2)
    await expect(row).toContainText('7–8 of 8')
  })

  test('stays out of the page when there are none', async ({ page }) => {
    const asked = await stub(page, () => [])
    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await reveal(page)
    await expect.poll(() => asked.length).toBeGreaterThan(0)
    await expect(page.getByTestId('dogfights-row')).toHaveCount(0)
    await expect(page.getByTestId('recordings-panel')).toBeHidden()
  })

  test('one fight to a row on a phone, with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stub(page, q => (q.get('server') === SERVER ? [fight('aaaaaaaaaa-1'), fight('aaaaaaaaaa-2')] : []))

    await page.goto(`/v4/servers/detail/${encodeURIComponent(SERVER)}`)
    await reveal(page)

    const cards = page.getByTestId('dogfight-card')
    await expect(cards).toHaveCount(2)
    const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()])
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
