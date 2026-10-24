import { test, expect, type Page } from '@playwright/test'

// A round someone shared a recording of (features/recording-stats-round): its report shows
// the replay and opens it at the report's moments, and the Sessions lists mark it. The
// recordings are stubbed: the matching is covered by RecordingStatsRoundTests, and the E2E
// database has no recording files.

const ROUND = 'e2e-recorded-round'
const START = '2026-10-17T19:44:00Z'

const entry = (playerName: string, score: number, kills: number, team: number) => ({
  rank: 1, playerName, score, kills, deaths: 0, ping: 50, team, teamLabel: team === 1 ? 'Axis' : 'Allied',
})

const report = {
  session: null,
  round: {
    mapName: 'wake',
    gameType: 'conquest',
    serverName: 'E2E Test Server',
    startTime: START,
    endTime: '2026-10-17T20:19:00Z',
    totalParticipants: 2,
    isActive: false,
    tickets1: 120,
    tickets2: 0,
    team1Label: 'Axis',
    team2Label: 'Allied',
    gameId: 'bf1942',
  },
  participants: [],
  leaderboardSnapshots: [
    { timestamp: '2026-10-17T19:44:00Z', entries: [entry('Alpha Player', 0, 0, 1), entry('Bravo Player', 0, 0, 2)] },
    { timestamp: '2026-10-17T19:50:00Z', entries: [entry('Alpha Player', 6, 3, 1), entry('Bravo Player', 2, 1, 2)] },
    { timestamp: '2026-10-17T20:10:00Z', entries: [entry('Alpha Player', 12, 6, 1), entry('Bravo Player', 4, 2, 2)] },
  ],
  achievements: [],
}

function recording(slug: string, over: Record<string, unknown> = {}) {
  return {
    slug,
    title: 'Wake Island on E2E Test Server',
    uploaderName: 'Bravo Player',
    uploaderPlayer: 'Bravo Player',
    recordedBy: 'Bravo Player',
    mod: 'bf1942',
    level: 'wake',
    durationSeconds: 2040,
    // Began 30 s before bfstats.io saw the round start.
    recordedAt: '2026-10-17T19:43:30Z',
    viewCount: 4,
    commentCount: 0,
    createdAt: '2026-10-18T10:00:00Z',
    recordingUrl: `/stats/recordings/${slug}.ndjson`,
    serverLogUrl: null,
    thumbnailUrl: null,
    group: 1,
    ...over,
  }
}

async function stubReport(page: Page, recordings: unknown[]) {
  await page.route(`**/stats/rounds/${ROUND}/report`, route => route.fulfill({ json: report }))
  await page.route(`**/stats/rounds/${ROUND}/recordings`, route => route.fulfill({ json: recordings }))
  await page.route('**/stats/armoury/maps/**', route => route.fulfill({ status: 404, body: '{}' }))
  await page.route('**/stats/assets/mesh/**', route => route.fulfill({ status: 404, body: '' }))
}

