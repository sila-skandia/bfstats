<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BfFactionBadge from '@/components/common/BfFactionBadge.vue'
import BfClassBadge from '@/components/common/BfClassBadge.vue'
import {
  fetchMapDossier,
  hudIconUrl,
  type MapDossier,
  type MapDossierArsenalEntry,
  type MapDossierTeam,
} from '@/services/mapDossierService'
import { isKnownMissing, mapImageKey, mapImageUrl, rememberMissing } from '@/utils/mapImage'

/**
 * A briefing for one map, assembled from the level's own configuration inside the
 * game archives: the two armies, the tickets they start with and how fast those
 * bleed, every flag plotted on the in-game minimap, and the vehicles each side can
 * field — illustrated with the icons the game itself draws for them.
 *
 * None of this comes from the live server feed, which only ever says "Axis" and
 * "Allied". Community maps ship no level archive, so rendering nothing at all is the
 * ordinary outcome rather than an error.
 */
const props = withDefaults(
  defineProps<{
    /** bflist gameId — the mod folder, e.g. "bf1942", "dc_final", "fhsw". */
    gameId?: string | null
    mapName?: string | null
    /**
     * Render a skeleton while loading and a note when the map has no briefing.
     * Off inline, where a map with nothing to say should simply take no space;
     * on when the briefing is the whole point of the surface, such as a modal
     * the reader opened deliberately and would otherwise find empty.
     */
    showPlaceholders?: boolean
    /** Drop the internal heading where the surrounding surface already names this. */
    hideHeading?: boolean
  }>(),
  { gameId: null, mapName: null, showPlaceholders: false, hideHeading: false },
)

const dossier = ref<MapDossier | null>(null)
const loading = ref(false)
const settled = ref(false)
const minimapFailed = ref(false)
const hoveredFlag = ref<string | null>(null)

const minimapKey = computed(() => mapImageKey(props.gameId, props.mapName))

const minimapSrc = computed(() => {
  if (minimapFailed.value || isKnownMissing(minimapKey.value)) return null
  return mapImageUrl(props.gameId, props.mapName, 'minimap')
})

const teams = computed(() => dossier.value?.teams ?? [])

/**
 * Which side of the war a team is on, so the page can colour it the way every other
 * team-aware surface does. The level names a nationality rather than a side, and a
 * mod skin we cannot place falls back to the Refractor convention that team 1 defends
 * as the Axis and team 2 attacks as the Allies.
 */
const AXIS_NATIONS = new Set(['ger', 'jp', 'ita', 'fin'])

function sideOf(team: MapDossierTeam): 'axis' | 'allied' {
  if (team.nation && AXIS_NATIONS.has(team.nation)) return 'axis'
  if (team.nation) return 'allied'
  return team.index === 1 ? 'axis' : 'allied'
}

/** Only levels that name an assault team have a defender worth labelling as one. */
const hasAttacker = computed(() => teams.value.some((team) => team.isAssault))

/** The faster-bleeding side is the one the level puts under pressure. */
const bleedStory = computed(() => {
  const [first, second] = teams.value
  if (!first || !second) return null
  const a = first.ticketLossPerMin
  const b = second.ticketLossPerMin
  if (a == null || b == null || a === b) return null
  const worse = a > b ? first : second
  return { team: worse, rate: Math.max(a, b), other: Math.min(a, b) }
})

const plottedFlags = computed(() => {
  const doc = dossier.value
  if (!doc || !doc.controlPointsPlottable) return []
  return doc.controlPoints.filter(
    (flag): flag is typeof flag & { x: number; y: number } => flag.x != null && flag.y != null,
  )
})

const canPlotFlags = computed(() => Boolean(minimapSrc.value) && plottedFlags.value.length > 0)

const CATEGORY_LABELS: Record<string, string> = {
  land: 'Armour & Transport',
  air: 'Air',
  sea: 'Naval',
  emplacement: 'Emplacements',
  unknown: 'Other',
}

const CATEGORY_ORDER = ['land', 'air', 'sea', 'emplacement', 'unknown']

/** Arsenal for one side, grouped the way the engine classifies its objects. */
function arsenalFor(teamIndex: number) {
  const entries = (dossier.value?.arsenal ?? []).filter((entry) => entry.team === teamIndex)
  return CATEGORY_ORDER
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      entries: entries.filter((entry) => entry.category === category),
    }))
    .filter((group) => group.entries.length > 0)
}

