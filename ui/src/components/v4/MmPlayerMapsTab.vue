<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import type { PlayerMapStatEntry } from '@/types/playerStatsTypes'
import { fetchPlayerMapDetail, type PlayerMapDetailResponse } from '@/services/playerStatsApi'
import { resolveMapArt, hideBrokenTheaterImg } from '@/utils/bf1942MapArt'
import { getMapTheater, normalizeMapSlug, type MapTheaterInfo } from '@/composables/useMapTheater'
import { kdClass } from '@/views/v4/mmTokens'
import { decodePlayerName, decodeServerName } from '@/utils/playerName'
import MmBaseModal from '@/components/v4/MmBaseModal.vue'
import MmMapPerformanceRace from '@/components/v4/data-explorer/MmMapPerformanceRace.vue'
import MmMapThumb from '@/components/v4/MmMapThumb.vue'
import MmMapDossier from '@/components/v4/MmMapDossier.vue'
import { mapImageUrl } from '@/utils/mapImage'

interface Props {
  playerName: string
  game?: string
  mapStats?: PlayerMapStatEntry[]
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  game: 'bf1942',
  mapStats: () => [],
  loading: false,
})

const emit = defineEmits<{
  navigateToMap: [mapName: string, gameId?: string]
}>()

const router = useRouter()

// --- Types ---
export interface EnrichedMap {
  mapName: string
  gameId: string
  displayName: string
  slug: string
  theaterInfo: MapTheaterInfo | null
  theaterCategory: string
  theaterKey: string
  theaterColor: string
  artUrl: string | null
  thumbnailUrl: string | null
  minimapUrl: string | null
  minutes: number
  kills: number
  deaths: number
  kd: number
  score: number
  rounds: number
  kpm: number
  kpr: number
  spm: number
}

// Theater color map matching editorial battlefield palette
const THEATER_COLORS: Record<string, string> = {
  'Pacific': '#4a8bad',
  'North Africa': '#c5a23a',
  'Eastern Front': '#b84545',
  'Western Europe': '#7d8849',
  'Mediterranean': '#38989b',
  'Secret Weapons': '#8a65a3',
  'Desert Combat': '#d46f2d',
  'Other': '#777777',
}

function getTheaterColor(category: string): string {
  return THEATER_COLORS[category] || THEATER_COLORS['Other']
}

// Helpers
const formatNumber = (n: number | null | undefined): string => {
  if (n == null) return '0'
  return n.toLocaleString()
}

