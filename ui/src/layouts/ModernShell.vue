<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import MmHeaderAuth from '@/components/v4/MmHeaderAuth.vue'
import MmSiteNoticeBanner from '@/components/v4/MmSiteNoticeBanner.vue'
import MmOmnisearchModal from '@/components/v4/MmOmnisearchModal.vue'
import { useAuth } from '@/composables/useAuth'
import { isNavigating } from '@/composables/useNavProgress'
import '../styles/modern-minimal.css'

interface NavItem { label: string; to: string; key: string; admin?: boolean; notice?: boolean }
const baseNavItems: NavItem[] = [
  { label: 'Servers', to: '/v4/servers/bf1942', key: 'servers' },
  { label: 'Players', to: '/v4/players', key: 'players' },
  { label: 'Leaderboard', to: '/v4/leaderboard', key: 'leaderboard', notice: true },
  // Rounds is deliberately not a top-level destination — the round report is only
  // meaningful when you arrive at a specific round from a player's session list or
  // achievement. The /v4/rounds routes and every inbound link to them still work.
]

const { isSupport } = useAuth()
const navItems = computed<NavItem[]>(() => {
  const items = [...baseNavItems]
  if (isSupport.value) {
    items.push({ label: 'Admin', to: '/v4/admin/data', key: 'admin', admin: true })
  }
  return items
})

const NAV_NOTICE_KEY = 'bfstats:seen-nav-leaderboard'

const readLeaderboardNotice = () => {
  try {
    return localStorage.getItem(NAV_NOTICE_KEY) !== '1'
  } catch {
    return true
  }
}

const showLeaderboardNotice = ref(readLeaderboardNotice())

const dismissLeaderboardNotice = () => {
  if (!showLeaderboardNotice.value) return
  showLeaderboardNotice.value = false
  try {
    localStorage.setItem(NAV_NOTICE_KEY, '1')
  } catch {
    /* private mode */
  }
}

const route = useRoute()
const activeKey = computed(() => {
  const path = route.path
  if (path.startsWith('/admin') || path.startsWith('/v4/admin')) return 'admin'
  if (path.startsWith('/v4/servers')) return 'servers'
  if (path.startsWith('/v4/players')) return 'players'
  if (path.startsWith('/v4/leaderboard')) return 'leaderboard'
  if (path.startsWith('/v4/rounds')) return 'rounds'
  return ''
})

watch(activeKey, (key) => {
  if (key === 'leaderboard') dismissLeaderboardNotice()
}, { immediate: true })

interface Crumb { label: string; to: string | null }

// Path segments that are URL structure but not meaningful breadcrumb steps.
// e.g. /v4/servers/detail/:name → drop "detail"; /v4/rounds/:id/report → drop "report"
const STRUCTURAL_SEGMENTS = new Set(['detail', 'report'])

// Map a cumulative segment path back to a clickable V4 destination. Returns
// null when the prefix has no landing of its own (just a path artefact).
const resolveCrumbTarget = (segs: string[]): string | null => {
  const path = '/v4/' + segs.join('/')
  // Section landings — the first segment alone
  if (segs.length === 1) {
    if (segs[0] === 'servers') return '/v4/servers/bf1942'
    if (segs[0] === 'players') return '/v4/players'
    if (segs[0] === 'leaderboard') return '/v4/leaderboard'
    if (segs[0] === 'rounds') return '/v4/rounds'
    // system-stats / map-popularity / communities are terminal-only; no
    // section landing exists, so the segment isn't linkable on its own.
    return null
  }
  // /v4/players/:name → player profile
  if (segs[0] === 'players' && segs.length === 2) return path
  // /v4/servers/detail/:name → server detail page
  if (segs[0] === 'servers' && segs[1] === 'detail' && segs.length === 3) return path
  return null
}