function iconFor(entry: MapDossierArsenalEntry): string | null {
  return hudIconUrl(entry.iconPath)
}

function flagTeamClass(team: number): string {
  if (team === 0) return 'mm-dossier__flag--neutral'
  const match = teams.value.find((candidate) => candidate.index === team)
  return match ? `mm-dossier__flag--${sideOf(match)}` : 'mm-dossier__flag--neutral'
}

function onMinimapError() {
  rememberMissing(minimapKey.value)
  minimapFailed.value = true
}

async function load() {
  dossier.value = null
  minimapFailed.value = false
  settled.value = false
  if (!props.gameId || !props.mapName) {
    settled.value = true
    return
  }

  loading.value = true
  const requested = `${props.gameId}/${props.mapName}`
  try {
    const result = await fetchMapDossier(props.gameId, props.mapName)
    // The map can change while a slower request is still open; only the newest wins.
    if (requested !== `${props.gameId}/${props.mapName}`) return
    dossier.value = result
  } catch (err) {
    // A dossier is supplementary context. Losing it should cost the panel nothing
    // more than this section.
    console.error('Error loading map dossier:', err)
  } finally {
    if (requested === `${props.gameId}/${props.mapName}`) {
      loading.value = false
      settled.value = true
    }
  }
}

watch(() => [props.gameId, props.mapName], load, { immediate: true })
</script>

