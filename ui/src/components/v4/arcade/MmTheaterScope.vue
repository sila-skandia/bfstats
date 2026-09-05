<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ArcadeServer } from '@/services/arcadeService'
import { decodeServerName } from '@/utils/playerName'
import { useArcadeAudio } from '@/composables/useArcadeAudio'

const props = defineProps<{
  servers: ArcadeServer[]
  selectedGuid: string
  loading?: boolean
}>()

const emit = defineEmits<{
  select: [guid: string]
}>()

const { playRoger } = useArcadeAudio()

const hoveredGuid = ref<string | null>(null)
const now = ref(new Date())
let clockTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})

const SCOPE_TIME = computed(() =>
  new Intl.DateTimeFormat('default', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now.value)
)

interface ScopeContact {
  guid: string
  name: string
  country: string
  currentPlayers: number
  totalPlayTimeHours: number
  totalCandidates: number
  live: boolean
  bearing: number
  range: number
  x: number
  y: number
  left: string
  top: string
}

const REGION_BEARING: Record<string, number> = {
  US: 252, CA: 258, MX: 242, CU: 236,
  BR: 218, AR: 210, CL: 208, CO: 228, PE: 214, VE: 224, UY: 212,
  GB: 348, UK: 348, IE: 342, FR: 356, ES: 350, PT: 346,
  NL: 6, BE: 4, DE: 10, CH: 2, AT: 14, IT: 8, LU: 5,
  SE: 16, NO: 12, FI: 22, DK: 8, IS: 330, EE: 24, LV: 26, LT: 28,
  PL: 20, CZ: 18, SK: 21, HU: 19, RO: 28, BG: 30, UA: 32, BY: 30,
  RS: 24, HR: 16, SI: 14, GR: 26, MK: 25,
  RU: 42, KZ: 55, GE: 38, AM: 40, AZ: 42,
  TR: 36, IL: 40, SA: 48, AE: 52, IR: 50, IQ: 46, QA: 51,
  EG: 44, ZA: 178, MA: 338, TN: 8, NG: 190, KE: 165, DZ: 352,
  IN: 78, PK: 70, CN: 92, JP: 108, KR: 102, TW: 100, TH: 88,
  VN: 90, ID: 118, MY: 112, PH: 114, SG: 110,
  AU: 138, NZ: 152, UN: 180,
}

