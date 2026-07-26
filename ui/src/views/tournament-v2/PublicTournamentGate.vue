<template>
  <!-- V2 league layout -->
  <PublicTournamentShellV2
    v-if="!loading && !error && tournament && isV2"
    :tournament="tournament"
    :tournament-id="tournamentId"
    :section="section"
    :hero-image-url="heroImageUrl"
    :logo-image-url="logoImageUrl"
    @refresh="loadTournament"
  />

  <!-- Legacy layout: untouched original views (they re-read from the tournament cache) -->
  <component
    :is="legacyComponent"
    v-else-if="!loading && !error && tournament"
  />

  <!-- Loading -->
  <div
    v-else-if="loading"
    class="t2 t2-loading"
    :style="defaultVars"
  >
    <div class="t2-spinner" />
  </div>

  <!-- Error -->
  <div
    v-else
    class="t2"
    :style="defaultVars"
    style="display: grid; place-items: center; min-height: 100vh"
  >
    <div style="text-align: center; padding: 24px">
      <div
        class="t2-eyebrow"
        style="margin-bottom: 14px"
      >
        Tournament not found
      </div>
      <p style="color: var(--t-muted); font-size: 14px; max-width: 44ch">
        {{ error }}
      </p>
      <router-link
        to="/servers"
        class="t2-btn t2-btn--outline"
        style="margin-top: 22px"
      >
        Browse servers
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, defineAsyncComponent } from 'vue'
import { usePublicTournamentPage } from '@/composables/usePublicTournamentPage'
import { notificationService } from '@/services/notificationService'
import PublicTournamentShellV2, { type T2Section } from './PublicTournamentShellV2.vue'

const props = defineProps<{ section: T2Section }>()

const { tournament, loading, error, heroImageUrl, logoImageUrl, tournamentId, loadTournament } = usePublicTournamentPage()

const isV2 = computed(() => tournament.value?.layoutVersion === 2)

// Neutral warm-dark vars for states rendered before any theme is known
const defaultVars = { '--t-bg': '#14100c', '--t-text': '#f2ece0', '--t-accent': '#c8a24a' }

// Legacy views loaded lazily so v2 tournaments never pull their chunks.
const legacyViews: Record<T2Section, ReturnType<typeof defineAsyncComponent>> = {
  overview: defineAsyncComponent(() => import('@/views/PublicTournament.vue')),
  rankings: defineAsyncComponent(() => import('@/views/PublicTournamentRankings.vue')),
  matches: defineAsyncComponent(() => import('@/views/PublicTournamentMatches.vue')),
  rules: defineAsyncComponent(() => import('@/views/PublicTournamentRules.vue')),
  teams: defineAsyncComponent(() => import('@/views/PublicTournamentTeams.vue')),
  files: defineAsyncComponent(() => import('@/views/PublicTournamentFiles.vue')),
  stats: defineAsyncComponent(() => import('@/views/PublicTournamentStats.vue')),
}

const legacyComponent = computed(() => legacyViews[props.section])

const SECTION_TITLES: Record<T2Section, string> = {
  overview: '',
  rankings: 'Rankings - ',
  matches: 'Matches - ',
  rules: 'Rules - ',
  teams: 'Teams - ',
  files: 'Files - ',
  stats: 'Stats - ',
}

// V2 owns the title; legacy views keep setting their own.
watch([tournament, () => props.section], ([t]) => {
  if (t && isV2.value) {
    document.title = `${SECTION_TITLES[props.section]}${t.name} - BF Stats`
    notificationService.updateOriginalTitle()
  }
}, { immediate: true })
</script>

<style src="@/styles/tournament-v2.css"></style>
