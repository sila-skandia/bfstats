<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

withDefaults(defineProps<{
  // 'inline' = compact accent button (default, top-right of landing).
  // 'cta-strip' = full-width highlight strip (mobile landing CTA).
  variant?: 'inline' | 'cta-strip'
}>(), { variant: 'inline' })

const showDropdown = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const toggleDropdown = () => {
  showDropdown.value = !showDropdown.value
}

const closeDropdown = () => {
  showDropdown.value = false
}

const handleDocumentClick = (e: MouseEvent) => {
  if (!rootEl.value) return
  if (!rootEl.value.contains(e.target as Node)) closeDropdown()
}

onMounted(() => document.addEventListener('mousedown', handleDocumentClick))
onUnmounted(() => document.removeEventListener('mousedown', handleDocumentClick))

defineExpose({ close: closeDropdown })

const links = [
  {
    href: 'https://team-simple.org/download/',
    label: 'SiMPLE · BF1942 installers',
    hint: 'Official installers and patches',
  },
  {
    href: 'https://bf1942.online/guide/installation',
    label: 'BF1942 Online · Step-by-step',
    hint: 'Complete installation guide',
  },
  {
    href: 'https://steamcommunity.com/sharedfiles/filedetails/?id=2721068159',
    label: 'Steam Community · Wiki',
    hint: 'Community installation wiki',
  },
]
</script>

<template>
  <div ref="rootEl" class="mm-install" :class="{ 'mm-install--strip': variant === 'cta-strip' }">
    <button
      type="button"
      class="mm-install__toggle"
      :class="variant === 'cta-strip' ? 'mm-cta-strip' : 'mm-btn mm-btn--accent'"
      :aria-expanded="showDropdown"
      @click="toggleDropdown"
    >
      <span class="mm-install__toggle-label">Get Online</span>
      <span v-if="variant === 'inline'" class="mm-install__toggle-label mm-install__toggle-label--mobile">Install</span>
      <svg
        class="mm-install__chevron"
        :class="{ 'is-open': showDropdown }"
        viewBox="0 0 24 24"
        width="11"
        height="11"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div v-if="showDropdown" class="mm-install__menu" role="menu">
      <div class="mm-eyebrow mm-install__head">Installation guides</div>
      <a
        v-for="link in links"
        :key="link.href"
        :href="link.href"
        target="_blank"
        rel="noopener noreferrer"
        class="mm-install__item"
        role="menuitem"
        @click="closeDropdown"
      >
        <div class="mm-install__item-body">
          <span class="mm-install__item-label">{{ link.label }}</span>
          <span class="mm-install__item-hint">{{ link.hint }}</span>
        </div>
        <span class="mm-install__item-arrow" aria-hidden="true">↗</span>
      </a>
    </div>
  </div>
</template>

<style scoped>
.mm-install {
  position: relative;
  display: inline-block;
}

/* CTA-strip variant — the toggle stretches edge-to-edge of the mobile
   container, so the wrapper must be block-level for `right: 0` (and
   `left: 0` below) to anchor against the *strip*, not against the
   inline-block's content width. Otherwise the menu collapses to
   ~32px wide and floats to the left of the visible area. */
.mm-install--strip {
  display: block;
  width: 100%;
}
.mm-install--strip .mm-install__menu {
  left: 0;
  right: 0;
  min-width: 0;
}

.mm-install__toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.mm-install__toggle-label--mobile { display: none; }

.mm-install__chevron {
  transition: transform 0.2s ease;
}

.mm-install__chevron.is-open {
  transform: rotate(180deg);
}

.mm-install__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 300px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  z-index: 50;
  padding: 4px 0;
}

.mm-install__head {
  padding: 10px 16px;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-install__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mm-rule);
  color: var(--mm-ink);
  transition: background-color 0.12s ease;
}

.mm-install__item:last-child { border-bottom: 0; }
.mm-install__item:hover { background: var(--mm-bg-soft); }

.mm-install__item-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mm-install__item-label {
  font-family: var(--mm-font-display);
  font-size: 13px;
  font-weight: 500;
}

.mm-install__item-hint {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
}

.mm-install__item-arrow {
  font-family: var(--mm-font-mono);
  color: var(--mm-ink-muted);
  flex-shrink: 0;
}

.mm-install__item:hover .mm-install__item-arrow {
  color: var(--mm-accent);
}

@media (max-width: 720px) {
  /* Inline (desktop top-right) variant collapses "Get Online" → "Install"
     to save space in the narrow meta row. The CTA-strip variant keeps
     the full label because the strip has the whole viewport width to
     work with. */
  .mm-install:not(.mm-install--strip) .mm-install__toggle-label { display: none; }
  .mm-install:not(.mm-install--strip) .mm-install__toggle-label--mobile { display: inline; }
  .mm-install:not(.mm-install--strip) .mm-install__menu {
    min-width: 260px;
    right: 0;
  }
}
</style>
