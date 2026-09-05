<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import 'primeicons/primeicons.css'
import {
  fetchHigherLowerNext,
  revealHigherLower,
  type HigherLowerQuestion,
  type HigherLowerRevealResult,
} from '@/services/arcadeService'
import { useArcadeAudio } from '@/composables/useArcadeAudio'

const props = defineProps<{
  serverGuid?: string
  serverName?: string
}>()

const { isMuted, toggleMute, playRoger, playNegative } = useArcadeAudio()

const currentQuestion = ref<HigherLowerQuestion | null>(null)
const revealResult = ref<HigherLowerRevealResult | null>(null)
const loading = ref(false)
const guessing = ref(false)
const error = ref<string | null>(null)

const score = ref(0)
const totalAnswered = ref(0)
const streak = ref(0)
const bestStreak = ref(
  Number(localStorage.getItem('bfstats:arcade-hl-best') || '0')
)

const loadNext = async (carryCandidate?: string) => {
  loading.value = true
  error.value = null
  revealResult.value = null
  try {
    currentQuestion.value = await fetchHigherLowerNext(props.serverGuid, carryCandidate)
  } catch {
    error.value = 'Failed to load matchup. Retrying in a moment...'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.serverGuid,
  () => {
    restartGame()
  }
)

const handleGuess = async (guess: 'higher' | 'lower') => {
  if (!currentQuestion.value || guessing.value || revealResult.value) return
  guessing.value = true
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
  } finally {
    guessing.value = false
  }
}

const advanceRound = () => {
  if (revealResult.value?.nextQuestion) {
    currentQuestion.value = revealResult.value.nextQuestion
    revealResult.value = null
  } else if (currentQuestion.value) {
    loadNext(currentQuestion.value.playerB.name)
  } else {
    loadNext()
  }
}

const restartGame = () => {
  streak.value = 0
  revealResult.value = null
  loadNext()
}

onMounted(() => {
  loadNext()
})
</script>

<template>
  <div class="mm-hl">
    <!-- Header HUD / Scoreboard -->
    <div class="mm-hl__hud">
      <div class="mm-hl__hud-col">
        <span class="mm-eyebrow">Score</span>
        <div class="mm-hl__hud-stat">
          <span class="mm-hl__hud-value">{{ score }}</span>
          <span v-if="totalAnswered > 0" class="mm-hl__hud-sub">/ {{ totalAnswered }}</span>
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

    <!-- Error Banner -->
    <div
      v-if="error"
      class="mm-hl__error"
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

    <!-- Main Battlefield Arena -->
    <div
      v-if="currentQuestion"
      class="mm-hl__arena"
    >
      <!-- Player A Card -->
      <div class="mm-hl__card mm-hl__card--left">
        <div class="mm-hl__card-header">
          <span class="mm-eyebrow">Player</span>
          <span
            class="mm-country-badge"
            :title="currentQuestion.playerA.country"
          >
            {{ currentQuestion.playerA.country || 'UN' }}
          </span>
        </div>

        <h3 class="mm-hl__soldier-name">
          <router-link
            :to="`/v4/players/${encodeURIComponent(currentQuestion.playerA.name)}`"
            class="mm-hl__player-link"
            title="View player profile"
          >
            {{ $pn(currentQuestion.playerA.name) }}
          </router-link>
        </h3>

        <div class="mm-hl__theater">
          <span class="mm-eyebrow">Favorite Map</span>
          <span class="mm-hl__theater-val">{{ currentQuestion.playerA.favoriteMap }}</span>
        </div>

        <div class="mm-hl__metric-box">
          <span class="mm-eyebrow">{{ currentQuestion.metricLabel }}</span>
          <div class="mm-hl__metric-val mm-hl__metric-val--verified">
            {{ currentQuestion.playerA.formattedValue }}
          </div>
        </div>
      </div>

      <!-- VS / Divider Badge -->
      <div class="mm-hl__vs">
        <div class="mm-hl__vs-circle">
          VS
        </div>
        <div class="mm-hl__metric-prompt">
          Comparing <strong>{{ currentQuestion.metricLabel }}</strong>
        </div>
      </div>

      <!-- Player B Card (Challenger) -->
      <div
        class="mm-hl__card mm-hl__card--right"
        :class="{
          'mm-hl__card--correct': revealResult?.isCorrect,
          'mm-hl__card--wrong': revealResult && !revealResult.isCorrect
        }"
      >
        <div class="mm-hl__card-header">
          <span class="mm-eyebrow">Challenger</span>
          <span
            class="mm-country-badge"
            :title="currentQuestion.playerB.country"
          >
            {{ currentQuestion.playerB.country || 'UN' }}
          </span>
        </div>

        <h3 class="mm-hl__soldier-name">
          <router-link
            :to="`/v4/players/${encodeURIComponent(currentQuestion.playerB.name)}`"
            class="mm-hl__player-link"
            title="View player profile"
          >
            {{ $pn(currentQuestion.playerB.name) }}
          </router-link>
        </h3>

        <div class="mm-hl__theater">
          <span class="mm-eyebrow">Favorite Map</span>
          <span class="mm-hl__theater-val">{{ currentQuestion.playerB.favoriteMap }}</span>
        </div>

        <div class="mm-hl__metric-box">
          <span class="mm-eyebrow">{{ currentQuestion.metricLabel }}</span>

          <!-- Unrevealed vs Revealed State -->
          <div
            v-if="!revealResult"
            class="mm-hl__unrevealed"
          >
            <span class="mm-hl__mystery-mark">???</span>
            <span class="mm-hl__mystery-sub">Higher or lower?</span>
          </div>

          <div
            v-else
            class="mm-hl__metric-val mm-hl__metric-val--revealed"
          >
            {{ revealResult.formattedPlayerBValue }}
          </div>
        </div>

        <!-- HIGHER / LOWER Buttons -->
        <div
          v-if="!revealResult"
          class="mm-hl__actions"
        >
          <button
            type="button"
            class="mm-hl__btn mm-hl__btn--higher"
            :disabled="guessing"
            @click="handleGuess('higher')"
          >
            <i class="pi pi-arrow-up mm-hl__btn-icon" />
            <span class="mm-hl__btn-text">HIGHER</span>
          </button>

          <button
            type="button"
            class="mm-hl__btn mm-hl__btn--lower"
            :disabled="guessing"
            @click="handleGuess('lower')"
          >
            <i class="pi pi-arrow-down mm-hl__btn-icon" />
            <span class="mm-hl__btn-text">LOWER</span>
          </button>
        </div>

        <!-- Reveal Outcome Banner & Next Round Button (Never ends the game!) -->
        <div
          v-else
          class="mm-hl__outcome"
          :class="revealResult.isCorrect ? 'mm-hl__outcome--success' : 'mm-hl__outcome--miss'"
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
            @click="advanceRound"
          >
            <span>Next Matchup</span>
            <i class="pi pi-arrow-right" />
          </button>
        </div>
      </div>
    </div>

    <!-- Loading Skeleton -->
    <div
      v-else-if="loading"
      class="mm-hl__loading"
    >
      <div class="mm-hl__spinner" />
      <p class="mm-eyebrow">
        Loading matchup...
      </p>
    </div>
  </div>
