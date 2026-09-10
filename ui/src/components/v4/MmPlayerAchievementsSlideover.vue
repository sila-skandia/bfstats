<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { decodePlayerName } from '@/utils/playerName'
import MmPlayerAchievementSummary from '@/components/v4/MmPlayerAchievementSummary.vue'

const props = defineProps<{
  open: boolean
  playerName: string
}>()

const emit = defineEmits<{
  close: []
}>()

const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (props.open) {
    e.preventDefault()
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  },
)

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="mm mm-trend-so"
      data-testid="achievements-slideover"
      role="dialog"
      aria-modal="true"
      aria-label="All achievements"
      @click.self="emit('close')"
    >
      <div class="mm-trend-so__panel">
        <header class="mm-trend-so__head">
          <div>
            <div class="mm-eyebrow mm-eyebrow--strong">Achievements</div>
            <h2 class="mm-h2" style="margin: 4px 0 0">{{ decodePlayerName(playerName) }}</h2>
          </div>
          <div class="mm-trend-so__head-actions">
            <button
              type="button"
              class="mm-trend-so__close"
              aria-label="Close achievements"
              @click="emit('close')"
            >
              ← Close
            </button>
          </div>
        </header>

        <div class="mm-trend-so__body mm-trend-so__pad">
          <MmPlayerAchievementSummary :player-name="playerName" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mm-trend-so {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: color-mix(in srgb, var(--mm-bg) 50%, transparent);
  display: flex;
  justify-content: flex-end;
  animation: mm-trend-fade 0.2s ease;
}

.mm-trend-so__panel {
  width: min(960px, 100vw);
  height: 100%;
  background: var(--mm-bg);
  border-left: 1px solid var(--mm-rule-strong);
  display: flex;
  flex-direction: column;
  animation: mm-trend-slide 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.mm-trend-so__head {
  padding: 16px 20px;
  border-bottom: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}

.mm-trend-so__head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.mm-trend-so__close {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  background: transparent;
  border: 1px solid var(--mm-rule);
  padding: 10px 14px;
  min-height: 44px;
  cursor: pointer;
  border-radius: 2px;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.mm-trend-so__close:hover {
  color: var(--mm-ink);
  border-color: var(--mm-ink-soft);
}

.mm-trend-so__body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  overscroll-behavior: contain;
}

.mm-trend-so__pad { padding: 16px 20px; }

@keyframes mm-trend-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes mm-trend-slide {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@media (max-width: 720px) {
  .mm-trend-so__panel {
    width: 100vw;
    max-width: 100vw;
  }
  .mm-trend-so__head {
    flex-direction: column;
    align-items: stretch;
  }
  .mm-trend-so__head-actions {
    justify-content: space-between;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mm-trend-so,
  .mm-trend-so__panel {
    animation: none;
  }
}
</style>
