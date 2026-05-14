import { createRouter, createWebHistory, type RouteRecordRaw, type RouteLocationNormalized } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { telemetryService } from '../services/telemetryService'

// Lazy load all route components for optimal code splitting
const Dashboard = () => import('../views/Dashboard.vue')
const LandingPageV2 = () => import('../views/LandingPageV2.vue')
const LandingPageV3 = () => import('../views/LandingPageV3.vue')
const Players = () => import('../views/Players.vue')
const PlayerDetails = () => import('../views/PlayerDetails.vue')
const PlayerAllAchievements = () => import('../views/PlayerAllAchievements.vue')
const ServerDetails = () => import('../views/ServerDetails.vue')
const PlayerSessionsPage = () => import('../components/PlayerSessionsPage.vue')
const ServerSessionsPage = () => import('../components/ServerSessionsPage.vue')
const RoundReportPageV2 = () => import('../components/RoundReportPageV2.vue')
const PlayerComparison = () => import('../views/PlayerComparison.vue')
const SystemStats = () => import('../views/SystemStats.vue')
const DiscordCallback = () => import('../views/DiscordCallback.vue')
const TournamentDetails = () => import('../views/TournamentDetails.vue')
const PublicTournament = () => import('../views/PublicTournament.vue')
const PublicTournamentRankings = () => import('../views/PublicTournamentRankings.vue')
const PublicTournamentRules = () => import('../views/PublicTournamentRules.vue')
const PublicTournamentTeams = () => import('../views/PublicTournamentTeams.vue')
const PublicTournamentMatches = () => import('../views/PublicTournamentMatches.vue')
const PublicTournamentStats = () => import('../views/PublicTournamentStats.vue')
const PublicTournamentFiles = () => import('../views/PublicTournamentFiles.vue')
const AdminDataManagement = () => import('../views/AdminDataManagement.vue')
const CommunityDetailsView = () => import('../views/CommunityDetailsView.vue')
const AliasDetectionView = () => import('../views/AliasDetectionView.vue')
const MapPopularityView = () => import('../views/MapPopularityView.vue')

// v4 — modern-minimal theme (parallel preview, accessible at /v4/*)
const ModernShell = () => import('../layouts/ModernShell.vue')
const LandingPageV4 = () => import('../views/v4/LandingPageV4.vue')
const PlayerDetailsV4 = () => import('../views/v4/PlayerDetailsV4.vue')
const ServerDetailsV4 = () => import('../views/v4/ServerDetailsV4.vue')
const PlayersV4 = () => import('../views/v4/PlayersV4.vue')
const PlayerAllAchievementsV4 = () => import('../views/v4/PlayerAllAchievementsV4.vue')
const PlayerSessionsV4 = () => import('../views/v4/PlayerSessionsV4.vue')
const PlayerNetworkV4 = () => import('../views/v4/PlayerNetworkV4.vue')
const RoundReportV4 = () => import('../views/v4/RoundReportV4.vue')
const RoundsIndexV4 = () => import('../views/v4/RoundsIndexV4.vue')
const SystemStatsV4 = () => import('../views/v4/SystemStatsV4.vue')
const MapPopularityV4 = () => import('../views/v4/MapPopularityV4.vue')
const ServerSessionsV4 = () => import('../views/v4/ServerSessionsV4.vue')
const CommunityDetailV4 = () => import('../views/v4/CommunityDetailV4.vue')

