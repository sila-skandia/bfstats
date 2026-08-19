<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

interface Props {
  ip?: string | null
  port?: number | null
  serverName?: string
  compact?: boolean
  align?: 'left' | 'right'
}

const props = withDefaults(defineProps<Props>(), {
  ip: '',
  port: 14567,
  serverName: '',
  compact: false,
  align: 'right',
})

const MENU_PAD = 8
const MENU_GAP = 6
const MENU_MIN_W = 260
const MENU_EST_H = 220

const boxesOverlap = (
  a: { top: number; bottom: number; left: number; right: number },
  b: { top: number; bottom: number; left: number; right: number },
) => !(b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom)

const showDropdown = ref(false)
const copiedStatus = ref<'ip' | 'cmd' | null>(null)
const copyTimeout = ref<number | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const copyBtnEl = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const isNarrow = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches)
let narrowMql: MediaQueryList | null = null

const formattedAddress = () => {
  if (!props.ip) return ''
  return `${props.ip}:${props.port || 14567}`
}

const directConnectUri = () => {
  const addr = formattedAddress()
  return addr ? `bf1942://${addr}` : '#'
}

const copyToClipboard = async (text: string, type: 'ip' | 'cmd') => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }

    copiedStatus.value = type
    if (copyTimeout.value) clearTimeout(copyTimeout.value)
    copyTimeout.value = window.setTimeout(() => {
      copiedStatus.value = null
    }, 2000)
  } catch (err) {
    console.error('Failed to copy connect info:', err)
  }
}

const copyIp = () => {
  const addr = formattedAddress()
  if (addr) void copyToClipboard(addr, 'ip')
}

const copyCommand = () => {
  const addr = formattedAddress()
  if (addr) void copyToClipboard(`+connect ${addr}`, 'cmd')
}

const placeMenu = () => {
  const trigger = copyBtnEl.value
  if (!trigger) {
    menuStyle.value = {}
    return
  }

  const r = trigger.getBoundingClientRect()
  const row = trigger.closest('tr')
  const rowBox = row?.getBoundingClientRect()
  const nameBox = row?.querySelector('.lb-name-cell')?.getBoundingClientRect()
  const menu = menuEl.value
  const mw = menu?.offsetWidth || MENU_MIN_W
  const mh = menu?.offsetHeight || MENU_EST_H
  const vw = window.innerWidth
  const vh = window.innerHeight

  // Hang left of the trigger (away from the name column to the right).
  let left = props.align === 'left' ? r.left : r.right - mw
  if (left + mw > vw - MENU_PAD) left = vw - mw - MENU_PAD
  if (left < MENU_PAD) left = MENU_PAD

  // Drop below the row so the current server name stays uncovered.
  const anchorBottom = rowBox?.bottom ?? r.bottom
  const anchorTop = rowBox?.top ?? r.top
  const below = anchorBottom + MENU_GAP
  const above = anchorTop - MENU_GAP - mh
  let top = below
  if (below + mh > vh - MENU_PAD && above >= MENU_PAD) {
    top = above
  } else if (below + mh > vh - MENU_PAD) {
    top = Math.max(MENU_PAD, vh - mh - MENU_PAD)
  }

  if (nameBox && boxesOverlap(
    { top, bottom: top + mh, left, right: left + mw },
    { top: nameBox.top, bottom: nameBox.bottom, left: nameBox.left, right: nameBox.right },
  )) {
    top = nameBox.bottom + MENU_GAP
    if (top + mh > vh - MENU_PAD) {
      const alt = nameBox.top - MENU_GAP - mh
      if (alt >= MENU_PAD) top = alt
      else {
        const leftOfName = nameBox.left - MENU_GAP - mw
        if (leftOfName >= MENU_PAD) left = leftOfName
      }
    }
  }

  menuStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    right: 'auto',
    zIndex: '1200',
  }
}

const closeDropdown = () => {
  showDropdown.value = false
}