const formatDuration = (mins: number | null | undefined): string => {
  if (!mins) return '0m'
  if (mins < 60) return `${Math.round(mins)}m`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins - h * 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

// --- Data Enrichment ---
const enrichedMaps = computed<EnrichedMap[]>(() => {
  if (!props.mapStats || props.mapStats.length === 0) return []

  return props.mapStats.map(m => {
    const gameId = m.gameId || props.game || 'bf1942'
    const thumb = mapImageUrl(gameId, m.mapName, 'thumbnail')
    const mini = mapImageUrl(gameId, m.mapName, 'minimap')
    const art = resolveMapArt(m.mapName)
    const theater = getMapTheater(m.mapName, gameId)
    const category = theater?.theaterCategory || 'Other'
    const color = getTheaterColor(category)

    const kills = m.totalKills ?? 0
    const deaths = m.totalDeaths ?? 0
    const minutes = m.totalPlayTimeMinutes ?? 0
    const rounds = m.sessionsPlayed ?? 0
    const score = m.totalScore ?? 0

    const kd = deaths > 0 ? kills / deaths : kills
    const kpm = minutes > 0 ? kills / minutes : 0
    const kpr = rounds > 0 ? kills / rounds : kills
    const spm = minutes > 0 ? score / minutes : 0

    return {
      mapName: m.mapName,
      gameId,
      displayName: art?.displayName || m.mapName,
      slug: art?.slug || normalizeMapSlug(m.mapName),
      theaterInfo: theater,
      theaterCategory: category,
      theaterKey: theater?.theaterKey || 'other',
      theaterColor: color,
      artUrl: thumb || mini || art?.ingame || theater?.imageUrl || null,
      thumbnailUrl: thumb,
      minimapUrl: mini,
      minutes,
      kills,
      deaths,
      kd,
      score,
      rounds,
      kpm,
      kpr,
      spm,
    }
  })
})

const maxMinutes = computed(() => {
  if (enrichedMaps.value.length === 0) return 1
  return Math.max(...enrichedMaps.value.map(m => m.minutes), 1)
})

const totalCombatMinutes = computed(() => {
  return enrichedMaps.value.reduce((acc, m) => acc + m.minutes, 0)
})

const totalCombatKills = computed(() => {
  return enrichedMaps.value.reduce((acc, m) => acc + m.kills, 0)
})

const totalCombatRounds = computed(() => {
  return enrichedMaps.value.reduce((acc, m) => acc + m.rounds, 0)
})

// --- Tactical Signatures ---
const homeTurf = computed<EnrichedMap | null>(() => {
  if (enrichedMaps.value.length === 0) return null
  const sorted = [...enrichedMaps.value].sort((a, b) => b.minutes - a.minutes)
  return sorted[0] && sorted[0].minutes > 0 ? sorted[0] : null
})

const stronghold = computed<EnrichedMap | null>(() => {
  if (enrichedMaps.value.length === 0) return null
  // Require at least 2 rounds or 15 minutes to qualify as a stronghold
  const qualified = enrichedMaps.value.filter(m => (m.rounds >= 2 || m.minutes >= 15) && m.kills >= 5)
  const pool = qualified.length > 0 ? qualified : enrichedMaps.value.filter(m => m.kills > 0)
  if (pool.length === 0) return null
  const sorted = [...pool].sort((a, b) => b.kd - a.kd)
  return sorted[0] || null
})

const nemesis = computed<EnrichedMap | null>(() => {
  if (enrichedMaps.value.length === 0) return null
  // Require at least 2 rounds or 15 minutes, at least 5 deaths, and kd < 1.15
  const qualified = enrichedMaps.value.filter(m => (m.rounds >= 2 || m.minutes >= 15) && m.deaths >= 5 && m.kd < 1.15)
  if (qualified.length === 0) return null
  const sorted = [...qualified].sort((a, b) => a.kd - b.kd)
  return sorted[0] || null
})

// --- Theater Distribution ---
interface TheaterSegment {
  category: string
  color: string
  minutes: number
  percentage: number
  count: number
}

const theaterSegments = computed<TheaterSegment[]>(() => {
  const total = totalCombatMinutes.value
  if (total === 0) return []

  const mapByCategory = new Map<string, { minutes: number; count: number }>()

  for (const m of enrichedMaps.value) {
    const prev = mapByCategory.get(m.theaterCategory) || { minutes: 0, count: 0 }
    mapByCategory.set(m.theaterCategory, {
      minutes: prev.minutes + m.minutes,
      count: prev.count + 1,
    })
  }

  const segments: TheaterSegment[] = []
  for (const [category, data] of mapByCategory.entries()) {
    const percentage = total > 0 ? (data.minutes / total) * 100 : 0
    segments.push({
      category,
      color: getTheaterColor(category),
      minutes: data.minutes,
      percentage,
      count: data.count,
    })
  }

  return segments.sort((a, b) => b.minutes - a.minutes)
})

// --- Filtering & Sorting ---
type ViewMode = 'cards' | 'roster'
const viewMode = ref<ViewMode>('cards')

type SortField = 'playtime' | 'kd' | 'kills' | 'deaths' | 'rounds' | 'score' | 'name'
type SortOrder = 'desc' | 'asc'

const activeTheater = ref<string | null>(null)
const searchQuery = ref('')
const sortBy = ref<SortField>('playtime')
const sortOrder = ref<SortOrder>('desc')
const showPerformanceStream = ref(false)

const toggleTheaterFilter = (category: string) => {
  if (activeTheater.value === category) {
    activeTheater.value = null
  } else {
    activeTheater.value = category
  }
}

const toggleSortOrder = () => {
  sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
}

const filteredMaps = computed<EnrichedMap[]>(() => {
  let list = [...enrichedMaps.value]

  // Theater filter
  if (activeTheater.value) {
    list = list.filter(m => m.theaterCategory === activeTheater.value)
  }

  // Search query
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(m =>
      m.mapName.toLowerCase().includes(q) ||
      m.displayName.toLowerCase().includes(q) ||
      m.theaterCategory.toLowerCase().includes(q)
    )
  }

  // Sorting
  list.sort((a, b) => {
    let diff = 0
    switch (sortBy.value) {
      case 'playtime':
        diff = b.minutes - a.minutes
        break
      case 'kd':
        diff = b.kd - a.kd
        break
      case 'kills':
        diff = b.kills - a.kills
        break
      case 'deaths':
        diff = b.deaths - a.deaths
        break
      case 'rounds':
        diff = b.rounds - a.rounds
        break
      case 'score':
        diff = b.score - a.score
        break
      case 'name':
        diff = a.displayName.localeCompare(b.displayName)
        break
    }
    return sortOrder.value === 'desc' ? diff : -diff
  })

  return list
})

// --- In-Situ Dossier Inspector ---
const selectedMap = ref<EnrichedMap | null>(null)
const isDossierOpen = ref(false)
const dossierLoading = ref(false)
const dossierData = ref<PlayerMapDetailResponse | null>(null)

const openDossier = async (map: EnrichedMap) => {
  selectedMap.value = map
  isDossierOpen.value = true
  dossierLoading.value = true
  dossierData.value = null

  try {
    const res = await fetchPlayerMapDetail(
      props.playerName,
      map.mapName,
      map.gameId || props.game,
      365
    )
    dossierData.value = res
  } catch {
    dossierData.value = null
  } finally {
    dossierLoading.value = false
  }
}

const closeDossier = () => {
  isDossierOpen.value = false
  selectedMap.value = null
  dossierData.value = null
}

const goToFullLeaderboard = (mapName: string, gameId?: string) => {
  closeDossier()
  emit('navigateToMap', mapName, gameId)
}

const goServer = (serverName: string) => {
  closeDossier()
  router.push(`/v4/servers/detail/${encodeURIComponent(serverName)}`)
}

// Rank index helper
const rankNum = (i: number) => String(i + 1).padStart(2, '0')
</script>

