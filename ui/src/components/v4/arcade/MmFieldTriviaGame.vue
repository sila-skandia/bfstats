<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import 'primeicons/primeicons.css'
import {
  arcadeLoadError,
  fetchTriviaQuiz,
  verifyTriviaQuestion,
  verifyTriviaQuiz,
  type TriviaQuiz,
  type TriviaQuizResult,
  type TriviaQuestionVerification,
} from '@/services/arcadeService'
import { useArcadeAudio } from '@/composables/useArcadeAudio'
import MmRoundReportSlideover from '@/components/v4/arcade/MmRoundReportSlideover.vue'
import MmEmphasizedText from '@/components/v4/arcade/MmEmphasizedText.vue'
import MmArcadeSkeleton from '@/components/v4/arcade/MmArcadeSkeleton.vue'
import {
  THEATER_PLACEHOLDER,
  concealMapName,
  resolveMapArt,
  hideBrokenTheaterImg,
  shouldUseTheaterTiles,
  stripMapHighlights,
  theaterOptionArts,
} from '@/utils/bf1942MapArt'

const props = defineProps<{
  serverGuid?: string
  serverName?: string
  orbitPlayer?: string
}>()

const { isMuted, toggleMute, playRoger, playNegative } = useArcadeAudio()

const quiz = ref<TriviaQuiz | null>(null)
const loading = ref(false)
const evaluatingQuestionId = ref<string | null>(null)
const verifying = ref(false)
const error = ref<string | null>(null)
const activeSlideoverRoundId = ref<string | null>(null)

const currentIndex = ref(0)
const answers = ref<Record<string, string>>({})
const revealedAnswers = ref<Record<string, TriviaQuestionVerification>>({})
const quizResult = ref<TriviaQuizResult | null>(null)

const currentQuestion = computed(() => {
  if (!quiz.value || quiz.value.questions.length === 0) return null
  return quiz.value.questions[currentIndex.value]
})

const currentRevealed = computed(() => {
  if (!currentQuestion.value) return null
  return revealedAnswers.value[currentQuestion.value.id] ?? null
})

const isCurrentAnswered = computed(() => {
  return currentRevealed.value !== null
})

const isLastQuestion = computed(() => {
  if (!quiz.value) return false
  return currentIndex.value === quiz.value.questions.length - 1
})

const progressPercent = computed(() => {
  if (!quiz.value) return 0
  return ((currentIndex.value + 1) / quiz.value.questions.length) * 100
})

const correctCount = computed(() => {
  return Object.values(revealedAnswers.value).filter(r => r.isCorrect).length
})

const answeredCount = computed(() => {
  return Object.keys(revealedAnswers.value).length
})

// Shape of the last quiz rendered, used to draw the loading skeleton. Seeded with what the
// endpoint always returns — five questions, four options — so the very first load is already
// the right shape; after that, switching server or replaying skeletons into the layout the
// user is actually about to get rather than a generic one.
const skeletonQuestionCount = ref(5)
const skeletonOptionCount = ref(4)
const skeletonTiles = ref(false)

const rememberQuizShape = (loaded: TriviaQuiz) => {
  if (loaded.questions.length === 0) return
  skeletonQuestionCount.value = loaded.questions.length
  skeletonOptionCount.value = loaded.questions[0].options.length
  skeletonTiles.value = shouldUseTheaterTiles(loaded.questions[0].options)
}

const loadQuiz = async () => {
  loading.value = true
  error.value = null
  currentIndex.value = 0
  answers.value = {}
  revealedAnswers.value = {}
  evaluatingQuestionId.value = null
  quizResult.value = null

  try {
    const loaded = await fetchTriviaQuiz(props.serverGuid, props.orbitPlayer)
    quiz.value = loaded
    rememberQuizShape(loaded)
  } catch (err) {
    error.value = arcadeLoadError(err, 'Failed to load reconnaissance quiz. Please retry.')
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.serverGuid, props.orbitPlayer],
  () => {
    loadQuiz()
  }
)

const handleSelectOption = async (opt: string) => {
  if (!quiz.value || !currentQuestion.value || isCurrentAnswered.value || evaluatingQuestionId.value) return

  const qId = currentQuestion.value.id
  evaluatingQuestionId.value = qId
  answers.value[qId] = opt

  try {
    const res = await verifyTriviaQuestion(quiz.value.quizToken, qId, opt)
    revealedAnswers.value[qId] = res

    if (res.isCorrect) {
      playRoger()
    } else {
      playNegative()
    }
  } catch {
    delete answers.value[qId]
  } finally {
    evaluatingQuestionId.value = null
  }
}

