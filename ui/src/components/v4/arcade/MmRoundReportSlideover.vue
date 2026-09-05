<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import MmRoundReportV2 from '@/components/v4/MmRoundReportV2.vue'

const props = defineProps<{
  roundId: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.roundId) {
    emit('close')
  }
}

watch(
  () => props.roundId,
  (newId) => {
    if (typeof document !== 'undefined') {
      if (newId) {
        document.body.style.overflow = 'hidden'
      } else {
        document.body.style.overflow = ''
      }
    }
  }
)

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  if (props.roundId && typeof document !== 'undefined') {
    document.body.style.overflow = 'hidden'
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="roundId"
      class="mm round-report-slideover"
      aria-modal="true"
      role="dialog"
      aria-label="Battlefield Round Report"
      @click.self="emit('close')"
    >
      <div class="slideover-content">
        <header class="slideover-header">
          <button
            type="button"
            class="close-btn"
            @click="emit('close')"
          >
            <span>&larr; Back to Arcade</span>
          </button>
          <div class="slideover-title-badge">
            <span class="mm-eyebrow">Round Report</span>
          </div>
        </header>
        <div class="slideover-body">
          <MmRoundReportV2
            :round-id="roundId"
            :open-in-new-tab="true"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.round-report-slideover {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  z-index: 9999;
  display: flex;
  justify-content: flex-end;
  animation: mmSlideoverFadeIn 0.25s ease;
}

.slideover-content {
  width: 95vw;
  max-width: 1560px;
  height: 100%;
  background-color: var(--mm-bg, #131313);
  border-left: 1px solid var(--mm-rule, #2d2d2d);
  display: flex;
  flex-direction: column;
  box-shadow: -10px 0 35px rgba(0, 0, 0, 0.65);
  animation: mmSlideoverSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

.slideover-header {
  padding: 12px 20px;
  border-bottom: 1px solid var(--mm-rule, #2d2d2d);
  background-color: var(--mm-bg-soft, #1a1a1a);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.close-btn {
  background: none;
  border: 1px solid var(--mm-rule-strong, #3d3d3d);
  color: var(--mm-ink-soft, #c8c8c8);
  font-family: var(--mm-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  letter-spacing: 0.1em;
  padding: 6px 14px;
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.close-btn:hover {
  color: var(--mm-ink, #ffffff);
  border-color: var(--mm-accent, #7d8849);
  background-color: var(--mm-bg-mute, #222222);
}

.slideover-title-badge {
  display: flex;
  align-items: center;
}

.slideover-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

@keyframes mmSlideoverFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes mmSlideoverSlideIn {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@media (max-width: 768px) {
  .slideover-content {
    width: 100vw;
  }
}
</style>
