<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import 'primeicons/primeicons.css'
import {
  fetchDailyMystery,
  fetchRandomMystery,
  submitMysteryGuess,
  type MysteryDossier,
  type MysteryGuessResult,
  type MysteryAttributeMatch,
} from '@/services/arcadeService'
import { useArcadeAudio } from '@/composables/useArcadeAudio'

const props = defineProps<{
  serverGuid?: string
  serverName?: string
  orbitPlayer?: string
}>()

const { isMuted, toggleMute, playRoger, playNegative } = useArcadeAudio()

const mode = ref<'daily' | 'random'>('daily')
const dossier = ref<MysteryDossier | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const submitting = ref(false)

const guesses = ref<MysteryGuessResult[]>([])
const isGameOver = ref(false)
const isVictorious = ref(false)
const identifiedTarget = ref<string | null>(null)

// Streak & session tracking
const streak = ref(0)
const bestStreak = ref(Number(localStorage.getItem('bfstats_mystery_best_streak') || 0))
const solvedCount = ref(0)

const candidateOptions = computed(() => dossier.value?.candidateOptions ?? [])
const investigatedNames = computed(() =>
  new Set(guesses.value.map(g => g.guessedPlayerName.toLowerCase()))
)
const maxGuesses = computed(() => Math.max(candidateOptions.value.length, 1))
const remainingGuesses = computed(() => Math.max(maxGuesses.value - guesses.value.length, 0))

interface DisplayAttribute {
  key: string
  label: string
  value?: string
  category?: string
}

const attributeColumns = computed<DisplayAttribute[]>(() => {
  if (dossier.value?.attributes && dossier.value.attributes.length > 0) {
    return dossier.value.attributes.map(a => ({
      key: a.key,
      label: a.label,
      value: a.value,
      category: a.category
    }))
  }
  return [
    { key: 'kills', label: 'Total Kills', value: dossier.value?.killsBracket, category: 'career' },
    { key: 'favoriteMap', label: 'Most Played Map', value: dossier.value?.favoriteMap, category: 'map' },
    { key: 'favoriteServer', label: 'Favorite Server', value: dossier.value?.favoriteServer, category: 'server' },
    { key: 'playTime', label: 'Play Time', value: dossier.value?.playTimeBracket, category: 'career' },
    { key: 'kdRatio', label: 'K/D Ratio', value: dossier.value?.kdBracket, category: 'career' },
    { key: 'badge', label: 'Badge', value: dossier.value?.signatureBadge || 'Combat Medal', category: 'combat' }
  ]
})

const guessTableColumns = computed(() => {
  if (dossier.value?.attributes && dossier.value.attributes.length > 0) {
    return dossier.value.attributes
  }
  return [
    { key: 'kills', label: 'Total Kills' },
    { key: 'playTime', label: 'Play Time' },
    { key: 'kdRatio', label: 'K/D Ratio' },
    { key: 'favoriteMap', label: 'Most Played Map' },
    { key: 'favoriteServer', label: 'Favorite Server' }
  ]
})

const gridColumnsStyle = computed(() => {
  const count = guessTableColumns.value.length
  return {
    gridTemplateColumns: `minmax(140px, 1.3fr) repeat(${count}, minmax(115px, 1fr))`
  }
})

const getRowAttributes = (g: MysteryGuessResult): MysteryAttributeMatch[] => {
  if (g.attributes && g.attributes.length > 0) {
    return g.attributes
  }
  return [
    { key: 'kills', label: 'Total Kills', value: g.kills.value, isMatch: g.kills.isMatch, indicator: g.kills.indicator },
    { key: 'playTime', label: 'Play Time', value: g.playTime.value, isMatch: g.playTime.isMatch, indicator: g.playTime.indicator },
    { key: 'kdRatio', label: 'K/D Ratio', value: g.kdRatio.value, isMatch: g.kdRatio.isMatch, indicator: g.kdRatio.indicator },
    { key: 'favoriteMap', label: 'Most Played Map', value: g.favoriteMap.value, isMatch: g.favoriteMap.isMatch },
    { key: 'favoriteServer', label: 'Favorite Server', value: g.favoriteServer.value, isMatch: g.favoriteServer.isMatch }
  ]
}