const nextQuestion = () => {
  if (!quiz.value) return
  if (currentIndex.value < quiz.value.questions.length - 1) {
    currentIndex.value++
  }
}

const prevQuestion = () => {
  if (currentIndex.value > 0) {
    currentIndex.value--
  }
}

const submitQuiz = async () => {
  if (!quiz.value || verifying.value) return
  verifying.value = true
  error.value = null

  try {
    const res = await verifyTriviaQuiz(quiz.value.quizToken, answers.value)
    quizResult.value = res
  } catch {
    error.value = 'Failed to compile debrief report. Please retry.'
  } finally {
    verifying.value = false
  }
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D']

const useTheaterTiles = computed(() => {
  if (!currentQuestion.value) return false
  return shouldUseTheaterTiles(currentQuestion.value.options)
})

const theaterBackdrop = computed(() => {
  const question = currentQuestion.value
  if (!question || useTheaterTiles.value) return null
  const art = resolveMapArt(question.targetMapName)
  if (!art) return null
  if (concealMapName(question.question, question.targetMapName) === question.question) {
    return null
  }
  return art
})

const optionTheaters = computed(() => {
  if (!currentQuestion.value) return []
  return theaterOptionArts(currentQuestion.value.options)
})

const concealTheater = computed(() => {
  return !isCurrentAnswered.value && Boolean(theaterBackdrop.value || useTheaterTiles.value)
})

const displayQuestion = computed(() => {
  const question = currentQuestion.value
  if (!question) return ''
  if (!concealTheater.value) return question.question
  return concealMapName(question.question, question.targetMapName)
})

const questionTerms = (
  highlights?: string[],
  ...entities: Array<string | null | undefined>
) => [...(highlights ?? []), ...entities, props.orbitPlayer]

const liveQuestionTerms = computed(() => {
  const question = currentQuestion.value
  if (!question) return []
  if (concealTheater.value) {
    return questionTerms(
      [...stripMapHighlights(question.highlights), THEATER_PLACEHOLDER],
      question.targetPlayerName,
      question.targetServerName
    )
  }
  return questionTerms(
    question.highlights,
    question.targetPlayerName,
    question.targetMapName,
    question.targetServerName
  )
})

onMounted(() => {
  loadQuiz()
})
</script>

<template>
  <div class="mm-trivia">
    <!-- Header Controls -->
    <div class="mm-trivia__top-bar">
      <div class="mm-trivia__status">
        <span class="mm-eyebrow">Field Lore</span>
        <div
          v-if="quiz"
          class="mm-trivia__step-tracker"
        >
          <span
            v-for="(q, idx) in quiz.questions"
            :key="q.id"
            class="mm-trivia__step-pip"
            :class="{
              'mm-trivia__step-pip--correct': revealedAnswers[q.id]?.isCorrect,
              'mm-trivia__step-pip--wrong': revealedAnswers[q.id] && !revealedAnswers[q.id].isCorrect,
              'mm-trivia__step-pip--active': idx === currentIndex && !revealedAnswers[q.id],
              'mm-trivia__step-pip--pending': idx !== currentIndex && !revealedAnswers[q.id]
            }"
            :title="`Question ${idx + 1}`"
          >
            <i
              v-if="revealedAnswers[q.id]?.isCorrect"
              class="pi pi-check"
            />
            <i
              v-else-if="revealedAnswers[q.id] && !revealedAnswers[q.id].isCorrect"
              class="pi pi-times"
            />
            <span v-else>{{ idx + 1 }}</span>
          </span>
        </div>
        <MmArcadeSkeleton
          v-else-if="loading"
          variant="pips"
          :question-count="skeletonQuestionCount"
          label="Loading trivia questions"
        />
        <span
          v-if="quiz"
          class="mm-trivia__score-pill"
        >
          Confirmed: {{ correctCount }} / {{ answeredCount }}
        </span>
      </div>

      <button
        type="button"
        class="mm-trivia__sound-btn"
        :class="{ 'mm-trivia__sound-btn--active': !isMuted }"
        @click="toggleMute"
      >
        <i
          :class="isMuted ? 'pi pi-volume-off' : 'pi pi-volume-up'"
          class="mm-trivia__sound-icon"
        />
        <span>{{ isMuted ? 'Muted' : 'Sound On' }}</span>
      </button>
    </div>

    <!-- Loading State -->
    <MmArcadeSkeleton
      v-if="loading"
      variant="quiz"
      :question-count="skeletonQuestionCount"
      :option-count="skeletonOptionCount"
      :tiles="skeletonTiles"
      label="Loading trivia questions"
    />

    <!-- Error State -->
    <div
      v-else-if="error"
      class="mm-trivia__error"
      data-testid="arcade-error"
    >
      {{ error }}
      <button
        type="button"
        class="mm-trivia__retry-btn"
        @click="loadQuiz"
      >
        Retry
      </button>
    </div>

    <!-- Active Question View -->
    <div
      v-else-if="currentQuestion && !quizResult"
      class="mm-trivia__quiz-box"
    >
      <!-- Progress Bar -->
      <div class="mm-trivia__progress-track">
        <div
          class="mm-trivia__progress-fill"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>

      <div class="mm-trivia__meta-row">
        <div class="mm-trivia__meta-left">
          <span class="mm-trivia__cat-badge">{{ currentQuestion.category }}</span>
          <span class="mm-trivia__step-label">Question {{ currentIndex + 1 }} of {{ quiz?.questions.length }}</span>
        </div>
        <button
          v-if="currentQuestion.targetRoundId"
          type="button"
          class="mm-trivia__round-btn"
          title="Inspect round report in slideover"
          @click="activeSlideoverRoundId = currentQuestion.targetRoundId"
        >
          <i class="pi pi-file" />
          <span>Round Report &rarr;</span>
        </button>
      </div>

      <div
        v-if="theaterBackdrop"
        class="mm-trivia__theater"
        data-testid="trivia-theater"
      >
        <div class="mm-trivia__theater-frame">
          <img
            class="mm-trivia__theater-img"
            :src="theaterBackdrop.ingame"
            :alt="isCurrentAnswered ? theaterBackdrop.displayName : 'Theater recon'"
            width="512"
            height="512"
            @error="hideBrokenTheaterImg"
          >
        </div>
        <div class="mm-trivia__theater-caption">
          <span class="mm-eyebrow">Theater recon</span>
          <span
            v-if="isCurrentAnswered"
            class="mm-trivia__theater-name"
          >{{ theaterBackdrop.displayName }}</span>
          <span
            v-else
            class="mm-trivia__theater-name mm-trivia__theater-name--blind"
          >Classify the theater</span>
        </div>
      </div>

      <h2
        class="mm-trivia__question"
        data-testid="trivia-question"
      >
        <MmEmphasizedText
          :text="displayQuestion"
          :terms="liveQuestionTerms"
        />
      </h2>

      <div
        v-if="useTheaterTiles"
        class="mm-trivia__theaters"
        data-testid="trivia-theater-options"
      >
        <button
          v-for="(opt, oIdx) in currentQuestion.options"
          :key="oIdx"
          type="button"
          class="mm-trivia__theater-tile"
          :class="{
            'mm-trivia__theater-tile--evaluating': evaluatingQuestionId === currentQuestion.id && answers[currentQuestion.id] === opt,
            'mm-trivia__theater-tile--correct': currentRevealed && answers[currentQuestion.id] === opt && currentRevealed.isCorrect,
            'mm-trivia__theater-tile--wrong': currentRevealed && answers[currentQuestion.id] === opt && !currentRevealed.isCorrect,
            'mm-trivia__theater-tile--actual-correct': currentRevealed && !currentRevealed.isCorrect && opt === currentRevealed.correctAnswer,
            'mm-trivia__theater-tile--dimmed': currentRevealed && opt !== answers[currentQuestion.id] && opt !== currentRevealed.correctAnswer
          }"
          :disabled="isCurrentAnswered || evaluatingQuestionId === currentQuestion.id"
          :aria-label="isCurrentAnswered ? $pn(opt) : `Theater ${OPTION_LETTERS[oIdx]}`"
          data-testid="trivia-option"
          @click="handleSelectOption(opt)"
        >
          <img
            v-if="optionTheaters[oIdx]"
            class="mm-trivia__theater-tile-img"
            :src="optionTheaters[oIdx]?.ingame"
            :alt="isCurrentAnswered ? $pn(opt) : ''"
            width="512"
            height="512"
            @error="hideBrokenTheaterImg"
          >
          <span
            v-else
            class="mm-trivia__theater-tile-fallback"
          >{{ isCurrentAnswered ? $pn(opt) : `Theater ${OPTION_LETTERS[oIdx]}` }}</span>
          <span class="mm-trivia__opt-letter mm-trivia__theater-letter">{{ OPTION_LETTERS[oIdx] }}</span>
          <span
            v-if="isCurrentAnswered"
            class="mm-trivia__theater-tile-name"
          >{{ $pn(opt) }}</span>
        </button>
      </div>

      <div
        v-else
        class="mm-trivia__options"
      >
        <button
          v-for="(opt, oIdx) in currentQuestion.options"
          :key="oIdx"
          type="button"
          class="mm-trivia__option-btn"
          :class="{
            'mm-trivia__option-btn--evaluating': evaluatingQuestionId === currentQuestion.id && answers[currentQuestion.id] === opt,
            'mm-trivia__option-btn--correct': currentRevealed && answers[currentQuestion.id] === opt && currentRevealed.isCorrect,
            'mm-trivia__option-btn--wrong': currentRevealed && answers[currentQuestion.id] === opt && !currentRevealed.isCorrect,
            'mm-trivia__option-btn--actual-correct': currentRevealed && !currentRevealed.isCorrect && opt === currentRevealed.correctAnswer,
            'mm-trivia__option-btn--dimmed': currentRevealed && opt !== answers[currentQuestion.id] && opt !== currentRevealed.correctAnswer
          }"
          :disabled="isCurrentAnswered || evaluatingQuestionId === currentQuestion.id"
          data-testid="trivia-option"
          @click="handleSelectOption(opt)"
        >
          <span class="mm-trivia__opt-letter">{{ OPTION_LETTERS[oIdx] }}</span>
          <span class="mm-trivia__opt-text">{{ $pn(opt) }}</span>
          <span
            v-if="currentRevealed && answers[currentQuestion.id] === opt"
            class="mm-trivia__opt-tag"
            :class="currentRevealed.isCorrect ? 'mm-trivia__opt-tag--correct' : 'mm-trivia__opt-tag--wrong'"
          >
            <i :class="currentRevealed.isCorrect ? 'pi pi-check' : 'pi pi-times'" />
            <span>{{ currentRevealed.isCorrect ? 'Correct' : 'Your Choice' }}</span>
          </span>
          <span
            v-else-if="currentRevealed && !currentRevealed.isCorrect && opt === currentRevealed.correctAnswer"
            class="mm-trivia__opt-tag mm-trivia__opt-tag--actual"
          >
            <i class="pi pi-check" />
            <span>Correct Answer</span>
          </span>
        </button>
      </div>

      <!-- Immediate Record Intel Reveal -->
      <div
        v-if="currentRevealed"
        class="mm-trivia__intel-reveal"
        :class="currentRevealed.isCorrect ? 'mm-trivia__intel-reveal--correct' : 'mm-trivia__intel-reveal--wrong'"
      >
        <div class="mm-trivia__intel-header">
          <i
            :class="currentRevealed.isCorrect ? 'pi pi-check-circle' : 'pi pi-info-circle'"
            class="mm-trivia__intel-icon"
          />
          <span class="mm-eyebrow">
            {{ currentRevealed.isCorrect ? 'Correct (+1)' : 'Incorrect (0)' }}
          </span>
        </div>
        <p class="mm-trivia__intel-text">
          <MmEmphasizedText
            :text="currentRevealed.explanation"
            :terms="questionTerms(
              currentRevealed.highlights ?? currentQuestion.highlights,
              currentRevealed.targetPlayerName,
              currentRevealed.targetMapName,
              currentRevealed.targetServerName
            )"
          />
        </p>

        <!-- Contextual Entity Links -->
        <div
          v-if="currentRevealed.targetPlayerName || currentRevealed.targetRoundId || currentQuestion.targetRoundId"
          class="mm-trivia__entity-actions"
        >
          <router-link
            v-if="currentRevealed.targetPlayerName"
            :to="`/v4/players/${encodeURIComponent(currentRevealed.targetPlayerName)}`"
            target="_blank"
            rel="noopener noreferrer"
            class="mm-entity-link"
          >
            <i class="pi pi-user" />
            <span>View {{ $pn(currentRevealed.targetPlayerName) }}'s Profile &rarr;</span>
          </router-link>

          <button
            v-if="currentRevealed.targetRoundId || currentQuestion.targetRoundId"
            type="button"
            class="mm-entity-btn"
            @click="activeSlideoverRoundId = (currentRevealed.targetRoundId || currentQuestion.targetRoundId)!"
          >
            <i class="pi pi-file" />
            <span>View Round Report &rarr;</span>
          </button>
        </div>
      </div>

      <!-- Navigation & Submit Bar -->
      <div class="mm-trivia__nav-bar">
        <button
          type="button"
          class="mm-trivia__nav-btn mm-trivia__nav-btn--prev"
          :disabled="currentIndex === 0"
          @click="prevQuestion"
        >
          <i class="pi pi-arrow-left" />
          <span>Previous</span>
        </button>

        <button
          v-if="!isLastQuestion"
          type="button"
          class="mm-trivia__nav-btn mm-trivia__nav-btn--next"
          :disabled="!isCurrentAnswered"
          @click="nextQuestion"
        >
          <span>Next Question</span>
          <i class="pi pi-arrow-right" />
        </button>

        <button
          v-else
          type="button"
          class="mm-trivia__nav-btn mm-trivia__nav-btn--submit"
          :disabled="!isCurrentAnswered || verifying"
          @click="submitQuiz"
        >
          <span>{{ verifying ? 'Calculating...' : 'View Results' }}</span>
          <i
            v-if="!verifying"
            class="pi pi-arrow-right"
          />
        </button>
      </div>
    </div>

    <!-- Result / Debrief Report -->
    <div
      v-else-if="quizResult"
      class="mm-trivia__debrief"
    >
      <div class="mm-trivia__debrief-banner">
        <div class="mm-trivia__debrief-top">
          <span class="mm-eyebrow">Results</span>
          <span class="mm-trivia__debrief-rank">{{ quizResult.rankTitle }}</span>
        </div>

        <div class="mm-trivia__score-row">
          <div class="mm-trivia__score-box">
            <span class="mm-trivia__score-val">{{ quizResult.correctCount }} / {{ quizResult.totalQuestions }}</span>
            <span class="mm-eyebrow">Score ({{ Math.round(quizResult.scorePercentage) }}%)</span>
          </div>
          <p class="mm-trivia__debrief-summary">
            {{ quizResult.summaryMessage }}
          </p>
        </div>

        <div class="mm-trivia__debrief-actions">
          <button
            type="button"
            class="mm-trivia__act-btn mm-trivia__act-btn--primary"
            @click="loadQuiz"
          >
            <i class="pi pi-refresh" />
            <span>Play Again</span>
          </button>
        </div>
      </div>

      <!-- Questions Review List -->
      <div class="mm-trivia__review-list">
        <div class="mm-trivia__review-heading">
          <span class="mm-eyebrow--strong">Question Review</span>
        </div>

        <div
          v-for="(q, qIdx) in quizResult.questionResults"
          :key="q.questionId"
          class="mm-trivia__review-card"
          :class="q.isCorrect ? 'mm-trivia__review-card--correct' : 'mm-trivia__review-card--wrong'"
        >
          <div class="mm-trivia__rev-header">
            <span class="mm-trivia__rev-idx">#{{ qIdx + 1 }}</span>
            <span class="mm-trivia__rev-status">{{ q.isCorrect ? 'CORRECT' : 'INCORRECT' }}</span>
          </div>

          <h4 class="mm-trivia__rev-question">
            <MmEmphasizedText
              :text="q.question"
              :terms="questionTerms(
                q.highlights,
                q.targetPlayerName,
                q.targetMapName,
                q.targetServerName
              )"
            />
          </h4>

          <div class="mm-trivia__rev-answers">
            <div class="mm-trivia__rev-answer-row">
              <span class="mm-eyebrow">Your Answer:</span>
              <span
                class="mm-trivia__rev-ans-val"
                :class="q.isCorrect ? 'mm-trivia__rev-ans-val--correct' : 'mm-trivia__rev-ans-val--wrong'"
              >
                {{ q.selectedAnswer ? $pn(q.selectedAnswer) : '(Unanswered)' }}
              </span>
            </div>

            <div
              v-if="!q.isCorrect"
              class="mm-trivia__rev-answer-row"
            >
              <span class="mm-eyebrow">Correct Answer:</span>
              <span class="mm-trivia__rev-ans-val mm-trivia__rev-ans-val--actual">
                {{ $pn(q.correctAnswer) }}
              </span>
            </div>
          </div>

          <div class="mm-trivia__rev-fact">
            <span class="mm-eyebrow">Context:</span>
            <p class="mm-trivia__rev-fact-text">
              <MmEmphasizedText
                :text="q.explanation"
                :terms="questionTerms(
                  q.highlights,
                  q.targetPlayerName,
                  q.targetMapName,
                  q.targetServerName
                )"
              />
            </p>

            <div
              v-if="q.targetPlayerName || q.targetRoundId"
              class="mm-trivia__entity-actions"
              style="margin-top: 10px"
            >
              <router-link
                v-if="q.targetPlayerName"
                :to="`/v4/players/${encodeURIComponent(q.targetPlayerName)}`"
                target="_blank"
                rel="noopener noreferrer"
                class="mm-entity-link"
              >
                <i class="pi pi-user" />
                <span>View {{ $pn(q.targetPlayerName) }}'s Profile &rarr;</span>
              </router-link>

              <button
                v-if="q.targetRoundId"
                type="button"
                class="mm-entity-btn"
                @click="activeSlideoverRoundId = q.targetRoundId"
              >
                <i class="pi pi-file" />
                <span>View Round Report &rarr;</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Slideover for Round Report -->
    <MmRoundReportSlideover
      :round-id="activeSlideoverRoundId"
      @close="activeSlideoverRoundId = null"
    />
  </div>
