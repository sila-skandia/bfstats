<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import 'primeicons/primeicons.css'
import {
  arcadeLoadError,
  fetchHigherLowerNext,
  revealHigherLower,
  type HigherLowerQuestion,
  type HigherLowerRevealResult,
} from '@/services/arcadeService'

import { useArcadeAudio } from '@/composables/useArcadeAudio'
import MmEmphasizedText from '@/components/v4/arcade/MmEmphasizedText.vue'
import MmArcadeSkeleton from '@/components/v4/arcade/MmArcadeSkeleton.vue'

const props = defineProps<{
  serverGuid?: string
  serverName?: string
  orbitPlayer?: string
}>()

const { isMuted, toggleMute, playRoger, playNegative } = useArcadeAudio()

const currentQuestion = ref<HigherLowerQuestion | null>(null)
const revealResult = ref<HigherLowerRevealResult | null>(null)
const loading = ref(false)
const guessing = ref(false)
const selectedGuess = ref<'playerA' | 'playerB' | null>(null)
const error = ref<string | null>(null)

const score = ref(0)
const totalAnswered = ref(0)
const streak = ref(0)
const bestStreak = ref(
  Number(localStorage.getItem('bfstats:arcade-hl-best') || '0')
)

const promptTitle = computed(() => currentQuestion.value?.metricLabel || '')
const promptDetail = computed(() => {
  const q = currentQuestion.value
  if (!q) return ''
  return q.prompt || `Who has more ${q.metricLabel.toLowerCase()}?`
})
const contestedMap = computed(() => currentQuestion.value?.mapName || '')

const isChoiceA = computed(() => selectedGuess.value === 'playerA')
const isChoiceB = computed(() => selectedGuess.value === 'playerB')

const isWinnerA = computed(() => {
  if (!revealResult.value) return false
  return revealResult.value.playerAValue >= revealResult.value.playerBValue
})

const isWinnerB = computed(() => {
  if (!revealResult.value) return false
  return revealResult.value.playerBValue >= revealResult.value.playerAValue
})

const formattedPlayerA = computed(() => {
  if (revealResult.value?.formattedPlayerAValue) {
    return revealResult.value.formattedPlayerAValue
  }
  if (revealResult.value?.playerAValue !== undefined) {
    return String(revealResult.value.playerAValue)
  }
  return ''
})

const formattedPlayerB = computed(() => {
  if (revealResult.value?.formattedPlayerBValue) {
    return revealResult.value.formattedPlayerBValue
  }
  if (revealResult.value?.playerBValue !== undefined) {
    return String(revealResult.value.playerBValue)
  }
  return ''
})

const loadNext = async () => {
  loading.value = true
  error.value = null
  revealResult.value = null
  selectedGuess.value = null
  try {
    currentQuestion.value = await fetchHigherLowerNext(props.serverGuid, undefined, props.orbitPlayer)
  } catch (err) {
    error.value = arcadeLoadError(err, 'Failed to load matchup. Retrying in a moment...')
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.serverGuid, props.orbitPlayer],
  () => {
    restartGame()
  }
)

const handleGuess = async (guess: 'playerA' | 'playerB') => {
  if (!currentQuestion.value || guessing.value || revealResult.value) return
  guessing.value = true
  selectedGuess.value = guess
  error.value = null

  try {
    const res = await revealHigherLower({
      roundToken: currentQuestion.value.roundToken,
      guess,
    })
    revealResult.value = res
    totalAnswered.value++

    if (res.isCorrect) {
      playRoger()
      score.value++
      streak.value++
      if (streak.value > bestStreak.value) {
        bestStreak.value = streak.value
        localStorage.setItem('bfstats:arcade-hl-best', String(bestStreak.value))
      }
    } else {
      playNegative()
      streak.value = 0
    }
  } catch {
    error.value = 'Failed to verify guess. Please try again.'
    selectedGuess.value = null
  } finally {
    guessing.value = false
  }
}

