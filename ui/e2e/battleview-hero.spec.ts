import { test, expect } from '@playwright/test'
import { HERO_EMBED, HERO_POSTER, HERO_RENDITIONS } from '../src/seo/battleViewHero'
import { pages, renderPage } from '../build/seoPrerender.js'

// The BattleView page's hero video and the Open Graph tags that make /battleview play
// in Discord (features/battleview-install-page, "Hero video"). The video files live on
// mesh.bfstats.io; here they are refused, so nothing is fetched and only the player's
// choices are checked.

test.describe('BattleView hero video', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://mesh.bfstats.io/media/**', route => route.abort())
    await page.route('**/stats/recordings**', route => route.fulfill({ json: { items: [], total: 0 } }))
    await page.route('**/stats/shorts**', route => route.fulfill({ json: { items: [], total: 0 } }))
  })

  test('Auto picks a rendition; a pick is kept and survives a reload', async ({ page }) => {
    await page.goto('/battleview')
    const player = page.getByTestId('hero-video-player')
    await expect(player).toHaveAttribute('poster', HERO_POSTER.src)
    await expect(page.getByTestId('hero-video-quality-auto')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('hero-video-quality-auto')).toHaveText(/^Auto · \d+p$/)
    const autoSrc = await player.getAttribute('src')
    expect(HERO_RENDITIONS.map(r => r.src)).toContain(autoSrc)
    // Never the 1440p unasked.
    expect(autoSrc).not.toContain('1440p')

    await page.getByTestId('hero-video-quality-720p').click()
    await expect(page.getByTestId('hero-video-quality-720p')).toHaveAttribute('aria-checked', 'true')
    await expect(player).toHaveAttribute('src', HERO_RENDITIONS.find(r => r.id === '720p')!.src)

    await page.reload()
    await expect(page.getByTestId('hero-video-quality-720p')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('hero-video-player')).toHaveAttribute('src', /720p/)

    await page.getByTestId('hero-video-quality-auto').click()
    await page.reload()
    await expect(page.getByTestId('hero-video-quality-auto')).toHaveAttribute('aria-checked', 'true')
  })

  test('Play with sound hands over to the controls', async ({ page }) => {
    await page.goto('/battleview')
    const player = page.getByTestId('hero-video-player')
    await expect(player).not.toHaveAttribute('controls', /.*/)
    await page.getByTestId('hero-video-play').click()
    await expect(page.getByTestId('hero-video-play')).toHaveCount(0)
    await expect(player).toHaveAttribute('controls', /.*/)
    expect(await player.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false)
  })

  test('is captioned as the trailer, with its credit', async ({ page }) => {
    await page.goto('/battleview')
    await expect(page.getByTestId('hero-video')).toContainText('BattleView trailer')
    await expect(page.getByTestId('hero-video')).toContainText('Thanks Black Mamba for the trailer')
  })
})

test.describe('BattleView link preview', () => {
  test('/battleview is prerendered with the 720p as og:video', () => {
    const base = `<!doctype html><html><head><title>x</title>
<meta name="description" content="x">
<meta property="og:type" content="website">
<meta property="og:title" content="x">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="https://bfstats.io/">
</head><body><div id="app"><div class="mm-preload"></div></div></body></html>`
    const bv = pages().find(p => p.path === '/battleview')
    expect(bv).toBeTruthy()
    const html = renderPage(base, bv!)
    const meta = (attr: string, key: string) =>
      html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1]

    expect(meta('property', 'og:type')).toBe('video.other')
    expect(meta('property', 'og:video')).toBe(HERO_EMBED.src)
    expect(meta('property', 'og:video:secure_url')).toBe(HERO_EMBED.src)
    expect(meta('property', 'og:video:type')).toBe('video/mp4')
    expect(meta('property', 'og:video:width')).toBe(String(HERO_EMBED.width))
    expect(meta('property', 'og:video:height')).toBe(String(HERO_EMBED.height))
    expect(meta('property', 'og:image')).toBe(HERO_POSTER.src)
    expect(meta('name', 'twitter:card')).toBe('summary_large_image')
    expect(html).toContain('<link rel="canonical" href="https://bfstats.io/battleview">')
    // Every video URL is https: Discord plays nothing else.
    expect(HERO_EMBED.src.startsWith('https://')).toBe(true)
    // Each meta tag once: the replaced ones are not duplicated.
    expect(html.match(/property="og:type"/g)).toHaveLength(1)
    expect(html.match(/name="twitter:card"/g)).toHaveLength(1)
  })
})
