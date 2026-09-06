<script setup lang="ts">
/**
 * Loading placeholders for the arcade games.
 *
 * These replace spinners. A spinner says "something is happening somewhere"; a skeleton that
 * traces the real layout tells you what is arriving and reserves its space, so the swap to
 * real content is a fill rather than a jump. Each variant mirrors the markup it stands in for
 * closely enough that nothing reflows when the data lands.
 *
 * Every element here is decorative — `aria-hidden` on the wrapper plus a single live-region
 * status line keeps screen readers from reading out a wall of empty boxes.
 */
withDefaults(
  defineProps<{
    /**
     * Which game is loading.
     *   quiz         — Field Lore trivia: question and answer options
     *   pips         — the trivia step tracker alone, which lives in the top bar rather
     *                  than the quiz box and so has to be placed separately
     *   headToHead   — Higher/Lower: two combatant cards either side of the VS badge
     *   dossier      — Mystery Soldier: the clue card grid
     */
    variant: 'quiz' | 'pips' | 'headToHead' | 'dossier'
    /** Answer options to outline. Matches the four the API always returns. */
    optionCount?: number
    /** Questions in the quiz, drawn as step pips. The quiz endpoint always returns five. */
    questionCount?: number
    /** Draw options as image tiles rather than rows, for theater-identification questions. */
    tiles?: boolean
    /** Clue cards to outline in the dossier variant. */
    clueCount?: number
    /** Announced to screen readers while the skeleton is up. */
    label?: string
  }>(),
  {
    optionCount: 4,
    questionCount: 5,
    tiles: false,
    clueCount: 6,
    label: 'Loading',
  }
)
</script>

<template>
  <div
    class="mm-askel"
    data-testid="arcade-skeleton"
  >
    <!-- The pips variant is always shown alongside a quiz skeleton, which carries the
         announcement; a second live region would just say the same thing twice. -->
    <p
      v-if="variant !== 'pips'"
      class="mm-askel__sr"
      role="status"
      aria-live="polite"
    >
      {{ label }}
    </p>

    <!-- Trivia step tracker, rendered into the top bar -->
    <div
      v-if="variant === 'pips'"
      class="mm-askel__pips"
      aria-hidden="true"
    >
      <span
        v-for="i in questionCount"
        :key="i"
        class="mm-skeleton mm-askel__pip"
      />
    </div>

    <!-- Field Lore trivia -->
    <div
      v-else-if="variant === 'quiz'"
      class="mm-askel__quiz"
      aria-hidden="true"
    >
      <div class="mm-skeleton mm-askel__progress" />

      <div class="mm-askel__meta">
        <span class="mm-skeleton mm-askel__badge" />
        <span class="mm-skeleton mm-askel__step" />
      </div>

      <div class="mm-askel__question">
        <span class="mm-skeleton mm-askel__line" />
        <span class="mm-skeleton mm-askel__line mm-askel__line--short" />
      </div>

      <div
        v-if="tiles"
        class="mm-askel__tiles"
      >
        <span
          v-for="i in optionCount"
          :key="i"
          class="mm-skeleton mm-askel__tile"
        />
      </div>
      <div
        v-else
        class="mm-askel__options"
      >
        <span
          v-for="i in optionCount"
          :key="i"
          class="mm-skeleton mm-askel__option"
        />
      </div>
    </div>

    <!-- Higher / Lower head-to-head -->
    <div
      v-else-if="variant === 'headToHead'"
      class="mm-askel__h2h"
      aria-hidden="true"
    >
      <div class="mm-askel__question mm-askel__question--centered">
        <span class="mm-skeleton mm-askel__line" />
      </div>

      <div class="mm-askel__arena">
        <div
          v-for="side in 2"
          :key="side"
          class="mm-askel__card"
        >
          <span class="mm-skeleton mm-askel__avatar" />
          <span class="mm-skeleton mm-askel__name" />
          <span class="mm-skeleton mm-askel__chip" />
          <span class="mm-skeleton mm-askel__metric" />
          <span class="mm-skeleton mm-askel__pick" />
        </div>

        <div class="mm-askel__vs">
          <span class="mm-skeleton mm-askel__vs-circle" />
        </div>
      </div>
    </div>

    <!-- Mystery Soldier dossier -->
    <div
      v-else
      class="mm-askel__dossier"
      aria-hidden="true"
    >
      <div class="mm-askel__meta">
        <span class="mm-skeleton mm-askel__badge" />
        <span class="mm-skeleton mm-askel__step" />
      </div>
      <div class="mm-askel__clues">
        <span
          v-for="i in clueCount"
          :key="i"
          class="mm-skeleton mm-askel__clue"
        />
      </div>
      <span class="mm-skeleton mm-askel__guess" />
    </div>
  </div>
