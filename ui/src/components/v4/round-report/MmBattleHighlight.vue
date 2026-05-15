<script setup lang="ts">
import { computed } from 'vue'
import type { BattleHighlight } from '@/utils/battleEventGenerator'

interface Props {
  highlight: BattleHighlight
  formatTimeOffset: (timestamp: string) => string
}

const props = defineProps<Props>()

const tone = computed(() => {
  switch (props.highlight.type) {
    case 'first_blood': return 'kill'
    case 'killing_spree': return 'streak'
    case 'lead_change': return 'lead'
    case 'mvp': return 'mvp'
    default: return 'log'
  }
})

const typeLabel = computed(() => {
  switch (props.highlight.type) {
    case 'first_blood': return 'First blood'
    case 'killing_spree': return 'Streak'
    case 'lead_change': return 'Lead change'
    case 'mvp': return 'MVP'
    default: return 'Log'
  }
})
</script>

<template>
  <div class="mm-highlight" :class="`mm-highlight--${tone}`">
    <span class="mm-highlight__icon">{{ highlight.icon }}</span>
    <div class="mm-highlight__body">
      <div class="mm-highlight__meta">
        <span class="mm-eyebrow mm-eyebrow--strong mm-highlight__type">{{ typeLabel }}</span>
        <span class="mm-meta-row__sep">·</span>
        <span class="mm-eyebrow">T+{{ formatTimeOffset(highlight.timestamp) }}</span>
      </div>
      <div class="mm-highlight__name">{{ $pn(highlight.playerName) }}</div>
      <div class="mm-highlight__desc">{{ highlight.description }}</div>
    </div>
    <div v-if="highlight.value" class="mm-highlight__value">{{ highlight.value }}</div>
  </div>
</template>

<style scoped>
.mm-highlight {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--mm-rule);
  border-left-width: 3px;
  border-radius: 2px;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}

.mm-highlight:hover { background: var(--mm-bg-soft); }

.mm-highlight--kill { border-left-color: var(--mm-kill); }
.mm-highlight--kill .mm-highlight__type { color: var(--mm-kill); }
.mm-highlight--streak { border-left-color: var(--mm-kd-elite); }
.mm-highlight--streak .mm-highlight__type { color: var(--mm-kd-elite); }
.mm-highlight--lead { border-left-color: var(--mm-ink-soft); }
.mm-highlight--lead .mm-highlight__type { color: var(--mm-ink-soft); }
.mm-highlight--mvp { border-left-color: var(--mm-accent); }
.mm-highlight--mvp .mm-highlight__type { color: var(--mm-accent); }
.mm-highlight--log { border-left-color: var(--mm-ink-muted); }

.mm-highlight__icon {
  flex-shrink: 0;
  font-size: 22px;
  filter: grayscale(0.3);
}

.mm-highlight__body { flex: 1; min-width: 0; }

.mm-highlight__meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 2px;
}

.mm-highlight__name {
  font-family: var(--mm-font-display);
  font-size: 14px;
  font-weight: 500;
  color: var(--mm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-highlight__desc {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-muted);
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-highlight__value {
  flex-shrink: 0;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  padding: 4px 10px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
}
</style>