const isMonoMetric = (key: string) =>
  ['kills', 'playtime', 'kd', 'score', 'playTime', 'kdRatio'].includes(key.toLowerCase())

const getCategoryIcon = (category?: string, key?: string) => {
  const k = key?.toLowerCase() || ''
  if (category === 'social' || k === 'frequent_buddy') return 'pi pi-users'
  if (category === 'map' || k.includes('map')) return 'pi pi-map'
  if (category === 'combat' || k === 'signature_badge' || k === 'badge') return 'pi pi-shield'
  if (category === 'server' || k === 'favorite_server' || k === 'favoriteserver') return 'pi pi-server'
  if (k === 'score') return 'pi pi-star'
  if (k === 'kd' || k === 'kdratio') return 'pi pi-percentage'
  if (k === 'kills') return 'pi pi-bullseye'
  if (k === 'playtime') return 'pi pi-clock'
  return 'pi pi-info-circle'
}

const loadMission = async (excludeCandidate?: string) => {
  loading.value = true
  error.value = null
  guesses.value = []
  isGameOver.value = false
  isVictorious.value = false
  identifiedTarget.value = null
  submitting.value = false

  try {
    dossier.value = mode.value === 'daily'
      ? await fetchDailyMystery(props.serverGuid, props.orbitPlayer)
      : await fetchRandomMystery(props.serverGuid, props.orbitPlayer, excludeCandidate)
  } catch {
    error.value = 'Classified dossier unavailable. Please retry.'
  } finally {
    loading.value = false
  }
}

const continuePlaying = () => {
  const lastTarget = identifiedTarget.value || undefined
  if (mode.value === 'daily') {
    mode.value = 'random'
  }
  loadMission(lastTarget)
}

watch(mode, () => {
  loadMission()
})

watch(
  () => [props.serverGuid, props.orbitPlayer],
  () => {
    loadMission()
  }
)

const makeGuess = async (guessedName: string) => {
  const name = guessedName.trim()
  if (!name || !dossier.value || isGameOver.value || submitting.value) return

  if (investigatedNames.value.has(name.toLowerCase())) {
    return
  }

  submitting.value = true
  try {
    const res = await submitMysteryGuess(dossier.value.dossierToken, name)
    guesses.value.push(res)

    if (res.isCorrect) {
      isVictorious.value = true
      isGameOver.value = true
      identifiedTarget.value = res.targetPlayerName || res.guessedPlayerName
      streak.value++
      solvedCount.value++
      if (streak.value > bestStreak.value) {
        bestStreak.value = streak.value
        try {
          localStorage.setItem('bfstats_mystery_best_streak', String(bestStreak.value))
        } catch {
          /* ignore */
        }
      }
      playRoger()
    } else {
      if (guesses.value.length >= maxGuesses.value) {
        isGameOver.value = true
        identifiedTarget.value = res.targetPlayerName || 'Classified'
        streak.value = 0
      }
      playNegative()
    }
  } catch {
    /* guess error */
  } finally {
    submitting.value = false
  }
}

const isInvestigated = (name: string) => investigatedNames.value.has(name.toLowerCase())

const suspectOutcome = (name: string): MysteryGuessResult | undefined =>
  guesses.value.find(g => g.guessedPlayerName.toLowerCase() === name.toLowerCase())

