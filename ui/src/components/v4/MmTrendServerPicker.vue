<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import 'primeicons/primeicons.css'
import { decodeServerName } from '@/utils/playerName'
import { countryCodeToFlag } from '@/types/countryCodes'

export interface TrendPickerServer {
  guid: string
  name: string
  country?: string
  numPlayers: number
}

const props = defineProps<{
  servers: TrendPickerServer[]
  modelValue: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [guids: string[]]
}>()

const open = ref(false)
const query = ref('')
const liveOnly = ref(true)
const searchRef = ref<HTMLInputElement | null>(null)
const anchorRef = ref<HTMLElement | null>(null)
const popStyle = ref<Record<string, string>>({})
const isNarrow = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches)
let narrowMql: MediaQueryList | null = null

const selected = computed(() => new Set(props.modelValue))

const visibleServers = computed(() => {
  const q = query.value.trim().toLowerCase()
  return props.servers
    .filter(s => !liveOnly.value || s.numPlayers > 0)
    .filter(s => {
      if (!q) return true
      return s.name.toLowerCase().includes(q)
        || (s.country || '').toLowerCase().includes(q)
        || decodeServerName(s.name).toLowerCase().includes(q)
    })
    .slice()
    .sort((a, b) => {
      const aOn = selected.value.has(a.guid) ? 0 : 1
      const bOn = selected.value.has(b.guid) ? 0 : 1
      if (aOn !== bOn) return aOn - bOn
      return b.numPlayers - a.numPlayers
    })
})

const liveCount = computed(() => props.servers.filter(s => s.numPlayers > 0).length)

const selectedObj = computed(() => {
  if (props.modelValue.length !== 1) return null
  return props.servers.find(s => s.guid === props.modelValue[0]) ?? null
})

const buttonLabel = computed(() => {
  if (selectedObj.value) return decodeServerName(selectedObj.value.name)
  if (props.modelValue.length > 1) return `${props.modelValue.length} servers`
  return liveOnly.value ? 'Live network' : 'All live hosts'
})

const buttonCount = computed(() => {
  if (props.modelValue.length > 0) return props.modelValue.length
  return liveOnly.value ? liveCount.value : props.servers.length
})

const placePopover = () => {
  const el = anchorRef.value
  if (!el || isNarrow.value) {
    popStyle.value = {}
    return
  }
  const r = el.getBoundingClientRect()
  popStyle.value = {
    position: 'fixed',
    top: `${Math.round(r.bottom + 4)}px`,
    left: `${Math.round(r.left)}px`,
    zIndex: '1200',
  }
}

const toggleOpen = async () => {
  open.value = !open.value
  if (open.value) {
    placePopover()
    await nextTick()
    if (!isNarrow.value) searchRef.value?.focus()
  }
}

const clear = () => emit('update:modelValue', [])

const toggle = (guid: string) => {
  const next = selected.value.has(guid)
    ? props.modelValue.filter(g => g !== guid)
    : [...props.modelValue, guid]
  emit('update:modelValue', next)
}

const chipLabel = (guid: string) => {
  const s = props.servers.find(x => x.guid === guid)
  return s ? decodeServerName(s.name) : guid
}

const onDocClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  if (!target?.closest('[data-trend-picker]')) open.value = false
}

const onNarrow = (e: MediaQueryListEvent) => { isNarrow.value = e.matches }

onMounted(() => {
  document.addEventListener('click', onDocClick)
  narrowMql = window.matchMedia('(max-width: 720px)')
  isNarrow.value = narrowMql.matches
  narrowMql.addEventListener('change', onNarrow)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  narrowMql?.removeEventListener('change', onNarrow)
})
</script>