const toggleDropdown = async () => {
  showDropdown.value = !showDropdown.value
  if (!showDropdown.value) return
  placeMenu()
  await nextTick()
  placeMenu()
}

const handleDocumentClick = (e: MouseEvent) => {
  const target = e.target as Node
  if (rootEl.value?.contains(target) || menuEl.value?.contains(target)) return
  closeDropdown()
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') closeDropdown()
}

const onNarrow = (e: MediaQueryListEvent) => {
  isNarrow.value = e.matches
  if (showDropdown.value) placeMenu()
}

watch(showDropdown, (open) => {
  if (open) {
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    document.addEventListener('keydown', handleKeydown)
  } else {
    window.removeEventListener('resize', placeMenu)
    window.removeEventListener('scroll', placeMenu, true)
    document.removeEventListener('keydown', handleKeydown)
  }
})

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
  narrowMql = window.matchMedia('(max-width: 720px)')
  isNarrow.value = narrowMql.matches
  narrowMql.addEventListener('change', onNarrow)
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick)
  window.removeEventListener('resize', placeMenu)
  window.removeEventListener('scroll', placeMenu, true)
  document.removeEventListener('keydown', handleKeydown)
  narrowMql?.removeEventListener('change', onNarrow)
  if (copyTimeout.value) clearTimeout(copyTimeout.value)
})
</script>

<template>
  <div
    v-if="ip"
    ref="rootEl"
    class="mm-connect"
    data-server-connect
    :class="{ 'mm-connect--compact': compact, 'is-open': showDropdown }"
  >
    <div class="mm-connect__group">
      <a
        v-if="!isNarrow"
        :href="directConnectUri()"
        class="mm-connect__btn mm-connect__btn--primary"
        data-testid="server-connect-join"
        :title="`Launch Battlefield 1942 and join ${formattedAddress()}`"
        aria-label="Direct join server in Battlefield 1942"
      >
        <svg
          class="mm-connect__icon"
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span class="mm-connect__label">Play Now</span>
      </a>

      <button
        ref="copyBtnEl"
        type="button"
        class="mm-connect__btn mm-connect__btn--copy"
        :class="{
          'mm-connect__btn--solo': isNarrow,
          'is-active': showDropdown,
          'is-copied': !!copiedStatus,
        }"
        :title="copiedStatus ? 'Copied to clipboard!' : 'Copy IP address or connect string'"
        :aria-expanded="showDropdown"
        aria-haspopup="menu"
        aria-label="Copy server connect options"
        @click="toggleDropdown"
      >
        <template v-if="copiedStatus">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span class="mm-connect__copied-text">Copied</span>
        </template>
        <template v-else>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span v-if="isNarrow" class="mm-connect__label">Copy</span>
          <svg class="mm-connect__chevron" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </template>
      </button>
    </div>

    <Teleport to="body">
      <div v-if="showDropdown" class="mm" data-server-connect>
        <div
          ref="menuEl"
          class="mm-connect__menu"
          :style="menuStyle"
          role="menu"
          data-testid="server-connect-menu"
        >
          <div class="mm-connect__menu-header">
            <div class="mm-connect__menu-heading">
              <span class="mm-eyebrow">Direct connect</span>
              <span class="mm-connect__address">{{ formattedAddress() }}</span>
            </div>
          </div>

          <div class="mm-connect__menu-actions">
            <button
              type="button"
              class="mm-connect__item"
              role="menuitem"
              @click="() => { copyIp(); closeDropdown(); }"
            >
              <div class="mm-connect__item-main">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <div class="mm-connect__item-text">
                  <span class="mm-connect__item-title">Copy IP & Port</span>
                  <span class="mm-connect__item-sub">{{ formattedAddress() }}</span>
                </div>
              </div>
              <span v-if="copiedStatus === 'ip'" class="mm-connect__badge">Copied!</span>
            </button>

            <button
              type="button"
              class="mm-connect__item"
              role="menuitem"
              @click="() => { copyCommand(); closeDropdown(); }"
            >
              <div class="mm-connect__item-main">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                <div class="mm-connect__item-text">
                  <span class="mm-connect__item-title">Copy Launch Argument</span>
                  <span class="mm-connect__item-sub">+connect {{ formattedAddress() }}</span>
                </div>
              </div>
              <span v-if="copiedStatus === 'cmd'" class="mm-connect__badge">Copied!</span>
            </button>

            <a
              v-if="!isNarrow"
              :href="directConnectUri()"
              class="mm-connect__item mm-connect__item--launch"
              role="menuitem"
              @click="closeDropdown"
            >
              <div class="mm-connect__item-main">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <div class="mm-connect__item-text">
                  <span class="mm-connect__item-title">Launch Game Directly</span>
                  <span class="mm-connect__item-sub">via bf1942:// protocol handler</span>
                </div>
              </div>
              <span class="mm-connect__item-arrow" aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mm-connect {
  position: relative;
  display: inline-flex;
  font-family: var(--mm-font-display);
}

