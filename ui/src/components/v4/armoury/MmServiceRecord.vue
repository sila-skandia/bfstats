<script setup lang="ts">
// The player's service record: every army their time on each (map, side) puts
// them in, the soldier of the selected army in 3D wearing that army's kit, and
// the vehicles that army fielded where they fought. See features/service-record.
import { computed, ref, watch } from 'vue'
import MmArmouryStage from './MmArmouryStage.vue'
import {
  defaultKit, figureSpec, hudUrl, meshSiteModelUrl, meshUrl, modLabel, nationBadge, openingArmy,
} from './meshAssets'
import { kdClass } from '@/views/v4/mmTokens'
import {
  fetchServiceRecord,
  type ArmyFigureKit,
  type ServiceRecord,
  type ServiceRecordArmy,
  type ServiceRecordVehicle,
} from '@/services/serviceRecordApi'

const props = defineProps<{ playerName: string }>()
const emit = defineEmits<{ openMap: [mapName: string, gameId: string] }>()

const ROSTER_PREVIEW = 6

const record = ref<ServiceRecord | null>(null)
const loading = ref(true)
const selectedKey = ref<string | null>(null)
const kitTemplate = ref<string | null>(null)
const vehicleTemplate = ref<string | null>(null)
const showAllArmies = ref(false)

async function load(name: string) {
  loading.value = true
  record.value = null
  selectedKey.value = null
  try {
    record.value = await fetchServiceRecord(name)
    selectedKey.value = openingArmy(record.value)?.key ?? null
  } catch {
    // The panel is an addition to the profile, not a dependency of it.
    record.value = null
  } finally {
    loading.value = false
  }
}

watch(() => props.playerName, name => { void load(name) }, { immediate: true })

const armies = computed(() => record.value?.armies ?? [])
const selected = computed<ServiceRecordArmy | null>(() =>
  armies.value.find(army => army.key === selectedKey.value) ?? armies.value[0] ?? null)
const selectedRank = computed(() => (selected.value ? armies.value.indexOf(selected.value) + 1 : 0))

watch(selected, army => {
  kitTemplate.value = defaultKit(army?.figure ?? null)?.template ?? null
  vehicleTemplate.value = null
})

const figureKits = computed(() => selected.value?.figure?.kits ?? [])
const activeKit = computed<ArmyFigureKit | null>(() =>
  figureKits.value.find(kit => kit.template === kitTemplate.value) ?? defaultKit(selected.value?.figure ?? null))

/** The army's kits in the level's own order, each with its icon and whether the armoury can dress it. */
const kitButtons = computed(() => (selected.value?.kits ?? []).map(kit => ({
  ...kit,
  figure: figureKits.value.find(entry => entry.template.toLowerCase() === kit.template.toLowerCase()) ?? null,
})).filter(kit => kit.figure))

const activeVehicle = computed<ServiceRecordVehicle | null>(() =>
  selected.value?.vehicles.find(vehicle => vehicle.template === vehicleTemplate.value && vehicle.model) ?? null)

const stageFigure = computed(() => figureSpec(activeKit.value))
const stageVehicle = computed(() => (activeVehicle.value?.model ? { model: activeVehicle.value.model } : null))
const stageFallback = computed(() => {
  const thumb = activeVehicle.value ? activeVehicle.value.thumb : selected.value?.figure?.thumb
  return thumb ? meshUrl(thumb) : null
})

const stageLabel = computed(() => {
  const army = selected.value
  if (!army) return ''
  if (activeVehicle.value) return `${activeVehicle.value.name}, fielded by ${armyRef.value}`
  const kit = activeKit.value
  return kit ? `A ${army.name} soldier carrying the ${kit.weapon}` : `${army.name}`
})

const sideShare = computed(() => {
  const sides = record.value?.sides ?? []
  const axis = sides.find(side => side.side === 'axis')?.minutes ?? 0
  const allied = sides.find(side => side.side === 'allied')?.minutes ?? 0
  const total = axis + allied
  return total > 0 ? { axis: Math.round((axis / total) * 100), allied: Math.round((allied / total) * 100) } : null
})