const handleKeydown = (e: KeyboardEvent) => {
  if (isGameOver.value && (e.key === 'Enter')) {
    e.preventDefault()
    continuePlaying()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  loadMission()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="mm-mystery">
    <div class="mm-mystery__control-bar">
      <div class="mm-mystery__modes">
        <button
          type="button"
          class="mm-mystery__mode-tab"
          :class="{ 'mm-mystery__mode-tab--active': mode === 'daily' }"
          @click="mode = 'daily'"
        >
          Daily
        </button>
        <button
          type="button"
          class="mm-mystery__mode-tab"
          :class="{ 'mm-mystery__mode-tab--active': mode === 'random' }"
          @click="mode = 'random'"
        >
          Random
        </button>
      </div>

      <div class="mm-mystery__stats-hud">
        <div
          class="mm-mystery__stat-chip"
          title="Current continuous win streak"
        >
          <span class="mm-mystery__stat-label">Streak</span>
          <span class="mm-mystery__stat-val">🔥 {{ streak }}</span>
        </div>
        <div
          class="mm-mystery__stat-chip"
          title="Best winning streak"
        >
          <span class="mm-mystery__stat-label">Best</span>
          <span class="mm-mystery__stat-val">🏆 {{ bestStreak }}</span>
        </div>
        <div
          class="mm-mystery__stat-chip"
          title="Total mystery soldiers solved"
        >
          <span class="mm-mystery__stat-label">Solved</span>
          <span class="mm-mystery__stat-val">🎯 {{ solvedCount }}</span>
        </div>
      </div>

      <div class="mm-mystery__bar-actions">
        <button
          v-if="mode === 'random' && !isGameOver"
          type="button"
          class="mm-mystery__skip-btn"
          title="Skip to another random soldier"
          @click="continuePlaying"
        >
          <i class="pi pi-refresh" />
          <span>New Case</span>
        </button>

        <button
          type="button"
          class="mm-mystery__sound-btn"
          :class="{ 'mm-mystery__sound-btn--active': !isMuted }"
          @click="toggleMute"
        >
          <i
            :class="isMuted ? 'pi pi-volume-off' : 'pi pi-volume-up'"
            class="mm-mystery__sound-icon"
          />
          <span>{{ isMuted ? 'Muted' : 'Sound On' }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="loading"
      class="mm-mystery__loading"
    >
      <div class="mm-mystery__spinner" />
      <p class="mm-eyebrow">
        Loading mystery player...
      </p>
    </div>

    <div
      v-else-if="error"
      class="mm-mystery__error"
    >
      {{ error }}
      <button
        type="button"
        class="mm-mystery__retry-btn"
        @click="loadMission()"
      >
        Retry
      </button>
    </div>

    <div
      v-else-if="dossier"
      class="mm-mystery__content"
    >
      <div class="mm-mystery__dossier">
        <div class="mm-mystery__dossier-header">
          <div>
            <h3 class="mm-mystery__dossier-title">
              Mystery Soldier
            </h3>
            <span class="mm-eyebrow">Attributes</span>
          </div>
          <div class="mm-mystery__attempts-pill">
            {{ remainingGuesses }} / {{ maxGuesses }} attempts remaining
          </div>
        </div>

        <div class="mm-mystery__clues-grid">
          <div
            v-for="attr in attributeColumns"
            :key="attr.key"
            class="mm-mystery__clue-card"
          >
            <div class="mm-mystery__clue-top">
              <span class="mm-eyebrow">{{ attr.label }}</span>
              <i
                :class="getCategoryIcon(attr.category, attr.key)"
                class="mm-mystery__clue-icon"
              />
            </div>
            <div
              class="mm-mystery__clue-val"
              :class="{ 'mm-mystery__clue-val--mono': isMonoMetric(attr.key) }"
            >
              {{ attr.value }}
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="!isGameOver"
        class="mm-mystery__suspects"
      >
        <div class="mm-mystery__suspects-header">
          <span class="mm-eyebrow">Candidates</span>
          <p class="mm-mystery__suspects-hint">
            Select a candidate to check their stats against the mystery player.
          </p>
        </div>

        <div class="mm-mystery__suspect-grid">
          <button
            v-for="name in candidateOptions"
            :key="name"
            type="button"
            class="mm-mystery__suspect"
            :class="{
              'mm-mystery__suspect--investigated': isInvestigated(name),
              'mm-mystery__suspect--correct': suspectOutcome(name)?.isCorrect,
              'mm-mystery__suspect--eliminated': isInvestigated(name) && !suspectOutcome(name)?.isCorrect,
            }"
            :disabled="isInvestigated(name) || submitting"
            @click="makeGuess(name)"
          >
            <span class="mm-mystery__suspect-name">{{ $pn(name) }}</span>
            <span
              v-if="isInvestigated(name) && !suspectOutcome(name)?.isCorrect"
              class="mm-mystery__suspect-status"
            >
              <i class="pi pi-times" />
              Eliminated
            </span>
            <span
              v-else-if="suspectOutcome(name)?.isCorrect"
              class="mm-mystery__suspect-status mm-mystery__suspect-status--win"
            >
              <i class="pi pi-check" />
              Confirmed
            </span>
            <span
              v-else
              class="mm-mystery__suspect-status mm-mystery__suspect-status--idle"
            >
              <i class="pi pi-search" />
              Select
            </span>
          </button>
        </div>
      </div>

      <div
        v-if="isGameOver"
        class="mm-mystery__resolution"
        :class="{ 'mm-mystery__resolution--win': isVictorious }"
      >
        <div class="mm-mystery__res-header">
          <span class="mm-eyebrow">Result</span>
          <h2 class="mm-mystery__res-title">
            <i
              :class="isVictorious ? 'pi pi-check-circle mm-res-icon--win' : 'pi pi-times-circle mm-res-icon--fail'"
              class="mm-mystery__res-icon"
            />
            <span>
              {{
                isVictorious
                  ? (mode === 'daily' ? 'Daily Mission Solved! Mystery soldier identified.' : 'Target Identified! Mystery soldier revealed.')
                  : (mode === 'daily' ? 'Daily Mission Compromised: Target revealed.' : 'Mission Over: Mystery soldier revealed.')
              }}
            </span>
          </h2>
          <p class="mm-mystery__res-subject">
            Mystery Player:
            <router-link
              v-if="identifiedTarget"
              :to="`/v4/players/${encodeURIComponent(identifiedTarget)}`"
              target="_blank"
              rel="noopener noreferrer"
              class="mm-mystery__player-link"
              title="View player profile (opens in new tab)"
            >
              <strong>{{ $pn(identifiedTarget) }}</strong>
            </router-link>
            <strong v-else>{{ $pn(identifiedTarget || '') }}</strong>
          </p>
          <p class="mm-mystery__daily-prompt">
            {{
              mode === 'daily'
                ? 'Daily classified case completed! Keep going with continuous field dossiers to build your streak.'
                : 'Ready for another mission? Keep your momentum going.'
            }}
          </p>
        </div>

        <div class="mm-mystery__res-actions">
          <button
            type="button"
            class="mm-mystery__res-btn mm-mystery__res-btn--primary"
            title="Start the next mystery mission (Enter)"
            @click="continuePlaying"
          >
            <i class="pi pi-forward" />
            <span>{{ mode === 'daily' ? 'Next Soldier (Keep Going)' : 'Next Soldier' }}</span>
          </button>

          <router-link
            v-if="identifiedTarget"
            :to="`/v4/players/${encodeURIComponent(identifiedTarget)}`"
            target="_blank"
            rel="noopener noreferrer"
            class="mm-mystery__res-btn mm-mystery__res-btn--secondary"
            title="View player profile (opens in new tab)"
          >
            <span>View Player Profile</span>
            <i class="pi pi-arrow-right" />
          </router-link>
        </div>
      </div>

      <div
        v-if="guesses.length > 0"
        class="mm-mystery__grid-wrap"
      >
        <div
          class="mm-mystery__grid-header"
          :style="gridColumnsStyle"
        >
          <span class="mm-mystery__col-title">Candidate</span>
          <span
            v-for="col in guessTableColumns"
            :key="col.key"
            class="mm-mystery__col-title"
          >
            {{ col.label }}
          </span>
        </div>

        <div
          v-for="(g, idx) in guesses"
          :key="idx"
          class="mm-mystery__guess-row"
          :class="{ 'mm-mystery__guess-row--correct': g.isCorrect }"
          :style="gridColumnsStyle"
        >
          <div class="mm-mystery__cell mm-mystery__cell--name">
            <router-link
              :to="`/v4/players/${encodeURIComponent(g.guessedPlayerName)}`"
              target="_blank"
              rel="noopener noreferrer"
              class="mm-mystery__player-link"
              title="View player profile (opens in new tab)"
            >
              {{ $pn(g.guessedPlayerName) }}
            </router-link>
          </div>

          <div
            v-for="attr in getRowAttributes(g)"
            :key="attr.key"
            class="mm-mystery__cell"
            :class="[
              attr.isMatch ? 'mm-mystery__cell--match' : 'mm-mystery__cell--miss',
              { 'mm-mystery__cell--text': !attr.indicator }
            ]"
          >
            <span>{{ attr.value }}</span>
            <span
              v-if="!attr.isMatch && attr.indicator"
              class="mm-mystery__arrow"
              :class="attr.indicator === 'higher' ? 'mm-mystery__arrow--up' : 'mm-mystery__arrow--down'"
            >
              <i :class="attr.indicator === 'higher' ? 'pi pi-arrow-up' : 'pi pi-arrow-down'" />
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mm-mystery {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.mm-mystery__control-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 6px;
}

.mm-mystery__modes {
  display: flex;
  gap: 8px;
}

.mm-mystery__mode-tab {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: none;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mm-mystery__mode-tab--active {
  background: var(--mm-bg-mute);
  border-color: var(--mm-rule-strong);
  color: var(--mm-ink);
}

.mm-mystery__stats-hud {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mm-mystery__stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 4px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
}

.mm-mystery__stat-label {
  color: var(--mm-ink-muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.mm-mystery__stat-val {
  color: var(--mm-ink);
  font-weight: 700;
}

.mm-mystery__bar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mm-mystery__skip-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg);
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mm-mystery__skip-btn:hover {
  color: var(--mm-ink);
  border-color: var(--mm-rule-strong);
  background: var(--mm-bg-mute);
}

.mm-mystery__sound-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: color 0.15s ease;
}
.mm-mystery__sound-btn:hover {
  color: var(--mm-ink);
}
.mm-mystery__sound-btn--active {
  color: var(--mm-accent-soft);
}

.mm-mystery__dossier {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 6px;
  position: relative;
  overflow: hidden;
}

.mm-mystery__dossier-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.mm-mystery__dossier-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--mm-ink);
}

