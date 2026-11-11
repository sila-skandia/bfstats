/**
 * The BattleView page's hero video (features/battleview-install-page, "Hero video"):
 * the Bocage cut with its end card, in four qualities, and its poster. The page plays
 * them; the build's prerender (ui/build/seoPrerender.js) puts the 720p and the poster
 * in /battleview's Open Graph tags, which is what Discord plays in a chat.
 *
 * The files live on the assets volume under mesh/media/battleview/ and mesh.bfstats.io
 * serves them from /media/ (mesh/nginx.conf). Each name carries the first ten hex of
 * its sha256, so a file never changes and is cached for a year; a new cut is new
 * names here and new uploads, never an overwrite.
 */
import type { HeroRendition } from '@/components/v4/article/MmHeroVideo.vue'

export const HERO_MEDIA = 'https://mesh.bfstats.io/media/battleview'

/** Biggest first, as the quality switch lists them. */
export const HERO_RENDITIONS: HeroRendition[] = [
  { id: '1440p', width: 3454, height: 1446, bytes: 68794920, src: `${HERO_MEDIA}/bocage-1440p.1700b0744e.mp4` },
  { id: '1080p', width: 2580, height: 1080, bytes: 31059231, src: `${HERO_MEDIA}/bocage-1080p.c799bd53b2.mp4` },
  { id: '720p', width: 1720, height: 720, bytes: 13179323, src: `${HERO_MEDIA}/bocage-720p.1247be9d36.mp4` },
  { id: '540p', width: 1290, height: 540, bytes: 6955222, src: `${HERO_MEDIA}/bocage-540p.4441360730.mp4` },
]

export const HERO_POSTER = { src: `${HERO_MEDIA}/bocage-poster.65014be5af.jpg`, width: 1920, height: 804 }

/** What a Discord unfurl plays: about the size of a Short, which embeds. */
export const HERO_EMBED = HERO_RENDITIONS.find(r => r.id === '720p')!

export const HERO_SECONDS = 55

export const HERO_LABEL =
  'BattleView trailer: a P-51 Mustang strafing the village on Bocage by the church and the windmill, ending on the BattleView title card'
