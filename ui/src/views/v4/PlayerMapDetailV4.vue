<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { decodePlayerName } from '@/utils/playerName'
import { getMapTheater } from '@/composables/useMapTheater'
import { resolveMapArt } from '@/utils/bf1942MapArt'
import { mapImageUrl } from '@/utils/mapImage'
import MmMapRankingsPanel from '@/components/v4/MmMapRankingsPanel.vue'
import MmMapDossier from '@/components/v4/MmMapDossier.vue'

const props = defineProps<{
  playerName?: string
  mapName?: string
}>()

const route = useRoute()

const rawName = computed(() => {
  const nameParam = props.playerName || (route.params.playerName as string) || ''
  return nameParam ? decodeURIComponent(nameParam) : ''
})

const displayName = computed(() => (rawName.value ? decodePlayerName(rawName.value) : ''))

const currentMapName = computed(() => {
  const mapParam = props.mapName || (route.params.mapName as string) || ''
  return mapParam ? decodeURIComponent(mapParam) : ''
})

function detectMod(map: string): string {
  const m = map.toLowerCase().replace(/[\s_-]+/g, '_')
  if (m.startsWith('dc_') || m.startsWith('dc ')) return 'dc_final'
  if (['baytown', 'cassino', 'husky', 'huskies', 'salerno', 'santo_croce', 'santa_croce', 'ancona'].includes(m)) return 'xpack1'
  if (['eagles_nest', 'essen', 'gothic_line', 'hellendoorn', 'kbely_airfield', 'mimoyecques', 'peenemunde', 'raid_on_agheila', 'telemark'].includes(m)) return 'xpack2'
  if (m.startsWith('fh_') || m.startsWith('fhsw_')) return 'fhsw'
  if (m.startsWith('eod_')) return 'eod'
  return 'bf1942'
}

// Mod identifier: from route query (e.g. ?game=xpack1), inferred from map, or default to bf1942
const game = computed(() => {
  const q = (route.query.game as string) || ''
  if (q.trim()) return q.trim()
  return detectMod(currentMapName.value)
})

const theater = computed(() => getMapTheater(currentMapName.value, game.value))
const art = computed(() => resolveMapArt(currentMapName.value))

const formattedMapTitle = computed(() => {
  if (art.value?.displayName) return art.value.displayName
  if (!currentMapName.value) return 'Map'
  return currentMapName.value
    .replace(/[_-]/g, ' ')
    .replace(/\b[a-z]/g, c => c.toUpperCase())
})

const heroBg = computed(() => {
  const slug = art.value?.slug || currentMapName.value
  return (
    mapImageUrl(game.value, slug, 'thumbnail') ||
    mapImageUrl(game.value, slug, 'minimap') ||
    mapImageUrl(game.value, currentMapName.value, 'thumbnail') ||
    mapImageUrl(game.value, currentMapName.value, 'minimap') ||
    art.value?.ingame ||
    theater.value?.imageUrl ||
    null
  )
})

const theaterColor = computed(() => {
  const cat = theater.value?.theaterCategory
  switch (cat) {
    case 'Pacific': return '#4a8bad'
    case 'North Africa': return '#c5a23a'
    case 'Eastern Front': return '#b84545'
    case 'Western Europe': return '#7d8849'
    case 'Mediterranean': return '#38989b'
    case 'Secret Weapons': return '#8a65a3'
    case 'Desert Combat': return '#d46f2d'
    default: return '#777777'
  }
})

// Collapsible level briefing
const showBriefing = ref(true)
</script>

