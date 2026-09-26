import { test, expect, type Page } from '@playwright/test';

// The service record's numbers come from the API (tests/api/ServiceRecord); these
// specs pin what the page does with them: which army it opens on, how the roster,
// kit bar and motor pool drive the stage, and the round report's two armies.
// WebGL is not asserted: without the mesh tree the stage falls back, and every
// control around it still has to work.

const PLAYER = 'Alpha Player';

const worn = (path: string, bone: string, slot: string) => ({ path, bone, slot, position: [0, 0, 0], rotation: [0, 0, 0] });

const marines = {
  key: 'bf1942:us:USMarineSoldier',
  name: 'US Marine Corps',
  nation: 'us',
  nationLabel: 'United States',
  side: 'allied',
  mod: 'bf1942',
  minutes: 1800, rounds: 60, kills: 420, deaths: 300, score: 900, wins: 33, losses: 22,
  maps: [
    { gameId: 'bf1942', mapName: 'wake', displayName: 'Wake', minutes: 1200, rounds: 40 },
    { gameId: 'bf1942', mapName: 'midway', displayName: 'Midway', minutes: 600, rounds: 20 },
  ],
  kits: [
    { template: 'USMarine_Scout', name: 'Scout', role: 'scout', iconPath: 'kits/bf1942/usmarinescout.png' },
    { template: 'UsMarine_Assault', name: 'Assault', role: 'assault', iconPath: 'kits/bf1942/usmarineassault.png' },
  ],
  figure: {
    skin: 'USMarineSoldier',
    thumb: 'models/thumbs/usmarinesoldier.png',
    kits: [
      { template: 'USMarine_Scout', weapon: 'No4Sniper', pose: 'models/poses/USMarineSoldier__No4Sniper.pose.glb', worn: [worn('models/UsMarine_Helmet.kit.glb', 'A', 'head')] },
      { template: 'UsMarine_Assault', weapon: 'Bar1918', pose: 'models/poses/USMarineSoldier__Bar1918.pose.glb', worn: [worn('models/UsMarine_Helmet.kit.glb', 'A', 'head')] },
    ],
  },
  vehicles: [
    { template: 'sherman', name: 'M4 Sherman', category: 'land', iconPath: 'vehicles/bf1942/sherman.png', thumb: 'models/thumbs/sherman.png', model: 'models/Sherman.glb', minutes: 1200, maps: 1 },
    { template: 'lcvp', name: 'LCVP', category: 'sea', iconPath: 'vehicles/bf1942/lcvp.png', thumb: null, model: null, minutes: 600, maps: 1 },
  ],
};

const japan = {
  ...marines,
  key: 'bf1942:jp:JapaneseSoldier',
  name: 'Imperial Japanese Army',
  nation: 'jp',
  nationLabel: 'Japan',
  side: 'axis',
  minutes: 900, rounds: 30, wins: 10, losses: 18,
  maps: [{ gameId: 'bf1942', mapName: 'wake', displayName: 'Wake', minutes: 900, rounds: 30 }],
  kits: [{ template: 'Jap_Assault', name: 'Assault', role: 'assault', iconPath: 'kits/bf1942/japassault.png' }],
  figure: {
    skin: 'JapaneseSoldier',
    thumb: null,
    kits: [{ template: 'Jap_Assault', weapon: 'Type99', pose: 'models/poses/JapaneseSoldier__Type99.pose.glb', worn: [] }],
  },
  vehicles: [],
};

const iraq = {
  ...marines,
  key: 'dc_final:Iraq',
  name: 'Iraq',
  nation: null,
  nationLabel: 'Iraq',
  side: 'axis',
  mod: 'dc_final',
  minutes: 300, rounds: 10, wins: 2, losses: 3,
  maps: [{ gameId: 'dc_final', mapName: 'dc al nas', displayName: 'Al Nas', minutes: 300, rounds: 10 }],
  kits: [{ template: 'Iraq_Sniper', name: 'Sniper', role: 'scout', iconPath: null }],
  figure: null,
  vehicles: [],
};