const hash32 = (value: string): number => {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const countryBearing = (country: string): number => {
  const code = (country || 'UN').toUpperCase()
  if (REGION_BEARING[code] != null) return REGION_BEARING[code]
  return hash32(code) % 360
}

const MAX_LOCKABLE = 16

const placeServers = (servers: ArcadeServer[]): ScopeContact[] => {
  if (servers.length === 0) return []

  const grouped = new Map<string, ArcadeServer[]>()
  for (const server of servers) {
    const code = (server.country || 'UN').toUpperCase()
    const bucket = grouped.get(code) ?? []
    bucket.push(server)
    grouped.set(code, bucket)
  }

  const placed: ScopeContact[] = []
  for (const [code, list] of grouped) {
    const base = countryBearing(code)
    const sector = Math.min(52, 18 + list.length * 2.4)
    list.forEach((server, index) => {
      const jitter = (hash32(server.guid) % 10000) / 10000
      const t = list.length === 1 ? 0.5 : index / (list.length - 1)
      const bearing = (base - sector / 2 + t * sector + (jitter - 0.5) * 8 + 360) % 360
      const live = server.currentPlayers > 0
      const ring = 0.33 + (index % 4) * 0.13 + jitter * 0.07 + (live ? 0 : 0.05)
      const range = Math.min(0.88, Math.max(0.28, ring))
      const rad = (bearing * Math.PI) / 180
      const x = 50 + Math.sin(rad) * range * 46
      const y = 50 - Math.cos(rad) * range * 46
      placed.push({
        guid: server.guid,
        name: server.name,
        country: code,
        currentPlayers: server.currentPlayers,
        totalPlayTimeHours: server.totalPlayTimeHours || 0,
        totalCandidates: server.totalCandidates,
        live,
        bearing,
        range,
        x,
        y,
        left: `${x}%`,
        top: `${y}%`,
      })
    })
  }
  return placed
}

const allContacts = computed(() => placeServers(props.servers))

const lockableIds = computed(() => {
  const ids = new Set<string>()
  const live = props.servers.filter(s => s.currentPlayers > 0)
  for (const server of live) ids.add(server.guid)
  if (props.selectedGuid) ids.add(props.selectedGuid)
  const quiet = props.servers
    .filter(s => s.currentPlayers <= 0 && s.guid !== props.selectedGuid)
    .sort((a, b) => (b.totalPlayTimeHours || 0) - (a.totalPlayTimeHours || 0))
  for (const server of quiet) {
    if (ids.size >= MAX_LOCKABLE) break
    ids.add(server.guid)
  }
  return ids
})

const contacts = computed(() =>
  allContacts.value.filter(contact => lockableIds.value.has(contact.guid))
)

const ghosts = computed(() =>
  allContacts.value.filter(contact => !lockableIds.value.has(contact.guid))
)

const liveContacts = computed(() => allContacts.value.filter(c => c.live))

const liveCount = computed(() =>
  props.servers.reduce((sum, s) => sum + (s.currentPlayers > 0 ? s.currentPlayers : 0), 0)
)

const focused = computed<ScopeContact | null>(() => {
  if (hoveredGuid.value) {
    return contacts.value.find(c => c.guid === hoveredGuid.value) ?? null
  }
  if (props.selectedGuid) {
    return contacts.value.find(c => c.guid === props.selectedGuid) ?? null
  }
  return null
})

const locked = computed(() =>
  props.selectedGuid
    ? contacts.value.find(c => c.guid === props.selectedGuid) ?? null
    : null
)

const formatHours = (hours?: number) => {
  if (!hours || hours <= 0) return '—'
  if (hours >= 1000) return `${(hours / 1000).toFixed(1)}k hrs`
  return `${Math.round(hours)} hrs`
}

const formatBearing = (deg: number) => `${String(Math.round(deg) % 360).padStart(3, '0')}°`

const formatRange = (range: number) => range.toFixed(2)

const tickerItems = computed(() => {
  const live = liveContacts.value
  if (live.length === 0) return []
  return [...live, ...live]
})

const lockContact = (guid: string) => {
  emit('select', guid)
  playRoger()
}

const releaseLock = () => {
  emit('select', '')
  playRoger()
}

const onBlipEnter = (guid: string) => {
  hoveredGuid.value = guid
}

const onBlipLeave = () => {
  hoveredGuid.value = null
}
</script>

<template>
  <section
    class="theater"
    data-testid="arcade-theater-scope"
    aria-label="Theater of operations"
  >
    <header class="theater__mast">
      <div>
        <p class="mm-eyebrow">Scope // Theater of operations</p>
        <p
          class="theater__clock"
          title="Times shown in your local time"
        >
          {{ SCOPE_TIME }}
          <span class="theater__clock-hint">local</span>
        </p>
      </div>
      <div class="theater__counts">
        <div class="theater__count">
          <span class="mm-eyebrow">Contacts</span>
          <span class="theater__count-val">{{ loading ? '—' : servers.length }}</span>
        </div>
        <div class="theater__count">
          <span class="mm-eyebrow">Live</span>
          <span class="theater__count-val theater__count-val--live">{{ loading ? '—' : liveCount }}</span>
        </div>
      </div>
    </header>

    <div class="theater__board">
      <div class="theater__scope-col">
        <div
          class="scope"
          :class="{ 'scope--acquiring': loading }"
        >
          <div
            class="scope__bracket scope__bracket--tl"
            aria-hidden="true"
          />
          <div
            class="scope__bracket scope__bracket--tr"
            aria-hidden="true"
          />
          <div
            class="scope__bracket scope__bracket--bl"
            aria-hidden="true"
          />
          <div
            class="scope__bracket scope__bracket--br"
            aria-hidden="true"
          />

          <div
            class="scope__face"
            role="group"
            aria-label="Radar contacts"
          >
            <div
              class="scope__sweep"
              aria-hidden="true"
            />
            <div
              class="scope__scan"
              aria-hidden="true"
            />

            <svg
              class="scope__grid"
              viewBox="0 0 200 200"
              aria-hidden="true"
            >
              <circle
                cx="100"
                cy="100"
                r="22"
              />
              <circle
                cx="100"
                cy="100"
                r="44"
              />
              <circle
                cx="100"
                cy="100"
                r="66"
              />
              <circle
                cx="100"
                cy="100"
                r="88"
              />
              <line
                x1="100"
                y1="10"
                x2="100"
                y2="190"
              />
              <line
                x1="10"
                y1="100"
                x2="190"
                y2="100"
              />
              <text
                x="100"
                y="9"
                text-anchor="middle"
              >N</text>
              <text
                x="193"
                y="103"
                text-anchor="middle"
              >E</text>
              <text
                x="100"
                y="198"
                text-anchor="middle"
              >S</text>
              <text
                x="8"
                y="103"
                text-anchor="middle"
              >W</text>
              <circle
                v-for="ghost in ghosts"
                :key="ghost.guid"
                class="scope__ghost"
                :cx="ghost.x * 2"
                :cy="ghost.y * 2"
                r="1.1"
              />
            </svg>

            <button
              type="button"
              class="scope__hq"
              :class="{ 'scope__hq--active': !selectedGuid }"
              :aria-pressed="!selectedGuid"
              aria-label="Headquarters, global network"
              @click="releaseLock"
            >
              <span class="scope__hq-pip" />
              <span class="scope__hq-label">HQ</span>
            </button>

            <button
              v-for="(contact, index) in contacts"
              :key="contact.guid"
              type="button"
              class="scope__blip"
              :class="{
                'scope__blip--live': contact.live,
                'scope__blip--locked': selectedGuid === contact.guid,
                'scope__blip--hover': hoveredGuid === contact.guid
              }"
              :style="{ left: contact.left, top: contact.top, '--i': String(index) }"
              :aria-pressed="selectedGuid === contact.guid"
              :aria-label="`${decodeServerName(contact.name)}, ${contact.country}${contact.live ? `, ${contact.currentPlayers} live` : ''}`"
              @click="lockContact(contact.guid)"
              @mouseenter="onBlipEnter(contact.guid)"
              @mouseleave="onBlipLeave"
              @focus="onBlipEnter(contact.guid)"
              @blur="onBlipLeave"
            >
              <span class="scope__pip" />
            </button>
          </div>
        </div>
      </div>

      <aside class="theater__readout">
        <p class="mm-eyebrow">
          <template v-if="loading">Acquiring</template>
          <template v-else-if="hoveredGuid && focused && focused.guid !== selectedGuid">Painted</template>
          <template v-else-if="locked">Locked</template>
          <template v-else>Headquarters</template>
        </p>

        <template v-if="loading">
          <h2 class="theater__callsign">Sweeping theater</h2>
          <p class="theater__detail">Compiling contacts from tracked battlegrounds.</p>
        </template>

        <template v-else-if="focused">
          <h2 class="theater__callsign">{{ $pn(focused.name) }}</h2>
          <div class="theater__meta">
            <span class="mm-country-badge">{{ focused.country }}</span>
            <span
              v-if="focused.live"
              class="theater__live"
            >{{ focused.currentPlayers }} live</span>
            <span
              v-else
              class="theater__quiet"
            >Quiet</span>
          </div>
          <dl class="theater__stats">
            <div>
              <dt>Bearing</dt>
              <dd>{{ formatBearing(focused.bearing) }}</dd>
            </div>
            <div>
              <dt>Range</dt>
              <dd>{{ formatRange(focused.range) }}</dd>
            </div>
            <div>
              <dt>Playtime</dt>
              <dd>{{ formatHours(focused.totalPlayTimeHours) }}</dd>
            </div>
            <div>
              <dt>Pool</dt>
              <dd>{{ focused.totalCandidates }}</dd>
            </div>
          </dl>
          <button
            v-if="locked && locked.guid === focused.guid"
            type="button"
            class="theater__release"
            @click="releaseLock"
          >
            Release lock
          </button>
          <p
            v-else
            class="theater__hint"
          >
            Click the contact to lock this theater.
          </p>
        </template>

        <template v-else>
          <h2 class="theater__callsign">Global network</h2>
          <p class="theater__detail">
            Exercise draws from every tracked battleground. Lock a contact to scope the games to one server.
          </p>
        </template>
      </aside>
    </div>

    <div
      class="mm-section-bar theater__intercept"
      aria-live="polite"
    >
      <span>Intercept</span>
      <div
        v-if="tickerItems.length > 0"
        class="theater__ticker"
      >
        <div class="theater__ticker-track">
          <span
            v-for="(item, index) in tickerItems"
            :key="`${item.guid}-${index}`"
            class="theater__ticker-item"
          >
            {{ item.currentPlayers }} live · {{ $pn(item.name) }} · {{ item.country }}
          </span>
        </div>
      </div>
      <span
        v-else
        class="mm-section-bar__meta"
      >
        {{ loading ? 'Listening…' : 'Theater quiet — no live contacts' }}
      </span>
    </div>
  </section>
