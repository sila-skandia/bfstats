import { test, expect } from '@playwright/test'

const MOCK_LEADERBOARD_DATA = {
  days: 30,
  minRounds: 1,
  minPlay: 0,
  sortBy: 'score',
  sortDir: 'desc',
  page: 1,
  pageSize: 50,
  totalPages: 1,
  totalPlayers: 4,
  players: [
    {
      rank: 1,
      name: 'Rommel_44',
      tag: '=DOG=',
      kills: 450,
      deaths: 150,
      kd: 3.0,
      score: 5200,
      kpm: 1.8,
      playMin: 250,
      rounds: 18,
      lastSeen: '2026-08-14T10:00:00Z',
      favServer: '=DOG= Dogtags 24/7',
      favServerGuid: 'srv-1',
      favServerCountry: 'DE',
      favServerFlag: '\uD83C\uDDE9\uD83C\uDDEA',
      favMap: 'Bocage',
      isActive: true,
      currentServer: '=DOG= Dogtags 24/7'
    },
    {
      rank: 2,
      name: 'Patton_USA',
      tag: '[USA]',
      kills: 300,
      deaths: 120,
      kd: 2.5,
      score: 4100,
      kpm: 1.5,
      playMin: 200,
      rounds: 14,
      lastSeen: '2026-08-13T12:00:00Z',
      favServer: 'Merciless Gamers 1942',
      favServerGuid: 'srv-2',
      favServerCountry: 'US',
      favServerFlag: '\uD83C\uDDFA\uD83C\uDDF8',
      favMap: 'Omaha Beach',
      isActive: false
    },
    {
      rank: 3,
      name: 'Zhukov',
      tag: '\u00b7',
      kills: 220,
      deaths: 180,
      kd: 1.22,
      score: 3100,
      kpm: 1.1,
      playMin: 120,
      rounds: 8,
      lastSeen: '2026-08-10T08:00:00Z',
      favServer: '=DOG= Dogtags 24/7',
      favServerGuid: 'srv-1',
      favServerCountry: 'DE',
      favServerFlag: '\uD83C\uDDE9\uD83C\uDDEA',
      favMap: 'Bocage',
      isActive: false
    },
    {
      rank: 4,
      name: 'NovicePlayer',
      tag: '',
      kills: 30,
      deaths: 90,
      kd: 0.33,
      score: 600,
      kpm: 0.5,
      playMin: 40,
      rounds: 2,
      lastSeen: '2026-08-01T04:00:00Z',
      favServer: 'Merciless Gamers 1942',
      favServerGuid: 'srv-2',
      favServerCountry: 'US',
      favServerFlag: '\uD83C\uDDFA\uD83C\uDDF8',
      favMap: 'Wake',
      isActive: false
    },
    {
      rank: 5,
      name: 'BotFarmer',
      tag: '',
      kills: 900,
      deaths: 20,
      kd: 45.0,
      score: 14000,
      kpm: 4.0,
      playMin: 30,
      rounds: 40,
      lastSeen: '2026-08-12T04:00:00Z',
      favServer: 'Empty Coop Bots',
      favServerGuid: 'srv-3',
      favServerCountry: 'RU',
      favServerFlag: '\uD83C\uDDF7\uD83C\uDDFA',
      favMap: 'Kharkov',
      isActive: false
    }
  ],
  servers: [
    {
      guid: 'srv-1',
      name: '=DOG= Dogtags 24/7',
      shortName: 'Dogtags 24/7',
      country: 'DE',
      flag: '\uD83C\uDDE9\uD83C\uDDEA',
      playerCount: 2,
      avgPlayers: 14.2,
      isPopulated: true
    },
    {
      guid: 'srv-2',
      name: 'Merciless Gamers 1942',
      shortName: 'Merciless Gamers',
      country: 'US',
      flag: '\uD83C\uDDFA\uD83C\uDDF8',
      playerCount: 2,
      avgPlayers: 9.6,
      isPopulated: true
    },
    {
      guid: 'srv-3',
      name: 'Empty Coop Bots',
      shortName: 'Coop Bots',
      country: 'RU',
      flag: '\uD83C\uDDF7\uD83C\uDDFA',
      playerCount: 1,
      avgPlayers: 1.1,
      isPopulated: false
    }
  ],
  maps: [
    { name: 'bocage', displayName: 'Bocage', playerCount: 2 },
    { name: 'omaha beach', displayName: 'Omaha Beach', playerCount: 1 },
    { name: 'wake', displayName: 'Wake', playerCount: 1 }
  ],
  generatedAt: '2026-08-14T19:50:00Z'
}