</template>

<style scoped>
.mm-trivia {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Top bar */
.mm-trivia__top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 6px;
}

.mm-trivia__status {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mm-trivia__status-pill {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 4px;
  color: var(--mm-accent-soft);
}

.mm-trivia__step-tracker {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mm-trivia__step-pip {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 700;
  transition: all 0.2s ease;
}

.mm-trivia__step-pip--pending {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink-muted);
}

.mm-trivia__step-pip--active {
  background: rgba(125, 136, 73, 0.15);
  border: 1.5px solid var(--mm-accent);
  color: var(--mm-accent);
}

.mm-trivia__step-pip--correct {
  background: rgba(34, 197, 94, 0.18);
  border: 1.5px solid #22c55e;
  color: #22c55e;
}

.mm-trivia__step-pip--wrong {
  background: rgba(239, 68, 68, 0.18);
  border: 1.5px solid #ef4444;
  color: #ef4444;
}

.mm-trivia__score-pill {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 3px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 4px;
  color: var(--mm-ink);
}

.mm-trivia__sound-btn {
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
.mm-trivia__sound-btn:hover {
  color: var(--mm-ink);
}
.mm-trivia__sound-btn--active {
  color: var(--mm-accent-soft);
}

/* Quiz Box */
.mm-trivia__quiz-box {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 28px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 8px;
  position: relative;
  overflow: hidden;
}

.mm-trivia__progress-track {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--mm-bg-mute);
}

.mm-trivia__progress-fill {
  height: 100%;
  background: var(--mm-accent);
  transition: width 0.3s ease;
}

.mm-trivia__meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.mm-trivia__meta-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mm-trivia__round-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--mm-bg, #131313);
  border: 1px solid var(--mm-rule-strong, #3d3d3d);
  border-radius: 2px;
  font-family: var(--mm-font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mm-ink, #ffffff);
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.2;
}

.mm-trivia__round-btn:hover {
  border-color: var(--mm-accent, #7d8849);
  color: var(--mm-accent-soft, #9aa666);
  background: var(--mm-bg-mute, #222222);
}

.mm-trivia__cat-badge {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--mm-accent-soft);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.mm-trivia__step-label {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  color: var(--mm-ink-muted);
}

.mm-trivia__theater {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(320px, 100%, 48vh);
}

.mm-trivia__theater-frame {
  position: relative;
  aspect-ratio: 1;
  width: 100%;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg);
  overflow: hidden;
}

.mm-trivia__theater-img,
.mm-trivia__theater-tile-img {
  display: block;
  width: 100%;
  height: 100%;
  object-position: center;
}

.mm-trivia__theater-img {
  object-fit: contain;
}

.mm-trivia__theater-tile-img {
  object-fit: cover;
}

.mm-trivia__theater-caption {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-trivia__theater-name {
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink);
}

.mm-trivia__theater-name--blind {
  color: var(--mm-accent-soft);
}

.mm-trivia__theaters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  max-width: min(440px, 100%);
}

.mm-trivia__theater-tile {
  position: relative;
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s ease, opacity 0.15s ease;
}

.mm-trivia__theater-tile:hover:not(:disabled) {
  border-color: var(--mm-accent);
}

.mm-trivia__theater-tile:disabled {
  cursor: default;
}

.mm-trivia__theater-tile--evaluating {
  border-color: var(--mm-accent);
}

.mm-trivia__theater-tile--correct {
  border-color: var(--mm-success);
}

.mm-trivia__theater-tile--wrong {
  border-color: var(--mm-danger);
}

.mm-trivia__theater-tile--actual-correct {
  border: 1.5px dashed var(--mm-success);
}

.mm-trivia__theater-tile--dimmed {
  opacity: 0.42;
}

.mm-trivia__theater-tile-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 16px;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  background: var(--mm-bg-mute);
}

.mm-trivia__theater-letter {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
}

.mm-trivia__theater-tile--correct .mm-trivia__theater-letter {
  background: var(--mm-success);
  color: var(--mm-highlight-ink);
  border-color: var(--mm-success);
}

.mm-trivia__theater-tile--wrong .mm-trivia__theater-letter {
  background: var(--mm-danger);
  color: var(--mm-ink);
  border-color: var(--mm-danger);
}

.mm-trivia__theater-tile-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  padding: 8px 10px 7px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mm-ink);
  background: color-mix(in srgb, var(--mm-bg) 82%, transparent);
}