const visibleArmies = computed(() =>
  showAllArmies.value ? armies.value : armies.value.slice(0, ROSTER_PREVIEW))

const maxArmyMinutes = computed(() => Math.max(1, ...armies.value.map(army => army.minutes)))

function hours(minutes: number): string {
  const tenths = Math.round(minutes / 6) / 10
  if (minutes > 0 && tenths < 0.1) return '<0.1'
  return tenths < 10 ? tenths.toFixed(1) : Math.round(minutes / 60).toLocaleString()
}

/**
 * The stencil's size, in characters to fit across the stage: a short name on one
 * line ("US ARMY"), a long one wrapped at spaces but never broken mid-word.
 */
function longestWord(text: string): number {
  const longest = Math.max(4, ...text.split(/\s+/).map(word => word.length))
  return Math.max(longest, Math.min(text.length, 12))
}

function share(army: ServiceRecordArmy): number {
  const total = record.value?.attributedMinutes ?? 0
  return total > 0 ? Math.round((army.minutes / total) * 100) : 0
}

function kd(army: { kills: number, deaths: number }): number {
  return army.deaths > 0 ? army.kills / army.deaths : army.kills
}

function winRate(army: { wins: number, losses: number }): string {
  const decided = army.wins + army.losses
  return decided >= 5 ? `${Math.round((army.wins / decided) * 100)}%` : '—'
}

function selectArmy(army: ServiceRecordArmy) {
  selectedKey.value = army.key
}

function selectVehicle(vehicle: ServiceRecordVehicle) {
  if (!vehicle.model) return
  vehicleTemplate.value = vehicleTemplate.value === vehicle.template ? null : vehicle.template
}

const categoryLabel: Record<string, string> = { land: 'Land', air: 'Air', sea: 'Sea' }