<template>
  <div class="mm-maps-tab">
    <!-- Top Telemetry Header -->
    <header class="mm-maps-tab__hero">
      <div class="mm-maps-tab__hero-titles">
        <div class="mm-eyebrow mm-eyebrow--strong">
          Combat Sector Intelligence
        </div>
        <div class="mm-maps-tab__hero-meta">
          <span>{{ formatNumber(enrichedMaps.length) }} sectors logged</span>
          <span class="mm-num__sep">·</span>
          <span>{{ formatDuration(totalCombatMinutes) }} combat time</span>
          <span class="mm-num__sep">·</span>
          <span class="mm-num--kill">{{ formatNumber(totalCombatKills) }} kills</span>
          <span class="mm-num__sep">·</span>
          <span>{{ formatNumber(totalCombatRounds) }} rounds</span>
        </div>
      </div>
    </header>

    <!-- Empty State -->
    <div
      v-if="!loading && enrichedMaps.length === 0"
      class="mm-empty"
      style="padding: 48px 0"
    >
      No combat map deployments logged for this player.
    </div>

    <template v-else>
      <!-- Tactical Signature Highlights (Home Turf, Stronghold, Nemesis) -->
      <section
        v-if="homeTurf || stronghold || nemesis"
        class="mm-signatures"
      >
        <!-- Home Turf -->
        <article
          v-if="homeTurf"
          class="mm-sig-card mm-sig-card--turf"
          @click="openDossier(homeTurf)"
        >
          <div
            v-if="homeTurf.artUrl"
            class="mm-sig-card__bg"
            :style="{ backgroundImage: `url(${homeTurf.artUrl})` }"
          />
          <div class="mm-sig-card__scrim" />
          <div class="mm-sig-card__content">
            <div class="mm-sig-card__badge-row">
              <span class="mm-badge mm-badge--turf">[HOME TURF]</span>
              <span
                class="mm-tag"
                :style="{ borderColor: homeTurf.theaterColor, color: homeTurf.theaterColor }"
              >
                {{ homeTurf.theaterCategory.toUpperCase() }}
              </span>
            </div>
            <h3 class="mm-sig-card__title">
              {{ homeTurf.displayName }}
            </h3>
            <div class="mm-sig-card__metrics">
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">TIME</span>
                <span class="mm-sig-metric__val">{{ formatDuration(homeTurf.minutes) }}</span>
              </div>
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">K/D</span>
                <span
                  class="mm-sig-metric__val"
                  :class="kdClass(homeTurf.kd)"
                >{{ homeTurf.kd.toFixed(2) }}</span>
              </div>
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">KILLS</span>
                <span class="mm-sig-metric__val mm-num--kill">{{ formatNumber(homeTurf.kills) }}</span>
              </div>
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">ROUNDS</span>
                <span class="mm-sig-metric__val">{{ formatNumber(homeTurf.rounds) }}</span>
              </div>
            </div>
            <div class="mm-sig-card__cta">
              Inspect Sector Briefing →
            </div>
          </div>
        </article>

        <!-- Stronghold -->
        <article
          v-if="stronghold"
          class="mm-sig-card mm-sig-card--stronghold"
          @click="openDossier(stronghold)"
        >
          <div
            v-if="stronghold.artUrl"
            class="mm-sig-card__bg"
            :style="{ backgroundImage: `url(${stronghold.artUrl})` }"
          />
          <div class="mm-sig-card__scrim" />
          <div class="mm-sig-card__content">
            <div class="mm-sig-card__badge-row">
              <span class="mm-badge mm-badge--stronghold">[STRONGHOLD]</span>
              <span
                class="mm-tag"
                :style="{ borderColor: stronghold.theaterColor, color: stronghold.theaterColor }"
              >
                {{ stronghold.theaterCategory.toUpperCase() }}
              </span>
            </div>
            <h3 class="mm-sig-card__title">
              {{ stronghold.displayName }}
            </h3>
            <div class="mm-sig-card__metrics">
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">K/D</span>
                <span
                  class="mm-sig-metric__val"
                  :class="kdClass(stronghold.kd)"
                >{{ stronghold.kd.toFixed(2) }}</span>
              </div>
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">KILLS</span>
                <span class="mm-sig-metric__val mm-num--kill">{{ formatNumber(stronghold.kills) }}</span>
              </div>
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">TIME</span>
                <span class="mm-sig-metric__val">{{ formatDuration(stronghold.minutes) }}</span>
              </div>
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">ROUNDS</span>
                <span class="mm-sig-metric__val">{{ formatNumber(stronghold.rounds) }}</span>
              </div>
            </div>
            <div class="mm-sig-card__cta">
              Inspect Sector Briefing →
            </div>
          </div>
        </article>

        <!-- Nemesis -->
        <article
          v-if="nemesis"
          class="mm-sig-card mm-sig-card--nemesis"
          @click="openDossier(nemesis)"
        >
          <div
            v-if="nemesis.artUrl"
            class="mm-sig-card__bg"
            :style="{ backgroundImage: `url(${nemesis.artUrl})` }"
          />
          <div class="mm-sig-card__scrim" />
          <div class="mm-sig-card__content">
            <div class="mm-sig-card__badge-row">
              <span class="mm-badge mm-badge--nemesis">[NEMESIS]</span>
              <span
                class="mm-tag"
                :style="{ borderColor: nemesis.theaterColor, color: nemesis.theaterColor }"
              >
                {{ nemesis.theaterCategory.toUpperCase() }}
              </span>
            </div>
            <h3 class="mm-sig-card__title">
              {{ nemesis.displayName }}
            </h3>
            <div class="mm-sig-card__metrics">
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">K/D</span>
                <span
                  class="mm-sig-metric__val"
                  :class="kdClass(nemesis.kd)"
                >{{ nemesis.kd.toFixed(2) }}</span>
              </div>
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">DEATHS</span>
                <span class="mm-sig-metric__val mm-num--death">{{ formatNumber(nemesis.deaths) }}</span>
              </div>
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">TIME</span>
                <span class="mm-sig-metric__val">{{ formatDuration(nemesis.minutes) }}</span>
              </div>
              <div class="mm-sig-metric">
                <span class="mm-sig-metric__label">ROUNDS</span>
                <span class="mm-sig-metric__val">{{ formatNumber(nemesis.rounds) }}</span>
              </div>
            </div>
            <div class="mm-sig-card__cta">
              Inspect Sector Briefing →
            </div>
          </div>
        </article>
      </section>

      <!-- Strategic Theater Distribution -->
      <section
        v-if="theaterSegments.length > 0"
        class="mm-theater-bar-section"
      >
        <div class="mm-theater-bar-section__head">
          <span class="mm-eyebrow mm-eyebrow--strong">Theater of War Footprint</span>
          <span class="mm-card__hint">proportional combat time</span>
        </div>

        <!-- Proportional multi-segment bar -->
        <div
          class="mm-theater-strip"
          role="progressbar"
          aria-label="Theater of war distribution"
        >
          <div
            v-for="seg in theaterSegments"
            :key="seg.category"
            class="mm-theater-strip__seg"
            :style="{
              width: `${seg.percentage}%`,
              backgroundColor: seg.color,
            }"
            :title="`${seg.category}: ${seg.percentage.toFixed(1)}% (${formatDuration(seg.minutes)})`"
          />
        </div>

        <!-- Interactive Theater Filter Pills -->
        <div class="mm-theater-pills">
          <button
            type="button"
            class="mm-pill"
            :class="{ 'is-active': activeTheater === null }"
            @click="activeTheater = null"
          >
            [ALL · {{ enrichedMaps.length }}]
          </button>
          <button
            v-for="seg in theaterSegments"
            :key="seg.category"
            type="button"
            class="mm-pill"
            :class="{ 'is-active': activeTheater === seg.category }"
            @click="toggleTheaterFilter(seg.category)"
          >
            <span
              class="mm-pill__dot"
              :style="{ backgroundColor: seg.color }"
            />
            {{ seg.category.toUpperCase() }} · {{ formatDuration(seg.minutes) }}
          </button>
        </div>
      </section>

      <!-- Control Toolbar -->
      <section class="mm-maps-toolbar">
        <div class="mm-maps-toolbar__search">
          <svg
            class="mm-maps-toolbar__icon"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle
              cx="11"
              cy="11"
              r="8"
            />
            <line
              x1="21"
              y1="21"
              x2="16.65"
              y2="16.65"
            />
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search map sectors..."
            class="mm-input mm-maps-toolbar__input"
          >
          <button
            v-if="searchQuery"
            type="button"
            class="mm-maps-toolbar__clear"
            aria-label="Clear search"
            @click="searchQuery = ''"
          >
            ×
          </button>
        </div>

        <div class="mm-maps-toolbar__actions">
          <!-- Sort Dropdown -->
          <div class="mm-maps-toolbar__sort">
            <span class="mm-eyebrow">SORT:</span>
            <select
              v-model="sortBy"
              class="mm-select"
            >
              <option value="playtime">
                Playtime
              </option>
              <option value="kd">
                K/D Ratio
              </option>
              <option value="kills">
                Kills
              </option>
              <option value="deaths">
                Deaths
              </option>
              <option value="rounds">
                Rounds
              </option>
              <option value="score">
                Score
              </option>
              <option value="name">
                Map Name
              </option>
            </select>
            <button
              type="button"
              class="mm-btn mm-btn--inline mm-maps-toolbar__order-btn"
              :title="`Order: ${sortOrder.toUpperCase()}`"
              @click="toggleSortOrder"
            >
              {{ sortOrder === 'desc' ? '↓' : '↑' }}
            </button>
          </div>

          <!-- View Mode Switcher -->
          <div class="mm-subtabs mm-maps-toolbar__views">
            <button
              type="button"
              class="mm-subtab"
              :class="{ 'is-active': viewMode === 'cards' }"
              @click="viewMode = 'cards'"
            >
              [CARDS]
            </button>
            <button
              type="button"
              class="mm-subtab"
              :class="{ 'is-active': viewMode === 'roster' }"
              @click="viewMode = 'roster'"
            >
              [ROSTER]
            </button>
          </div>
        </div>
      </section>

      <!-- Filter / Search summary -->
      <div
        v-if="filteredMaps.length < enrichedMaps.length"
        class="mm-meta-row"
        style="margin-bottom: 12px"
      >
        <span>Showing {{ filteredMaps.length }} of {{ enrichedMaps.length }} sectors</span>
        <button
          v-if="activeTheater || searchQuery"
          type="button"
          class="mm-link-inline"
          @click="activeTheater = null; searchQuery = ''"
        >
          [Clear Filters]
        </button>
      </div>

      <!-- Zero results state -->
      <div
        v-if="filteredMaps.length === 0"
        class="mm-empty"
        style="padding: 32px 0"
      >
        No map sectors match the selected criteria.
      </div>

      <!-- ==================== TACTICAL CARDS VIEW ==================== -->
      <section
        v-else-if="viewMode === 'cards'"
        class="mm-maps-grid"
      >
        <article
          v-for="(m, i) in filteredMaps"
          :key="`card-${m.mapName}`"
          class="mm-map-card"
          @click="openDossier(m)"
        >
          <!-- Card Image Header -->
          <div class="mm-map-card__banner">
            <img
              v-if="m.artUrl"
              :src="m.artUrl"
              :alt="m.displayName"
              class="mm-map-card__img"
              loading="lazy"
              @error="hideBrokenTheaterImg"
            >
            <div class="mm-map-card__gradient" />
            <div class="mm-map-card__badges">
              <span class="mm-map-card__rank">#{{ rankNum(i) }}</span>
              <span
                class="mm-tag mm-tag--pill"
                :style="{ borderColor: m.theaterColor, color: m.theaterColor }"
              >
                {{ m.theaterCategory.toUpperCase() }}
              </span>
              <span
                v-if="m.gameId && m.gameId !== 'bf1942'"
                class="mm-tag mm-tag--pill"
                style="border-color: var(--mm-accent); color: var(--mm-accent)"
              >
                [{{ m.gameId.toUpperCase() }}]
              </span>
            </div>
          </div>

          <!-- Card Body -->
          <div class="mm-map-card__body">
            <h4 class="mm-map-card__title">
              {{ m.displayName }}
            </h4>

            <!-- Relative Playtime Bar -->
            <div
              class="mm-map-card__bar-wrap"
              :title="`Playtime: ${formatDuration(m.minutes)}`"
            >
              <div
                class="mm-map-card__bar-fill"
                :style="{
                  width: `${(m.minutes / maxMinutes) * 100}%`,
                  backgroundColor: m.theaterColor,
                }"
              />
            </div>

            <!-- Stats Cluster -->
            <div class="mm-map-card__stats">
              <div class="mm-map-card__stat">
                <span class="mm-stat-label">K/D</span>
                <span
                  class="mm-stat-val"
                  :class="kdClass(m.kd)"
                >{{ m.kd.toFixed(2) }}</span>
              </div>
              <div class="mm-map-card__stat">
                <span class="mm-stat-label">COMBAT TIME</span>
                <span class="mm-stat-val">{{ formatDuration(m.minutes) }}</span>
              </div>
              <div class="mm-map-card__stat">
                <span class="mm-stat-label">KILLS / DEATHS</span>
                <span class="mm-stat-val">
                  <span class="mm-num--kill">{{ formatNumber(m.kills) }}</span>
                  <span class="mm-num__sep">/</span>
                  <span class="mm-num--death">{{ formatNumber(m.deaths) }}</span>
                </span>
              </div>
              <div class="mm-map-card__stat">
                <span class="mm-stat-label">ROUNDS</span>
                <span class="mm-stat-val">{{ formatNumber(m.rounds) }}</span>
              </div>
            </div>

            <div class="mm-map-card__footer">
              <span class="mm-map-card__cta">Inspect Sector Briefing →</span>
            </div>
          </div>
        </article>
      </section>

      <!-- ==================== DENSE ROSTER TABLE VIEW ==================== -->
      <section
        v-else
        class="mm-maps-roster"
      >
        <!-- Desktop Table -->
        <table class="mm-list mm-list--dense mm-tab-table">
          <thead>
            <tr>
              <th style="width: 44px">
                #
              </th>
              <th>Sector</th>
              <th>Theater</th>
              <th class="is-num">
                Playtime
              </th>
              <th class="is-num">
                Rounds
              </th>
              <th class="is-num">
                Kills
              </th>
              <th class="is-num">
                Deaths
              </th>
              <th class="is-num">
                K/D
              </th>
              <th class="is-num">
                Score
              </th>
              <th style="width: 110px" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(m, i) in filteredMaps"
              :key="`row-${m.mapName}`"
              class="mm-roster-row"
              @click="openDossier(m)"
            >
              <td class="mm-list__rank">
                {{ rankNum(i) }}
              </td>
              <td class="mm-list__name-cell">
                <div class="mm-roster-name">
                  <MmMapThumb
                    :game-id="m.gameId || props.game"
                    :map-name="m.mapName"
                    :width="44"
                    class="mm-roster-thumb"
                  />
                  <div>
                    <span class="mm-list__name-primary">{{ m.displayName }}</span>
                    <span
                      v-if="m.gameId && m.gameId !== 'bf1942'"
                      class="mm-card__hint"
                      style="display: block; font-size: 10px; line-height: 1; margin-top: 2px"
                    >[{{ m.gameId.toUpperCase() }}]</span>
                  </div>
                </div>
              </td>
              <td>
                <span
                  class="mm-tag"
                  :style="{ borderColor: m.theaterColor, color: m.theaterColor }"
                >
                  {{ m.theaterCategory }}
                </span>
              </td>
              <td class="is-num">
                {{ formatDuration(m.minutes) }}
              </td>
              <td class="is-num">
                {{ formatNumber(m.rounds) }}
              </td>
              <td class="is-num mm-num--kill">
                {{ formatNumber(m.kills) }}
              </td>
              <td class="is-num mm-num--death">
                {{ formatNumber(m.deaths) }}
              </td>
              <td
                class="is-num"
                :class="kdClass(m.kd)"
              >
                {{ m.kd.toFixed(2) }}
              </td>
              <td class="is-num mm-num--score">
                {{ formatNumber(m.score) }}
              </td>
              <td>
                <span class="mm-eyebrow mm-roster-action">Briefing →</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Expandable Historical Performance Stream -->
      <section class="mm-stream-accordion">
        <button
          type="button"
          class="mm-stream-accordion__toggle"
          @click="showPerformanceStream = !showPerformanceStream"
        >
          <span class="mm-eyebrow mm-eyebrow--strong">Historical Performance Stream</span>
          <span class="mm-eyebrow">
            {{ showPerformanceStream ? '[HIDE STREAM ↑]' : '[EXPAND STREAM ↓]' }}
          </span>
        </button>

        <div
          v-if="showPerformanceStream"
          class="mm-stream-accordion__body"
        >
          <MmMapPerformanceRace
            :player-name="playerName"
            :game="game"
            @navigate-to-map="emit('navigateToMap', $event)"
          />
        </div>
      </section>
    </template>

    <!-- ==================== IN-SITU MAP DOSSIER MODAL ==================== -->
    <MmBaseModal
      v-model="isDossierOpen"
      size="xl"
      no-padding
      @update:model-value="!$event && closeDossier()"
    >
      <div
        v-if="selectedMap"
        class="mm-dossier"
      >
        <!-- Hero Art Banner -->
        <header class="mm-dossier__hero">
          <div
            v-if="selectedMap.artUrl"
            class="mm-dossier__hero-bg"
            :style="{ backgroundImage: `url(${selectedMap.artUrl})` }"
          />
          <div class="mm-dossier__hero-scrim" />

          <div class="mm-dossier__hero-content">
            <div class="mm-dossier__hero-tags">
              <span
                class="mm-badge"
                :style="{
                  borderColor: selectedMap.theaterColor,
                  color: selectedMap.theaterColor,
                  backgroundColor: 'rgba(0, 0, 0, 0.65)'
                }"
              >
                {{ selectedMap.theaterCategory.toUpperCase() }} THEATER
              </span>
            </div>
            <h2 class="mm-display mm-dossier__title">
              {{ selectedMap.displayName }}
            </h2>
            <div class="mm-eyebrow mm-dossier__subtitle">
              Combat Sector Dossier · {{ decodePlayerName(playerName) }}
            </div>
          </div>
        </header>

        <div class="mm-dossier__body">
          <!-- Primary Combat Telemetry Grid -->
          <section class="mm-dossier__stats">
            <div class="mm-dossier__stat-card">
              <span class="mm-stat-label">K/D RATIO</span>
              <span
                class="mm-stat__value mm-stat__value--small"
                :class="kdClass(selectedMap.kd)"
              >
                {{ selectedMap.kd.toFixed(2) }}
              </span>
              <span class="mm-stat__delta">career on sector</span>
            </div>

            <div class="mm-dossier__stat-card">
              <span class="mm-stat-label">PLAYTIME</span>
              <span class="mm-stat__value mm-stat__value--small">
                {{ formatDuration(selectedMap.minutes) }}
              </span>
              <span class="mm-stat__delta">{{ selectedMap.rounds }} rounds</span>
            </div>

            <div class="mm-dossier__stat-card">
              <span class="mm-stat-label">COMBAT SCORE</span>
              <span class="mm-stat__value mm-stat__value--small mm-num--score">
                {{ formatNumber(selectedMap.score) }}
              </span>
              <span class="mm-stat__delta">{{ selectedMap.spm.toFixed(1) }} score/min</span>
            </div>

            <div class="mm-dossier__stat-card">
              <span class="mm-stat-label">KILLS / DEATHS</span>
              <span class="mm-stat__value mm-stat__value--small">
                <span class="mm-num--kill">{{ formatNumber(selectedMap.kills) }}</span>
                <span class="mm-num__sep">/</span>
                <span class="mm-num--death">{{ formatNumber(selectedMap.deaths) }}</span>
              </span>
              <span class="mm-stat__delta">{{ selectedMap.kpr.toFixed(1) }} kills/round</span>
            </div>
          </section>

          <hr
            class="mm-rule"
            style="margin: 24px 0"
          >

          <!-- Deployment By Server Breakdown -->
          <section class="mm-dossier__servers">
            <div class="mm-dossier__sec-head">
              <div class="mm-eyebrow mm-eyebrow--strong">
                Deployment by Server
              </div>
              <div class="mm-card__hint">
                historical combat across tracked rotations
              </div>
            </div>

            <div
              v-if="dossierLoading"
              class="mm-dossier__loading"
            >
              <div
                v-for="i in 3"
                :key="i"
                class="mm-skeleton"
                style="margin-bottom: 8px"
              />
            </div>

            <div
              v-else-if="!dossierData || !dossierData.serverBreakdown || dossierData.serverBreakdown.length === 0"
              class="mm-empty"
              style="padding: 24px 0"
            >
              Aggregated global stats only. No per-server split recorded for this sector.
            </div>

            <table
              v-else
              class="mm-list mm-list--dense"
            >
              <thead>
                <tr>
                  <th>Server</th>
                  <th class="is-num">
                    Rounds
                  </th>
                  <th class="is-num">
                    Time
                  </th>
                  <th class="is-num">
                    Kills
                  </th>
                  <th class="is-num">
                    Deaths
                  </th>
                  <th class="is-num">
                    K/D
                  </th>
                  <th class="is-num">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="s in dossierData.serverBreakdown"
                  :key="s.serverGuid"
                  class="mm-dossier__server-row"
                  @click="goServer(s.serverName)"
                >
                  <td class="mm-list__name-cell">
                    <span class="mm-list__name-primary">{{ decodeServerName(s.serverName) }}</span>
                  </td>
                  <td class="is-num">
                    {{ formatNumber(s.rounds) }}
                  </td>
                  <td class="is-num">
                    {{ formatDuration(s.playTime) }}
                  </td>
                  <td class="is-num mm-num--kill">
                    {{ formatNumber(s.kills) }}
                  </td>
                  <td class="is-num mm-num--death">
                    {{ formatNumber(s.deaths) }}
                  </td>
                  <td
                    class="is-num"
                    :class="kdClass(s.deaths > 0 ? s.kills / s.deaths : s.kills)"
                  >
                    {{ (s.deaths > 0 ? s.kills / s.deaths : s.kills).toFixed(2) }}
                  </td>
                  <td class="is-num mm-num--score">
                    {{ formatNumber(s.score) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <hr
            class="mm-rule"
            style="margin: 24px 0"
          >

          <!-- Level Briefing with Interactive Minimap and Plotted Spawn / Control Points -->
          <section class="mm-dossier__briefing-section">
            <div class="mm-dossier__sec-head">
              <div class="mm-eyebrow mm-eyebrow--strong">
                Level Briefing &amp; Spawn Points
              </div>
              <div class="mm-card__hint">
                control points, order of battle, and vehicle arsenal from level archives
              </div>
            </div>

            <MmMapDossier
              :key="`${selectedMap.gameId || game}/${selectedMap.mapName}`"
              :game-id="selectedMap.gameId || game"
              :map-name="selectedMap.mapName"
              show-placeholders
              hide-heading
            />
          </section>

          <!-- Footer Action Bar -->
          <footer class="mm-dossier__foot">
            <button
              type="button"
              class="mm-btn mm-btn--primary"
              @click="goToFullLeaderboard(selectedMap.mapName, selectedMap.gameId)"
            >
              [OPEN GLOBAL MAP LEADERBOARD →]
            </button>
            <button
              type="button"
              class="mm-btn mm-btn--ghost"
              @click="closeDossier"
            >
              [CLOSE]
            </button>
          </footer>
        </div>
      </div>
    </MmBaseModal>
  </div>
</template>

<style scoped>
.mm-maps-tab {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Hero header */
.mm-maps-tab__hero {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
  padding-bottom: 4px;
}

.mm-maps-tab__hero-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  margin-top: 6px;
  flex-wrap: wrap;
}

/* Tactical Signatures (Home Turf, Stronghold, Nemesis) */
.mm-signatures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

.mm-sig-card {
  position: relative;
  border-radius: 2px;
  border: 1px solid var(--mm-rule-strong);
  background: var(--mm-bg-soft);
  overflow: hidden;
  cursor: pointer;
  min-height: 170px;
  transition: transform 0.12s ease, border-color 0.12s ease, background-color 0.12s ease;
}

.mm-sig-card:hover {
  transform: translateY(-2px);
  background: var(--mm-bg-mute);
}

.mm-sig-card--turf { border-color: rgba(197, 162, 58, 0.4); }
.mm-sig-card--turf:hover { border-color: #c5a23a; }

.mm-sig-card--stronghold { border-color: rgba(125, 136, 73, 0.45); }
.mm-sig-card--stronghold:hover { border-color: var(--mm-accent); }

.mm-sig-card--nemesis { border-color: rgba(214, 90, 90, 0.45); }
.mm-sig-card--nemesis:hover { border-color: var(--mm-kill); }

.mm-sig-card__bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0.22;
  filter: saturate(0.65) contrast(1.1);
  transition: opacity 0.15s ease, transform 0.3s ease;
}

.mm-sig-card:hover .mm-sig-card__bg {
  opacity: 0.34;
  transform: scale(1.03);
}

.mm-sig-card__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, var(--mm-bg-soft) 25%, rgba(19, 19, 19, 0.7) 100%);
}

