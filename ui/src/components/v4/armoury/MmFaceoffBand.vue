<script setup lang="ts">
// Two soldiers face to face across a band, each side captioned: the round
// report's two armies, the comparison page's two players. The loser (if any)
// stands in shadow. Renders nothing when neither side has a soldier to draw.
import { computed } from 'vue'
import MmArmouryStage, { type FaceoffFigure } from './MmArmouryStage.vue'
import type { FigureSpec, Side } from './stage'

export interface FaceoffSide {
  figure: FigureSpec | null
  side: Side
  /** The nation badge ("JP") and the nation it stands for. */
  badge: string
  nationLabel: string
  title: string
  /** A smaller line under the title, e.g. the army a player served in. */
  subtitle?: string
  outcome?: string
}

const props = defineProps<{
  sides: FaceoffSide[]
  /** Index into `sides` of the winner, or null for none. */
  winner: 0 | 1 | null
  label: string
  footnote?: string | null
}>()

const figures = computed<FaceoffFigure[]>(() => props.sides.slice(0, 2).map(side => ({ figure: side.figure, side: side.side })))
const dressed = computed(() => figures.value.some(entry => entry.figure))
</script>

<template>
  <section
    v-if="dressed"
    class="mm-fb"
  >
    <div class="mm-fb__line">
      <div
        v-for="(entry, index) in sides.slice(0, 2)"
        :key="index"
        class="mm-fb__side"
        :class="[
          `mm-fb__side--${index === 0 ? 'left' : 'right'}`,
          { 'mm-fb__side--lost': winner !== null && winner !== index },
        ]"
      >
        <div
          v-if="entry.badge"
          class="mm-fb__nation"
        >
          <span class="mm-country-badge">{{ entry.badge }}</span>
          <span>{{ entry.nationLabel }}</span>
        </div>
        <div class="mm-fb__title">
          {{ entry.title }}
        </div>
        <div
          v-if="entry.subtitle"
          class="mm-fb__subtitle"
        >
          {{ entry.subtitle }}
        </div>
        <div class="mm-fb__result">
          <span
            v-if="entry.side"
            class="mm-chip"
            :class="entry.side === 'axis' ? 'mm-chip--loss' : 'mm-chip--win'"
          >{{ entry.side === 'axis' ? 'Axis' : 'Allied' }}</span>
          <span
            v-if="entry.outcome"
            class="mm-fb__outcome"
          >{{ entry.outcome }}</span>
        </div>
      </div>
    </div>
    <MmArmouryStage
      class="mm-fb__stage"
      layout="faceoff"
      :label="label"
      :figures="figures"
      :winner="winner"
    >
      <div
        v-if="footnote"
        class="mm-fb__footnote"
      >
        {{ footnote }}
      </div>
    </MmArmouryStage>
  </section>
</template>

<style scoped>
.mm-fb {
  position: relative;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  overflow: hidden;
  background: var(--mm-bg-soft);
}

.mm-fb__stage {
  height: 300px;
}

/* Over the stage on a wide band; above it on a phone, where the two men fill the width. */
.mm-fb__line {
  position: absolute;
  inset: 16px 18px auto;
  z-index: 3;
  display: flex;
  justify-content: space-between;
  gap: 24px;
  pointer-events: none;
}

.mm-fb__side {
  max-width: 34%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: opacity 0.2s ease;
}

.mm-fb__side--right {
  align-items: flex-end;
  text-align: right;
}

.mm-fb__side--lost { opacity: 0.55; }

.mm-fb__nation {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
}

.mm-fb__side--right .mm-fb__nation { flex-direction: row-reverse; }

.mm-fb__title {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(20px, 2.2vw, 28px);
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: var(--mm-ink);
  overflow-wrap: anywhere;
}

.mm-fb__subtitle {
  font-size: 13px;
  color: var(--mm-ink-soft);
}

.mm-fb__result {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-fb__side--right .mm-fb__result { flex-direction: row-reverse; }

.mm-fb__outcome {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-fb__footnote {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12px;
  text-align: center;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
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
  color: var(--mm-ink-soft);
  background: color-mix(in srgb, var(--mm-ink) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--mm-ink) 15%, transparent);
  border-radius: 2px;
  line-height: 1.3;
}

@media (max-width: 640px) {
  .mm-fb__stage { height: 240px; }
  .mm-fb__line {
    position: static;
    padding: 12px 12px 0;
    gap: 12px;
  }
  .mm-fb__side { max-width: 50%; }
  .mm-fb__title { font-size: 17px; }
}
</style>
