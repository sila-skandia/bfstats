<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerCommunity } from '@/services/playerRelationshipsApi'
import { formatDistanceToNow } from 'date-fns'
import { parseUtc, formatLocalTooltip } from '@/utils/timeUtils'

const props = defineProps<{
  community: PlayerCommunity
  // Position in the surrounding grid. Drives which of the four sanctioned
  // accent tokens the card wears so a wall of squads doesn't read as one
  // grey block. Falls back to a hash of the id when unset, which keeps a
  // card's colour stable even when it's rendered on its own.
  accentIndex?: number
}>()

const cohesionPercentage = computed(() => Math.round(props.community.cohesionScore * 100))

const ACCENT_COUNT = 4
const accentClass = computed(() => {
  if (props.accentIndex != null) return `mm-comm--a${props.accentIndex % ACCENT_COUNT}`
  let h = 0
  for (const ch of props.community.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `mm-comm--a${h % ACCENT_COUNT}`
})

const formatDate = (dateStr: string) => {
  const d = parseUtc(dateStr)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}

const statusLabel = computed(() => {
  if (!props.community.isActive) return 'Inactive'
  if (props.community.cohesionScore >= 0.7) return 'Tight-knit'
  if (props.community.cohesionScore >= 0.5) return 'Active'
  return 'Emerging'
})

const statusChipClass = computed(() => {
  if (!props.community.isActive) return 'mm-chip--off'
  if (props.community.cohesionScore >= 0.7) return 'mm-chip--accent'
  return ''
})
</script>

<template>
  <article class="mm-comm" :class="accentClass">
    <header class="mm-comm__head">
      <div class="mm-comm__head-text">
        <div class="mm-eyebrow mm-comm__eyebrow">Community</div>
        <h3 class="mm-h2 mm-comm__name">{{ community.name }}</h3>
        <p class="mm-card__hint" style="margin: 4px 0 0; font-family: var(--mm-font-mono); font-size: 10.5px">
          {{ community.id }}
        </p>
      </div>
      <span class="mm-chip" :class="statusChipClass">
        <span class="mm-chip__dot" />
        {{ statusLabel }}
      </span>
    </header>

    <hr class="mm-rule" />

    <div class="mm-comm__stats">
      <div class="mm-comm__stat">
        <div class="mm-stat__value mm-stat__value--small">{{ community.memberCount }}</div>
        <div class="mm-stats__label">Members</div>
      </div>
      <div class="mm-comm__stat">
        <div class="mm-stat__value mm-stat__value--small mm-comm__cohesion">{{ cohesionPercentage }}<span class="mm-stat__suffix">%</span></div>
        <div class="mm-stats__label">Cohesion</div>
      </div>
      <div class="mm-comm__stat">
        <div class="mm-stat__value mm-stat__value--small">{{ community.avgSessionsPerPair.toFixed(1) }}</div>
        <div class="mm-stats__label">Avg sessions</div>
      </div>
      <div class="mm-comm__stat">
        <div class="mm-stat__value mm-stat__value--small">{{ community.primaryServers.length }}</div>
        <div class="mm-stats__label">Servers</div>
      </div>
    </div>

    <div class="mm-comm__meter" :aria-label="`Cohesion ${cohesionPercentage}%`">
      <span class="mm-comm__meter-fill" :style="{ width: `${cohesionPercentage}%` }" />
    </div>

    <div v-if="community.coreMembers.length > 0" class="mm-comm__section">
      <div class="mm-eyebrow">Core members</div>
      <div class="mm-comm__chips">
        <router-link
          v-for="member in community.coreMembers.slice(0, 5)"
          :key="member"
          :to="`/v4/players/${encodeURIComponent(member)}`"
          class="mm-comm__member"
        >
          {{ $pn(member) }}
        </router-link>
        <span v-if="community.coreMembers.length > 5" class="mm-eyebrow">+{{ community.coreMembers.length - 5 }}</span>
      </div>
    </div>

    <div v-if="community.primaryServers.length > 0" class="mm-comm__section">
      <div class="mm-eyebrow">Primary servers</div>
      <ul class="mm-comm__servers">
        <li v-for="(name, idx) in community.primaryServers.slice(0, 3)" :key="idx">{{ name }}</li>
      </ul>
    </div>

    <hr class="mm-rule" />

    <div class="mm-comm__dates">
      <div>
        <div class="mm-eyebrow">Formed</div>
        <div class="mm-comm__date-value">{{ formatDate(community.formationDate) }}</div>
      </div>
      <div>
        <div class="mm-eyebrow">Last active</div>
        <div class="mm-comm__date-value" :title="formatLocalTooltip(community.lastActiveDate)">{{ formatDistanceToNow(parseUtc(community.lastActiveDate), { addSuffix: true }) }}</div>
      </div>
    </div>

    <router-link :to="`/communities/${encodeURIComponent(community.id)}`" class="mm-btn mm-comm__cta">
      View community →
    </router-link>
  </article>
</template>

<style scoped>
/* Per-card accent. Every value is an existing --mm-* token; the variants
   only decide which one this card wears. color-mix derives the wash and
   the hover tint so no new hex enters the palette. */
.mm-comm { --comm-accent: var(--mm-accent); }
.mm-comm--a0 { --comm-accent: var(--mm-accent); }
.mm-comm--a1 { --comm-accent: var(--mm-load-busy); }
.mm-comm--a2 { --comm-accent: var(--mm-kill); }
.mm-comm--a3 { --comm-accent: var(--mm-success); }

.mm-comm {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--mm-rule-strong);
  border-top: 2px solid var(--comm-accent);
  border-radius: 2px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--comm-accent) 9%, transparent) 0%,
      transparent 140px
    );
}