.mm-mystery__attempts-pill {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 4px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  color: var(--mm-accent-soft);
}

.mm-mystery__clues-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
}

.mm-mystery__clue-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 6px;
  transition: border-color 0.15s ease;
}

.mm-mystery__clue-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mm-mystery__clue-icon {
  font-size: 13px;
  color: var(--mm-ink-muted);
  opacity: 0.85;
}

.mm-mystery__clue-val {
  font-size: 14px;
  font-weight: 600;
  color: var(--mm-ink);
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-mystery__clue-val--mono {
  font-family: var(--mm-font-mono);
  color: var(--mm-accent-soft);
}

.mm-mystery__suspects {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mm-mystery__suspects-hint {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--mm-ink-muted);
}

.mm-mystery__suspect-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.mm-mystery__suspect {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 14px 16px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 6px;
  color: var(--mm-ink);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
}

.mm-mystery__suspect:hover:not(:disabled) {
  border-color: var(--mm-accent);
  background: var(--mm-bg-mute);
}

.mm-mystery__suspect:disabled {
  cursor: default;
}

.mm-mystery__suspect--eliminated {
  opacity: 0.55;
  border-color: var(--mm-rule);
  background: var(--mm-bg);
}

.mm-mystery__suspect--correct {
  border-color: var(--mm-success);
  background: rgba(125, 163, 76, 0.12);
}

.mm-mystery__suspect-name {
  font-family: var(--mm-font-display);
  font-size: 15px;
  font-weight: 700;
}

.mm-mystery__suspect-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-danger);
}