.mm-connect.is-open {
  z-index: 150;
}

.mm-connect__group {
  display: inline-flex;
  align-items: stretch;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.mm-connect__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  line-height: 1;
}

.mm-connect__btn--primary {
  background: var(--mm-accent);
  color: #ffffff;
  border: 1px solid var(--mm-accent);
  border-top-left-radius: 4px;
  border-bottom-left-radius: 4px;
}

.mm-connect__btn--primary:hover {
  background: #8b9752;
  border-color: #8b9752;
  color: #ffffff;
}

.mm-connect__btn--copy {
  background: var(--mm-bg-soft);
  color: var(--mm-ink);
  border: 1px solid var(--mm-rule);
  border-left: 0;
  border-top-right-radius: 4px;
  border-bottom-right-radius: 4px;
  padding: 6px 8px;
}

.mm-connect__btn--solo {
  border-left: 1px solid var(--mm-rule);
  border-radius: 4px;
  padding: 6px 10px;
  min-height: 32px;
}

.mm-connect__btn--copy:hover,
.mm-connect__btn--copy.is-active {
  background: #242424;
  border-color: var(--mm-ink-faint);
  color: var(--mm-ink);
}

.mm-connect__btn--copy.is-copied {
  color: var(--mm-success);
  border-color: var(--mm-success);
}

.mm-connect__copied-text {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.mm-connect__icon {
  flex-shrink: 0;
}

.mm-connect__chevron {
  transition: transform 0.15s ease;
}

.mm-connect__btn--copy.is-active .mm-connect__chevron {
  transform: rotate(180deg);
}

.mm-connect--compact .mm-connect__btn {
  padding: 4px 8px;
  font-size: 10.5px;
}

.mm-connect--compact .mm-connect__btn--copy {
  padding: 4px 6px;
}

.mm-connect--compact .mm-connect__btn--solo {
  padding: 5px 8px;
}

.mm-connect__menu {
  position: fixed;
  z-index: 1200;
  min-width: 260px;
  max-width: min(280px, calc(100vw - 16px));
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 4px;
  padding: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
}

.mm-connect__menu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 4px 6px 8px;
  border-bottom: 1px solid var(--mm-rule);
  margin-bottom: 6px;
}

.mm-connect__menu-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mm-connect__address {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-accent);
  letter-spacing: 0.03em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-connect__menu-actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-connect__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--mm-ink);
  text-decoration: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
}

.mm-connect__item:hover {
  background: var(--mm-bg-soft);
}

.mm-connect__item-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.mm-connect__item-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mm-connect__item-title {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--mm-ink);
}

.mm-connect__item-sub {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-connect__item--launch .mm-connect__item-title {
  color: var(--mm-accent);
}

.mm-connect__item-arrow {
  color: var(--mm-ink-muted);
  font-size: 11px;
}

.mm-connect__badge {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  color: var(--mm-success);
  background: rgba(125, 163, 76, 0.15);
  padding: 2px 6px;
  border-radius: 2px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

@media (max-width: 720px) {
  .mm-connect__item {
    min-height: 44px;
    padding: 10px 8px;
  }
}

</style>