.mm-comm__eyebrow { color: var(--comm-accent); }

.mm-comm__cohesion { color: var(--comm-accent); }

.mm-comm__meter {
  position: relative;
  height: 4px;
  background: var(--mm-bg-mute);
  border-radius: 2px;
  overflow: hidden;
}

.mm-comm__meter-fill {
  display: block;
  height: 100%;
  background: var(--comm-accent);
}

.mm-comm__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.mm-comm__head-text { min-width: 0; }

.mm-comm__name {
  margin: 4px 0 0;
  font-size: 22px;
  word-break: break-word;
}

.mm-comm__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border-top: 1px solid var(--mm-rule);
  border-bottom: 1px solid var(--mm-rule);
}

.mm-comm__stat {
  padding: 14px 12px 14px 0;
  border-right: 1px solid var(--mm-rule);
}
.mm-comm__stat:last-child { border-right: 0; }
.mm-comm__stat + .mm-comm__stat { padding-left: 12px; }

.mm-comm__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mm-comm__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.mm-comm__member {
  display: inline-flex;
  align-items: center;
  font-family: var(--mm-font-display);
  font-size: 12.5px;
  padding: 4px 10px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  transition: border-color 0.12s ease, color 0.12s ease;
}

.mm-comm__member:hover {
  border-color: var(--comm-accent);
  color: var(--comm-accent);
  background: color-mix(in srgb, var(--comm-accent) 12%, transparent);
}

.mm-comm__servers {
  list-style: none;
  margin: 0;
  padding: 0;
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  color: var(--mm-ink);
}

.mm-comm__servers li {
  padding: 4px 0;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-comm__servers li:last-child { border-bottom: 0; }

.mm-comm__dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.mm-comm__date-value {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  color: var(--mm-ink);
  margin-top: 2px;
}

.mm-comm__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  text-align: center;
  margin-top: auto;
  border-color: var(--comm-accent);
  color: var(--comm-accent);
  background: color-mix(in srgb, var(--comm-accent) 10%, transparent);
}

.mm-comm__cta:hover {
  background: var(--comm-accent);
  border-color: var(--comm-accent);
  color: var(--mm-bg);
}

@media (max-width: 640px) {
  .mm-comm__stats { grid-template-columns: repeat(2, 1fr); }
  .mm-comm__stat:nth-child(2) { border-right: 0; }
  .mm-comm__stat:nth-child(3) { padding-left: 0; }
  .mm-comm__stat:nth-child(1),
  .mm-comm__stat:nth-child(2) { border-bottom: 1px solid var(--mm-rule); padding-bottom: 14px; }
}
</style>