const routes: RouteRecordRaw[] = [
    {
      path: '/',
      name: 'home',
      meta: {
        title: 'BF Stats - Battlefield 1942, FH2 & BF Vietnam Server Statistics',
        description: 'Real-time Battlefield 1942, Forgotten Hope 2, and Battlefield Vietnam server monitoring. Track player statistics, server rankings, and game analytics.'
      },
      beforeEnter: (_to, _from, next) => {
        // Check for stored auth token synchronously first to avoid slow auth validation
        const storedToken = localStorage.getItem('auth_token')
        if (storedToken) {
          // Only do expensive auth validation if we have a stored token
          const { isAuthenticated } = useAuth()
          if (isAuthenticated.value) {
            next('/dashboard')
          } else {
            next('/servers/bf1942')
          }
        } else {
          // No stored token - skip auth validation and go straight to servers
          next('/servers/bf1942')
        }
      }
    },
    {
      path: '/landing',
      name: 'landing',
      component: LandingPageV2,
      meta: {
        title: "bfstats.io | 42' telemetry",
        description: 'Browse active Battlefield 1942, Forgotten Hope 2, and Battlefield Vietnam servers. Real-time player counts, maps, and server information.'
      }
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: Dashboard,
      meta: {
        title: 'My Dashboard - BF Stats Personal Command Center',
        description: 'Your personal Battlefield statistics dashboard. View favorite servers, player profiles, and custom battlefield analytics.'
      },
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
      path: '/servers',
      name: 'servers',
      redirect: '/servers/bf1942',
      meta: {
        title: 'Game Servers - BF Stats Server Browser',
        description: 'Browse all Battlefield 1942, Forgotten Hope 2, and Battlefield Vietnam servers. Find active servers with real-time player counts and statistics.'
      }
    },
    {
      path: '/servers/bf1942',
      name: 'servers-bf1942',
      component: LandingPageV2,
      props: { initialMode: '42' },
      meta: {
        title: "bfstats.io | 42' telemetry",
        description: 'Find active Battlefield 1942 servers worldwide. Real-time player counts, maps, ping, and detailed server statistics. Join the classic WWII battlefield action.'
      }
    },
    {
      path: '/servers/fh2',
      name: 'servers-fh2',
      component: LandingPageV2,
      props: { initialMode: 'FH2' },
      meta: {
        title: 'bfstats.io | FH2 telemetry',
        description: 'Discover active Forgotten Hope 2 servers with realistic WWII gameplay. Live server stats, player counts, and detailed FH2 server information.'
      }
    },
    {
      path: '/servers/bfv',
      name: 'servers-bfv',
      component: LandingPageV2,
      props: { initialMode: 'BFV' },
      meta: {
        title: 'bfstats.io | BFV telemetry',
        description: 'Find active Battlefield Vietnam servers with jungle warfare action. Live server statistics, player counts, and Vietnam War era battlefield servers.'
      }
    },
    {
      path: '/servers/bf1942/v3',
      name: 'servers-bf1942-v3',
      component: LandingPageV3,
      props: { initialMode: '42' },
      meta: {
        title: "bfstats.io | 42' telemetry",
        description: 'Live rounds, recent wins, and network pulse for Battlefield 1942 servers. Beta command-center view.'
      }
    },
    {
      path: '/servers/fh2/v3',
      name: 'servers-fh2-v3',
      component: LandingPageV3,
      props: { initialMode: 'FH2' },
      meta: {
        title: 'bfstats.io | FH2 telemetry',
        description: 'Live rounds, recent wins, and network pulse for Forgotten Hope 2 servers. Beta command-center view.'
      }
    },
    {
      path: '/servers/bfv/v3',
      name: 'servers-bfv-v3',
      component: LandingPageV3,
      props: { initialMode: 'BFV' },
      meta: {
        title: 'bfstats.io | BFV telemetry',
        description: 'Live rounds, recent wins, and network pulse for Battlefield Vietnam servers. Beta command-center view.'
      }
    },
    {
      path: '/servers/:serverName',
      name: 'server-details',
      component: ServerDetails,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `${route.params.serverName} Server Stats - bfstats.io`,
        description: (route: RouteLocationNormalized) => `Detailed statistics for ${route.params.serverName} server. View player rankings, server history, performance metrics, and join information.`
      }
    },
    {
      path: '/servers/:serverName/sessions',
      name: 'server-sessions',
      component: ServerSessionsPage,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `${route.params.serverName} Session History - BF Stats`,
        description: (route: RouteLocationNormalized) => `Gaming session history and analytics for ${route.params.serverName}. Track server activity, player trends, and performance over time.`
      }
    },
    {
      path: '/players',
      name: 'players',
      component: Players,
      meta: {
        title: 'Player Search & Leaderboard - BF Stats Player Database',
        description: 'Search Battlefield players and view global leaderboards. Find detailed player statistics, rankings, and performance across BF1942, FH2, and BF Vietnam.'
      }
    },
    {
      path: '/players/compare',
      name: 'player-comparison',
      component: PlayerComparison,
      props: route => ({
        player1: route.query.player1,
        player2: route.query.player2
      }),
      meta: {
        title: (route: RouteLocationNormalized) => {
          const player1 = route.query.player1 || 'Player 1'
          const player2 = route.query.player2 || 'Player 2'
          return `${player1} vs ${player2} - BF Stats Player Comparison`
        },
        description: (route: RouteLocationNormalized) => {
          const player1 = route.query.player1 || 'players'
          const player2 = route.query.player2 || ''
          return `Compare Battlefield player statistics between ${player1}${player2 ? ` and ${player2}` : ' and other players'}. Side-by-side performance analysis and rankings.`
        }
      }
    },
    {
      path: '/players/:playerName',
      name: 'player-details',
      component: PlayerDetails,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `${route.params.playerName} - BF Stats Player Profile & Statistics`,
        description: (route: RouteLocationNormalized) => `Detailed Battlefield statistics for ${route.params.playerName}. View kills, deaths, score, accuracy, favorite servers, and complete gaming history.`
      }
    },
    {
      path: '/players/:playerName/sessions',
      name: 'player-sessions',
      component: PlayerSessionsPage,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `${route.params.playerName} Session History - BF Stats`,
        description: (route: RouteLocationNormalized) => `Gaming session history and analytics for ${route.params.playerName}. Track playtime, server activity, and performance trends over time.`
      }
    },
    {
      path: '/players/:playerName/achievements',
      name: 'player-achievements',
      component: PlayerAllAchievements,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `${route.params.playerName} Achievements & Awards - BF Stats`,
        description: (route: RouteLocationNormalized) => `All achievements, badges, and awards earned by ${route.params.playerName}. View unlocked content, milestones, and battlefield accomplishments.`
      }
    },
    {
      path: '/players/:playerName/network',
      name: 'player-network',
      component: () => import('../views/PlayerNetworkView.vue'),
      props: route => ({ playerName: route.params.playerName }),
      meta: {
        title: (route: RouteLocationNormalized) => `${route.params.playerName} Network & Connections - BF Stats`,
        description: (route: RouteLocationNormalized) => `Player network visualization for ${route.params.playerName}. Explore connections, teammates, and social relationships in the Battlefield community.`
      }
    },
    {
      path: '/explore',
      name: 'explore',
      redirect: '/servers'
    },
    {
      path: '/explore/servers',
      redirect: '/servers'
    },
    {
      path: '/explore/servers/:serverGuid',
      redirect: '/servers'
    },
    {
      path: '/explore/servers/:serverGuid/maps/:mapName',
      redirect: '/servers'
    },
    {
      path: '/explore/maps',
      redirect: '/servers'
    },
    {
      path: '/explore/maps/:mapName',
      redirect: '/servers'
    },
    {
      path: '/explore/players',
      redirect: '/players'
    },
    {
      path: '/explore/players/:playerName',
      redirect: to => `/players/${to.params.playerName}`
    },
    {
      path: '/rounds/:roundId/report',
      name: 'round-report',
      component: RoundReportPageV2,
      props: route => ({
        roundId: route.params.roundId,
        players: route.query.players // Optional parameter for pinning specific players
      }),
      meta: {
        title: (route: RouteLocationNormalized) => `Round ${route.params.roundId} Report - BF Stats Match Analysis`,
        description: (route: RouteLocationNormalized) => `Detailed round report and match analysis for round ${route.params.roundId}. View player performance, team statistics, and battlefield events.`
      }
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
    {
      path: '/admin/data',
      name: 'admin-data',
      component: AdminDataManagement,
      meta: {
        title: 'Admin Data Management - BF Stats',
        description: 'Investigate and delete suspicious player sessions.'
      },
      beforeEnter: (_to, _from, next) => {
        const { isAuthenticated, isSupport } = useAuth()
        if (!isAuthenticated.value || !isSupport.value) {
          next('/dashboard')
        } else {
          next()
        }
      }
    },
    {
      path: '/system-stats',
      name: 'system-stats',
      component: SystemStats,
      meta: {
        title: 'System Statistics - BF Stats Infrastructure Metrics',
        description: 'Real-time data volume metrics across the platform. View the scale of data being processed in SQLite.'
      }
    },
    {
      path: '/auth/discord/callback',
      name: 'discord-callback',
      component: DiscordCallback,
      meta: {
        title: 'Discord Authentication - BF Stats',
        description: 'Completing Discord authentication...'
      }
    },
    {
      path: '/communities/:id',
      name: 'community-details',
      component: CommunityDetailsView,
      props: true,
      meta: {
        title: (route: RouteLocationNormalized) => `Community ${route.params.id} - BF Stats`,
        description: (route: RouteLocationNormalized) => `Detailed view of player community ${route.params.id}. See all members, servers, network connections, and activity trends.`
      }
    },
    {
      path: '/map-popularity/:serverGuid',
      name: 'map-popularity',
      component: MapPopularityView,
      props: true,
      meta: {
        title: 'Map Popularity Report - BF Stats',
        description: 'Analyse map rotation popularity and player retention trends for server administration.'
      }
    },
    {
      path: '/alias-detection',
      name: 'alias-detection',
      component: AliasDetectionView,
      meta: {
        title: 'Alias Detection - Player Relationship Analysis | BF Stats',
        description: 'Investigate potential player aliases and alternate accounts. Analyze behavioral patterns, statistics, and activity timelines to identify suspicious accounts.'
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
            title: 'Servers · bfstats.io',
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