.mm-trivia__question {
  margin: 4px 0 10px;
  font-size: 22px;
  font-weight: 700;
  color: var(--mm-ink);
  line-height: 1.4;
}

.mm-trivia__options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.mm-trivia__option-btn {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 6px;
  color: var(--mm-ink);
  font-family: var(--mm-font-display);
  font-size: 15px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mm-trivia__option-btn:hover {
  border-color: var(--mm-rule-strong);
  background: var(--mm-bg-mute);
}

.mm-trivia__option-btn--selected {
  border-color: var(--mm-accent);
  background: rgba(125, 136, 73, 0.12);
  color: var(--mm-ink);
}

.mm-trivia__option-btn:disabled {
  cursor: default;
}

.mm-trivia__option-btn--evaluating {
  border-color: var(--mm-accent);
  opacity: 0.8;
}

.mm-trivia__option-btn--correct {
  border-color: #22c55e !important;
  background: rgba(34, 197, 94, 0.12) !important;
}

.mm-trivia__option-btn--correct .mm-trivia__opt-letter {
  background: #22c55e !important;
  color: #000 !important;
  border-color: #22c55e !important;
}

.mm-trivia__option-btn--wrong {
  border-color: #ef4444 !important;
  background: rgba(239, 68, 68, 0.12) !important;
}

.mm-trivia__option-btn--wrong .mm-trivia__opt-letter {
  background: #ef4444 !important;
  color: #fff !important;
  border-color: #ef4444 !important;
}

.mm-trivia__option-btn--actual-correct {
  border: 1.5px dashed #22c55e !important;
  background: rgba(34, 197, 94, 0.08) !important;
}

.mm-trivia__option-btn--actual-correct .mm-trivia__opt-letter {
  border-color: #22c55e !important;
  color: #22c55e !important;
}

.mm-trivia__option-btn--dimmed {
  opacity: 0.45;
}

.mm-trivia__opt-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 4px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.mm-trivia__opt-tag--correct {
  background: var(--mm-success-bg, #2b3a1a);
  color: var(--mm-success, #7da34c);
  border: 1px solid var(--mm-success, #7da34c);
}

.mm-trivia__opt-tag--wrong {
  background: rgba(214, 90, 90, 0.18);
  color: var(--mm-danger, #d65a5a);
  border: 1px solid var(--mm-danger, #d65a5a);
}

.mm-trivia__opt-tag--actual {
  background: rgba(125, 163, 76, 0.12);
  color: var(--mm-success, #7da34c);
  border: 1px dashed var(--mm-success, #7da34c);
}

/* Intel Reveal Box */
.mm-trivia__intel-reveal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  border-radius: 2px;
  animation: mmIntelFade 0.2s ease-out;
}

@keyframes mmIntelFade {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.mm-trivia__intel-reveal--correct {
  background: rgba(125, 163, 76, 0.09);
  border: 1px solid var(--mm-success, #7da34c);
}

.mm-trivia__intel-reveal--wrong {
  background: rgba(214, 90, 90, 0.09);
  border: 1px solid var(--mm-danger, #d65a5a);
}

.mm-trivia__intel-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-trivia__intel-icon {
  font-size: 14px;
}

.mm-trivia__intel-reveal--correct .mm-trivia__intel-icon {
  color: var(--mm-success, #7da34c);
}

.mm-trivia__intel-reveal--wrong .mm-trivia__intel-icon {
  color: var(--mm-danger, #d65a5a);
}

.mm-trivia__intel-text {
  margin: 0;
  font-family: var(--mm-font-display);
  font-size: 14px;
  line-height: 1.5;
  color: var(--mm-ink);
}

/* Contextual Entity Link Actions */
.mm-trivia__entity-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.mm-entity-link,
.mm-entity-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--mm-bg, #131313);
  border: 1px solid var(--mm-rule-strong, #3d3d3d);
  border-radius: 2px;
  font-family: var(--mm-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--mm-ink, #ffffff);
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.2;
}

.mm-entity-link:hover,
.mm-entity-btn:hover {
  border-color: var(--mm-accent, #7d8849);
  color: var(--mm-accent-soft, #9aa666);
  background: var(--mm-bg-mute, #222222);
}

.mm-trivia__opt-letter {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  background: var(--mm-bg-mute);
  border: 1px solid var(--mm-rule-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  font-weight: 800;
  color: var(--mm-ink-soft);
  flex-shrink: 0;
}

.mm-trivia__option-btn--selected .mm-trivia__opt-letter {
  background: var(--mm-accent);
  color: #000;
  border-color: var(--mm-accent);
}

.mm-trivia__opt-text {
  flex: 1;
}

.mm-trivia__nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 18px;
  border-top: 1px solid var(--mm-rule);
}

.mm-trivia__nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 6px;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.mm-trivia__nav-btn--prev {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink-soft);
}
.mm-trivia__nav-btn--prev:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mm-trivia__nav-btn--next {
  background: var(--mm-accent);
  color: #000;
}
.mm-trivia__nav-btn--next:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mm-trivia__nav-btn--submit {
  background: var(--mm-success);
  color: #000;
}
.mm-trivia__nav-btn--submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Debrief / Results */
.mm-trivia__debrief {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.mm-trivia__debrief-banner {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 8px;
}

.mm-trivia__debrief-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mm-trivia__debrief-rank {
  font-family: var(--mm-font-mono);
  font-size: 14px;
  font-weight: 800;
  color: var(--mm-accent-soft);
  text-transform: uppercase;
}

.mm-trivia__score-row {
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 14px 0;
  border-top: 1px solid var(--mm-rule);
  border-bottom: 1px solid var(--mm-rule);
}

.mm-trivia__score-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-trivia__score-val {
  font-family: var(--mm-font-mono);
  font-size: 32px;
  font-weight: 800;
  color: var(--mm-ink);
  line-height: 1;
}

.mm-trivia__debrief-summary {
  margin: 0;
  font-size: 15px;
  color: var(--mm-ink-soft);
  line-height: 1.5;
}

.mm-trivia__debrief-actions {
  display: flex;
  gap: 12px;
}

.mm-trivia__act-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 6px;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 0.06em;
}

.mm-trivia__act-btn--primary {
  background: var(--mm-accent);
  color: #000;
  border: none;
}
.mm-trivia__act-btn--secondary {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  color: var(--mm-ink);
}

/* Review List */
.mm-trivia__review-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mm-trivia__review-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 6px;
}

.mm-trivia__review-card--correct {
  border-left: 4px solid var(--mm-success);
}

.mm-trivia__review-card--wrong {
  border-left: 4px solid var(--mm-danger);
}

.mm-trivia__rev-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mm-trivia__rev-idx {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--mm-ink-muted);
}

.mm-trivia__rev-status {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.mm-trivia__review-card--correct .mm-trivia__rev-status {
  color: var(--mm-success);
}
.mm-trivia__review-card--wrong .mm-trivia__rev-status {
  color: var(--mm-danger);
}

.mm-trivia__rev-question {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--mm-ink);
}

.mm-trivia__rev-answers {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mm-trivia__rev-answer-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.mm-trivia__rev-ans-val {
  font-size: 14px;
  font-weight: 600;
}
.mm-trivia__rev-ans-val--correct {
  color: var(--mm-success);
}
.mm-trivia__rev-ans-val--wrong {
  color: var(--mm-danger);
}
.mm-trivia__rev-ans-val--actual {
  color: var(--mm-ink);
}

.mm-trivia__rev-fact {
  margin-top: 4px;
  padding: 10px 14px;
  background: var(--mm-bg);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-trivia__rev-fact-text {
  margin: 0;
  font-size: 13px;
  color: var(--mm-ink-soft);
  line-height: 1.4;
}

@media (max-width: 720px) {
  .mm-trivia__options {
    grid-template-columns: 1fr;
  }

  .mm-trivia__score-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
}
</style>
