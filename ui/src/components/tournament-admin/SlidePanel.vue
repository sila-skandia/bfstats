<template>
  <Teleport to="body">
    <Transition name="slide-panel">
      <div
        v-if="open"
        class="mm mm-admin slide-panel-overlay"
        @click.self="$emit('close')"
      >
        <div
          class="slide-panel"
          :class="[sizeClass]"
        >
          <!-- Header -->
          <header class="slide-panel-header">
            <div>
              <span v-if="eyebrow" class="mm-eyebrow" style="margin-bottom: 4px; display: block;">{{ eyebrow }}</span>
              <h2 class="slide-panel-title">
                {{ title }}
              </h2>
              <p
                v-if="subtitle"
                class="slide-panel-subtitle"
              >
                {{ subtitle }}
              </p>
            </div>
            <button
              type="button"
              class="slide-panel-close"
              title="Close"
              @click="$emit('close')"
            >
              <i class="pi pi-times" style="font-size: 12px;" />
            </button>
          </header>

          <!-- Content -->
          <div class="slide-panel-content">
            <slot />
          </div>

          <!-- Footer -->
          <footer
            v-if="$slots.footer"
            class="slide-panel-footer"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  open: boolean;
  title: string;
  eyebrow?: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md'
});

defineEmits<{
  (e: 'close'): void;
}>();

const sizeClass = computed(() => {
  const sizes = {
    sm: 'slide-panel--sm',
    md: 'slide-panel--md',
    lg: 'slide-panel--lg',
    xl: 'slide-panel--xl'
  };
  return sizes[props.size];
});
</script>

<style scoped>
.slide-panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: flex-end;
}

.slide-panel {
  height: 100%;
  background: var(--mm-bg-soft, #1c1c1c);
  border-left: 1px solid var(--mm-rule-strong, #3d3d3d);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  color: var(--mm-ink, #ffffff);
}

.slide-panel--sm { width: 100%; max-width: 400px; }
.slide-panel--md { width: 100%; max-width: 500px; }
.slide-panel--lg { width: 100%; max-width: 560px; }
.slide-panel--xl { width: 100%; max-width: 800px; }

@media (max-width: 640px) {
  .slide-panel {
    max-width: 100% !important;
  }
}

.slide-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 16px 20px;
  border-bottom: 1px solid var(--mm-rule, #2d2d2d);
  background: var(--mm-bg-soft, #1c1c1c);
}

.slide-panel-title {
  font-family: var(--mm-font-display);
  font-size: 18px;
  font-weight: 500;
  color: var(--mm-ink);
  margin: 0;
  letter-spacing: -0.01em;
}

.slide-panel-subtitle {
  font-size: 12.5px;
  color: var(--mm-ink-muted);
  margin: 4px 0 0;
}

.slide-panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
  flex-shrink: 0;
}

.slide-panel-close:hover {
  background: var(--mm-bg-mute);
  border-color: var(--mm-rule-strong);
  color: var(--mm-ink);
}

.slide-panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.slide-panel-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
}

/* Transition animations */
.slide-panel-enter-active,
.slide-panel-leave-active {
  transition: opacity 0.2s ease;
}

.slide-panel-enter-active .slide-panel,
.slide-panel-leave-active .slide-panel {
  transition: transform 0.25s ease;
}

.slide-panel-enter-from,
.slide-panel-leave-to {
  opacity: 0;
}

.slide-panel-enter-from .slide-panel,
.slide-panel-leave-to .slide-panel {
  transform: translateX(100%);
}
</style>