</template>

<style scoped>
.mm-hl {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* HUD */
.mm-hl__hud {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 6px;
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
  transition: color 0.15s ease;
}

.mm-hl__sound-btn:hover {
  color: var(--mm-ink);
}

.mm-hl__sound-btn--active {
  color: var(--mm-accent-soft);
}

/* Arena */
.mm-hl__arena {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: stretch;
  gap: 16px;
  position: relative;
}

.mm-hl__card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 8px;
  transition: all 0.25s ease;
  position: relative;
}

.mm-hl__card--correct {
  border-color: var(--mm-success);
  background: rgba(125, 163, 76, 0.06);
}

.mm-hl__card--wrong {
  border-color: var(--mm-danger);
  background: rgba(214, 90, 90, 0.06);
}

.mm-hl__card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mm-hl__soldier-name {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--mm-ink);
  word-break: break-word;
}

.mm-hl__player-link {
  color: inherit;
  text-decoration: none;
  transition: color 0.15s ease;
}

.mm-hl__player-link:hover {
  color: var(--mm-accent-soft);
  text-decoration: underline;
  text-underline-offset: 4px;
}

.mm-hl__theater {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-hl__theater-val {
  font-size: 14px;
  color: var(--mm-ink-soft);
}

.mm-hl__metric-box {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 6px;
}

.mm-hl__metric-val {
  font-family: var(--mm-font-mono);
  font-size: 32px;
  font-weight: 800;
  color: var(--mm-ink);
  line-height: 1.1;
}

.mm-hl__metric-val--verified {
  color: var(--mm-accent-soft);
}

.mm-hl__metric-val--revealed {
  color: var(--mm-ink);
}

.mm-hl__unrevealed {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-hl__mystery-mark {
  font-family: var(--mm-font-mono);
  font-size: 32px;
  font-weight: 800;
  color: var(--mm-ink-faint);
  letter-spacing: 0.1em;
}

.mm-hl__mystery-sub {
  font-size: 12px;
  color: var(--mm-ink-muted);
}

/* VS divider */
.mm-hl__vs {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
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

.mm-hl__metric-prompt {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  text-align: center;
  max-width: 140px;
}

/* Decision Buttons */
.mm-hl__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.mm-hl__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 12px;
  border-radius: 6px;
  border: none;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mm-hl__btn--higher {
  background: var(--mm-accent);
  color: #000;
}
.mm-hl__btn--higher:hover:not(:disabled) {
  background: var(--mm-accent-soft);
  transform: translateY(-1px);
}

.mm-hl__btn--lower {
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-rule-strong);
  color: var(--mm-ink);
}
.mm-hl__btn--lower:hover:not(:disabled) {
  background: var(--mm-rule-strong);
  transform: translateY(-1px);
}

.mm-hl__btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.mm-hl__outcome {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mm-hl__outcome-msg {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
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
  padding: 12px 16px;
  background: var(--mm-accent);
  color: #000;
  border: none;
  border-radius: 6px;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: filter 0.15s ease;
}
.mm-hl__next-btn:hover {
  filter: brightness(1.1);
}

/* Loading */
.mm-hl__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 16px;
}

.mm-hl__spinner {
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

/* Mobile responsive */
@media (max-width: 720px) {
  .mm-hl__arena {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .mm-hl__vs {
    flex-direction: row;
    padding: 8px 0;
  }

  .mm-hl__vs-circle {
    width: 32px;
    height: 32px;
    font-size: 11px;
  }
}
</style>