.mm-sig-card__content {
  position: relative;
  z-index: 1;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.mm-sig-card__badge-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.mm-badge {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  padding: 3px 8px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule);
}

.mm-badge--turf {
  border-color: #c5a23a;
  color: #d8b856;
  background: rgba(197, 162, 58, 0.14);
}

.mm-badge--stronghold {
  border-color: var(--mm-accent);
  color: var(--mm-accent-soft);
  background: rgba(125, 136, 73, 0.16);
}

.mm-badge--nemesis {
  border-color: var(--mm-kill);
  color: #f08080;
  background: rgba(214, 90, 90, 0.14);
}

.mm-tag {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule);
  background: rgba(0, 0, 0, 0.4);
}

.mm-tag--pill {
  border-radius: 2px;
}

.mm-sig-card__title {
  font-family: var(--mm-font-display);
  font-size: 18px;
  font-weight: 500;
  color: var(--mm-ink);
  margin: 0 0 12px;
  line-height: 1.2;
}

.mm-sig-card__metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.mm-sig-metric {
  display: flex;
  flex-direction: column;
}

.mm-sig-metric__label {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-ink-muted);
  letter-spacing: 0.08em;
}

.mm-sig-metric__val {
  font-family: var(--mm-font-display);
  font-size: 14px;
  font-weight: 500;
  color: var(--mm-ink);
  margin-top: 2px;
}