</template>

<style scoped>
.theater {
  margin: 0 0 28px;
}

.theater__mast {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.theater__clock {
  margin: 6px 0 0;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-soft);
}

.theater__clock-hint {
  margin-left: 8px;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.theater__counts {
  display: flex;
  gap: 20px;
}

.theater__count {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.theater__count-val {
  font-family: var(--mm-font-mono);
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
  color: var(--mm-ink);
}

.theater__count-val--live {
  color: var(--mm-success);
}

.theater__board {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: 28px;
  align-items: center;
}

.theater__scope-col {
  display: flex;
  justify-content: center;
}

.scope {
  position: relative;
  width: min(100%, 340px);
  aspect-ratio: 1;
}

.scope__bracket {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 1px solid var(--mm-accent);
  pointer-events: none;
  z-index: 4;
}

.scope__bracket--tl {
  top: 0;
  left: 0;
  border-right: 0;
  border-bottom: 0;
}

.scope__bracket--tr {
  top: 0;
  right: 0;
  border-left: 0;
  border-bottom: 0;
}

.scope__bracket--bl {
  bottom: 0;
  left: 0;
  border-right: 0;
  border-top: 0;
}

.scope__bracket--br {
  bottom: 0;
  right: 0;
  border-left: 0;
  border-top: 0;
}

.scope__face {
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  overflow: hidden;
  background: radial-gradient(
    circle at 50% 50%,
    var(--mm-bg-mute) 0%,
    var(--mm-bg) 72%,
    var(--mm-bg-soft) 100%
  );
  box-shadow: inset 0 0 0 1px var(--mm-rule-strong);
}

.scope__sweep {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    color-mix(in srgb, var(--mm-accent) 38%, transparent) 0deg,
    color-mix(in srgb, var(--mm-accent) 10%, transparent) 28deg,
    transparent 58deg
  );
  animation: theater-sweep 5.2s linear infinite;
  pointer-events: none;
  z-index: 1;
}

.scope__scan {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent 2px,
    color-mix(in srgb, var(--mm-ink) 4%, transparent) 2px,
    color-mix(in srgb, var(--mm-ink) 4%, transparent) 3px
  );
  pointer-events: none;
  z-index: 2;
}

