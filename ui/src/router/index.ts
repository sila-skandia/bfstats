import { createRouter, createWebHistory, type RouteRecordRaw, type RouteLocationNormalized } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { telemetryService } from '../services/telemetryService'
import { isNavigating } from '../composables/useNavProgress'

// Legacy routes have been migrated to V4 — only views that are kept (Discord
// callback, tournaments, admin) are still imported here. All public stats
// pages live under /v4/* now.
const DiscordCallback = () => import('../views/DiscordCallback.vue')
const TournamentDetails = () => import('../views/TournamentDetails.vue')
const PublicTournament = () => import('../views/PublicTournament.vue')
const PublicTournamentRankings = () => import('../views/PublicTournamentRankings.vue')
const PublicTournamentRules = () => import('../views/PublicTournamentRules.vue')
const PublicTournamentTeams = () => import('../views/PublicTournamentTeams.vue')
const PublicTournamentMatches = () => import('../views/PublicTournamentMatches.vue')
const PublicTournamentStats = () => import('../views/PublicTournamentStats.vue')
const PublicTournamentFiles = () => import('../views/PublicTournamentFiles.vue')
const AdminDataManagementV4 = () => import('../views/v4/AdminDataManagementV4.vue')
const AliasDetectionView = () => import('../views/AliasDetectionView.vue')

// v4 — modern-minimal theme (parallel preview, accessible at /v4/*)
const ModernShell = () => import('../layouts/ModernShell.vue')
const LandingPageV4 = () => import('../views/v4/LandingPageV4.vue')
const PlayerDetailsV4 = () => import('../views/v4/PlayerDetailsV4.vue')
const ServerDetailsV4 = () => import('../views/v4/ServerDetailsV4.vue')
const PlayersV4 = () => import('../views/v4/PlayersV4.vue')
const ServersV4 = () => import('../views/v4/ServersV4.vue')
const PlayerAllAchievementsV4 = () => import('../views/v4/PlayerAllAchievementsV4.vue')
const PlayerSessionsV4 = () => import('../views/v4/PlayerSessionsV4.vue')
const PlayerNetworkV4 = () => import('../views/v4/PlayerNetworkV4.vue')
const RoundReportV4 = () => import('../views/v4/RoundReportV4.vue')
const RoundsIndexV4 = () => import('../views/v4/RoundsIndexV4.vue')
const SystemStatsV4 = () => import('../views/v4/SystemStatsV4.vue')
const MapPopularityV4 = () => import('../views/v4/MapPopularityV4.vue')
const ServerSessionsV4 = () => import('../views/v4/ServerSessionsV4.vue')
const CommunityDetailV4 = () => import('../views/v4/CommunityDetailV4.vue')
const PlayerMapDetailV4 = () => import('../views/v4/PlayerMapDetailV4.vue')
const PlayerComparisonV4 = () => import('../views/v4/PlayerComparisonV4.vue')
const DashboardV4 = () => import('../views/v4/DashboardV4.vue')
const ServerWrappedV4 = () => import('../views/v4/ServerWrappedV4.vue')
const PlayerWrappedV4 = () => import('../views/v4/PlayerWrappedV4.vue')

