<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="mm mm-modal__backdrop"
      :class="backdropClass"
      :style="{ zIndex }"
      @click="handleOverlayClick"
      @mousedown="handleOverlayMouseDown"
      @keydown.esc="handleClose"
    >
      <div
        ref="modalRef"
        class="mm-modal__panel"
        :class="[sizeClass, contentClass]"
        :style="{ maxHeight }"
        @click.stop
        @mousedown="handleModalMouseDown"
      >
        <header
          v-if="title || subtitle || $slots.header || showCloseButton"
          class="mm-modal__head"
        >
          <div class="mm-modal__head-text">
            <slot name="header">
              <div v-if="subtitle" class="mm-eyebrow mm-eyebrow--strong">{{ subtitle }}</div>
              <h2 v-if="title" class="mm-h2 mm-modal__title">{{ title }}</h2>
            </slot>
          </div>
          <button
            v-if="showCloseButton"
            type="button"
            class="mm-modal__close"
            aria-label="Close modal"
            @click="handleClose"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <hr v-if="title || subtitle || $slots.header" class="mm-rule" />

        <div
          class="mm-modal__body"
          :class="[noPadding ? 'is-flush' : '', bodyClass]"
          :style="{ maxHeight: bodyMaxHeight }"
        >
          <slot />
        </div>

        <template v-if="$slots.footer">
          <hr class="mm-rule" />
          <footer class="mm-modal__foot">
            <slot name="footer" />
          </footer>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

interface Props {
  modelValue: boolean
  title?: string
  subtitle?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  showCloseButton?: boolean
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  zIndex?: number
  maxHeight?: string
  noPadding?: boolean
  backdropClass?: string
  contentClass?: string
  bodyClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  subtitle: undefined,
  size: 'md',
  showCloseButton: true,
  closeOnBackdrop: true,
  closeOnEscape: true,
  zIndex: 1000,
  maxHeight: '90vh',
  noPadding: false,
  backdropClass: '',
  contentClass: '',
  bodyClass: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

const modalRef = ref<HTMLElement | null>(null)
const mouseDownInsideModal = ref(false)

const sizeClass = computed(() => `mm-modal__panel--${props.size}`)

const bodyMaxHeight = computed(() => `calc(${props.maxHeight} - 92px)`)

const handleClose = () => {
  emit('update:modelValue', false)
  emit('close')
}

const handleOverlayClick = () => {
  if (props.closeOnBackdrop && !mouseDownInsideModal.value) handleClose()
}

const handleModalMouseDown = () => { mouseDownInsideModal.value = true }
const handleOverlayMouseDown = () => { mouseDownInsideModal.value = false }

const handleEscapeKey = (e: KeyboardEvent) => {
  if (props.closeOnEscape && props.modelValue && e.key === 'Escape') handleClose()
}

watch(() => props.modelValue, (isOpen) => {
  document.body.style.overflow = isOpen ? 'hidden' : ''
})

onMounted(() => {
  document.addEventListener('keydown', handleEscapeKey)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscapeKey)
  document.body.style.overflow = ''
})
</script>

<style scoped>
.mm-modal__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(26, 26, 26, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.mm-modal__panel {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--mm-ink);
}

.mm-modal__panel--sm { max-width: 360px; }
.mm-modal__panel--md { max-width: 520px; }
.mm-modal__panel--lg { max-width: 720px; }
.mm-modal__panel--xl { max-width: 960px; }
.mm-modal__panel--full { max-width: 95vw; }

.mm-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 16px;
}

.mm-modal__head-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-modal__title {
  margin: 0;
}

.mm-modal__close {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 999px;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.mm-modal__close:hover {
  color: var(--mm-ink);
  border-color: var(--mm-ink);
}

.mm-modal__body {
  padding: 20px 24px;
  overflow-y: auto;
}

.mm-modal__body.is-flush {
  padding: 0;
}

.mm-modal__foot {
  padding: 16px 24px 20px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 18px;
}

@media (max-width: 720px) {
  .mm-modal__backdrop {
    padding: 0;
    align-items: stretch;
  }

  .mm-modal__panel,
  .mm-modal__panel--sm,
  .mm-modal__panel--md,
  .mm-modal__panel--lg,
  .mm-modal__panel--xl,
  .mm-modal__panel--full {
    max-width: 100%;
    max-height: 100vh !important;
    border: 0;
    border-radius: 0;
  }

  .mm-modal__head {
    padding: 16px 18px 12px;
  }

  .mm-modal__body {
    padding: 16px 18px;
  }

  .mm-modal__foot {
    padding: 12px 18px 16px;
  }
}
</style>