<template>
  <section v-if="showPlaceholders && loading" class="mm-dossier mm-dossier--placeholder">
    <div class="mm-skeleton" style="height: 92px" />
    <div class="mm-skeleton" style="height: 240px" />
  </section>

  <p v-else-if="showPlaceholders && settled && !dossier" class="mm-dossier__none">
    No briefing for this map — it ships no level archive we can read, which is normal
    for community maps.
  </p>

  <section v-else-if="dossier" class="mm-dossier">
    <header v-if="!hideHeading" class="mm-dossier__head">
      <div class="mm-eyebrow mm-eyebrow--strong">Level briefing</div>
      <div class="mm-dossier__source">Read from the game's own level files</div>
    </header>

    <!-- Order of battle: the two armies, opposed across a centre rule -->
    <div v-if="teams.length === 2" class="mm-dossier__battle">
      <article
        v-for="team in teams"
        :key="team.index"
        class="mm-dossier__army"
        :class="[`mm-dossier__army--${sideOf(team)}`, { 'mm-dossier__army--right': team.index === 2 }]"
      >
        <div class="mm-dossier__army-id">
          <BfFactionBadge
            v-if="team.nation"
            :faction="team.nation"
            :size="36"
            variant="icon-only"
            flag-type="ensign"
          />
          <div class="mm-dossier__army-name">
            <div class="mm-dossier__nation">{{ team.label }}</div>
            <div class="mm-dossier__role">
              <span v-if="team.isAssault" class="mm-chip mm-chip--filled">Attacking</span>
              <span v-else class="mm-dossier__role-text">{{ hasAttacker ? 'Defending' : `Team ${team.index}` }}</span>
            </div>
          </div>
        </div>

        <div v-if="team.tickets != null" class="mm-dossier__tickets">
          <span class="mm-headline-rank">{{ team.tickets }}</span>
          <span class="mm-dossier__tickets-unit">tickets</span>
        </div>

        <div v-if="team.ticketLossPerMin != null" class="mm-dossier__bleed">
          &minus;{{ team.ticketLossPerMin }}/min while outflagged
        </div>

        <ul v-if="team.kits.length" class="mm-dossier__kits">
          <li v-for="kit in team.kits" :key="kit.template" :title="kit.name">
            <!-- The level's own kit art, resolved through the mod's content chain. -->
            <img
              v-if="kit.iconPath"
              class="mm-dossier__kit-img"
              :src="hudIconUrl(kit.iconPath)!"
              :alt="kit.name"
              loading="lazy"
              decoding="async"
            >
            <!-- A mod kit outside the stock five has no art; the badge draws the role. -->
            <BfClassBadge
              v-else-if="kit.role"
              :class-type="kit.role"
              :faction="sideOf(team) === 'axis' ? 'axis' : 'allies'"
              :size="26"
              variant="icon-only"
            />
            <span v-else class="mm-dossier__kit-text">{{ kit.name }}</span>
          </li>
        </ul>
      </article>

      <div class="mm-dossier__versus" aria-hidden="true"><span>vs</span></div>
    </div>

    <p v-if="bleedStory" class="mm-dossier__verdict">
      The level puts
      <strong :class="`mm-dossier__verdict--${sideOf(bleedStory.team)}`">{{ bleedStory.team.label }}</strong>
      on the clock: {{ bleedStory.rate }} tickets a minute against
      {{ bleedStory.other }} once the flags go the other way.
    </p>

    <!-- The ground: flags stamped onto the in-game minimap -->
    <div
      v-if="dossier.controlPoints.length"
      class="mm-dossier__ground"
      :class="{ 'mm-dossier__ground--listonly': !canPlotFlags }"
    >
      <div v-if="canPlotFlags" class="mm-dossier__map">
        <img
          class="mm-dossier__map-img"
          :src="minimapSrc!"
          :alt="`${dossier.displayName} minimap`"
          loading="lazy"
          decoding="async"
          @error="onMinimapError"
        >
        <button
          v-for="flag in plottedFlags"
          :key="flag.id"
          type="button"
          class="mm-dossier__flag"
          :class="[flagTeamClass(flag.team), { 'mm-dossier__flag--active': hoveredFlag === flag.id }]"
          :style="{ left: `${flag.x * 100}%`, top: `${flag.y * 100}%` }"
          :title="flag.name"
          @mouseenter="hoveredFlag = flag.id"
          @mouseleave="hoveredFlag = null"
          @focus="hoveredFlag = flag.id"
          @blur="hoveredFlag = null"
        >
          <span class="mm-dossier__flag-label">{{ flag.name }}</span>
        </button>
      </div>

      <div class="mm-dossier__flags">
        <div class="mm-eyebrow">
          {{ dossier.controlPoints.length }} control point{{ dossier.controlPoints.length === 1 ? '' : 's' }}
        </div>
        <ul class="mm-dossier__flag-list">
          <li
            v-for="flag in dossier.controlPoints"
            :key="flag.id"
            :class="{ 'mm-dossier__flag-list-item--active': hoveredFlag === flag.id }"
            @mouseenter="hoveredFlag = flag.id"
            @mouseleave="hoveredFlag = null"
          >
            <span class="mm-dossier__flag-pip" :class="flagTeamClass(flag.team)" />
            <span class="mm-dossier__flag-name">{{ flag.name }}</span>
            <span v-if="flag.team === 0" class="mm-dossier__flag-note">neutral at start</span>
          </li>
        </ul>
        <p v-if="!dossier.controlPointsPlottable" class="mm-card__hint">
          This map's minimap art is framed differently from its terrain, so the flags
          are listed rather than plotted.
        </p>
      </div>
    </div>

    <!-- Arsenal: what each side can put in the field -->
    <div v-if="dossier.arsenal.length" class="mm-dossier__arsenal">
      <div class="mm-eyebrow mm-eyebrow--strong">Arsenal</div>
      <div class="mm-dossier__arsenal-grid">
        <section
          v-for="team in teams"
          :key="team.index"
          class="mm-dossier__arsenal-side"
          :class="`mm-dossier__arsenal-side--${sideOf(team)}`"
        >
          <header class="mm-dossier__arsenal-head">
            <BfFactionBadge v-if="team.nation" :faction="team.nation" :size="20" variant="icon-only" flag-type="ensign" />
            <span>{{ team.label }}</span>
          </header>

          <div v-for="group in arsenalFor(team.index)" :key="group.category" class="mm-dossier__group">
            <div class="mm-dossier__group-label">{{ group.label }}</div>
            <ul class="mm-dossier__kit-list">
              <li v-for="entry in group.entries" :key="entry.key" class="mm-dossier__unit">
                <span class="mm-dossier__unit-icon">
                  <img
                    v-if="iconFor(entry)"
                    :src="iconFor(entry)!"
                    :alt="entry.name"
                    loading="lazy"
                    decoding="async"
                  >
                  <span v-else class="mm-dossier__unit-icon-blank" aria-hidden="true" />
                </span>
                <span class="mm-dossier__unit-name">{{ entry.name }}</span>
                <span
                  v-if="entry.spawnPoints > 1"
                  class="mm-dossier__unit-count"
                  :title="`${entry.spawnPoints} spawn points`"
                >&times;{{ entry.spawnPoints }}</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
      <p class="mm-card__foot">
        Counts are spawn points, not vehicles alive at once — a spawner refills after
        its previous machine is lost.
      </p>
    </div>
  </section>
</template>