test.describe('Leaderboard Page', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept leaderboard API — server-side filters applied from query params
    await page.route('**/stats/leaderboard*', async route => {
      const url = new URL(route.request().url())
      const mapParam = url.searchParams.get('map')
      const serverParam = url.searchParams.get('server')
      const excludeParam = url.searchParams.get('exclude')
      const populatedParam = url.searchParams.get('populatedOnly')
      const populatedOnly = populatedParam === 'true' || populatedParam === '1'
      const qParam = url.searchParams.get('q')
      const minPlayParam = parseInt(url.searchParams.get('minPlay') ?? '0', 10)
      const pageParam = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
      const pageSizeParam = Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50', 10))

      let filtered = [...MOCK_LEADERBOARD_DATA.players]

      if (mapParam) {
        filtered = filtered.filter(p => p.favMap.toLowerCase() === mapParam.toLowerCase())
      }
      if (serverParam) {
        filtered = filtered.filter(p =>
          p.favServer.toLowerCase() === serverParam.toLowerCase() ||
          p.favServerGuid === serverParam
        )
      } else {
        if (populatedOnly) {
          const live = new Set(
            MOCK_LEADERBOARD_DATA.servers.filter(s => s.isPopulated).map(s => s.guid)
          )
          filtered = filtered.filter(p => live.has(p.favServerGuid))
        }
        if (excludeParam) {
          const excluded = excludeParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
          filtered = filtered.filter(p =>
            !excluded.includes(p.favServer.toLowerCase()) &&
            !excluded.includes(p.favServerGuid.toLowerCase())
          )
        }
      }
      if (qParam) {
        const q = qParam.toLowerCase()
        filtered = filtered.filter(p =>
          p.name.toLowerCase().includes(q) ||
          p.tag.toLowerCase().includes(q) ||
          p.favServer.toLowerCase().includes(q) ||
          p.favMap.toLowerCase().includes(q)
        )
      }
      if (minPlayParam > 0) {
        filtered = filtered.filter(p => p.playMin >= minPlayParam)
      }

      const totalPlayers = filtered.length
      const totalPages = Math.max(1, Math.ceil(totalPlayers / pageSizeParam))
      const start = (pageParam - 1) * pageSizeParam
      const paged = filtered.slice(start, start + pageSizeParam)

      const response = {
        ...MOCK_LEADERBOARD_DATA,
        map: mapParam ?? undefined,
        server: serverParam ?? undefined,
        exclude: excludeParam ?? undefined,
        populatedOnly,
        searchQuery: qParam ?? undefined,
        page: pageParam,
        pageSize: pageSizeParam,
        totalPlayers,
        totalPages,
        players: paged.map((p, i) => ({ ...p, rank: start + i + 1 }))
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response)
      })
    })
  })

  test('should redirect /leaderboard to /v4/leaderboard', async ({ page }) => {
    await page.goto('/leaderboard')
    await expect(page).toHaveURL(/\/v4\/leaderboard/)

    const heading = page.locator('h1')
    await expect(heading).toHaveText('Leaderboard')
  })

  test('should navigate via top navigation bar', async ({ page }) => {
    await page.goto('/v4/servers/bf1942')

    const leaderboardNav = page.locator('header nav a, .mm-header__nav a', { hasText: /Leaderboard/i })
    await expect(leaderboardNav.first()).toBeVisible()
    await leaderboardNav.first().click()

    await expect(page).toHaveURL(/\/v4\/leaderboard/)
    await expect(page.locator('h1')).toHaveText('Leaderboard')
  })

  test('should render table headers, player records, and map info correctly', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    await expect(page.locator('h1')).toHaveText('Leaderboard')

    // Verify table rendered with rows
    const rows = page.locator('.lb-table tbody tr.lb-row')
    await expect(rows).toHaveCount(4)

    // Check rank #1 player details
    const firstRow = rows.first()
    await expect(firstRow).toContainText('Rommel_44')
    await expect(firstRow).toContainText('3.00')
    await expect(firstRow.locator('.lb-rank')).toHaveText('01')
    await expect(firstRow).toContainText('Bocage')
  })

  test('should filter players using client search including map name', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    const searchInput = page.locator('.lb-search-input')
    await searchInput.fill('Omaha')

    const rows = page.locator('.lb-table tbody tr.lb-row')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Patton_USA')

    // Clear search
    await page.locator('.lb-search-clear').click()
    await expect(page.locator('.lb-table tbody tr.lb-row')).toHaveCount(4)
  })

  test('should filter players by searchable server selector dropdown', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    const serverBtn = page.locator('[data-lbmenu="server"] .lb-server-dropdown-btn')
    await expect(serverBtn).toBeVisible()
    await expect(serverBtn).toContainText('Populated')

    // Open server dropdown popover and check autofocus
    await serverBtn.click()
    const popover = page.locator('.lb-server-popover').first()
    await expect(popover).toBeVisible()

    const searchInput = page.locator('.lb-server-search-input')
    await expect(searchInput).toBeFocused()

    // Search for "Merciless"
    await searchInput.fill('Merciless')

    // Check filtered option display (flag / name / count)
    const serverItem = page.locator('.lb-server-item', { hasText: /Merciless/i })
    await expect(serverItem).toBeVisible()
    await expect(serverItem).toContainText('🇺🇸')
    await expect(serverItem).toContainText('Merciless Gamers')
    await expect(serverItem).toContainText('2')

    // Select the server
    await serverItem.click()
    await expect(popover).not.toBeVisible()

    // Table rows should now only show Merciless Gamers players (2 players)
    const rows = page.locator('.lb-table tbody tr.lb-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Patton_USA')

    // Section bar should reflect active server tag
    await expect(page.locator('.lb-section-bar')).toContainText('SRV: MERCILESS GAMERS')

    // Clear server filter via clear button
    await page.locator('.lb-server-clear-btn').first().click()
    await expect(page.locator('.lb-table tbody tr.lb-row')).toHaveCount(4)
  })

  test('should filter players by searchable map dropdown slicer and auto-focus search field', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    const mapBtn = page.locator('.lb-map-dropdown-btn')
    await expect(mapBtn).toBeVisible()
    await expect(mapBtn).toContainText('All Maps')

    // Open map dropdown popover and check autofocus
    await mapBtn.click()
    const popover = page.locator('.lb-server-popover')
    await expect(popover).toBeVisible()

    const mapSearch = page.locator('.lb-map-search-input')
    await expect(mapSearch).toBeFocused()

    // Search for "Bocage"
    await mapSearch.fill('Bocage')

    const mapItem = page.locator('.lb-server-item', { hasText: /Bocage/i })
    await expect(mapItem).toBeVisible()
    await mapItem.click()
    await expect(popover).not.toBeVisible()

    // Rows should now show only players on Bocage (Rommel & Zhukov = 2)
    const rows = page.locator('.lb-table tbody tr.lb-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Rommel_44')

    // Olive section bar should reflect active map tag
    await expect(page.locator('.lb-map-active-tag')).toContainText('MAP: BOCAGE')

    // Clear map filter via clear button
    await page.locator('.lb-server-clear-btn').click()
    await expect(page.locator('.lb-table tbody tr.lb-row')).toHaveCount(4)
  })

  test('should trigger CSV export and JSON export actions without errors', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    // CSV export trigger
    const csvBtn = page.locator('.lb-btn', { hasText: /^CSV$/ })
    await expect(csvBtn).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await csvBtn.click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toContain('.csv')

    // JSON export trigger
    const jsonBtn = page.locator('.lb-btn', { hasText: /JSON|COPIED/ })
    await expect(jsonBtn).toBeVisible()
    await jsonBtn.click()
    await expect(page.locator('.lb-btn', { hasText: 'COPIED' })).toBeVisible()
  })

  test('should filter by min playtime slicer', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    // Select 1h+ min play (60 mins)
    const minPlaySelect = page.locator('.lb-control-group', { hasText: /Min Play/i }).locator('select')
    await minPlaySelect.selectOption('60')

    // Only players with >= 60 min play time (Rommel: 250, Patton: 200, Zhukov: 120) = 3 players
    const rows = page.locator('.lb-table tbody tr.lb-row')
    await expect(rows).toHaveCount(3)
    await expect(page.locator('.lb-table')).not.toContainText('NovicePlayer')
  })

  test('should group players by Fav. Map with collapsible group headers', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    const groupSelect = page.locator('.lb-control-group', { hasText: /Group By/i }).locator('select')
    await groupSelect.selectOption('favMap')

    // Group rows should be present for Bocage, Omaha Beach, Wake
    const groupRows = page.locator('.lb-group-row')
    await expect(groupRows).toHaveCount(3)

    // Toggle collapse on first group
    await groupRows.first().click()
    await expect(groupRows.first()).toBeVisible()
  })

  test('should toggle column visibility via columns popover', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    // Open columns popover
    const colBtn = page.locator('.lb-btn', { hasText: /COLUMNS/i })
    await colBtn.scrollIntoViewIfNeeded()
    await colBtn.click()

    const popover = page.locator('.lb-col-popover')
    await expect(popover).toBeVisible()

    // Hide Score column
    const scoreCheck = popover.locator('label', { hasText: 'Score' }).locator('input')
    await scoreCheck.dispatchEvent('click')

    // Table header should no longer have Score
    await expect(page.locator('.lb-table th', { hasText: 'Score' })).toHaveCount(0)

    // Re-enable Score
    await scoreCheck.dispatchEvent('click')
    await expect(page.locator('.lb-table th', { hasText: 'Score' })).toBeVisible()
  })

  test('should toggle density between comfortable and compact', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    const table = page.locator('.lb-table')
    await expect(table).not.toHaveClass(/lb-table--compact/)

    const densityBtn = page.locator('.lb-btn', { hasText: /COMFORTABLE|COMPACT/i })
    await densityBtn.click()

    await expect(table).toHaveClass(/lb-table--compact/)
  })

  test('should toggle fullscreen mode on button click', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    const fullscreenBtn = page.locator('.lb-btn-fullscreen')
    await expect(fullscreenBtn).toBeVisible()
    await expect(fullscreenBtn).toContainText('FULLSCREEN')

    await fullscreenBtn.click()
    await expect(fullscreenBtn).toContainText('EXIT')

    await fullscreenBtn.click()
    await expect(fullscreenBtn).toContainText('FULLSCREEN')
  })

  test('should reset all filters when Reset button is clicked', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    // Apply search filter
    await page.locator('.lb-search-input').fill('Zhukov')
    await expect(page.locator('.lb-table tbody tr.lb-row')).toHaveCount(1)

    // Click Reset
    await page.locator('.lb-btn', { hasText: /RESET/i }).click()

    await expect(page.locator('.lb-search-input')).toHaveValue('')
    await expect(page.locator('.lb-table tbody tr.lb-row')).toHaveCount(4)
  })

  test('should exclude multiple servers from the leaderboard', async ({ page }) => {
    await page.goto('/v4/leaderboard')
    await expect(page.locator('.lb-table tbody tr.lb-row')).toHaveCount(4)

    const serverBtn = page.locator('[data-lbmenu="server"] .lb-server-dropdown-btn')
    await serverBtn.click()

    const popover = page.locator('.lb-server-popover').first()
    await expect(popover).toBeVisible()

    await popover.locator('.lb-mode-btn--exclude').click()
    await popover.locator('.lb-server-item', { hasText: /Merciless/i }).click()

    const rows = page.locator('.lb-table tbody tr.lb-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Rommel_44')

    await popover.locator('.lb-server-item', { hasText: /Dogtags/i }).click()
    await expect(rows).toHaveCount(0)

    await page.locator('.lb-server-clear-btn').first().click()
    await expect(page.locator('.lb-table tbody tr.lb-row')).toHaveCount(4)
  })

  test('should include empty servers when populated-only is turned off', async ({ page }) => {
    await page.goto('/v4/leaderboard')
    await expect(page.locator('.lb-table tbody tr.lb-row')).toHaveCount(4)
    await expect(page.locator('.lb-table')).not.toContainText('BotFarmer')

    const serverBtn = page.locator('[data-lbmenu="server"] .lb-server-dropdown-btn')
    await serverBtn.click()

    const popover = page.locator('.lb-server-popover').first()
    await expect(popover.locator('.lb-populated-toggle')).toContainText('Populated servers only')
    await popover.locator('.lb-populated-toggle').click()

    await expect(page.locator('.lb-table tbody tr.lb-row')).toHaveCount(5)
    await expect(page.locator('.lb-table')).toContainText('BotFarmer')
    await expect(page).toHaveURL(/populatedOnly=0/)
  })
})