function record(armies: object[]) {
  return {
    playerName: PLAYER,
    totalMinutes: 3100,
    attributedMinutes: 3000,
    sides: [
      { side: 'axis', minutes: 1200, rounds: 40, kills: 0, deaths: 0, wins: 12, losses: 21 },
      { side: 'allied', minutes: 1800, rounds: 60, kills: 0, deaths: 0, wins: 33, losses: 22 },
    ],
    armies,
    unattributed: { minutes: 100, rounds: 3 },
    window: { sessions: 103, capped: false, since: '2026-06-01T20:00:00Z' },
  };
}

async function mockServiceRecord(page: Page, body: object) {
  await page.route('**/stats/players/*/service-record', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  // No mesh tree in the E2E asset root; answer at once rather than wait on the API.
  await page.route('**/stats/assets/mesh/**', route => route.fulfill({ status: 404, body: '' }));
}

test.describe('Service record', () => {
  test('opens on the longest-served army and re-dresses on selection', async ({ page }) => {
    await mockServiceRecord(page, record([marines, japan, iraq]));
    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`);

    const panel = page.getByTestId('service-record');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.mm-sr__army')).toHaveText('US Marine Corps');
    await expect(panel.locator('.mm-sr__lead .mm-eyebrow')).toContainText('Primary service');
    await expect(panel.locator('.mm-pbar__m')).toContainText('3 armies');
    await expect(panel.locator('.mm-sr__row')).toHaveCount(3);

    // The rifleman's kit is the one the stage opens on.
    const kits = panel.locator('button.mm-sr__kit');
    await expect(kits).toHaveCount(2);
    await expect(kits.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.mm-sr__caption')).toHaveText(/Assault · Bar1918/);
    await kits.nth(0).click();
    await expect(kits.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.mm-sr__caption')).toHaveText(/Scout · No4Sniper/);

    // A vehicle with a model takes the stage; one without is a static tile.
    await expect(panel.locator('button.mm-sr__vehicle')).toHaveCount(1);
    await panel.locator('button.mm-sr__vehicle', { hasText: 'M4 Sherman' }).click();
    await expect(panel.locator('.mm-sr__back')).toBeVisible();
    await expect(panel.locator('.mm-sr__caption')).toHaveText(/M4 Sherman · Land/);
    await expect(panel.locator('.mm-sr__mesh-link')).toHaveAttribute('href', 'https://mesh.bfstats.io/#Sherman');
    await panel.locator('.mm-sr__back').click();
    await expect(panel.locator('button.mm-sr__kit')).toHaveCount(2);

    // Another army re-dresses the stage and resets the kit.
    await panel.locator('.mm-sr__row', { hasText: 'Imperial Japanese Army' }).click();
    await expect(panel.locator('.mm-sr__army')).toHaveText('Imperial Japanese Army');
    await expect(panel.locator('.mm-sr__lead .mm-eyebrow')).toContainText('#2 of 3 armies');
    await expect(panel.locator('.mm-sr__caption')).toHaveText(/Assault · Type99/);
    await expect(panel.locator('.mm-sr__pool')).toHaveCount(0);

    // A mod army the armoury has no soldier for says so, and takes no article.
    await panel.locator('.mm-sr__row', { hasText: 'Iraq' }).click();
    await expect(panel.locator('.mm-sr__no-figure')).toHaveText(/No soldier extracted for Desert Combat Final yet/);
    await expect(panel.locator('button.mm-sr__kit')).toHaveCount(0);
  });

  test('opens on the real primary when the dressed army is a footnote', async ({ page }) => {
    const footnote = { ...marines, minutes: 12 };
    const t72 = { template: 't72', name: 'T-72', category: 'land', iconPath: null, thumb: null, model: null, minutes: 2000, maps: 3 };
    await mockServiceRecord(page, record([{ ...iraq, minutes: 2988, vehicles: [t72] }, footnote]));
    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`);

    const panel = page.getByTestId('service-record');
    await expect(panel.locator('.mm-sr__army')).toHaveText('Iraq');
    await expect(panel.locator('.mm-sr__no-figure')).toBeVisible();
    await expect(panel.locator('.mm-sr__label', { hasText: 'Arsenal' })).toContainText('what Iraq fielded');
  });

  test('fought-at chips open the map rankings', async ({ page }) => {
    await mockServiceRecord(page, record([marines]));
    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`);

    await page.getByTestId('service-record').locator('.mm-sr__theatre', { hasText: 'Midway' }).click();
    await expect(page).toHaveURL(/\/v4\/players\/Alpha%20Player\/maps\/midway\?game=bf1942/);
  });

  test('says when a busy record covers only the latest rounds', async ({ page }) => {
    await mockServiceRecord(page, { ...record([marines]), window: { sessions: 1000, capped: true, since: '2026-08-02T20:00:00Z' } });
    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`);

    await expect(page.getByTestId('service-record').locator('.mm-pbar__m')).toContainText('last 1,000 rounds');
  });

  test('stays out of the way when nothing is attributed', async ({ page }) => {
    await mockServiceRecord(page, record([]));
    await page.goto(`/v4/players/${encodeURIComponent(PLAYER)}`);

    await expect(page.locator('.mm-player__name')).toBeVisible();
    await expect(page.getByTestId('service-record')).toHaveCount(0);
  });
});