const advanceRound = () => {
  selectedGuess.value = null
  if (revealResult.value?.nextQuestion) {
    currentQuestion.value = revealResult.value.nextQuestion
    revealResult.value = null
  } else {
    loadNext()
  }
}

const restartGame = () => {
  streak.value = 0
  revealResult.value = null
  selectedGuess.value = null
  loadNext()
}

onMounted(() => {
  loadNext()
})
</script>

<template>
  <div class="mm-hl">
    <div class="mm-hl__hud">
      <div class="mm-hl__hud-col">
        <span class="mm-eyebrow">Score</span>
        <div class="mm-hl__hud-stat">
          <span class="mm-hl__hud-value">{{ score }}</span>
          <span
            v-if="totalAnswered > 0"
            class="mm-hl__hud-sub"
          >/ {{ totalAnswered }}</span>
        </div>
      </div>

      <div class="mm-hl__hud-center">
        <div class="mm-hl__streak-box">
          <span class="mm-eyebrow">Streak</span>
          <div class="mm-hl__streak-number">
            {{ streak }}
          </div>
        </div>
      </div>

      <div class="mm-hl__hud-col mm-hl__hud-col--right">
        <div class="mm-hl__hud-meta">
          <span class="mm-eyebrow">Best</span>
          <span class="mm-hl__best">{{ bestStreak }}</span>
        </div>
        <button
          type="button"
          class="mm-hl__sound-btn"
          :class="{ 'mm-hl__sound-btn--active': !isMuted }"
          :title="isMuted ? 'Unmute radio audio' : 'Mute radio audio'"
          @click="toggleMute"
        >
          <i
            :class="isMuted ? 'pi pi-volume-off' : 'pi pi-volume-up'"
            class="mm-hl__sound-icon"
          />
          <span>{{ isMuted ? 'Muted' : 'Sound On' }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="error"
      class="mm-hl__error"
      data-testid="arcade-error"
    >
      {{ error }}
      <button
        type="button"
        class="mm-hl__retry-btn"
        @click="() => loadNext()"
      >
        Retry
      </button>
    </div>

    <!-- Loading wins over currentQuestion. loadNext() leaves the previous matchup in place
         while the next one is in flight, so ordering these the other way round meant the
         loading branch was unreachable on every load but the first — switching server just
         sat on the old matchup with no indication anything was happening. -->
    <MmArcadeSkeleton
      v-if="loading"
      variant="headToHead"
      label="Loading matchup"
    />

    <template v-else-if="currentQuestion">
      <div
        class="mm-section-bar mm-hl__prompt"
        data-testid="hl-prompt"
      >
        <span>{{ promptTitle }}</span>
        <span class="mm-section-bar__meta">Higher or Lower · Click a player to answer</span>
      </div>

      <h2
        class="mm-hl__question"
        data-testid="hl-prompt-detail"
      >
        <MmEmphasizedText
          :text="promptDetail"
          :terms="[currentQuestion.mapName, serverName]"
        />
      </h2>

      <div class="mm-hl__arena">
        <!-- Player A Card -->
        <div
          class="mm-hl__card mm-hl__card--left"
          :class="{
            'mm-hl__card--interactive': !revealResult && !guessing,
            'mm-hl__card--chosen': selectedGuess === 'playerA',
            'mm-hl__card--correct': revealResult && isChoiceA && revealResult.isCorrect,
            'mm-hl__card--wrong': revealResult && isChoiceA && !revealResult.isCorrect,
            'mm-hl__card--winner': revealResult && !isChoiceA && isWinnerA,
            'mm-hl__card--dimmed': revealResult && !isChoiceA && !isWinnerA
          }"
          :role="!revealResult ? 'button' : undefined"
          :tabindex="!revealResult ? 0 : undefined"
          :aria-label="!revealResult ? `Pick ${currentQuestion.playerA.name}` : undefined"
          @click="!revealResult && handleGuess('playerA')"
          @keydown.enter="!revealResult && handleGuess('playerA')"
          @keydown.space.prevent="!revealResult && handleGuess('playerA')"
        >
          <div class="mm-hl__card-header">
            <span class="mm-eyebrow">Candidate A</span>
            <div class="mm-hl__card-badges">
              <span
                class="mm-country-badge"
                :title="currentQuestion.playerA.country"
              >
                {{ currentQuestion.playerA.country || 'UN' }}
              </span>
              <router-link
                :to="`/v4/players/${encodeURIComponent(currentQuestion.playerA.name)}`"
                target="_blank"
                rel="noopener noreferrer"
                class="mm-hl__profile-link"
                title="View player profile (opens in new tab)"
                @click.stop
              >
                <i class="pi pi-external-link" />
              </router-link>
            </div>
          </div>

          <h3 class="mm-hl__soldier-name">
            {{ $pn(currentQuestion.playerA.name) }}
          </h3>

          <div
            v-if="contestedMap"
            class="mm-hl__map-chip"
          >
            <span class="mm-eyebrow">On this map</span>
            <span class="mm-hl__map-name">{{ contestedMap }}</span>
          </div>
          <div
            v-else-if="currentQuestion.playerA.favoriteMap"
            class="mm-hl__map-chip"
          >
            <span class="mm-eyebrow">Favorite Map</span>
            <span class="mm-hl__map-name">{{ currentQuestion.playerA.favoriteMap }}</span>
          </div>

          <div class="mm-hl__metric-box">
            <span class="mm-eyebrow">{{ currentQuestion.metricLabel }}</span>
            <div
              v-if="!revealResult"
              class="mm-hl__unrevealed"
            >
              <span class="mm-hl__mystery-mark">???</span>
            </div>
            <div
              v-else
              class="mm-hl__metric-val"
              :class="{ 'mm-hl__metric-val--winner': isWinnerA }"
            >
              {{ formattedPlayerA }}
            </div>
          </div>

          <!-- Pick CTA or Post-reveal status tag -->
          <div
            v-if="!revealResult"
            class="mm-hl__pick-btn"
            data-testid="hl-pick-a"
          >
            <i class="pi pi-check" />
            <span>Select {{ $pn(currentQuestion.playerA.name) }}</span>
          </div>
          <div
            v-else
            class="mm-hl__status-row"
          >
            <span
              v-if="isChoiceA && revealResult.isCorrect"
              class="mm-hl__card-tag mm-hl__card-tag--correct"
            >
              <i class="pi pi-check" />
              Your Pick · Correct
            </span>
            <span
              v-else-if="isChoiceA && !revealResult.isCorrect"
              class="mm-hl__card-tag mm-hl__card-tag--wrong"
            >
              <i class="pi pi-times" />
              Your Pick
            </span>
            <span
              v-else-if="isWinnerA"
              class="mm-hl__card-tag mm-hl__card-tag--winner"
            >
              <i class="pi pi-star" />
              Higher Value
            </span>
          </div>
        </div>

        <!-- Center VS Divider -->
        <div
          class="mm-hl__vs"
          aria-hidden="true"
        >
          <div class="mm-hl__vs-circle">
            VS
          </div>
        </div>

        <!-- Player B Card -->
        <div
          class="mm-hl__card mm-hl__card--right"
          :class="{
            'mm-hl__card--interactive': !revealResult && !guessing,
            'mm-hl__card--chosen': selectedGuess === 'playerB',
            'mm-hl__card--correct': revealResult && isChoiceB && revealResult.isCorrect,
            'mm-hl__card--wrong': revealResult && isChoiceB && !revealResult.isCorrect,
            'mm-hl__card--winner': revealResult && !isChoiceB && isWinnerB,
            'mm-hl__card--dimmed': revealResult && !isChoiceB && !isWinnerB
          }"
          :role="!revealResult ? 'button' : undefined"
          :tabindex="!revealResult ? 0 : undefined"
          :aria-label="!revealResult ? `Pick ${currentQuestion.playerB.name}` : undefined"
          @click="!revealResult && handleGuess('playerB')"
          @keydown.enter="!revealResult && handleGuess('playerB')"
          @keydown.space.prevent="!revealResult && handleGuess('playerB')"
        >
          <div class="mm-hl__card-header">
            <span class="mm-eyebrow">Candidate B</span>
            <div class="mm-hl__card-badges">
              <span
                class="mm-country-badge"
                :title="currentQuestion.playerB.country"
              >
                {{ currentQuestion.playerB.country || 'UN' }}
              </span>
              <router-link
                :to="`/v4/players/${encodeURIComponent(currentQuestion.playerB.name)}`"
                target="_blank"
                rel="noopener noreferrer"
                class="mm-hl__profile-link"
                title="View player profile (opens in new tab)"
                @click.stop
              >
                <i class="pi pi-external-link" />
              </router-link>
            </div>
          </div>

          <h3 class="mm-hl__soldier-name">
            {{ $pn(currentQuestion.playerB.name) }}
          </h3>

          <div
            v-if="contestedMap"
            class="mm-hl__map-chip"
          >
            <span class="mm-eyebrow">On this map</span>
            <span class="mm-hl__map-name">{{ contestedMap }}</span>
          </div>
          <div
            v-else-if="currentQuestion.playerB.favoriteMap"
            class="mm-hl__map-chip"
          >
            <span class="mm-eyebrow">Favorite Map</span>
            <span class="mm-hl__map-name">{{ currentQuestion.playerB.favoriteMap }}</span>
          </div>

          <div class="mm-hl__metric-box">
            <span class="mm-eyebrow">{{ currentQuestion.metricLabel }}</span>
            <div
              v-if="!revealResult"
              class="mm-hl__unrevealed"
            >
              <span class="mm-hl__mystery-mark">???</span>
            </div>
            <div
              v-else
              class="mm-hl__metric-val"
              :class="{ 'mm-hl__metric-val--winner': isWinnerB }"
            >
              {{ formattedPlayerB }}
            </div>
          </div>

          <!-- Pick CTA or Post-reveal status tag -->
          <div
            v-if="!revealResult"
            class="mm-hl__pick-btn"
            data-testid="hl-pick-b"
          >
            <i class="pi pi-check" />
            <span>Select {{ $pn(currentQuestion.playerB.name) }}</span>
          </div>
          <div
            v-else
            class="mm-hl__status-row"
          >
            <span
              v-if="isChoiceB && revealResult.isCorrect"
              class="mm-hl__card-tag mm-hl__card-tag--correct"
            >
              <i class="pi pi-check" />
              Your Pick · Correct
            </span>
            <span
              v-else-if="isChoiceB && !revealResult.isCorrect"
              class="mm-hl__card-tag mm-hl__card-tag--wrong"
            >
              <i class="pi pi-times" />
              Your Pick
            </span>
            <span
              v-else-if="isWinnerB"
              class="mm-hl__card-tag mm-hl__card-tag--winner"
            >
              <i class="pi pi-star" />
              Higher Value
            </span>
          </div>
        </div>
      </div>

      <!-- Action Row (Select player buttons for explicit button clicks / accessibility) -->
      <div
        v-if="!revealResult"
        class="mm-hl__actions"
        data-testid="hl-actions"
      >
        <button
          type="button"
          class="mm-hl__btn mm-hl__btn--choice"
          :disabled="guessing"
          @click="handleGuess('playerA')"
        >
          <i class="pi pi-user mm-hl__btn-icon" />
          <span class="mm-hl__btn-text">{{ $pn(currentQuestion.playerA.name) }}</span>
        </button>

        <button
          type="button"
          class="mm-hl__btn mm-hl__btn--choice"
          :disabled="guessing"
          @click="handleGuess('playerB')"
        >
          <i class="pi pi-user mm-hl__btn-icon" />
          <span class="mm-hl__btn-text">{{ $pn(currentQuestion.playerB.name) }}</span>
        </button>
      </div>

      <!-- Outcome Banner -->
      <div
        v-else
        class="mm-hl__outcome"
        :class="revealResult.isCorrect ? 'mm-hl__outcome--success' : 'mm-hl__outcome--miss'"
        data-testid="hl-outcome"
      >
        <div class="mm-hl__outcome-msg">
          <i
            :class="revealResult.isCorrect ? 'pi pi-check-circle' : 'pi pi-info-circle'"
            class="mm-hl__outcome-icon"
          />
          <span>{{ revealResult.message }}</span>
        </div>
        <button
          type="button"
          class="mm-hl__next-btn"
          data-testid="hl-next-btn"
          @click="advanceRound"
        >
          <span>Next Matchup</span>
          <i class="pi pi-arrow-right" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mm-hl {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mm-hl__hud {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-hl__hud-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-hl__hud-col--right {
  align-items: flex-end;
}

.mm-hl__hud-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.mm-hl__hud-stat {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.mm-hl__hud-value {
  font-family: var(--mm-font-mono);
  font-size: 20px;
  font-weight: 800;
  color: var(--mm-ink);
  line-height: 1;
}

.mm-hl__hud-sub {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  color: var(--mm-ink-muted);
}

.mm-hl__hud-center {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mm-hl__streak-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.mm-hl__streak-number {
  font-family: var(--mm-font-mono);
  font-size: 32px;
  font-weight: 800;
  color: var(--mm-ink);
  line-height: 1;
}

.mm-hl__best {
  font-family: var(--mm-font-mono);
  font-size: 15px;
  font-weight: 700;
  color: var(--mm-ink-soft);
}

.mm-hl__sound-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  cursor: pointer;
  padding: 4px 0;
  min-height: 44px;
  transition: color 0.15s ease;
}

.mm-hl__sound-btn:hover,
.mm-hl__sound-btn:focus-visible {
  color: var(--mm-ink);
}

.mm-hl__sound-btn--active {
  color: var(--mm-accent-soft);
}

.mm-hl__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--mm-danger);
  background: rgba(214, 90, 90, 0.08);
  color: var(--mm-ink-soft);
  font-size: 13px;
}

.mm-hl__retry-btn {
  flex-shrink: 0;
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid var(--mm-rule-strong);
  background: var(--mm-bg-mute);
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.mm-hl__prompt {
  margin: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 6px;
  padding: 14px 16px;
}

.mm-hl__prompt .mm-section-bar__meta {
  opacity: 0.72;
}

.mm-hl__question {
  margin: 0;
  text-align: center;
  font-size: 20px;
  line-height: 1.4;
  color: var(--mm-ink);
  font-weight: 700;
  padding: 14px 20px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-hl__arena {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: stretch;
  gap: 16px;
}

.mm-hl__card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
  min-width: 0;
}

.mm-hl__card--interactive {
  cursor: pointer;
  user-select: none;
}

.mm-hl__card--interactive:hover {
  border-color: var(--mm-accent-soft);
  background: var(--mm-bg-mute);
}

.mm-hl__card--interactive:focus-visible {
  outline: 2px solid var(--mm-accent);
  outline-offset: 2px;
}

.mm-hl__card--chosen {
  border-color: var(--mm-accent);
}

.mm-hl__card--correct {
  border-color: var(--mm-success);
  background: rgba(125, 163, 76, 0.06);
}

.mm-hl__card--wrong {
  border-color: var(--mm-danger);
  background: rgba(214, 90, 90, 0.06);
}

.mm-hl__card--winner {
  border-color: var(--mm-accent-soft);
  background: rgba(224, 163, 46, 0.06);
}

.mm-hl__card--dimmed {
  opacity: 0.65;
}

.mm-hl__card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mm-hl__card-badges {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-hl__profile-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: var(--mm-ink-muted);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: var(--mm-bg);
  font-size: 11px;
  text-decoration: none;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.mm-hl__profile-link:hover,
.mm-hl__profile-link:focus-visible {
  color: var(--mm-accent-soft);
  border-color: var(--mm-rule-strong);
}

.mm-hl__soldier-name {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--mm-ink);
  word-break: break-word;
  line-height: 1.25;
}

.mm-hl__card--interactive:hover .mm-hl__soldier-name {
  color: var(--mm-accent-soft);
}

.mm-hl__map-chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-hl__map-name {
  font-size: 14px;
  color: var(--mm-ink-soft);
}

.mm-hl__metric-box {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 6px;
  min-height: 92px;
  padding: 16px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-hl__metric-val {
  font-family: var(--mm-font-mono);
  font-size: 32px;
  font-weight: 800;
  color: var(--mm-ink);
  line-height: 1.1;
}

.mm-hl__metric-val--winner {
  color: var(--mm-accent-soft);
}

.mm-hl__unrevealed {
  display: flex;
  align-items: flex-end;
  min-height: 36px;
}

.mm-hl__mystery-mark {
  font-family: var(--mm-font-mono);
  font-size: 32px;
  font-weight: 800;
  color: var(--mm-ink-faint);
  letter-spacing: 0.1em;
  line-height: 1.1;
}

.mm-hl__pick-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 40px;
  padding: 10px 14px;
  background: var(--mm-bg);
  border: 1px dashed var(--mm-rule-strong);
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--mm-ink-soft);
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.mm-hl__card--interactive:hover .mm-hl__pick-btn {
  background: var(--mm-accent);
  color: var(--mm-highlight-ink);
  border-style: solid;
  border-color: var(--mm-accent);
}

.mm-hl__status-row {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
}

.mm-hl__card-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.mm-hl__card-tag--correct {
  background: rgba(125, 163, 76, 0.15);
  border: 1px solid var(--mm-success);
  color: var(--mm-success);
}

.mm-hl__card-tag--wrong {
  background: rgba(214, 90, 90, 0.15);
  border: 1px solid var(--mm-danger);
  color: var(--mm-danger);
}

.mm-hl__card-tag--winner {
  background: rgba(224, 163, 46, 0.15);
  border: 1px solid var(--mm-accent-soft);
  color: var(--mm-accent-soft);
}

.mm-hl__vs {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
}

.mm-hl__vs-circle {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-rule-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 800;
  color: var(--mm-ink-soft);
}

.mm-hl__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  max-width: 520px;
  width: 100%;
  margin: 4px auto 0;
}

.mm-hl__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  padding: 14px 16px;
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.mm-hl__btn--choice {
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  color: var(--mm-ink);
}

.mm-hl__btn--choice:hover:not(:disabled),
.mm-hl__btn--choice:focus-visible:not(:disabled) {
  background: var(--mm-accent);
  color: var(--mm-highlight-ink);
  border-color: var(--mm-accent);
}

.mm-hl__btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.mm-hl__outcome {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 640px;
  width: 100%;
  margin: 4px auto 0;
}

.mm-hl__outcome-msg {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.mm-hl__outcome--success .mm-hl__outcome-msg {
  color: var(--mm-success);
}

.mm-hl__outcome--miss .mm-hl__outcome-msg {
  color: var(--mm-ink-soft);
}

.mm-hl__outcome-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.mm-hl__next-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  padding: 12px 16px;
  background: var(--mm-accent);
  color: var(--mm-highlight-ink);
  border: none;
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: filter 0.15s ease;
}

.mm-hl__next-btn:hover,
.mm-hl__next-btn:focus-visible {
  filter: brightness(1.1);
}

@media (max-width: 720px) {
  .mm-hl__arena {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .mm-hl__vs {
    padding: 0;
  }

  .mm-hl__vs-circle {
    width: 32px;
    height: 32px;
    font-size: 11px;
  }

  .mm-hl__prompt {
    padding: 12px 14px;
  }

  .mm-hl__question {
    font-size: 17px;
    padding: 12px 14px;
  }

  .mm-hl__actions {
    grid-template-columns: 1fr;
    max-width: none;
  }

  .mm-hl__metric-val,
  .mm-hl__mystery-mark {
    font-size: 28px;
  }
}
</style>