.mm-sig-card__cta {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  margin-top: 10px;
  text-transform: uppercase;
  transition: color 0.12s ease;
}

.mm-sig-card:hover .mm-sig-card__cta {
  color: var(--mm-accent);
}

/* Strategic Theater Distribution */
.mm-theater-bar-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  padding: 14px 18px;
  border-radius: 2px;
}

.mm-theater-bar-section__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.mm-theater-strip {
  display: flex;
  height: 6px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
}

.mm-theater-strip__seg {
  height: 100%;
  transition: opacity 0.12s ease;
}

.mm-theater-strip__seg:hover {
  filter: brightness(1.25);
}

.mm-theater-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.mm-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  padding: 4px 10px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule);
  background: transparent;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: all 0.12s ease;
}

.mm-pill:hover {
  color: var(--mm-ink);
  border-color: var(--mm-rule-strong);
}

.mm-pill.is-active {
  background: var(--mm-bg-mute);
  color: var(--mm-ink);
  border-color: var(--mm-ink);
}

.mm-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

/* Toolbar */
.mm-maps-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding-bottom: 4px;
}

.mm-maps-toolbar__search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 240px;
  max-width: 380px;
}

.mm-maps-toolbar__icon {
  position: absolute;
  left: 10px;
  color: var(--mm-ink-muted);
  pointer-events: none;
}

