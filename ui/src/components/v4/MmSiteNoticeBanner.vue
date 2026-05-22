<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import { useSiteNotice } from '@/composables/useSiteNotice'

const { notice, isVisible, dismissNotice } = useSiteNotice()

const renderedContent = computed(() => {
  if (!notice.value?.content) return ''
  try {
    return marked(notice.value.content, { breaks: true })
  } catch {
    return notice.value.content
  }
})

const bannerClass = computed(() => {
  const type = notice.value?.type || 'info'
  return ['mm-site-notice', `mm-site-notice--${type}`]
})
</script>

<template>
  <Transition name="mm-site-notice">
    <div
      v-if="isVisible"
      :class="bannerClass"
      role="status"
    >
      <div class="mm-site-notice__content" v-html="renderedContent" />
      <button
        v-if="notice?.dismissible"
        type="button"
        class="mm-site-notice__dismiss"
        aria-label="Dismiss notice"
        @click="dismissNotice"
      >
        Dismiss
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.mm-site-notice {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 10px 32px;
  border-bottom: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
  color: var(--mm-ink);
  font-family: var(--mm-font-display);
  font-size: 13px;
  line-height: 1.5;
}

.mm-site-notice__content {
  flex: 1 1 auto;
  min-width: 0;
  text-align: center;
}

.mm-site-notice__content :deep(p) { margin: 0; }
.mm-site-notice__content :deep(p + p) { margin-top: 6px; }
.mm-site-notice__content :deep(strong) { font-weight: 600; }
.mm-site-notice__content :deep(em) { font-style: italic; }
.mm-site-notice__content :deep(code) {
  font-family: var(--mm-font-mono);
  background: var(--mm-bg-mute);
  padding: 1px 5px;
  border-radius: 2px;
  font-size: 0.92em;
}
.mm-site-notice__content :deep(a) {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.mm-site-notice__content :deep(a:hover) { color: var(--mm-ink); }

.mm-site-notice__dismiss {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  padding: 4px 10px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
}
.mm-site-notice__dismiss:hover {
  color: var(--mm-ink);
  border-color: var(--mm-ink);
  background: var(--mm-bg-mute);
}

/* type variants — left border + tinted bg + accent text */
.mm-site-notice--info {
  border-left: 3px solid var(--mm-ink-soft);
}
.mm-site-notice--warning {
  border-left: 3px solid var(--mm-load-busy);
  background: rgba(197, 162, 58, 0.08);
  color: var(--mm-load-busy);
}
.mm-site-notice--success {
  border-left: 3px solid var(--mm-success);
  background: rgba(125, 163, 76, 0.08);
  color: var(--mm-success);
}
.mm-site-notice--error {
  border-left: 3px solid var(--mm-danger);
  background: rgba(214, 90, 90, 0.10);
  color: var(--mm-danger);
}

/* slide-in transition */
.mm-site-notice-enter-active,
.mm-site-notice-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.mm-site-notice-enter-from,
.mm-site-notice-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}

@media (max-width: 720px) {
  .mm-site-notice {
    padding: 10px 18px;
    font-size: 12.5px;
    gap: 10px;
  }
  .mm-site-notice__dismiss {
    padding: 3px 8px;
    font-size: 9.5px;
  }
}
</style>