<template>
  <div class="mm-spick" data-trend-picker>
    <span class="mm-spick__label">Server</span>
    <div class="mm-spick__anchor" ref="anchorRef">
      <button
        type="button"
        class="mm-spick__btn"
        :class="{ 'mm-spick__btn--active': modelValue.length > 0, 'mm-spick__btn--open': open }"
        title="Filter by server"
        @click.stop="toggleOpen"
      >
        <template v-if="selectedObj">
          <span v-if="selectedObj.country" class="mm-spick__flag">{{ countryCodeToFlag(selectedObj.country) }}</span>
          <span class="mm-spick__text">{{ buttonLabel }}</span>
          <span class="mm-spick__count">{{ selectedObj.numPlayers }}</span>
        </template>
        <template v-else>
          <i class="pi pi-server mm-spick__icon"></i>
          <span class="mm-spick__text">{{ buttonLabel }}</span>
          <span v-if="buttonCount > 0" class="mm-spick__count">{{ buttonCount }}</span>
        </template>
        <i class="pi pi-chevron-down mm-spick__chevron"></i>
      </button>
      <button
        v-if="modelValue.length > 0"
        type="button"
        class="mm-spick__clear"
        aria-label="Clear server filter"
        @click.stop="clear"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="open"
        class="mm mm-spick__pop"
        :class="{ 'mm-spick__pop--sheet': isNarrow }"
        :style="isNarrow ? undefined : popStyle"
        data-trend-picker
        :role="isNarrow ? 'dialog' : undefined"
        :aria-modal="isNarrow ? true : undefined"
        aria-label="Server"
        @click.stop
      >
        <div class="mm-spick__head">
          <div>
            <div class="mm-eyebrow">FILTER</div>
            <h2 class="mm-spick__title">Server</h2>
          </div>
          <div class="mm-spick__actions">
            <button v-if="modelValue.length > 0" type="button" class="mm-spick__ghost" @click="clear(); open = false">Clear</button>
            <button type="button" class="mm-spick__done" @click="open = false">Done</button>
          </div>
        </div>

        <button
          type="button"
          class="mm-spick__live"
          :class="{ 'mm-spick__live--on': liveOnly }"
          :aria-pressed="liveOnly"
          @click="liveOnly = !liveOnly"
        >
          <i :class="liveOnly ? 'pi pi-users' : 'pi pi-globe'"></i>
          <span>{{ liveOnly ? 'Live servers only' : 'Include empty hosts' }}</span>
          <span v-if="liveCount > 0" class="mm-spick__pill">{{ liveCount }} live</span>
        </button>

        <div class="mm-spick__search">
          <i class="pi pi-search mm-spick__search-icon"></i>
          <input
            ref="searchRef"
            v-model="query"
            type="text"
            placeholder="Search server name / country..."
            class="mm-spick__input"
          />
          <button v-if="query" type="button" class="mm-spick__search-clear" @click="query = ''">
            <i class="pi pi-times"></i>
          </button>
        </div>

        <div v-if="modelValue.length > 0" class="mm-spick__chips">
          <span class="mm-spick__chips-k">Selected · {{ modelValue.length }}</span>
          <div class="mm-spick__chips-row">
            <button
              v-for="guid in modelValue"
              :key="guid"
              type="button"
              class="mm-spick__chip"
              :aria-label="`Remove ${chipLabel(guid)}`"
              @click="toggle(guid)"
            >
              {{ chipLabel(guid) }}
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>

        <div class="mm-spick__list">
          <button
            type="button"
            class="mm-spick__item"
            :class="{ 'mm-spick__item--active': modelValue.length === 0 }"
            :aria-pressed="modelValue.length === 0"
            @click="clear"
          >
            <span class="mm-spick__mark" :class="{ 'is-on': modelValue.length === 0 }"></span>
            <i class="pi pi-globe mm-spick__item-icon"></i>
            <span class="mm-spick__item-name">Live network</span>
            <span class="mm-spick__count">{{ liveOnly ? liveCount : servers.length }}</span>
            <span v-if="modelValue.length === 0" class="mm-spick__on">ON</span>
          </button>

          <button
            v-for="srv in visibleServers"
            :key="srv.guid"
            type="button"
            class="mm-spick__item"
            :class="{
              'mm-spick__item--active': selected.has(srv.guid),
              'mm-spick__item--quiet': liveOnly && srv.numPlayers === 0
            }"
            :aria-pressed="selected.has(srv.guid)"
            @click="toggle(srv.guid)"
          >
            <span class="mm-spick__mark" :class="{ 'is-on': selected.has(srv.guid) }"></span>
            <span v-if="srv.country" class="mm-spick__flag">{{ countryCodeToFlag(srv.country) }}</span>
            <span class="mm-spick__item-name">{{ $pn(srv.name) }}</span>
            <span class="mm-spick__avg" :class="{ 'mm-spick__avg--live': srv.numPlayers > 0 }">{{ srv.numPlayers }}</span>
            <span v-if="selected.has(srv.guid)" class="mm-spick__on">ON</span>
          </button>

          <div v-if="visibleServers.length === 0" class="mm-spick__empty">
            No servers match "{{ query }}"
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mm-spick {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  position: relative;
}
.mm-spick__label {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.mm-spick__anchor {
  position: relative;
  display: flex;
  align-items: stretch;
  max-width: 292px;
}
.mm-spick__btn {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.05em;
  background: var(--mm-bg-mute);
  color: var(--mm-ink);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 5px 24px 5px 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  flex: 1;
  min-width: 0;
  text-align: left;
  position: relative;
  min-height: 32px;
}
.mm-spick__btn:hover,
.mm-spick__btn--active,
.mm-spick__btn--open {
  border-color: var(--mm-accent);
}
.mm-spick__btn--open {
  box-shadow: 0 0 0 1px var(--mm-accent);
}
.mm-spick__icon { font-size: 11px; color: var(--mm-ink-muted); }
.mm-spick__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.mm-spick__chevron {
  position: absolute;
  right: 8px;
  font-size: 9px;
  color: var(--mm-ink-muted);
  pointer-events: none;
}
.mm-spick__count,
.mm-spick__avg {
  margin-left: auto;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
  flex-shrink: 0;
}
.mm-spick__avg--live { color: var(--mm-accent-soft); }
.mm-spick__flag { font-family: 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif; }
.mm-spick__clear {
  flex-shrink: 0;
  width: 32px;
  border: 1px solid var(--mm-rule);
  border-left: 0;
  border-radius: 0 2px 2px 0;
  background: var(--mm-bg-mute);
  color: var(--mm-ink);
  cursor: pointer;
  font-size: 18px;
}
.mm-spick__btn:has(+ .mm-spick__clear) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.mm-spick__pop {
  z-index: 1200;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  width: 320px;
  max-width: 90vw;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mm-spick__head { display: none; }
.mm-spick__title {
  margin: 4px 0 0;
  font-family: var(--mm-font-display);
  font-size: 28px;
  font-weight: 500;
  color: var(--mm-ink);
}
.mm-spick__actions { display: flex; gap: 8px; }
.mm-spick__done,
.mm-spick__ghost {
  min-height: 44px;
  padding: 8px 14px;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}
.mm-spick__ghost { border: 0; color: var(--mm-ink-muted); }
.mm-spick__live {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-align: left;
}
.mm-spick__live--on {
  border-color: var(--mm-accent);
  color: var(--mm-ink);
}
.mm-spick__pill {
  margin-left: auto;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-accent-soft);
}
.mm-spick__search { position: relative; display: flex; align-items: center; }
.mm-spick__search-icon {
  position: absolute;
  left: 8px;
  font-size: 11px;
  color: var(--mm-ink-muted);
}
.mm-spick__input {
  width: 100%;
  padding: 6px 24px 6px 26px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  font-size: 12px;
  outline: none;
}
.mm-spick__input:focus { border-color: var(--mm-accent); }
.mm-spick__search-clear {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  color: var(--mm-ink-muted);
  cursor: pointer;
}
.mm-spick__chips { display: flex; flex-direction: column; gap: 6px; }
.mm-spick__chips-k {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.mm-spick__chips-row { display: flex; flex-wrap: wrap; gap: 6px; }
.mm-spick__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  color: var(--mm-ink-soft);
  font-size: 11px;
  cursor: pointer;
}
.mm-spick__list {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mm-spick__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: var(--mm-ink);
  font-family: var(--mm-font-display);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  width: 100%;
}
.mm-spick__item:hover { background: var(--mm-bg-mute); color: var(--mm-accent); }
.mm-spick__item--quiet { opacity: 0.55; }
.mm-spick__item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.mm-spick__item-icon { font-size: 11px; color: var(--mm-ink-muted); }
.mm-spick__mark {
  width: 15px;
  height: 15px;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  flex-shrink: 0;
  background: var(--mm-bg);
}
.mm-spick__mark.is-on {
  background: var(--mm-accent);
  border-color: var(--mm-accent);
}
.mm-spick__mark.is-on::after {
  content: '';
  display: block;
  width: 7px;
  height: 4px;
  margin: 3px auto 0;
  border-left: 1.5px solid var(--mm-highlight-ink);
  border-bottom: 1.5px solid var(--mm-highlight-ink);
  transform: rotate(-45deg);
}
.mm-spick__on {
  margin-left: 4px;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--mm-accent-soft);
}
.mm-spick__empty {
  padding: 12px 8px;
  color: var(--mm-ink-muted);
  font-size: 12px;
}

.mm-spick__pop--sheet {
  position: fixed;
  inset: 0;
  z-index: 1200;
  width: 100%;
  height: 100dvh;
  max-width: none;
  border: 0;
  border-radius: 0;
  padding: 0 0 env(safe-area-inset-bottom);
  background: var(--mm-bg);
  gap: 10px;
  overflow: hidden;
}
.mm-spick__pop--sheet .mm-spick__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  padding-top: max(16px, env(safe-area-inset-top));
  border-bottom: 1px solid var(--mm-rule);
}
.mm-spick__pop--sheet .mm-spick__live,
.mm-spick__pop--sheet .mm-spick__search,
.mm-spick__pop--sheet .mm-spick__chips {
  margin-left: 16px;
  margin-right: 16px;
}
.mm-spick__pop--sheet .mm-spick__list {
  flex: 1;
  max-height: none;
  min-height: 0;
  padding: 0 8px 16px;
}
.mm-spick__pop--sheet .mm-spick__item { min-height: 48px; padding: 12px 10px; font-size: 14px; }
.mm-spick__pop--sheet .mm-spick__input { min-height: 44px; font-size: 16px; }
.mm-spick__pop--sheet .mm-spick__live { min-height: 48px; }
</style>