test.describe('Round report armies', () => {
  const ROUND = 'e2e-wake-round';

  const report = {
    round: {
      mapName: 'wake',
      gameType: 'conquest',
      serverName: 'E2E Test Server',
      startTime: '2026-08-31T03:21:00Z',
      endTime: '2026-08-31T03:51:00Z',
      totalParticipants: 0,
      isActive: false,
      tickets1: 512,
      tickets2: 364,
      team1Label: 'Axis',
      team2Label: 'Allied',
      gameId: 'bf1942',
    },
    leaderboardSnapshots: [],
  };

  const armies = {
    mod: 'bf1942',
    map: 'wake',
    displayName: 'Wake',
    teams: [
      { index: 1, side: 'axis', key: japan.key, name: japan.name, nation: 'jp', nationLabel: 'Japan', kits: japan.kits, figure: japan.figure },
      { index: 2, side: 'allied', key: marines.key, name: marines.name, nation: 'us', nationLabel: 'United States', kits: marines.kits, figure: marines.figure },
    ],
  };

  test('names both armies and marks the winner', async ({ page }) => {
    await page.route(`**/stats/rounds/${ROUND}/report`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) }));
    await page.route('**/stats/armoury/maps/bf1942/wake', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(armies) }));
    await page.route('**/stats/assets/mesh/**', route => route.fulfill({ status: 404, body: '' }));

    await page.goto(`/v4/rounds/${ROUND}/report`);

    const tickets = page.locator('.mm-rr__tickets');
    await expect(tickets).toContainText('Imperial Japanese Army');
    await expect(tickets).toContainText('US Marine Corps');

    const band = page.getByTestId('round-armies');
    await expect(band).toBeVisible();
    await expect(band.locator('.mm-fb__side--left')).toContainText('Victory');
    await expect(band.locator('.mm-fb__side--right')).toContainText('Defeat');
    await expect(band.locator('.mm-fb__side--lost')).toHaveCount(1);
  });

  test('keeps bflist labels for a map with no dossier', async ({ page }) => {
    await page.route(`**/stats/rounds/${ROUND}/report`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) }));
    await page.route('**/stats/armoury/maps/**', route => route.fulfill({ status: 404, body: '{}' }));

    await page.goto(`/v4/rounds/${ROUND}/report`);

    await expect(page.locator('.mm-rr__tickets')).toContainText('Axis');
    await expect(page.getByTestId('round-armies')).toHaveCount(0);
  });
});