/** The busiest regulars' records cover their latest thousand rounds; this is when those began. */
const windowSince = computed(() => {
  const since = record.value?.window?.since
  return since ? new Date(since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null
})

/** "the Red Army", but plain "Iraq": mod armies are named by their nation, which takes no article. */
const armyRef = computed(() => {
  const army = selected.value
  if (!army) return ''
  return army.name === army.nationLabel ? army.name : `the ${army.name}`
})
</script>

<template>
  <section
    v-if="loading || selected"
    class="mm-panel mm-sr"
    data-testid="service-record"
  >
    <div class="mm-pbar">
      <span class="mm-pbar__t"># Service record</span>
      <span
        v-if="record && selected"
        class="mm-pbar__m"
      >
        {{ hours(record.attributedMinutes) }} h · {{ armies.length }} {{ armies.length === 1 ? 'army' : 'armies' }}<span
          v-if="sideShare"
          class="mm-sr__pbar-sides"
        > · axis {{ sideShare.axis }} / allied {{ sideShare.allied }}</span><span
          v-if="record.window?.capped"
          :title="windowSince ? `Counted from ${windowSince}` : undefined"
        > · last {{ record.window.sessions.toLocaleString() }} rounds</span>
      </span>
    </div>

    <div
      v-if="loading"
      class="mm-sr__body"
    >
      <div class="mm-sr__stage mm-skeleton" />
      <div class="mm-sr__detail">
        <div
          class="mm-skeleton"
          style="width: 40%; height: 12px"
        />
        <div
          class="mm-skeleton mm-skeleton--lg"
          style="width: 65%; margin-top: 12px"
        />
        <div
          v-for="i in 5"
          :key="i"
          class="mm-skeleton"
          style="height: 28px; margin-top: 12px"
        />
      </div>
    </div>

    <div
      v-else-if="selected && record"
      class="mm-sr__body"
    >
      <MmArmouryStage
        class="mm-sr__stage"
        :class="`mm-sr__stage--${selected.side}`"
        :label="stageLabel"
        :figure="stageFigure"
        :vehicle="stageVehicle"
        :side="selected.side"
        :fallback="stageFallback"
      >
        <template #backdrop>
          <div class="mm-sr__glow" />
          <div
            class="mm-sr__stencil"
            :style="{ '--longest': longestWord(activeVehicle ? activeVehicle.name : selected.name) }"
          >
            {{ activeVehicle ? activeVehicle.name : selected.name }}
          </div>
        </template>

        <div class="mm-sr__stage-top">
          <span class="mm-country-badge">{{ nationBadge(selected.nation, selected.nationLabel) }}</span>
          <span class="mm-sr__stage-nation">{{ selected.nationLabel }}</span>
          <button
            v-if="activeVehicle"
            type="button"
            class="mm-sr__back"
            @click="vehicleTemplate = null"
          >
            [&lt;-] Soldier
          </button>
        </div>

        <div
          v-if="!selected.figure && !activeVehicle"
          class="mm-sr__no-figure"
        >
          No soldier extracted for {{ modLabel(selected.mod) ?? 'this army' }} yet
        </div>

        <div class="mm-sr__stage-foot">
          <template v-if="activeVehicle">
            <div class="mm-sr__caption">
              {{ activeVehicle.name }} · {{ categoryLabel[activeVehicle.category] ?? activeVehicle.category }}
            </div>
            <a
              v-if="meshSiteModelUrl(activeVehicle.model)"
              class="mm-sr__mesh-link"
              :href="meshSiteModelUrl(activeVehicle.model)!"
              target="_blank"
              rel="noopener"
            >Inspect on mesh.bfstats.io [-&gt;]</a>
          </template>
          <template v-else-if="!selected.figure && selected.kits.some(kit => kit.iconPath)">
            <div
              class="mm-sr__kits mm-sr__kits--static"
              aria-label="Kits this army carried"
            >
              <span
                v-for="kit in selected.kits.filter(kit => kit.iconPath)"
                :key="kit.template"
                class="mm-sr__kit"
                :title="kit.name"
              >
                <img
                  :src="hudUrl(kit.iconPath!)"
                  alt=""
                  loading="lazy"
                >
              </span>
            </div>
          </template>
          <template v-else-if="kitButtons.length">
            <div
              class="mm-sr__kits"
              role="group"
              aria-label="Kit"
            >
              <button
                v-for="kit in kitButtons"
                :key="kit.template"
                type="button"
                class="mm-sr__kit"
                :class="{ 'mm-sr__kit--active': kit.figure?.template === activeKit?.template }"
                :aria-pressed="kit.figure?.template === activeKit?.template"
                :aria-label="`${kit.name} kit`"
                :title="`${kit.name} · ${kit.figure?.weapon}`"
                @click="kitTemplate = kit.figure?.template ?? null"
              >
                <img
                  v-if="kit.iconPath"
                  :src="hudUrl(kit.iconPath)"
                  alt=""
                  loading="lazy"
                >
                <span v-else>{{ kit.name.slice(0, 2) }}</span>
              </button>
            </div>
            <div
              v-if="activeKit"
              class="mm-sr__caption"
            >
              {{ kitButtons.find(kit => kit.figure?.template === activeKit?.template)?.name ?? 'Kit' }} · {{ activeKit.weapon }}
            </div>
          </template>
        </div>
      </MmArmouryStage>

      <div class="mm-sr__detail">
        <div class="mm-sr__lead">
          <div class="mm-eyebrow">
            <template v-if="selectedRank === 1">
              Primary service · {{ share(selected) }}% of their time
            </template>
            <template v-else>
              #{{ selectedRank }} of {{ armies.length }} armies · {{ share(selected) }}% of their time
            </template>
          </div>
          <h3 class="mm-sr__army">
            {{ selected.name }}
          </h3>
          <div class="mm-sr__meta">
            <span
              class="mm-chip"
              :class="selected.side === 'axis' ? 'mm-chip--loss' : 'mm-chip--win'"
            >{{ selected.side === 'axis' ? 'Axis' : 'Allied' }}</span>
            <span v-if="modLabel(selected.mod)">{{ modLabel(selected.mod) }}</span>
          </div>

          <dl class="mm-sr__kpis">
            <div>
              <dt>Hours</dt>
              <dd>{{ hours(selected.minutes) }}</dd>
            </div>
            <div>
              <dt>Rounds</dt>
              <dd>{{ selected.rounds.toLocaleString() }}</dd>
            </div>
            <div>
              <dt>K/D</dt>
              <dd :class="kdClass(kd(selected))">
                {{ kd(selected).toFixed(2) }}
              </dd>
            </div>
            <div>
              <dt>Won</dt>
              <dd>{{ winRate(selected) }}</dd>
            </div>
          </dl>

          <div
            v-if="selected.maps.length"
            class="mm-sr__theatres"
          >
            <span class="mm-sr__label">Fought at</span>
            <button
              v-for="map in selected.maps"
              :key="`${map.gameId}/${map.mapName}`"
              type="button"
              class="mm-sr__theatre"
              @click="emit('openMap', map.mapName, map.gameId)"
            >
              {{ map.displayName }} <span>{{ hours(map.minutes) }} h</span>
            </button>
          </div>
        </div>

        <ol
          class="mm-sr__roster"
          aria-label="Armies served"
        >
          <li
            v-for="(army, index) in visibleArmies"
            :key="army.key"
          >
            <button
              type="button"
              class="mm-sr__row"
              :class="{ 'mm-sr__row--active': army.key === selected.key }"
              :aria-pressed="army.key === selected.key"
              @click="selectArmy(army)"
            >
              <span class="mm-sr__row-rank">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="mm-country-badge">{{ nationBadge(army.nation, army.nationLabel) }}</span>
              <span class="mm-sr__row-name">
                {{ army.name }}
                <span
                  v-if="modLabel(army.mod)"
                  class="mm-sr__row-mod"
                >{{ modLabel(army.mod) }}</span>
              </span>
              <span
                class="mm-sr__row-bar"
                aria-hidden="true"
              >
                <span
                  :class="`mm-sr__row-fill mm-sr__row-fill--${army.side}`"
                  :style="{ width: `${Math.max(3, (army.minutes / maxArmyMinutes) * 100)}%` }"
                />
              </span>
              <span class="mm-sr__row-num">{{ hours(army.minutes) }}<small>h</small></span>
              <span
                class="mm-sr__row-num mm-sr__row-num--hide-sm"
                :class="kdClass(kd(army))"
              >{{ kd(army).toFixed(2) }}</span>
              <span class="mm-sr__row-num mm-sr__row-num--hide-sm">{{ winRate(army) }}</span>
            </button>
          </li>
        </ol>
        <button
          v-if="armies.length > ROSTER_PREVIEW"
          type="button"
          class="mm-sr__more"
          @click="showAllArmies = !showAllArmies"
        >
          {{ showAllArmies ? 'Fewer' : `All ${armies.length} armies` }} [{{ showAllArmies ? '-' : '+' }}]
        </button>

        <div
          v-if="selected.vehicles.length"
          class="mm-sr__pool"
        >
          <div class="mm-sr__label">
            Arsenal · what {{ armyRef }} fielded where they fought
          </div>
          <ul class="mm-sr__vehicles">
            <li
              v-for="vehicle in selected.vehicles"
              :key="vehicle.template"
            >
              <component
                :is="vehicle.model ? 'button' : 'div'"
                :type="vehicle.model ? 'button' : undefined"
                class="mm-sr__vehicle"
                :class="{
                  'mm-sr__vehicle--active': vehicle.template === activeVehicle?.template,
                  'mm-sr__vehicle--static': !vehicle.model,
                }"
                :aria-pressed="vehicle.model ? vehicle.template === activeVehicle?.template : undefined"
                :title="vehicle.model ? `Put the ${vehicle.name} on the stage` : vehicle.name"
                @click="selectVehicle(vehicle)"
              >
                <span class="mm-sr__vehicle-art">
                  <img
                    v-if="vehicle.thumb"
                    :src="meshUrl(vehicle.thumb)"
                    alt=""
                    loading="lazy"
                  >
                  <img
                    v-else-if="vehicle.iconPath"
                    class="mm-sr__vehicle-icon"
                    :src="hudUrl(vehicle.iconPath)"
                    alt=""
                    loading="lazy"
                  >
                </span>
                <span class="mm-sr__vehicle-name">{{ vehicle.name }}</span>
                <span class="mm-sr__vehicle-meta">{{ hours(vehicle.minutes) }} h fielded · {{ vehicle.maps }} {{ vehicle.maps === 1 ? 'map' : 'maps' }}</span>
              </component>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mm-sr__body {
  display: grid;
  grid-template-columns: minmax(300px, 400px) minmax(0, 1fr);
  align-items: start;
}