.scope__grid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none;
}

.scope__grid circle,
.scope__grid line {
  fill: none;
  stroke: var(--mm-rule);
  stroke-width: 0.6;
}

.scope__grid circle:last-of-type {
  stroke: var(--mm-rule-strong);
}

.scope__grid text {
  fill: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
  font-size: 7px;
  letter-spacing: 0.08em;
}

.scope__ghost {
  fill: var(--mm-ink-faint);
  stroke: none;
}

.scope__hq {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 44px;
  height: 44px;
  transform: translate(-50%, -50%);
  z-index: 5;
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.scope__hq-pip {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mm-ink);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mm-ink) 18%, transparent);
}

.scope__hq--active .scope__hq-pip {
  background: var(--mm-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mm-accent) 28%, transparent);
}

.scope__hq-label {
  font-family: var(--mm-font-mono);
  font-size: 8px;
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
}

.scope__hq--active .scope__hq-label {
  color: var(--mm-accent-soft);
}

.scope__hq:focus-visible,
.scope__blip:focus-visible {
  outline: 1px solid var(--mm-accent);
  outline-offset: 2px;
}

.scope__blip {
  position: absolute;
  width: 44px;
  height: 44px;
  transform: translate(-50%, -50%);
  z-index: 4;
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: theater-blip-in 0.45s ease backwards;
  animation-delay: calc(var(--i, 0) * 18ms);
}