<style scoped>
.mm-dossier {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.mm-dossier--placeholder { gap: 14px; }

.mm-dossier__none {
  margin: 0;
  padding: 18px 0;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  line-height: 1.7;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
}

.mm-dossier__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.mm-dossier__source {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
}

/* ---------- order of battle ---------- */

.mm-dossier__battle {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border-top: 1px solid var(--mm-rule);
  border-bottom: 1px solid var(--mm-rule);
}

.mm-dossier__army {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px 24px;
  min-width: 0;
}

/* The two sides mirror each other across the centre rule, so the flags sit
   outermost and the numbers read inward toward the fight. */
.mm-dossier__army--right {
  align-items: flex-end;
  text-align: right;
}

.mm-dossier__army-id {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.mm-dossier__army--right .mm-dossier__army-id {
  flex-direction: row-reverse;
}

.mm-dossier__army-name { min-width: 0; }

.mm-dossier__nation {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--mm-ink);
}

.mm-dossier__role { margin-top: 4px; }

.mm-dossier__role-text {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
}

.mm-dossier__tickets {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

/* Only the row's alignment mirrors — reversing it would render "tickets 100". */
.mm-dossier__army--right .mm-dossier__tickets { justify-content: flex-end; }

.mm-dossier__tickets-unit {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-dossier__bleed {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
}

.mm-dossier__kits :deep(.bf-class-img),
.mm-dossier__kit-img {
  transition: transform 140ms ease;
}

.mm-dossier__kits li:hover :deep(.bf-class-img),
.mm-dossier__kits li:hover .mm-dossier__kit-img {
  transform: scale(2.2);
}

.mm-dossier__kit-img {
  display: block;
  width: 26px;
  height: 26px;
  object-fit: contain;
}

/* A kit the game draws nothing for still deserves its name. */
.mm-dossier__kit-text {
  display: inline-block;
  padding: 3px 6px;
  border: 1px solid var(--mm-rule);
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  white-space: nowrap;
}

.mm-dossier__kits li {
  position: relative;
}

.mm-dossier__kits li:hover { z-index: 5; }

.mm-dossier__kits {
  display: flex;
  gap: 6px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}

.mm-dossier__army--right .mm-dossier__kits { flex-direction: row-reverse; }

/* Centre rule with the matchup marker sitting on it. */
.mm-dossier__versus {
  position: absolute;
  inset: 0 auto 0 50%;
  width: 1px;
  background: var(--mm-rule-strong);
  display: flex;
  align-items: center;
  justify-content: center;
}

.mm-dossier__versus span {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
  background: var(--mm-bg);
  padding: 5px 0;
  transform: translateX(-0.5px);
}

.mm-dossier__verdict {
  margin: -6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--mm-ink-soft);
  max-width: 62ch;
}

.mm-dossier__verdict strong { font-weight: 500; }
.mm-dossier__verdict--axis { color: var(--mm-kill); }
.mm-dossier__verdict--allied { color: var(--mm-success); }

/* ---------- the ground ---------- */

.mm-dossier__ground {
  display: grid;
  grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

/* With no map to sit beside, the list should not be pinned to the map's column. */
.mm-dossier__ground--listonly { grid-template-columns: minmax(0, 1fr); }

.mm-dossier__map {
  position: relative;
  aspect-ratio: 1;
  border: 1px solid var(--mm-rule);
  overflow: hidden;
  background: var(--mm-bg-soft);
}

.mm-dossier__map-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* The terrain art is the backdrop, not the subject — pull it back so the
     flags stamped on top stay the thing the eye lands on. */
  filter: saturate(0.7) contrast(1.05) brightness(0.82);
}

.mm-dossier__flag {
  position: absolute;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  padding: 0;
  border: 2px solid currentColor;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mm-bg) 55%, transparent);
  color: var(--mm-ink-muted);
  cursor: default;
  transition: transform 140ms ease, box-shadow 140ms ease;
}

.mm-dossier__flag::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: currentColor;
}

.mm-dossier__flag--axis { color: var(--mm-kill); }
.mm-dossier__flag--allied { color: var(--mm-success); }
.mm-dossier__flag--neutral { color: var(--mm-ink-soft); }

.mm-dossier__flag:hover,
.mm-dossier__flag:focus-visible,
.mm-dossier__flag--active {
  transform: scale(1.35);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--mm-ink) 8%, transparent);
  outline: none;
}

.mm-dossier__flag-label {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 7px);
  transform: translateX(-50%);
  white-space: nowrap;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--mm-ink);
  background: color-mix(in srgb, var(--mm-bg) 94%, transparent);
  border: 1px solid var(--mm-rule-strong);
  padding: 3px 7px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 140ms ease;
}