/* The soldier stays in view while the roster and arsenal scroll past him. */
.mm-sr__body > .mm-sr__stage {
  position: sticky;
  top: 12px;
  height: 560px;
  container-type: inline-size;
}

.mm-sr__detail {
  min-height: 560px;
  border-left: 1px solid var(--mm-rule);
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

/* ---- stage dressing ---- */

.mm-sr__glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 60% 48% at 50% 46%, color-mix(in srgb, var(--mm-accent-soft) 10%, transparent), transparent 72%);
}

.mm-sr__stage--axis .mm-sr__glow {
  background: radial-gradient(ellipse 60% 48% at 50% 46%, color-mix(in srgb, var(--mm-kill) 10%, transparent), transparent 72%);
}

.mm-sr__stage--allied .mm-sr__glow {
  background: radial-gradient(ellipse 60% 48% at 50% 46%, color-mix(in srgb, var(--mm-success) 11%, transparent), transparent 72%);
}

/* The army's name, stencilled huge behind the man: a recruiting poster, not a label. */
.mm-sr__stencil {
  position: absolute;
  left: -2%;
  right: -2%;
  top: 7%;
  font-family: var(--mm-font-display);
  font-weight: 800;
  font-size: min(92px, calc(92cqw / (var(--longest, 8) * 0.8)));
  line-height: 0.86;
  letter-spacing: -0.04em;
  text-transform: uppercase;
  text-align: center;
  color: color-mix(in srgb, var(--mm-ink) 4.5%, transparent);
  user-select: none;
}