test.describe('Leaderboard Page — Mobile', () => {
  test.use({ viewport: { width: 393, height: 851 } })

  test.beforeEach(async ({ page }) => {
    await page.route('**/stats/leaderboard*', async route => {
      const url = new URL(route.request().url())
      const serverParam = url.searchParams.get('server')
      const mapParam = url.searchParams.get('map')
      let filtered = MOCK_LEADERBOARD_DATA.players.filter(p =>
        p.favServerGuid === 'srv-1' || p.favServerGuid === 'srv-2'
      )
      if (serverParam) {
        filtered = filtered.filter(p =>
          p.favServer.toLowerCase() === serverParam.toLowerCase() ||
          p.favServerGuid === serverParam
        )
      }
      if (mapParam) {
        filtered = filtered.filter(p => p.favMap.toLowerCase() === mapParam.toLowerCase())
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...MOCK_LEADERBOARD_DATA,
          totalPlayers: filtered.length,
          totalPages: 1,
          players: filtered.map((p, i) => ({ ...p, rank: i + 1 }))
        })
      })
    })
  })

  test('shows stacked filter chips that open full-screen sheets, not the desktop table', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    const periodBtn = page.locator('[data-lbmenu="period"] .lb-server-dropdown-btn')
    const serverBtn = page.locator('[data-lbmenu="server"] .lb-server-dropdown-btn')
    const mapBtn = page.locator('[data-lbmenu="map"] .lb-server-dropdown-btn')

    await expect(periodBtn).toBeVisible()
    await expect(serverBtn).toBeVisible()
    await expect(mapBtn).toBeVisible()
    await expect(page.locator('.lb-select.lb-desktop-only')).toBeHidden()
    await expect(page.locator('.lb-search-input')).toBeHidden()
    await expect(page.locator('.lb-btn', { hasText: /COLUMNS/i })).toBeHidden()
    await expect(page.locator('.lb-btn', { hasText: /^CSV$/ })).toBeHidden()

    const cards = page.locator('.lb-mobile-list .mm-session-row')
    await expect(cards).toHaveCount(4)
    await expect(cards.first()).toContainText('Rommel_44')
    await expect(cards.first()).toContainText('3.00')

    await expect(page.locator('.lb-scroll-pane')).toBeHidden()
    await expect(page.locator('.lb-td--pinned').first()).toBeHidden()

    await serverBtn.click()
    const sheet = page.locator('.lb-server-popover--sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name: 'Server' })).toBeVisible()
    await expect(sheet.locator('.lb-sheet-done')).toBeVisible()

    const box = await sheet.boundingBox()
    expect(box).toBeTruthy()
    expect(box!.width).toBeGreaterThanOrEqual(390)
    expect(box!.height).toBeGreaterThanOrEqual(800)

    await page.locator('.lb-server-item', { hasText: /Merciless/i }).click()
    await expect(sheet).toBeHidden()
    await expect(cards).toHaveCount(2)
    await expect(cards.first()).toContainText('Patton_USA')

    await periodBtn.click()
    await expect(sheet.getByRole('heading', { name: 'Period' })).toBeVisible()
    await sheet.locator('.lb-sheet-done').click()
    await expect(sheet).toBeHidden()

    await mapBtn.click()
    await expect(sheet.getByRole('heading', { name: 'Map' })).toBeVisible()
    await sheet.locator('.lb-sheet-done').click()
    await expect(sheet).toBeHidden()
  })

  test('lets you clear a map after a server filter yields no results', async ({ page }) => {
    await page.goto('/v4/leaderboard')

    const serverBtn = page.locator('[data-lbmenu="server"] .lb-server-dropdown-btn')
    const mapBtn = page.locator('[data-lbmenu="map"] .lb-server-dropdown-btn')
    const sheet = page.locator('.lb-server-popover--sheet')

    await mapBtn.click()
    await page.locator('.lb-server-item', { hasText: /^Bocage/ }).click()
    await expect(sheet).toBeHidden()
    await expect(page.locator('.lb-mobile-list .mm-session-row')).toHaveCount(2)

    await serverBtn.click()
    await page.locator('.lb-server-item', { hasText: /Merciless/i }).click()

    await expect(page.locator('.lb-state-box')).toContainText('NO PLAYERS MATCH')
    await expect(page.locator('[data-lbmenu="map"] .lb-server-clear-btn')).toBeVisible()
    await expect(page.locator('.lb-active-filters .lb-empty-chip', { hasText: /Bocage/i })).toBeVisible()

    await page.locator('[data-lbmenu="map"] .lb-server-clear-btn').click()
    await expect(page.locator('.lb-mobile-list .mm-session-row')).toHaveCount(2)
    await expect(page.locator('.lb-mobile-list .mm-session-row').first()).toContainText('Patton_USA')
  })
})