.mm-dossier__flag:hover .mm-dossier__flag-label,
.mm-dossier__flag:focus-visible .mm-dossier__flag-label,
.mm-dossier__flag--active .mm-dossier__flag-label { opacity: 1; }

.mm-dossier__flags {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mm-dossier__flag-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mm-dossier__flag-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--mm-rule);
  font-size: 13px;
  color: var(--mm-ink-soft);
  transition: color 120ms ease;
}

.mm-dossier__flag-list li:last-child { border-bottom: 0; }
.mm-dossier__flag-list-item--active { color: var(--mm-ink); }

.mm-dossier__flag-pip {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.mm-dossier__flag-name { min-width: 0; }

.mm-dossier__flag-note {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
}

/* ---------- arsenal ---------- */

.mm-dossier__arsenal {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mm-dossier__arsenal-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px;
}

.mm-dossier__arsenal-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding-left: 14px;
  border-left: 2px solid var(--mm-rule);
}

.mm-dossier__arsenal-side--axis { border-left-color: var(--mm-kill-soft); }
.mm-dossier__arsenal-side--allied { border-left-color: var(--mm-accent); }

.mm-dossier__arsenal-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink);
}

.mm-dossier__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mm-dossier__group-label {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
}

.mm-dossier__kit-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-dossier__unit {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  font-size: 13px;
  color: var(--mm-ink-soft);
}

/* Hovering lifts the row above its neighbours so the enlarged icon is not clipped
   by the rows stacked after it. */
.mm-dossier__unit:hover { z-index: 5; }

.mm-dossier__unit-icon {
  position: relative;
  flex-shrink: 0;
  width: 34px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* The game draws these at 128px and the row shows them at about fourteen. Hovering
   promotes the same file out of flow at its native size — no second request, no
   reflow, and nothing here is available only on hover.
   Anchored above the row so it never covers the name it belongs to. */
.mm-dossier__unit:hover .mm-dossier__unit-icon img {
  position: absolute;
  left: -10px;
  bottom: calc(100% + 6px);
  width: 112px;
  height: 112px;
  max-width: none;
  max-height: none;
  opacity: 1;
  padding: 6px;
  /* Opaque: this sits over the rows above it, and they must not read through. */
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  z-index: 6;
}

.mm-dossier__unit-icon img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  /* Icons are painted for a bright HUD; ease them onto the dark surface. */
  opacity: 0.92;
}

.mm-dossier__unit-icon-blank {
  width: 16px;
  height: 1px;
  background: var(--mm-rule-strong);
}

.mm-dossier__unit-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-dossier__unit-count {
  margin-left: auto;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-faint);
}

/* ---------- narrow viewports ---------- */

@media (max-width: 880px) {
  .mm-dossier__ground { grid-template-columns: minmax(0, 1fr); }
  .mm-dossier__map { max-width: 360px; }
}

@media (max-width: 720px) {
  .mm-dossier__battle { grid-template-columns: minmax(0, 1fr); }

  .mm-dossier__army { padding: 16px 0; }

  .mm-dossier__army--right {
    align-items: flex-start;
    text-align: left;
    border-top: 1px solid var(--mm-rule);
  }

  .mm-dossier__army--right .mm-dossier__army-id,
  .mm-dossier__army--right .mm-dossier__tickets,
  .mm-dossier__army--right .mm-dossier__kits {
    flex-direction: row;
  }

  /* The centre rule only reads as a divide when the armies sit side by side. */
  .mm-dossier__versus { display: none; }

  .mm-dossier__arsenal-grid { grid-template-columns: minmax(0, 1fr); gap: 20px; }

  .mm-dossier__map { max-width: none; }
}

@media (prefers-reduced-motion: reduce) {
  .mm-dossier__flag,
  .mm-dossier__flag-label { transition: none; }
  .mm-dossier__kits :deep(.bf-class-img),
  .mm-dossier__kit-img { transition: none; }
}

/* Coarse pointers have no hover state to enter, and a tap that enlarges an icon in
   place reads as a broken layout rather than a preview. */
@media (hover: none) {
  .mm-dossier__unit:hover .mm-dossier__unit-icon img {
    position: static;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
    padding: 0;
    background: none;
    border: 0;
  }

  .mm-dossier__kits li:hover :deep(.bf-class-img),
  .mm-dossier__kits li:hover .mm-dossier__kit-img { transform: none; }
}
</style>