.mm-mystery__suspect-status--idle {
  color: var(--mm-ink-muted);
}

.mm-mystery__suspect-status--win {
  color: var(--mm-success);
}

.mm-mystery__resolution {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 8px;
}

.mm-mystery__resolution--win {
  border-color: var(--mm-success);
  background: rgba(125, 163, 76, 0.08);
}

.mm-mystery__res-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0;
  font-size: 20px;
  font-weight: 800;
  color: var(--mm-ink);
}

.mm-mystery__res-icon {
  font-size: 22px;
}
.mm-res-icon--win {
  color: var(--mm-success);
}
.mm-res-icon--fail {
  color: var(--mm-danger);
}

.mm-mystery__res-subject {
  margin: 0;
  font-size: 15px;
  color: var(--mm-ink-soft);
}

.mm-mystery__daily-prompt {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--mm-ink-muted);
}

.mm-mystery__res-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.mm-mystery__res-btn {
  padding: 10px 16px;
  border-radius: 6px;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.mm-mystery__res-btn--primary {
  background: var(--mm-accent);
  color: #000;
  border: none;
}
.mm-mystery__res-btn--secondary {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  color: var(--mm-ink);
}

.mm-mystery__grid-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 6px;
}

.mm-mystery__grid-header,
.mm-mystery__guess-row {
  display: grid;
  gap: 6px;
  align-items: stretch;
  min-width: 680px;
}