const crumbs = computed<Crumb[]>(() => {
  const raw = route.path.split('/').filter(Boolean)
  if (raw[0] === 'v4') raw.shift()
  if (raw.length === 0) return []

  // Build crumb candidates with each one's cumulative segment path. Skip
  // structural-only segments so we don't surface "detail" / "report" as
  // visible (non-clickable) noise in the breadcrumb.
  const candidates: { segs: string[]; label: string }[] = []
  const accum: string[] = []
  for (const seg of raw) {
    accum.push(seg)
    if (STRUCTURAL_SEGMENTS.has(seg)) continue
    let label = seg
    try { label = decodeURIComponent(seg) } catch { /* keep raw */ }
    // Humanise dashed section names ("map-popularity" → "map popularity").
    if (/^[a-z-]+$/.test(label) && label.includes('-')) {
      label = label.replace(/-/g, ' ')
    }
    candidates.push({ segs: [...accum], label })
  }

  // Last crumb is the current page — never a link.
  return candidates.map((c, idx) => ({
    label: c.label,
    to: idx === candidates.length - 1 ? null : resolveCrumbTarget(c.segs),
  }))
})

const clock = ref('00:00:00')
let timer: number | undefined
const updateClock = () => {
  const d = new Date()
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  clock.value = `${h}:${m}:${s}`
}
onMounted(() => {
  updateClock()
  timer = window.setInterval(updateClock, 1000)
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})

const showOmnisearch = ref(false)

const openOmnisearch = () => {
  showOmnisearch.value = true
}

// Global ⌘K / Ctrl+K opens the omnisearch command palette.
const onGlobalKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    showOmnisearch.value = true
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown))
</script>

<template>
  <div class="mm mm-shell">
    <div class="mm-nav-progress" :class="{ 'mm-nav-progress--active': isNavigating }" aria-hidden="true" />
    <MmSiteNoticeBanner />
    <header class="mm-topbar">
      <router-link to="/v4/servers/bf1942" class="mm-brand">
        <img
          src="@/assets/clippy_my_boi.webp"
          alt="bfstats.io"
          class="mm-brand__sigil"
        />
        <span class="mm-brand__mark">
          <span class="mm-brand__name">bfstats.io</span>
          <span class="mm-brand__sub">Battlefield 1942 stats</span>
        </span>
      </router-link>

      <nav class="mm-nav" aria-label="Primary">
        <router-link
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          class="mm-nav__link"
          :class="{
            'mm-nav__link--active': activeKey === item.key,
            'mm-nav__link--admin': item.admin,
            'mm-nav__link--new': item.notice && showLeaderboardNotice,
          }"
          :aria-label="item.notice && showLeaderboardNotice ? `${item.label}, new` : undefined"
        >
          {{ item.label }}<span
            v-if="item.notice && showLeaderboardNotice"
            class="mm-nav__pip"
            aria-hidden="true"
          />
        </router-link>
      </nav>

      <button
        type="button"
        class="mm-search mm-search--trigger"
        title="Search players, servers, and pages (⌘K)"
        aria-label="Search players and servers"
        @click="openOmnisearch"
      >
        <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span class="mm-search__placeholder">Search players, servers…</span>
        <span class="mm-search__hint">⌘K</span>
      </button>

      <button
        type="button"
        class="mm-mobile-search-btn"
        title="Search players and servers"
        aria-label="Search"
        @click="openOmnisearch"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>

      <MmHeaderAuth />
    </header>

    <div class="mm-substrip">
      <div class="mm-crumbs" aria-label="Breadcrumb">
        <router-link to="/v4/servers/bf1942">overview</router-link>
        <template v-for="(c, i) in crumbs" :key="i">
          <span class="mm-crumbs__sep">/</span>
          <router-link v-if="c.to" :to="c.to">{{ c.label }}</router-link>
          <span v-else class="mm-crumbs__here">{{ c.label }}</span>
        </template>
      </div>
      <div class="mm-clock">
        <span class="mm-clock__time">{{ clock }}</span>
        <span>UTC</span>
      </div>
    </div>

    <main>
      <router-view />
    </main>

    <footer class="mm-foot">
      <span>bfstats.io · Battlefield 1942 stats</span>
      <router-link to="/system-stats" title="System Statistics">
        System Stats
      </router-link>
    </footer>

    <MmOmnisearchModal v-model="showOmnisearch" />
  </div>
</template>