.mm-sr__stage-top {
  position: absolute;
  top: 12px;
  left: 14px;
  right: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
}

.mm-sr__stage-nation { flex: 1; }

.mm-sr__back,
.mm-sr__more {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  background: transparent;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  padding: 4px 8px;
  cursor: pointer;
}

.mm-sr__back:hover,
.mm-sr__more:hover {
  color: var(--mm-ink);
  border-color: var(--mm-accent);
}

.mm-sr__no-figure {
  position: absolute;
  inset: 40% 16% auto;
  text-align: center;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-sr__stage-foot {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.mm-sr__kits {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: color-mix(in srgb, var(--mm-bg) 72%, transparent);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  backdrop-filter: blur(4px);
}

.mm-sr__kit {
  width: 46px;
  height: 46px;
  padding: 3px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 2px;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-soft);
}

.mm-sr__kit img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.mm-sr__kit:hover { opacity: 0.9; }

.mm-sr__kits--static .mm-sr__kit {
  cursor: default;
  opacity: 0.8;
}

.mm-sr__kit--active {
  opacity: 1;
  border-color: var(--mm-accent);
  background: color-mix(in srgb, var(--mm-accent) 16%, transparent);
}

.mm-sr__kit:focus-visible,
.mm-sr__row:focus-visible,
.mm-sr__vehicle:focus-visible,
.mm-sr__theatre:focus-visible {
  outline: 1px solid var(--mm-accent-soft);
  outline-offset: 1px;
}

.mm-sr__caption {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
}

.mm-sr__mesh-link {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-accent-soft);
}

/* ---- lead ---- */

.mm-sr__army {
  margin: 6px 0 0;
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(30px, 3.4vw, 44px);
  line-height: 1.02;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
}

.mm-sr__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-sr__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 16px 0 0;
  border-top: 1px solid var(--mm-rule);
  border-bottom: 1px solid var(--mm-rule);
}

.mm-sr__kpis > div {
  padding: 10px 12px 10px 0;
}

.mm-sr__kpis > div + div {
  padding-left: 12px;
  border-left: 1px solid var(--mm-rule);
}