.mm-maps-toolbar__input {
  width: 100%;
  padding-left: 32px;
  padding-right: 28px;
  height: 34px;
  font-size: 12px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
}

.mm-maps-toolbar__input:focus {
  border-color: var(--mm-accent);
  outline: none;
}

.mm-maps-toolbar__clear {
  position: absolute;
  right: 8px;
  background: transparent;
  border: 0;
  color: var(--mm-ink-muted);
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
}

.mm-maps-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-maps-toolbar__sort {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mm-select {
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 2px;
}

.mm-maps-toolbar__order-btn {
  padding: 4px 8px;
  font-family: var(--mm-font-mono);
  font-size: 12px;
}

.mm-link-inline {
  background: transparent;
  border: 0;
  color: var(--mm-accent);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}

.mm-link-inline:hover {
  text-decoration: underline;
}

/* Tactical Cards Grid */
.mm-maps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 14px;
}

.mm-map-card {
  display: flex;
  flex-direction: column;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease;
}

.mm-map-card:hover {
  transform: translateY(-2px);
  border-color: var(--mm-ink-muted);
}

.mm-map-card__banner {
  position: relative;
  height: 110px;
  background: var(--mm-bg-mute);
  overflow: hidden;
}

.mm-map-card__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.mm-map-card:hover .mm-map-card__img {
  transform: scale(1.04);
}