<template>
  <div class="mm-container mm-section mm-map-leaderboard">
    <!-- Breadcrumbs -->
    <div class="mm-meta-row mm-map-leaderboard__nav">
      <router-link
        v-if="rawName"
        :to="`/v4/players/${encodeURIComponent(rawName)}?tab=maps`"
        class="mm-meta-row__strong mm-map-leaderboard__back"
      >
        ‹ {{ displayName }} · MAPS
      </router-link>
      <router-link
        v-else
        to="/v4/leaderboard"
        class="mm-meta-row__strong mm-map-leaderboard__back"
      >
        ‹ GLOBAL LEADERBOARD
      </router-link>
    </div>

    <!-- Hero Tactical Banner -->
    <header class="mm-hero-card">
      <div
        v-if="heroBg"
        class="mm-hero-card__bg"
        :style="{ backgroundImage: `url(${heroBg})` }"
      />
      <div class="mm-hero-card__scrim" />

      <div class="mm-hero-card__content">
        <div class="mm-hero-card__badges">
          <span
            v-if="theater"
            class="mm-badge"
            :style="{
              borderColor: theaterColor,
              color: theaterColor,
              backgroundColor: 'rgba(0, 0, 0, 0.65)'
            }"
          >
            {{ theater.theaterCategory.toUpperCase() }} THEATER
          </span>

          <span
            v-if="game && game !== 'bf1942'"
            class="mm-badge"
            style="border-color: var(--mm-accent); color: var(--mm-accent); background-color: rgba(0, 0, 0, 0.65)"
          >
            [{{ game.toUpperCase() }}]
          </span>
        </div>

        <h1 class="mm-display mm-hero-card__title">
          {{ formattedMapTitle }}
        </h1>

        <div class="mm-eyebrow mm-hero-card__subtitle">
          <template v-if="rawName">
            Sector Engagement Ladder · Tracking <mark class="mm-hero-card__player-mark">{{ displayName }}</mark>
          </template>
          <template v-else>
            Sector Engagement Ladder · Battlefield 1942 Telemetry
          </template>
        </div>
      </div>
    </header>

    <!-- Engagement Ladder / Player Rankings (shown first above map details) -->
    <section class="mm-map-leaderboard__rankings">
      <MmMapRankingsPanel
        :map-name="currentMapName"
        :game="(game as any)"
        :highlight-player="rawName || undefined"
      />
    </section>

    <hr
      class="mm-rule"
      style="margin: 28px 0;"
    >

    <!-- Tactical Intel & Level Briefing Section -->
    <section class="mm-map-briefing-panel">
      <header class="mm-map-briefing-panel__head">
        <div>
          <div class="mm-eyebrow mm-eyebrow--strong">
            Tactical Intel &amp; Spawn Points
          </div>
          <div class="mm-card__hint">
            control points, order of battle, and vehicle arsenal extracted from level archives
          </div>
        </div>

        <button
          type="button"
          class="mm-btn mm-btn--inline"
          @click="showBriefing = !showBriefing"
        >
          {{ showBriefing ? '[HIDE BRIEFING ↑]' : '[SHOW BRIEFING ↓]' }}
        </button>
      </header>

      <div
        v-if="showBriefing"
        class="mm-map-briefing-panel__body"
      >
        <MmMapDossier
          :key="`${game}/${currentMapName}`"
          :game-id="game"
          :map-name="currentMapName"
          show-placeholders
          hide-heading
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.mm-map-leaderboard {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.mm-map-leaderboard__nav {
  margin-bottom: 2px;
}

.mm-map-leaderboard__back {
  text-decoration: underline;
  text-underline-offset: 3px;
  color: var(--mm-ink);
  font-family: var(--mm-font-mono, monospace);
  font-size: 12px;
  letter-spacing: 0.04em;
  transition: opacity 0.15s ease;
}

.mm-map-leaderboard__back:hover {
  opacity: 0.75;
}

/* Hero Tactical Banner (matched to player briefing modal) */
.mm-hero-card {
  position: relative;
  min-height: 160px;
  display: flex;
  align-items: flex-end;
  padding: 24px 28px;
  background: var(--mm-bg-mute, #1a1a1a);
  border: 1px solid var(--mm-rule, var(--mm-border));
  overflow: hidden;
}

.mm-hero-card__bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0.45;
  filter: saturate(0.8);
}

.mm-hero-card__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    var(--mm-bg, #131313) 0%,
    rgba(19, 19, 19, 0.75) 60%,
    rgba(19, 19, 19, 0.3) 100%
  );
}

.mm-hero-card__content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mm-hero-card__badges {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mm-badge {
  display: inline-flex;
  align-items: center;
  font-family: var(--mm-font-mono, monospace);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  padding: 3px 8px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule);
  background: rgba(0, 0, 0, 0.65);
  line-height: 1.4;
}

.mm-hero-card__title {
  margin: 0;
  font-size: clamp(24px, 3vw, 36px);
  line-height: 1.1;
  color: var(--mm-ink);
}

.mm-hero-card__subtitle {
  color: var(--mm-ink-muted, var(--mm-muted));
  font-size: 11px;
}

.mm-hero-card__player-mark {
  display: inline;
  font-family: var(--mm-font-mono, monospace);
  font-weight: 700;
  font-style: normal;
  letter-spacing: 0.02em;
  color: var(--mm-highlight-ink, #000000);
  background: var(--mm-highlight, #847d4c);
  padding: 0.06em 0.34em 0.08em;
  margin: 0 0.15em;
  border-radius: 2px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

/* Tactical Intel Panel */
.mm-map-briefing-panel {
  background: var(--mm-surface);
  border: 1px solid var(--mm-border);
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mm-map-briefing-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.mm-map-briefing-panel__body {
  padding-top: 8px;
}

@media (max-width: 720px) {
  .mm-hero-card {
    padding: 18px 16px;
    min-height: 150px;
  }

  .mm-map-briefing-panel {
    padding: 16px;
  }
}
</style>
