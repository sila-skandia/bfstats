<template>
  <section
    v-if="entries.length > 0"
    class="yf-strip"
    aria-label="Your recently visited servers"
  >
    <header class="yf-strip__head">
      <span class="yf-strip__label">YOUR FRONT</span>
      <span class="yf-strip__sub">Servers you've been to · pinned by this browser</span>
    </header>
    <div class="yf-strip__rail">
      <router-link
        v-for="entry in entries"
        :key="entry.guid"
        :to="`/servers/${encodeURIComponent(entry.name)}`"
        class="yf-card"
        :class="{ 'yf-card--live': liveFor(entry.guid)?.numPlayers ?? 0 > 0 }"
      >
        <div class="yf-card__head">
          <span class="yf-card__dot" aria-hidden="true" />
          <span class="yf-card__game">{{ entry.game.toUpperCase() }}</span>
          <button
            type="button"
            class="yf-card__forget"
            aria-label="Forget this server"
            @click.prevent="$emit('forget', entry.guid)"
          >×</button>
        </div>
        <div class="yf-card__name">{{ entry.name }}</div>
        <div class="yf-card__meta">
          <template v-if="liveFor(entry.guid)">
            <button
              type="button"
              class="yf-card__players"
              @click.prevent="$emit('show-players', entry.guid)"
            >
              <strong>{{ liveFor(entry.guid)!.numPlayers }}</strong>/{{ liveFor(entry.guid)!.maxPlayers }}
            </button>
            <span class="yf-card__sep" aria-hidden="true">·</span>
            <span class="yf-card__map">{{ liveFor(entry.guid)!.mapName || '—' }}</span>
          </template>
          <template v-else>
            <span class="yf-card__offline">offline</span>
          </template>
        </div>
        <div
          v-if="liveFor(entry.guid) && liveFor(entry.guid)!.maxPlayers > 0"
          class="yf-card__bar"
          aria-hidden="true"
        >
          <div
            class="yf-card__fill"
            :style="{ width: fillPercent(entry.guid) + '%' }"
          />
        </div>
        <div class="yf-card__foot">
          Last visit · {{ formatLastVisit(entry.lastVisitedAt) }}
        </div>
      </router-link>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { VisitedServerRecord } from '@/composables/useVisitedServers'
import type { ServerSummary } from '@/types/server'

const props = defineProps<{
  entries: VisitedServerRecord[]
  liveServers: ServerSummary[]
}>()

defineEmits<{
  'forget': [guid: string]
  'show-players': [server: string]
}>()

const liveByGuid = computed(() => {
  const map = new Map<string, ServerSummary>()
  for (const s of props.liveServers) {
    map.set(s.guid, s)
  }
  return map
})

const liveFor = (guid: string) => liveByGuid.value.get(guid)

const fillPercent = (guid: string): number => {
  const s = liveByGuid.value.get(guid)
  if (!s || !s.maxPlayers) return 0
  return Math.min(100, Math.round((s.numPlayers / s.maxPlayers) * 100))
}

const formatLastVisit = (iso: string): string => {
  try {
    const ms = Date.now() - new Date(iso).getTime()
    const mins = Math.round(ms / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.round(hrs / 24)
    return `${days}d ago`
  } catch {
    return '—'
  }
}
</script>

<style scoped>
.yf-strip {
  margin: 1rem 0 1.25rem;
}
.yf-strip__head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  padding: 0 0.25rem;
}
.yf-strip__label {
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: var(--portal-accent);
  font-weight: 700;
}
.yf-strip__sub {
  font-size: 0.72rem;
  color: var(--portal-text);
  opacity: 0.75;
}
.yf-strip__rail {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(240px, 1fr);
  gap: 0.75rem;
  overflow-x: auto;
  padding: 0.25rem;
  scroll-snap-type: x mandatory;
}
@media (min-width: 768px) {
  .yf-strip__rail {
    grid-auto-columns: minmax(280px, 1fr);
  }
}
.yf-card {
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem 0.85rem;
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
  border-radius: 8px;
  text-decoration: none;
  color: var(--portal-text-bright);
  position: relative;
  transition: border-color 0.15s ease, transform 0.15s ease;
  min-width: 0;
}
.yf-card:hover {
  border-color: var(--portal-accent);
  transform: translateY(-1px);
}
.yf-card--live::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 8px;
  pointer-events: none;
  box-shadow: 0 0 0 1px var(--portal-accent-dim), 0 0 14px var(--portal-accent-glow);
}
.yf-card__head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.68rem;
  letter-spacing: 0.14em;
}
.yf-card__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--portal-text);
}
.yf-card--live .yf-card__dot {
  background: var(--portal-success);
  box-shadow: 0 0 6px var(--portal-success);
}
.yf-card__game {
  color: var(--portal-accent);
  font-weight: 600;
}
.yf-card__forget {
  margin-left: auto;
  background: transparent;
  border: 0;
  color: var(--portal-text);
  font-size: 1rem;
  cursor: pointer;
  line-height: 1;
  padding: 0 0.25rem;
}
.yf-card__forget:hover {
  color: var(--portal-danger);
}
.yf-card__name {
  font-size: 0.95rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.yf-card__meta {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: var(--portal-text);
  min-width: 0;
}
.yf-card__players {
  background: transparent;
  border: 0;
  padding: 0;
  font-family: inherit;
  font-size: 0.78rem;
  color: var(--portal-text);
  cursor: pointer;
}
.yf-card__players strong {
  color: var(--portal-text-bright);
  font-weight: 700;
}
.yf-card__players:hover strong {
  color: var(--portal-accent);
}
.yf-card__sep {
  opacity: 0.5;
}
.yf-card__map {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.yf-card__offline {
  font-size: 0.72rem;
  color: var(--portal-text);
  opacity: 0.55;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.yf-card__bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
  overflow: hidden;
}
.yf-card__fill {
  height: 100%;
  background: linear-gradient(90deg, var(--portal-accent), var(--portal-success));
}
.yf-card__foot {
  font-size: 0.68rem;
  color: var(--portal-text);
  opacity: 0.6;
}
</style>
