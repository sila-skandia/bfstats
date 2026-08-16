<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import MmServerMapDetailPanel from '@/components/v4/data-explorer/MmServerMapDetailPanel.vue'

interface Props {
  modelValue: boolean
  serverGuid: string
  mapName: string | null
  serverName?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

const drawerPanelRef = ref<HTMLElement | null>(null)
const mouseDownInside = ref(false)

const handleClose = () => {
  emit('update:modelValue', false)
  emit('close')
}

const handleOverlayClick = () => {
  if (!mouseDownInside.value) {
    handleClose()
  }
}

const handlePanelMouseDown = () => {
  mouseDownInside.value = true
}

const handleOverlayMouseDown = () => {
  mouseDownInside.value = false
}

const handleKeyDown = (e: KeyboardEvent) => {
  if (props.modelValue && e.key === 'Escape') {
    handleClose()
  }
}

// Lock body scrolling when drawer is open to prevent underlying content from moving
watch(
  () => props.modelValue,
  (isOpen) => {
    if (typeof document !== 'undefined') {
      if (isOpen) {
        document.body.style.overflow = 'hidden'
      } else {
        document.body.style.overflow = ''
      }
    }
  }
)

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="mm-map-drawer">
      <div
        v-if="modelValue && mapName && serverGuid"
        class="mm mm-map-drawer__overlay"
        @click="handleOverlayClick"
        @mousedown="handleOverlayMouseDown"
      >
        <div
          ref="drawerPanelRef"
          class="mm-map-drawer__panel"
          role="dialog"
          aria-modal="true"
          :aria-label="`Map details for ${mapName}`"
          @click.stop
          @mousedown="handlePanelMouseDown"
        >
          <!-- Drawer top navigation bar -->
          <header class="mm-map-drawer__bar">
            <button
              type="button"
              class="mm-btn mm-btn--inline mm-map-drawer__back"
              @click="handleClose"
            >
              <span class="mm-map-drawer__back-icon">←</span>
              <span>Back to maps</span>
            </button>

            <div class="mm-map-drawer__bar-meta">
              <span class="mm-eyebrow mm-eyebrow--soft">Map Drill-In</span>
            </div>

            <button
              type="button"
              class="mm-map-drawer__close"
              title="Close drawer (Esc)"
              aria-label="Close drawer"
              @click="handleClose"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          <!-- Drawer scrollable content area -->
          <div class="mm-map-drawer__content">
            <MmServerMapDetailPanel
              :server-guid="serverGuid"
              :map-name="mapName"
              @close="handleClose"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mm-map-drawer__overlay {
  position: fixed;
  inset: 0;
  z-index: 1050;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  justify-content: flex-end;
  overflow: hidden;
}

.mm-map-drawer__panel {
  width: 100%;
  max-width: 860px;
  height: 100%;
  background: var(--mm-bg, #131313);
  border-left: 1px solid var(--mm-rule-strong, #3d3d3d);
  display: flex;
  flex-direction: column;
  box-shadow: -16px 0 40px rgba(0, 0, 0, 0.65);
  color: var(--mm-ink, #ffffff);
  overflow: hidden;
}

.mm-map-drawer__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  background: var(--mm-bg-soft, #1a1a1a);
  border-bottom: 1px solid var(--mm-rule, #2d2d2d);
  flex-shrink: 0;
}

.mm-map-drawer__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  padding: 5px 10px;
}

.mm-map-drawer__back:hover {
  color: var(--mm-ink);
  background: var(--mm-bg-mute);
}

.mm-map-drawer__back-icon {
  font-size: 13px;
  line-height: 1;
}

.mm-map-drawer__bar-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-eyebrow--soft {
  color: var(--mm-ink-faint, #555555);
}

.mm-map-drawer__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 999px;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  flex-shrink: 0;
}

.mm-map-drawer__close:hover {
  color: var(--mm-ink);
  border-color: var(--mm-rule-strong);
  background: var(--mm-bg-mute);
}

.mm-map-drawer__content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px 40px;
  overscroll-behavior: contain;
}

/* Mobile: full-screen replacement */
@media (max-width: 768px) {
  .mm-map-drawer__overlay {
    align-items: stretch;
  }

  .mm-map-drawer__panel {
    max-width: 100% !important;
    width: 100vw;
    height: 100vh;
    border-left: 0;
    box-shadow: none;
  }

  .mm-map-drawer__bar {
    padding: 12px 16px;
  }

  .mm-map-drawer__content {
    padding: 16px 16px 36px;
  }
}

/* Transitions */
.mm-map-drawer-enter-active,
.mm-map-drawer-leave-active {
  transition: opacity 0.22s ease;
}

.mm-map-drawer-enter-active .mm-map-drawer__panel,
.mm-map-drawer-leave-active .mm-map-drawer__panel {
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

.mm-map-drawer-enter-from,
.mm-map-drawer-leave-to {
  opacity: 0;
}

.mm-map-drawer-enter-from .mm-map-drawer__panel,
.mm-map-drawer-leave-to .mm-map-drawer__panel {
  transform: translateX(100%);
}

@media (max-width: 768px) {
  .mm-map-drawer-enter-from .mm-map-drawer__panel,
  .mm-map-drawer-leave-to .mm-map-drawer__panel {
    transform: translateY(100%);
  }
}
</style>