const routes: RouteRecordRaw[] = [
    // -------- Root + V3 → V4 redirects --------
    // Every public stats URL the legacy site used now redirects to its
    // V4 equivalent so existing bookmarks / links still land somewhere
    // sensible. Tournaments and admin keep their legacy URLs.
    {
      path: '/',
      name: 'home',
      redirect: () => {
        const storedToken = localStorage.getItem('auth_token')
        if (storedToken) {
          const { isAuthenticated } = useAuth()
          if (isAuthenticated.value) return '/v4/dashboard'
        }
        return '/v4/servers/bf1942'
      },
    },
    { path: '/landing', redirect: '/v4/servers/bf1942' },
    { path: '/dashboard', redirect: '/v4/dashboard' },
    { path: '/servers', redirect: '/v4/servers/bf1942' },
    { path: '/servers/bf1942', redirect: '/v4/servers/bf1942' },
    { path: '/servers/fh2', redirect: '/v4/servers/bf1942' },
    { path: '/servers/bfv', redirect: '/v4/servers/bf1942' },
    { path: '/servers/bf1942/v3', redirect: '/v4/servers/bf1942' },
    { path: '/servers/fh2/v3', redirect: '/v4/servers/bf1942' },
    { path: '/servers/bfv/v3', redirect: '/v4/servers/bf1942' },
    {
      path: '/servers/:serverName',
      redirect: to => `/v4/servers/detail/${encodeURIComponent(String(to.params.serverName))}`,
    },
    {
      path: '/servers/:serverName/sessions',
      redirect: to => `/v4/servers/${encodeURIComponent(String(to.params.serverName))}/sessions`,
    },
    { path: '/players', redirect: '/v4/players' },
    { path: '/players/compare', redirect: to => ({ path: '/v4/players/compare', query: to.query }) },
    {
      path: '/wrapped/player/:playerName',
      redirect: to => `/v4/wrapped/player/${encodeURIComponent(String(to.params.playerName))}`,
    },
    {
      path: '/wrapped/player/:playerName/:serverGuid',
      redirect: to => `/v4/wrapped/player/${encodeURIComponent(String(to.params.playerName))}/${encodeURIComponent(String(to.params.serverGuid))}`,
    },
    {
      path: '/players/:playerName',
      redirect: to => `/v4/players/${encodeURIComponent(String(to.params.playerName))}`,
    },
    {
      path: '/players/:playerName/sessions',
      redirect: to => `/v4/players/${encodeURIComponent(String(to.params.playerName))}/sessions`,
    },
    {
      path: '/players/:playerName/achievements',
      redirect: to => `/v4/players/${encodeURIComponent(String(to.params.playerName))}/achievements`,
    },
    {
      path: '/players/:playerName/network',
      redirect: to => `/v4/players/${encodeURIComponent(String(to.params.playerName))}/network`,
    },
    { path: '/explore', redirect: '/v4/servers/bf1942' },
    { path: '/explore/servers', redirect: '/v4/servers/bf1942' },
    { path: '/explore/servers/:serverGuid', redirect: '/v4/servers/bf1942' },
    { path: '/explore/servers/:serverGuid/maps/:mapName', redirect: '/v4/servers/bf1942' },
    { path: '/explore/maps', redirect: '/v4/servers/bf1942' },
    { path: '/explore/maps/:mapName', redirect: '/v4/servers/bf1942' },
    { path: '/explore/players', redirect: '/v4/players' },
    {
      path: '/explore/players/:playerName',
      redirect: to => `/v4/players/${encodeURIComponent(String(to.params.playerName))}`,
    },
    {
      path: '/rounds/:roundId/report',
      redirect: to => ({
        path: `/v4/rounds/${encodeURIComponent(String(to.params.roundId))}/report`,
        query: to.query,
      }),
    },
    { path: '/system-stats', redirect: '/v4/system-stats' },
    {
      path: '/communities/:id',
      redirect: to => `/v4/communities/${encodeURIComponent(String(to.params.id))}`,
    },
    {
      path: '/map-popularity/:serverGuid',
      redirect: to => `/v4/map-popularity/${encodeURIComponent(String(to.params.serverGuid))}`,
    },
    {
      path: '/t/:id',
      name: 'public-tournament',
      component: PublicTournament,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `Tournament ${route.params.id} - BF Stats`,
        description: 'View tournament schedule, matches, and results for Battlefield competitions.'
      }
    },
    {
      path: '/t/:id/rankings',
      name: 'public-tournament-rankings',
      component: PublicTournamentRankings,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `Rankings - Tournament ${route.params.id} - BF Stats`,
        description: 'Tournament team rankings and leaderboard.'
      }
    },
    {
      path: '/t/:id/rules',
      name: 'public-tournament-rules',
      component: PublicTournamentRules,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `Tournament Rules - ${route.params.id} - BF Stats`,
        description: 'Tournament rules and guidelines.'
      }
    },
    {
      path: '/t/:id/teams',
      name: 'public-tournament-teams',
      component: PublicTournamentTeams,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `Teams - Tournament ${route.params.id} - BF Stats`,
        description: 'Registered teams and rosters.'
      }
    },
    {
      path: '/t/:id/matches',
      name: 'public-tournament-matches',
      component: PublicTournamentMatches,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `Matches - Tournament ${route.params.id} - BF Stats`,
        description: 'Tournament matches and results.'
      }
    },
    {
      path: '/t/:id/stats',
      name: 'public-tournament-stats',
      component: PublicTournamentStats,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `Player Stats - Tournament ${route.params.id} - BF Stats`,
        description: 'Player statistics for the tournament.'
      }
    },
    {
      path: '/t/:id/files',
      name: 'public-tournament-files',
      component: PublicTournamentFiles,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `Files - Tournament ${route.params.id} - BF Stats`,
        description: 'Tournament files, maps, and resources.'
      }
    },
    // Legacy route redirects for backwards compatibility
    {
      path: '/tournaments/:id',
      redirect: to => `/t/${to.params.id}`
    },
    {
      path: '/tournaments/:id/:subpage',
      redirect: to => `/t/${to.params.id}/${to.params.subpage}`
    },
    {
      path: '/admin/tournaments/:id',
      name: 'admin-tournament-details',
      redirect: to => `/admin/tournaments/${to.params.id}/matches`,
      beforeEnter: (_to, _from, next) => {
        const { isAuthenticated } = useAuth()
        if (!isAuthenticated.value) {
          next('/servers/bf1942')
        } else {
          next()
        }
      }
    },
    {
      path: '/admin/tournaments/:id/:tab',
      name: 'admin-tournament-details-tab',
      component: TournamentDetails,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `Tournament ${route.params.id} - BF Stats Tournament Manager`,
        description: 'Manage your Battlefield tournament rounds, track results, and view the overall winner.'
      },
      beforeEnter: (to, _from, next) => {
        const { isAuthenticated } = useAuth()
        if (!isAuthenticated.value) {
          next('/servers/bf1942')
        } else {
          // Validate tab parameter
          const validTabs = ['matches', 'teams', 'weeks', 'files', 'posts', 'settings']
          const tab = to.params.tab as string
          if (!validTabs.includes(tab)) {
            next(`/admin/tournaments/${to.params.id}/matches`)
          } else {
            next()
          }
        }
      }
    },
    { path: '/admin/data', redirect: '/v4/admin/data' },
    {
      path: '/auth/discord/callback',
      name: 'discord-callback',
      component: DiscordCallback,
      meta: {
        title: 'Discord Authentication · bfstats.io',
        description: 'Completing Discord authentication.'
      }
    },
    {
      path: '/alias-detection',
      name: 'alias-detection',
      component: AliasDetectionView,
      meta: {
        title: 'Alias detection · bfstats.io',
        description: 'Investigate potential player aliases and alternate accounts.'
      }
    },
    {
      path: '/v4',
      component: ModernShell,
      meta: {
        title: 'bfstats.io · Battlefield 1942 stats',
        description: 'Live Battlefield 1942 server and player statistics.'
      },
      children: [
        { path: '', redirect: '/v4/servers/bf1942' },
        { path: 'servers', redirect: '/v4/servers/bf1942' },
        // Old FH2/BFV deeplinks redirect to BF1942 — those games are no longer tracked here.
        { path: 'servers/fh2', redirect: '/v4/servers/bf1942' },
        { path: 'servers/bfv', redirect: '/v4/servers/bf1942' },
        { path: 'servers/bfvietnam', redirect: '/v4/servers/bf1942' },
        {
          path: 'servers/:game(bf1942)',
          name: 'v4-servers',
          component: LandingPageV4,
          props: true,
          meta: {
            title: 'bfstats.io | Battlefield 1942 player and server stats',
            description: 'Live Battlefield 1942 server list and player counts.'
          }
        },
        {
          path: 'players/:playerName',
          name: 'v4-player-details',
          component: PlayerDetailsV4,
          props: true,
          meta: {
            title: (route: RouteLocationNormalized) => `${route.params.playerName} · bfstats.io`,
            description: 'Player profile, stats, achievements, and recent sessions.'
          }
        },
        {
          path: 'players/:playerName/achievements',
          name: 'v4-player-achievements',
          component: PlayerAllAchievementsV4,
          props: true,
          meta: {
            title: (route: RouteLocationNormalized) => `${route.params.playerName} · Achievements · bfstats.io`,
            description: 'All achievements earned by this player.'
          }
        },
        {
          path: 'players/:playerName/sessions',
          name: 'v4-player-sessions',
          component: PlayerSessionsV4,
          props: true,
          meta: {
            title: (route: RouteLocationNormalized) => `${route.params.playerName} · Sessions · bfstats.io`,
            description: 'Session history for this player.'
          }
        },
        {
          path: 'players/:playerName/network',
          name: 'v4-player-network',
          component: PlayerNetworkV4,
          props: true,
          meta: {
            title: (route: RouteLocationNormalized) => `${route.params.playerName} · Network · bfstats.io`,
            description: 'Player co-play network and proximity.'
          }
        },
        {
          path: 'players/:playerName/maps/:mapName',
          name: 'v4-player-map-detail',
          component: PlayerMapDetailV4,
          props: true,
          meta: {
            title: (route: RouteLocationNormalized) => `${route.params.mapName} · ${route.params.playerName} · bfstats.io`,
            description: 'Rankings on a single map for this player.'
          }
        },
        {
          path: 'servers/search',
          name: 'v4-servers-search',
          component: ServersV4,
          meta: {
            title: 'Search servers · bfstats.io',
            description: 'Search every tracked Battlefield 1942 server by name.'
          }
        },
        {
          path: 'servers/detail/:serverName',
          name: 'v4-server-details',
          component: ServerDetailsV4,
          props: true,
          meta: {
            title: (route: RouteLocationNormalized) => `${route.params.serverName} · bfstats.io`,
            description: 'Server profile, live roster, and population history.'
          }
        },
        {
          path: 'servers/detail/:serverName/wrapped',
          name: 'v4-server-wrapped',
          component: ServerWrappedV4,
          props: true,
          meta: {
            title: (route: RouteLocationNormalized) => `${route.params.serverName} Wrapped · bfstats.io`,
            description: 'Year in Review Wrapped stories for this server.'
          }
        },
        {
          path: 'wrapped/player/:playerName',
          name: 'v4-player-wrapped-global',
          component: PlayerWrappedV4,
          props: true,
          meta: {
            title: (route: RouteLocationNormalized) => `${route.params.playerName} Wrapped · bfstats.io`,
            description: 'Year in Review Wrapped stories for this player.'
          }
        },
        {
          path: 'wrapped/player/:playerName/:serverGuid',
          name: 'v4-player-wrapped-server',
          component: PlayerWrappedV4,
          props: true,
          meta: {
            title: (route: RouteLocationNormalized) => `${route.params.playerName} Wrapped · bfstats.io`,
            description: 'Year in Review Wrapped stories for this player on this server.'
          }
        },
        {
          path: 'rounds/:roundId/report',
          name: 'v4-round-report',
          component: RoundReportV4,
          props: route => ({
            roundId: route.params.roundId,
            players: route.query.players,
          }),
          meta: {
            title: (route: RouteLocationNormalized) => `Round ${route.params.roundId} · bfstats.io`,
            description: 'Round playback, scoreboard, and battle highlights.'
          }
        },
        {
          path: 'players',
          name: 'v4-players',
          component: PlayersV4,
          meta: {
            title: 'Players · bfstats.io',
            description: 'Player registry and leaderboards.'
          }
        },
        {
          path: 'players/compare',
          name: 'v4-player-comparison',
          component: PlayerComparisonV4,
          meta: {
            title: 'Compare players · bfstats.io',
            description: 'Side-by-side comparison of two players.'
          }
        },
        {
          path: 'dashboard',
          name: 'v4-dashboard',
          component: DashboardV4,
          meta: {
            title: 'Dashboard · bfstats.io',
            description: 'Your buddies, favourite servers, and tournament shortcuts.'
          }
        },
        {
          path: 'rounds',
          name: 'v4-rounds-index',
          component: RoundsIndexV4,
          meta: {
            title: 'Rounds · bfstats.io',
            description: 'Recent rounds across all tracked servers.'
          }
        },
        {
          path: 'system-stats',
          name: 'v4-system-stats',
          component: SystemStatsV4,
          meta: {
            title: 'System · bfstats.io',
            description: 'Servers and players tracked, plus credits.'
          }
        },
        {
          path: 'map-popularity/:serverGuid',
          name: 'v4-map-popularity',
          component: MapPopularityV4,
          props: true,
          meta: {
            title: 'Map popularity · bfstats.io',
            description: 'Map rotation popularity and time-of-day heatmap.'
          }
        },
        {
          path: 'servers/:serverName/sessions',
          name: 'v4-server-sessions',
          component: ServerSessionsV4,
          props: true,
          meta: {
            title: (route: RouteLocationNormalized) => `${route.params.serverName} · Sessions · bfstats.io`,
            description: 'Recent rounds played on this server.'
          }
        },
        {
          path: 'communities/:id',
          name: 'v4-community-detail',
          component: CommunityDetailV4,
          props: true,
          meta: {
            title: 'Community · bfstats.io',
            description: 'Detected play-group, members, and primary servers.'
          }
        },
        {
          path: 'admin/data',
          name: 'v4-admin-data',
          component: AdminDataManagementV4,
          meta: {
            title: 'Admin · Data intel · bfstats.io',
            description: 'Investigate and delete suspicious player sessions.'
          },
          beforeEnter: (_to, _from, next) => {
            const { isAuthenticated, isSupport } = useAuth()
            if (!isAuthenticated.value || !isSupport.value) {
              next('/v4/servers/bf1942')
            } else {
              next()
            }
          }
        }
      ]
    }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  // Landing position on every navigation:
  //  - browser back/forward → restore the prior scroll position
  //  - in-route hash target → smooth scroll to the anchor
  //  - query-only change (e.g. ?tab=maps → ?tab=ranks) → leave scroll alone;
  //    these are in-page state syncs, not page changes. Without this guard,
  //    every tab click was yanking the page to the top.
  //  - everything else (different path) → top of page
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, behavior: 'smooth' as ScrollBehavior }
    if (to.path === from.path) return false
    return { top: 0, behavior: 'auto' as ScrollBehavior }
  },
})

