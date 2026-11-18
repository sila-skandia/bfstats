import type { Page, Route } from '@playwright/test'

// The landing page's thumbnails per server (features/dogfights-on-stats-pages). The E2E
// database has no recordings, Shorts or dogfight index, so `/stats/server-media` is stubbed
// with media for the first live server the landing list is given.

export function serverMediaItem(kind: 'short' | 'replay' | 'dogfight', id: string, over: Record<string, unknown> = {}) {
  return {
    kind,
    id,
    title: kind === 'dogfight' ? 'Ace (BF109) downs Bravo (Spitfire)' : `A ${kind} on Wake Island`,
    imageUrl: null,
    mod: 'bf1942',
    level: 'wake',
    seconds: 42,
    at: kind === 'dogfight' ? null : '2026-11-01T10:00:00Z',
    ...over,
  }
}

/** Gives the first live server `items`. `first` resolves to its raw name once the list has come
 *  (wrapped: an async function returning a bare promise would wait for it). */
export async function stubServerMedia(page: Page, items: unknown[], counts = { shorts: 4, replays: 3, dogfights: 2 }) {
  let resolve!: (name: string) => void
  const first = new Promise<string>(r => { resolve = r })
  // Watched, not routed: the list's own request goes through untouched.
  page.on('response', response => {
    if (!/\/stats\/liveservers\/bf1942\/servers/.test(response.url()) || !response.ok()) return
    response.json().then(body => {
      const name = body?.servers?.[0]?.name
      if (name) resolve(name)
    }, () => {})
  })
  await page.route(/\/stats\/server-media/, async (route: Route) => {
    const serverName = await first
    await route.fulfill({ json: { servers: [{ serverName, ...counts, items }] } })
  })
  // Pictures: an empty answer, so nothing reaches the network.
  await page.route(/\/stats\/(shorts|recordings)\/[a-z0-9]+\.(jpg|mp4)/, route => route.fulfill({ status: 404, body: '' }))
  return { first }
}