.mm-map-card__gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, var(--mm-bg-soft) 0%, rgba(0, 0, 0, 0.4) 60%, rgba(0, 0, 0, 0.7) 100%);
}

.mm-map-card__badges {
  position: absolute;
  top: 8px;
  left: 10px;
  right: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 1;
}

.mm-map-card__rank {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  background: rgba(0, 0, 0, 0.65);
  color: var(--mm-ink-soft);
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.mm-map-card__body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.mm-map-card__title {
  font-family: var(--mm-font-display);
  font-size: 16px;
  font-weight: 500;
  color: var(--mm-ink);
  margin: 0 0 8px;
  line-height: 1.25;
}

.mm-map-card__bar-wrap {
  width: 100%;
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 1px;
  margin-bottom: 12px;
  overflow: hidden;
}

.mm-map-card__bar-fill {
  height: 100%;
  border-radius: 1px;
}

.mm-map-card__stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 14px;
}

.mm-map-card__stat {
  display: flex;
  flex-direction: column;
}

.mm-stat-label {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
}

.mm-stat-val {
  font-family: var(--mm-font-display);
  font-size: 14px;
  font-weight: 500;
  color: var(--mm-ink);
  margin-top: 2px;
}

.mm-map-card__footer {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--mm-rule);
}

.mm-map-card__cta {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  transition: color 0.12s ease;
}