test.describe('Round report replay', () => {
  test('shows the replay, merged, and opens it at the moments of the report', async ({ page }) => {
    await stubReport(page, [
      recording('aaaaaaaaaa'),
      recording('bbbbbbbbbb', { uploaderName: 'Alpha Player', uploaderPlayer: 'Alpha Player', durationSeconds: 900, recordedAt: null }),
    ])
    await page.goto(`/v4/rounds/${ROUND}/report`)

    const panel = page.getByTestId('round-replay')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('2 recordings')
    await expect(panel).toContainText('shared by Bravo Player, Alpha Player')
    await expect(panel.getByTestId('round-replay-watch')).toHaveAttribute('href',
      'https://play.bfstats.io/map.html?mod=bf1942&map=wake&replay=/stats/recordings/aaaaaaaaaa.ndjson&replay=/stats/recordings/bbbbbbbbbb.ndjson')
    await expect(panel.getByRole('link', { name: /Comments/ })).toHaveAttribute('href', 'https://play.bfstats.io/play/?tab=replay&rec=aaaaaaaaaa')

    // The playback ends on the last snapshot, 26 minutes in: 26:30 into the recording.
    const moment = panel.getByTestId('round-replay-moment')
    await expect(moment).toContainText('Watch from 26:00')
    await expect(moment).toHaveAttribute('href', /replay=\/stats\/recordings\/aaaaaaaaaa\.ndjson&t=1590$/)

    // A battle-feed line opens the one recording that knows its clock at that line's time.
    const lines = page.getByTestId('battle-feed-replay')
    await expect(lines.first()).toHaveAttribute('href', /replay=\/stats\/recordings\/aaaaaaaaaa\.ndjson&t=1590$/)
    await expect(lines.last()).toHaveAttribute('href', /&t=30$/)
  })

  test('the panel stacks at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stubReport(page, [recording('aaaaaaaaaa')])
    await page.goto(`/v4/rounds/${ROUND}/report`)

    const panel = page.getByTestId('round-replay')
    await expect(panel).toBeVisible()
    const cover = await panel.getByTestId('round-replay-watch').boundingBox()
    const watch = await panel.getByRole('link', { name: 'Watch replay' }).boundingBox()
    // The cover spans the panel and the text sits under it.
    expect(cover!.width).toBeGreaterThan(300)
    expect(watch!.y).toBeGreaterThan(cover!.y + cover!.height)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('stays out of a report no one recorded', async ({ page }) => {
    await stubReport(page, [])
    await page.goto(`/v4/rounds/${ROUND}/report`)

    await expect(page.locator('.mm-rr__tickets')).toBeVisible()
    await expect(page.getByTestId('round-replay')).toHaveCount(0)
    await expect(page.getByTestId('battle-feed-replay')).toHaveCount(0)
  })

  test('without a known start offers the replay but no moments', async ({ page }) => {
    await stubReport(page, [recording('aaaaaaaaaa', { recordedAt: null })])
    await page.goto(`/v4/rounds/${ROUND}/report`)

    await expect(page.getByTestId('round-replay')).toBeVisible()
    await expect(page.getByTestId('round-replay-moment')).toHaveCount(0)
    await expect(page.getByTestId('battle-feed-replay')).toHaveCount(0)
  })
})

test.describe('Sessions mark recorded rounds', () => {
  /** A page of two rounds, the first of them recorded twice (the E2E seed has no rounds). */
  async function markFirstRecorded(page: Page) {
    const round = (roundId: string, over: Record<string, unknown> = {}) => ({
      roundId,
      serverName: 'E2E Test Server',
      serverGuid: 'e2e-server',
      mapName: 'wake',
      gameType: 'conquest',
      gameId: 'bf1942',
      startTime: '2026-10-17T19:44:00',
      endTime: '2026-10-17T20:19:00Z',
      durationMinutes: 35,
      participantCount: 24,
      totalSessions: 24,
      isActive: false,
      team1Label: 'Axis',
      team2Label: 'Allied',
      team1Points: 120,
      team2Points: 0,
      players: [],
      topPlayers: [{ sessionId: 1, roundId, playerName: 'Alpha Player', startTime: '2026-10-17T19:44:00', endTime: '2026-10-17T20:19:00', durationMinutes: 35, score: 40, kills: 20, deaths: 5, isActive: false }],
      recordings: null,
      ...over,
    })
    await page.route(/\/stats\/rounds\?/, route => route.fulfill({
      json: {
        items: [
          round(ROUND, { recordings: [recording('aaaaaaaaaa'), recording('bbbbbbbbbb', { group: 2 })] }),
          round('e2e-unrecorded', { startTime: '2026-10-17T19:00:00' }),
        ],
        page: 1, pageSize: 25, totalItems: 2, totalPages: 1, playerInfo: null,
      },
    }))
  }

  test('a server\'s sessions open the replay from the recorded round', async ({ page }) => {
    await markFirstRecorded(page)
    await page.goto(`/v4/servers/${encodeURIComponent('E2E Test Server')}/sessions`)

    const chip = page.locator('.mm-sessions__table').getByTestId('round-replay-chip')
    await expect(chip).toHaveCount(1)
    await expect(chip).toContainText('Replay2')
    // The second recording is another round as far as the feed knows: the chip plays the first's.
    await expect(chip).toHaveAttribute('href', 'https://play.bfstats.io/map.html?mod=bf1942&map=wake&replay=/stats/recordings/aaaaaaaaaa.ndjson')
    await expect(chip).toHaveAttribute('target', '_blank')
  })

  test('the chip sits on the round card at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await markFirstRecorded(page)
    await page.goto(`/v4/servers/${encodeURIComponent('E2E Test Server')}/sessions`)

    const chip = page.locator('.mm-sessions__cards').getByTestId('round-replay-chip')
    await expect(chip).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