</template>

<style scoped>
.mm-askel {
  display: block;
}

/* Visually hidden, still announced. */
.mm-askel__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* Stagger the shimmer so the placeholders read as a group settling rather than a
   single block flashing. mm-shimmer itself is defined globally in modern-minimal.css. */
.mm-askel .mm-skeleton:nth-child(2) { animation-delay: 0.08s; }
.mm-askel .mm-skeleton:nth-child(3) { animation-delay: 0.16s; }
.mm-askel .mm-skeleton:nth-child(4) { animation-delay: 0.24s; }
.mm-askel .mm-skeleton:nth-child(5) { animation-delay: 0.32s; }

@media (prefers-reduced-motion: reduce) {
  .mm-askel .mm-skeleton { animation: none; opacity: 0.6; }
}

/* ---------- quiz ---------- */

.mm-askel__quiz {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-askel__pips {
  display: flex;
  gap: 6px;
}

.mm-askel__pip {
  width: 22px;
  height: 22px;
  border-radius: 2px;
}

.mm-askel__progress {
  height: 3px;
  border-radius: 0;
}

.mm-askel__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mm-askel__badge {
  width: 128px;
  height: 18px;
}

.mm-askel__step {
  width: 96px;
  height: 12px;
}

.mm-askel__question {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 4px 0 8px;
}

.mm-askel__question--centered {
  align-items: center;
}

.mm-askel__line {
  width: 100%;
  height: 20px;
}

.mm-askel__line--short {
  width: 62%;
}

.mm-askel__options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mm-askel__option {
  height: 52px;
}

.mm-askel__tiles {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.mm-askel__tile {
  aspect-ratio: 1 / 1;
}

/* ---------- head to head ---------- */

.mm-askel__h2h {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mm-askel__arena {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: stretch;
  gap: 16px;
}

/* The VS badge sits between the two cards, so it is ordered second in the grid
   while remaining last in the DOM. */
.mm-askel__vs {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mm-askel__card:first-of-type { grid-column: 1; grid-row: 1; }
.mm-askel__card:nth-of-type(2) { grid-column: 3; grid-row: 1; }

.mm-askel__card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-askel__avatar {
  width: 56px;
  height: 56px;
  border-radius: 2px;
}

.mm-askel__name { width: 70%; height: 22px; }
.mm-askel__chip { width: 50%; height: 16px; }
.mm-askel__metric { height: 48px; }
.mm-askel__pick { height: 44px; margin-top: auto; }

.mm-askel__vs-circle {
  width: 48px;
  height: 48px;
  border-radius: 50%;
}

/* ---------- dossier ---------- */

.mm-askel__dossier {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-askel__clues {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.mm-askel__clue { height: 72px; }
.mm-askel__guess { height: 44px; }

/* ---------- mobile ---------- */

@media (max-width: 768px) {
  .mm-askel__quiz,
  .mm-askel__card,
  .mm-askel__dossier {
    padding: 16px;
  }

  /* Match the real arena, which stacks the combatants with the VS badge between them. */
  .mm-askel__arena {
    grid-template-columns: 1fr;
  }

  .mm-askel__card:first-of-type { grid-column: 1; grid-row: 1; }
  .mm-askel__vs { grid-column: 1; grid-row: 2; }
  .mm-askel__card:nth-of-type(2) { grid-column: 1; grid-row: 3; }

  .mm-askel__option { height: 46px; }
}
</style>