.mm-map-card:hover .mm-map-card__cta {
  color: var(--mm-accent);
}

/* Dense Roster Table */
.mm-maps-roster {
  overflow-x: auto;
}

.mm-roster-row {
  cursor: pointer;
}

.mm-roster-name {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mm-roster-thumb {
  width: 44px;
  height: 26px;
  object-fit: cover;
  border-radius: 2px;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg-mute);
  flex-shrink: 0;
}

.mm-roster-action {
  color: var(--mm-ink-muted);
  transition: color 0.12s ease;
}

.mm-roster-row:hover .mm-roster-action {
  color: var(--mm-accent);
}

/* Historical Stream Accordion */
.mm-stream-accordion {
  border-top: 1px solid var(--mm-rule);
  padding-top: 16px;
  margin-top: 12px;
}

.mm-stream-accordion__toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: transparent;
  border: 0;
  padding: 8px 0;
  cursor: pointer;
  color: var(--mm-ink);
}

.mm-stream-accordion__body {
  margin-top: 14px;
  padding: 16px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

/* In-Situ Dossier Modal */
.mm-dossier {
  display: flex;
  flex-direction: column;
}

.mm-dossier__hero {
  position: relative;
  min-height: 160px;
  background: var(--mm-bg-mute);
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  padding: 24px 28px;
}

.mm-dossier__hero-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0.45;
  filter: saturate(0.8);
}

.mm-dossier__hero-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, var(--mm-bg) 0%, rgba(19, 19, 19, 0.75) 60%, rgba(19, 19, 19, 0.3) 100%);
}

.mm-dossier__hero-content {
  position: relative;
  z-index: 1;
}

.mm-dossier__hero-tags {
  margin-bottom: 8px;
}

.mm-dossier__title {
  font-size: clamp(24px, 3vw, 36px);
  margin: 0 0 4px;
}

.mm-dossier__subtitle {
  color: var(--mm-ink-muted);
}

.mm-dossier__body {
  padding: 20px 28px 24px;
}

.mm-dossier__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
}

.mm-dossier__stat-card {
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  padding: 12px 14px;
  border-radius: 2px;
  display: flex;
  flex-direction: column;
}

.mm-dossier__sec-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 12px;
}

.mm-dossier__server-row {
  cursor: pointer;
}

.mm-dossier__server-row:hover .mm-list__name-primary {
  color: var(--mm-accent);
}

.mm-dossier__foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--mm-rule);
}
</style>