.mm-sr__kpis dt {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-sr__kpis dd {
  margin: 6px 0 0;
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: 24px;
  line-height: 1;
}

.mm-sr__label {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-sr__theatres {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
}

.mm-sr__theatres .mm-sr__label { margin-right: 4px; }

.mm-sr__theatre {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-soft);
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 3px 7px;
  cursor: pointer;
}

.mm-sr__theatre span { color: var(--mm-ink-muted); }
.mm-sr__theatre:hover { border-color: var(--mm-accent); color: var(--mm-ink); }

/* ---- roster ---- */

.mm-sr__roster {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--mm-rule);
}

.mm-sr__row {
  width: 100%;
  display: grid;
  grid-template-columns: 22px auto minmax(0, 1.4fr) minmax(60px, 1fr) 58px 44px 40px;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 10px;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--mm-rule);
  border-left: 2px solid transparent;
  color: var(--mm-ink-soft);
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}

.mm-sr__row:hover { background: var(--mm-bg-soft); }

.mm-sr__row--active {
  border-left-color: var(--mm-accent);
  background: var(--mm-bg-soft);
  color: var(--mm-ink);
}

.mm-sr__row-rank {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-faint);
}

.mm-sr__row-name {
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-sr__row-mod {
  margin-left: 6px;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-sr__row-bar {
  height: 3px;
  background: var(--mm-bg-mute);
  border-radius: 2px;
  overflow: hidden;
}

.mm-sr__row-fill {
  display: block;
  height: 100%;
  background: var(--mm-ink-faint);
}

.mm-sr__row-fill--axis { background: var(--mm-kill); }
.mm-sr__row-fill--allied { background: var(--mm-success); }

.mm-sr__row-num {
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.mm-sr__row-num small {
  margin-left: 2px;
  font-size: 9px;
  color: var(--mm-ink-muted);
}

.mm-sr__more { align-self: flex-start; margin-top: -8px; }

/* ---- arsenal ---- */

.mm-sr__vehicles {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.mm-sr__vehicle {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px 8px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink-soft);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
}

.mm-sr__vehicle:hover { border-color: var(--mm-rule-strong); }
.mm-sr__vehicle--static { cursor: default; }

.mm-sr__vehicle--active {
  border-color: var(--mm-accent);
  background: color-mix(in srgb, var(--mm-accent) 12%, transparent);
}

.mm-sr__vehicle-art {
  height: 84px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* The mesh site's browse renders: a square with the vehicle in its middle half and
   the viewer's own chrome in a corner. Scaled up so the square's edges fall outside
   the box, and lightened so its stage colour melts into the tile. */
.mm-sr__vehicle-art img {
  flex: none;
  width: 84px;
  height: 84px;
  object-fit: contain;
  transform: scale(1.7);
  mix-blend-mode: lighten;
}

.mm-sr__vehicle-art .mm-sr__vehicle-icon {
  width: auto;
  height: 52px;
  object-fit: contain;
  transform: none;
  mix-blend-mode: normal;
  opacity: 0.85;
}

.mm-sr__vehicle-name {
  font-size: 12.5px;
  color: var(--mm-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-sr__vehicle-meta {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: var(--mm-ink-muted);
}

.mm-country-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  padding: 1px 4px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  background: color-mix(in srgb, var(--mm-ink) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--mm-ink) 15%, transparent);
  border-radius: 2px;
  line-height: 1.3;
}

/* ---- density ---- */

@media (max-width: 900px) {
  .mm-sr__body { grid-template-columns: minmax(0, 1fr); }

  .mm-sr__body > .mm-sr__stage {
    position: relative;
    top: auto;
    height: 440px;
    border-bottom: 1px solid var(--mm-rule);
  }

  .mm-sr__detail {
    min-height: 0;
    border-left: 0;
  }
}

@media (max-width: 640px) {
  .mm-sr__pbar-sides { display: none; }
  .mm-sr__body > .mm-sr__stage { height: 400px; }
  .mm-sr__vehicles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mm-sr__detail { padding: 16px 14px 18px; }
  .mm-sr__row { grid-template-columns: 22px auto minmax(0, 1fr) minmax(40px, 0.6fr) 52px; }
  .mm-sr__row-num--hide-sm { display: none; }
  .mm-sr__kpis > div + div { padding-left: 8px; }
  .mm-sr__kpis dd { font-size: 20px; }
}
</style>