.mm-mystery__col-title {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 4px 8px;
}

.mm-mystery__cell {
  padding: 12px 10px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 600;
}

.mm-mystery__cell--name {
  justify-content: flex-start;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink);
  font-family: var(--mm-font-display);
}

.mm-mystery__player-link {
  color: inherit;
  text-decoration: none;
  transition: color 0.15s ease;
}

.mm-mystery__player-link:hover {
  color: var(--mm-accent-soft);
  text-decoration: underline;
  text-underline-offset: 4px;
}

.mm-mystery__cell--match {
  background: var(--mm-success);
  color: #000;
  font-weight: 700;
}

.mm-mystery__cell--miss {
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink-soft);
}

.mm-mystery__cell--text {
  font-size: 12px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-mystery__arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
}

.mm-mystery__arrow--up {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
}

.mm-mystery__arrow--down {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.15);
}

.mm-mystery__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 16px;
}

.mm-mystery__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--mm-rule);
  border-top-color: var(--mm-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.mm-mystery__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 20px;
  color: var(--mm-danger);
  font-family: var(--mm-font-mono);
}

.mm-mystery__retry-btn {
  padding: 8px 16px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 4px;
  color: var(--mm-ink);
  cursor: pointer;
  font-family: var(--mm-font-mono);
  font-size: 12px;
}

.mm-mystery__content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

@media (max-width: 768px) {
  .mm-mystery__control-bar {
    flex-wrap: wrap;
    gap: 12px;
  }

  .mm-mystery__stats-hud {
    order: 3;
    width: 100%;
    justify-content: flex-start;
  }

  .mm-mystery__cell {
    padding: 8px 6px;
    font-size: 11px;
  }

  .mm-mystery__dossier-header {
    flex-direction: column;
    gap: 10px;
  }

  .mm-mystery__suspect-grid {
    grid-template-columns: 1fr;
  }
}
</style>