// Navigation progress indicator
router.beforeEach(() => { isNavigating.value = true })
router.afterEach(() => { isNavigating.value = false })

// Page-view telemetry beacon — one event per resolved navigation, tied to canonical route name.
router.afterEach((to) => {
  telemetryService.recordPageView(to)
})

// SEO meta tag handler
router.afterEach((to) => {
  const meta = to.meta
  let title = 'BF Stats - Battlefield Server Statistics'
  let description = 'Real-time Battlefield server monitoring and player statistics for BF1942, FH2, and BF Vietnam.'

  if (meta?.title) {
    title = typeof meta.title === 'function' ? meta.title(to) : meta.title
    document.title = title

    // Update notification service's stored original title
    import('../services/notificationService').then(({ notificationService }) => {
      notificationService.updateOriginalTitle()
    })
  }

  if (meta?.description) {
    description = typeof meta.description === 'function' ? meta.description(to) : meta.description
  }

  // Helper function to update or create meta tags
  const updateMetaTag = (selector: string, attribute: string, content: string) => {
    let tag = document.querySelector(selector)
    if (!tag) {
      tag = document.createElement('meta')
      tag.setAttribute(attribute.includes('property') ? 'property' : 'name', attribute.replace('property=', '').replace('name=', ''))
      document.head.appendChild(tag)
    }
    tag.setAttribute('content', content)
  }

  // Standard meta tags
  updateMetaTag('meta[name="description"]', 'name=description', description)

  // Open Graph tags for social media
  updateMetaTag('meta[property="og:title"]', 'property=og:title', title)
  updateMetaTag('meta[property="og:description"]', 'property=og:description', description)
  updateMetaTag('meta[property="og:type"]', 'property=og:type', 'website')
  updateMetaTag('meta[property="og:url"]', 'property=og:url', window.location.href)
  updateMetaTag('meta[property="og:site_name"]', 'property=og:site_name', 'BF Stats')

  // Twitter Card tags
  updateMetaTag('meta[name="twitter:card"]', 'name=twitter:card', 'summary_large_image')
  updateMetaTag('meta[name="twitter:title"]', 'name=twitter:title', title)
  updateMetaTag('meta[name="twitter:description"]', 'name=twitter:description', description)
})

export default router
