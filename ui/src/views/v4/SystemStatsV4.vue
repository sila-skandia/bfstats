<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import axios from 'axios'
import { parseUtc } from '@/utils/timeUtils'

interface SystemStats {
  sqliteMetrics: {
    serversTracked: number
    playersTracked: number
  }
  generatedAt: string
}

const stats = ref<SystemStats | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const lastUpdate = ref<Date | null>(null)
const now = ref(Date.now())

const REFRESH_INTERVAL_MS = 5 * 60_000
let refreshTimer: number | undefined
let tickTimer: number | undefined

const fetchStats = async () => {
  const wasInitialLoad = !stats.value
  if (wasInitialLoad) loading.value = true
  error.value = null
  try {
    const { data } = await axios.get<SystemStats>('/stats/app/systemstats')
    stats.value = data
    lastUpdate.value = new Date()
  } catch (err) {
    console.error('Failed to fetch system stats:', err)
    error.value = err instanceof Error ? err.message : 'Failed to fetch system statistics'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void fetchStats()
  refreshTimer = window.setInterval(() => void fetchStats(), REFRESH_INTERVAL_MS)
  tickTimer = window.setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  if (tickTimer) window.clearInterval(tickTimer)
})

const formatNumber = (n: number) => n.toLocaleString()

const formatTimestamp = (iso: string): string => {
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const secondsUntilRefresh = computed(() => {
  if (!lastUpdate.value) return 0
  const elapsed = now.value - lastUpdate.value.getTime()
  return Math.max(0, Math.ceil((REFRESH_INTERVAL_MS - elapsed) / 1000))
})

const refreshLabel = computed(() => {
  const s = secondsUntilRefresh.value
  if (s <= 0) return 'refreshing…'
  const m = Math.floor(s / 60)
  const rem = s % 60
  return m > 0 ? `${m}m ${rem.toString().padStart(2, '0')}s` : `${rem}s`
})

const REFRESH_RING_CIRCUMFERENCE = 2 * Math.PI * 6
const refreshProgress = computed(() => {
  if (!lastUpdate.value) return 0
  const elapsed = now.value - lastUpdate.value.getTime()
  return Math.min(1, Math.max(0, elapsed / REFRESH_INTERVAL_MS))
})
</script>

<template>
  <div class="mm-container mm-section">
    <div class="mm-meta-row" style="margin-bottom: 14px">
      <span class="mm-chip"><span class="mm-chip__dot" />System</span>
      <span class="mm-meta-row__sep">·</span>
      <span>Operational metrics</span>
      <span v-if="lastUpdate" class="mm-meta-row__sep">·</span>
      <span
        v-if="lastUpdate"
        class="mm-system__refresh"
        :title="`Next refresh in ${refreshLabel}`"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--mm-rule)" stroke-width="1.5" />
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="var(--mm-accent)"
            stroke-width="1.5"
            stroke-linecap="round"
            :stroke-dasharray="REFRESH_RING_CIRCUMFERENCE"
            :stroke-dashoffset="REFRESH_RING_CIRCUMFERENCE * (1 - refreshProgress)"
            transform="rotate(-90 8 8)"
          />
        </svg>
        <span>{{ refreshLabel }}</span>
      </span>
    </div>

    <h1 class="mm-display">System</h1>

    <hr class="mm-rule" style="margin-top: 28px" />

    <div v-if="loading && !stats" style="padding: 32px 0">
      <div v-for="i in 3" :key="i" class="mm-skeleton" style="margin-bottom: 12px" />
    </div>

    <div v-else-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="fetchStats">Retry</button>
    </div>

    <template v-else-if="stats">
      <div class="mm-stats" style="border-top: 0; margin-top: 0">
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Servers tracked</div>
          <div class="mm-stat__value">{{ formatNumber(stats.sqliteMetrics.serversTracked) }}</div>
          <div class="mm-stat__delta">unique game hosts monitored</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Players tracked</div>
          <div class="mm-stat__value">{{ formatNumber(stats.sqliteMetrics.playersTracked) }}</div>
          <div class="mm-stat__delta">unique players observed</div>
        </div>
      </div>

      <hr class="mm-rule" style="margin-top: 24px; margin-bottom: 24px" />

      <div class="mm-system__panels">
        <section>
          <h2 class="mm-eyebrow">About this system</h2>
          <ul class="mm-system__list">
            <li>Server feeds scraped every 30 seconds via <a href="https://bflist.io/" target="_blank" rel="noopener noreferrer">bflist.io</a>.</li>
            <li>SQLite operational + analytics store; aggregates refresh on a fixed cadence.</li>
            <li>Built entirely with AI/LLMs as a long-running prompt-engineering experiment.</li>
            <li><a href="https://github.com/sila-skandia/bfstats" target="_blank" rel="noopener noreferrer">Source on GitHub</a>.</li>
          </ul>
        </section>

        <section>
          <h2 class="mm-eyebrow">Feedback</h2>
          <p>Found a bug or have a suggestion? The Discord is the fastest line.</p>
          <p style="margin-top: 8px">
            <a href="https://discord.gg/6saqqTTYEM" target="_blank" rel="noopener noreferrer" class="mm-btn">Join Discord</a>
          </p>
        </section>

        <section>
          <h2 class="mm-eyebrow">Credits</h2>
          <p>
            <strong>Data:</strong>
            <a href="https://bflist.io/" target="_blank" rel="noopener noreferrer">bflist.io</a>
            — thanks to
            <a href="https://github.com/sponsors/cetteup" target="_blank" rel="noopener noreferrer">cetteup</a>
            for the APIs and quick replies.
          </p>
          <p style="margin-top: 10px"><strong>Early feedback:</strong></p>
          <ul class="mm-system__list mm-system__list--inline">
            <li><router-link to="/v4/players/pada">pada</router-link></li>
            <li><router-link to="/v4/players/tragic!">tragic!</router-link></li>
            <li><router-link to="/v4/players/Black%20Mamba">Black Mamba</router-link></li>
          </ul>
          <p style="margin-top: 10px">
            <strong>Special recognition:</strong>
            <router-link to="/v4/players/Black%20Mamba">Black Mamba</router-link>
            for originating the tournaments concept.
          </p>
        </section>
      </div>

      <p class="mm-card__hint" style="margin-top: 24px; text-align: center">
        Last updated {{ formatTimestamp(stats.generatedAt) }} · next refresh in {{ refreshLabel }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.mm-system__refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.mm-system__refresh svg circle:last-child {
  transition: stroke-dashoffset 1s linear;
}

.mm-system__panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 28px;
  align-items: start;
}

.mm-system__panels section {
  border-top: 1px solid var(--mm-rule);
  padding-top: 12px;
}

.mm-system__panels h2 {
  margin: 0 0 10px 0;
}

.mm-system__panels p {
  margin: 0;
  color: var(--mm-ink);
  line-height: 1.55;
}

.mm-system__panels a {
  color: var(--mm-ink);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.mm-system__panels a:hover {
  color: var(--mm-accent);
}

.mm-system__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mm-system__list li {
  position: relative;
  padding-left: 14px;
  color: var(--mm-ink);
  line-height: 1.55;
}

.mm-system__list li::before {
  content: '·';
  position: absolute;
  left: 2px;
  top: 0;
  color: var(--mm-ink-soft);
}

.mm-system__list--inline {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.mm-system__list--inline li {
  padding-left: 0;
}

.mm-system__list--inline li::before {
  content: '';
}
</style>