.scope__pip {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mm-ink-muted);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--mm-ink) 12%, transparent);
}

.scope__blip--live .scope__pip {
  background: var(--mm-success);
  box-shadow: 0 0 8px color-mix(in srgb, var(--mm-success) 55%, transparent);
}

.scope__blip--live::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--mm-success) 45%, transparent);
  animation: theater-ping 2.4s ease-out infinite;
}

.scope__blip--hover .scope__pip,
.scope__blip--locked .scope__pip {
  background: var(--mm-accent-soft);
  box-shadow: 0 0 10px color-mix(in srgb, var(--mm-accent) 60%, transparent);
}

.scope__blip--locked::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  border: 1px solid var(--mm-accent);
  transform: rotate(45deg);
  pointer-events: none;
}

.theater__readout {
  min-width: 0;
  padding-top: 4px;
}

.theater__callsign {
  margin: 8px 0 10px;
  font-family: var(--mm-font-display);
  font-size: clamp(26px, 4vw, 36px);
  font-weight: 500;
  line-height: 1.1;
  color: var(--mm-ink);
  overflow-wrap: anywhere;
}

.theater__detail {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--mm-ink-muted);
  max-width: 42ch;
}

.theater__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.theater__live {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--mm-success);
}

.theater__quiet {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.theater__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  margin: 0 0 16px;
}

.theater__stats dt {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.theater__stats dd {
  margin: 4px 0 0;
  font-family: var(--mm-font-mono);
  font-size: 16px;
  color: var(--mm-ink);
}

.theater__release {
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

.theater__release:hover {
  border-color: var(--mm-accent);
  color: var(--mm-accent);
}

.theater__hint {
  margin: 0;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--mm-ink-faint);
}

.theater__intercept {
  margin-top: 20px;
  overflow: hidden;
}

.theater__ticker {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  mask-image: linear-gradient(
    to right,
    transparent,
    var(--mm-highlight-ink) 8%,
    var(--mm-highlight-ink) 92%,
    transparent
  );
}

.theater__ticker-track {
  display: flex;
  gap: 28px;
  width: max-content;
  animation: theater-ticker 42s linear infinite;
}

.theater__ticker-item {
  white-space: nowrap;
  color: var(--mm-highlight-ink);
}

.mm-country-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 4px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: inherit;
  background: color-mix(in srgb, var(--mm-ink) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--mm-ink) 15%, transparent);
  border-radius: 2px;
  line-height: 1;
}

@keyframes theater-sweep {
  to { transform: rotate(360deg); }
}

@keyframes theater-ping {
  0% { transform: scale(0.6); opacity: 0.7; }
  100% { transform: scale(2.1); opacity: 0; }
}

@keyframes theater-blip-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

@keyframes theater-ticker {
  to { transform: translateX(-50%); }
}

@media (max-width: 720px) {
  .theater__board {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .scope {
    width: min(100%, 280px);
  }

  .theater__count {
    align-items: flex-end;
  }

  .theater__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .scope__sweep,
  .scope__blip--live::after,
  .scope__blip,
  .theater__ticker-track {
    animation: none;
  }
}
</style>
