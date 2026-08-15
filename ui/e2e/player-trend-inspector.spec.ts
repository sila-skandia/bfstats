import { test, expect, type Page } from '@playwright/test';

const PLAYER = 'TrendZoomPlayer';

function trendPoint(dayOffset: number, kd: number, killRate: number, rounds: number) {
  const d = new Date(Date.UTC(2026, 2, 1 + dayOffset));
  const timestamp = d.toISOString();
  return {
    kd: { timestamp, value: kd, sessionCount: rounds },
    kr: { timestamp, value: killRate, sessionCount: rounds },
  };
}

const points = Array.from({ length: 30 }, (_, i) =>
  trendPoint(i, 0.8 + i * 0.04, 0.3 + (i % 7) * 0.02, 3),
);

const playerPayload = {
  totalPlayTimeMinutes: 1200,
  totalSessions: 90,
  firstPlayed: '2026-03-01T00:00:00Z',
  lastPlayed: '2026-03-30T00:00:00Z',
  highestScore: 80,
  totalKills: 400,
  totalDeaths: 200,
  isActive: false,
  currentServer: null,
  bestSession: null,
  servers: [],
  recentSessions: [],
  insights: { activityByHour: [], serverRankings: [], serverPlayTimes: [], favoriteMaps: [], playerName: PLAYER, startPeriod: '2026-03-01T00:00:00Z', endPeriod: '2026-03-30T00:00:00Z' },
  killMilestones: [],
  recentStats: {
    analysisPeriodStart: '2026-03-01T00:00:00Z',
    analysisPeriodEnd: '2026-03-30T00:00:00Z',
    totalRoundsAnalyzed: 90,
    granularity: 'daily',
    kdRatioTrend: points.map(p => p.kd),
    killRateTrend: points.map(p => p.kr),
  },
};

const roundsPayload = {
  items: [
    {
      roundId: 'round-wake-1',
      serverName: 'MoonGamers',
      serverGuid: 'guid-1',
      mapName: 'Wake Island',
      gameType: 'gpm_cq',
      startTime: '2026-03-12T18:00:00Z',
      endTime: '2026-03-12T18:22:00Z',
      durationMinutes: 22,
      participantCount: 32,
      isActive: false,
      topPlayers: [{
        sessionId: 1,
        roundId: 'round-wake-1',
        playerName: PLAYER,
        startTime: '2026-03-12T18:00:00Z',
        endTime: '2026-03-12T18:22:00Z',
        durationMinutes: 22,
        score: 84,
        kills: 18,
        deaths: 7,
        isActive: false,
      }],
    },
  ],
  page: 1,
  currentPage: 1,
  pageSize: 25,
  totalItems: 1,
  totalPages: 1,
};

async function mockPlayerTrend(page: Page) {
  await page.route(`**/stats/players/${encodeURIComponent(PLAYER)}`, async route => {
    if (route.request().url().includes('/map-stats') || route.request().url().includes('/sessions')) {
      await route.continue();
      return;
    }
    await route.fulfill({ json: playerPayload });
  });
  await page.route('**/stats/rounds**', async route => {
    await route.fulfill({ json: roundsPayload });
  });
}

test.describe('Player trend inspector', () => {
  test('expands to fullscreen and slides in rounds for the window', async ({ page }) => {
    await mockPlayerTrend(page);
    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`);
    await expect(page.getByTestId('player-trend-panel')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('K/D trend').first()).toBeVisible();
    await expect(page.getByText('drag to zoom').first()).toBeVisible();

    await page.getByRole('button', { name: /expand trend graphs/i }).first().click();
    const inspector = page.getByTestId('trend-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText('Trend inspector')).toBeVisible();
    await expect(inspector.getByText('Drag a slice to zoom')).toBeVisible();

    await inspector.getByRole('button', { name: /view .* rounds/i }).click();
    const slideover = page.getByTestId('trend-rounds-slideover');
    await expect(slideover).toBeVisible();
    await expect(slideover.getByText('Rounds in window')).toBeVisible();
    await expect(slideover.getByText('Wake Island')).toBeVisible();
    await expect(slideover.getByRole('button', { name: /open sessions page/i })).toBeVisible();

    await slideover.getByRole('button', { name: /close rounds listing/i }).click();
    await expect(slideover).toHaveCount(0);

    await inspector.getByRole('button', { name: /exit full screen/i }).click();
    await expect(inspector).toHaveCount(0);
  });

  test('dragging a slice zooms both charts and offers a reset', async ({ page }) => {
    await mockPlayerTrend(page);
    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`);
    const panel = page.getByTestId('player-trend-panel');
    await expect(panel).toBeVisible({ timeout: 15000 });

    const chart = panel.getByRole('group', { name: /drag horizontally to zoom/i }).first();
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    expect(box).toBeTruthy();
    const y = box!.y + box!.height / 2;
    const fromX = box!.x + 16;
    const toX = box!.x + Math.max(box!.width * 0.5, 120);
    await chart.dispatchEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: fromX,
      clientY: y,
    });
    await chart.dispatchEvent('pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: toX,
      clientY: y,
    });
    await chart.dispatchEvent('pointerup', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: toX,
      clientY: y,
    });

    await expect(panel.getByRole('button', { name: /^reset$/i }).first()).toBeVisible();
    await expect(panel.getByRole('button', { name: /view .* rounds/i })).toBeVisible();

    await panel.getByRole('button', { name: /^reset$/i }).first().click();
    await expect(panel.getByRole('button', { name: /^reset$/i })).toHaveCount(0);
    await expect(panel.getByText('drag to zoom').first()).toBeVisible();
  });
});
