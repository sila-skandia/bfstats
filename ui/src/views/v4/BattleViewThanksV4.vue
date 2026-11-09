<script setup lang="ts">
/**
 * Thanks to the people who helped make the replay system.
 * The owner's own words, kept exactly as written: do not edit them
 * (features/battleview-install-page, "Thanks page").
 */
import { RouterLink } from 'vue-router'

type Thanks = {
  id: string
  name: string
  paragraphs: string[]
  /** A link at the end of the last paragraph, shown in brackets as its own URL. */
  link?: string
}

const people: Thanks[] = [
  {
    id: 'black-mamba',
    name: 'Black Mamba',
    paragraphs: [
      'Black was one of the first to try the original stats website, and as always had constructive feedback, which let to adding the trends dashbaords.',
      'For the replay system Black has watched over most recordings with a fine tooth comb and identified multiple bugs with the game mechanics down to the pixel detail. If the replays look almost perfect, a lot of that polish is thanks to Black.',
      'Many thanks for the many discussions about random features and bugs, I greatly appreciate it.',
    ],
  },
  {
    id: 'tragic',
    name: 'tragic!',
    paragraphs: [
      "one of the wisest players in the game, knows his shit and about everyone in the game. Has been a conduit for putting me in touch with various community members. Also has many banger ideas that he'll drop off the cuff, such as mobile controls for playing BF on mobile.",
    ],
  },
  {
    id: 'chief-hemp',
    name: 'Chief-H.E.M.P',
    paragraphs: [
      'a regular uploader, particularly at the start. Their recordings have uncovered hundreds of bugs that got fixed to make the replays better for everyone.',
    ],
  },
  {
    id: 'volpi-heph',
    name: '=Volpi=[Heph]',
    paragraphs: [
      "for being in the first group of recorders. Provided some really great suggestions like adding cross-hairs, adding zoom from the player's POV, and for reporting many small bugs.",
    ],
  },
  {
    id: 'jan-paul',
    name: 'Jan Paul',
    paragraphs: [
      'Contributing FHSW Europe recordings. What a beautiful immersive mod, love watching your recordings. The community in general is a laugh, and always do something hilarious each recording',
    ],
    link: 'https://replay.bfstats.io/s/mdtqtue2k8',
  },
]
</script>

<template>
  <div class="mm-container mm-section bvt" data-testid="battleview-thanks">
    <RouterLink to="/battleview" class="bvt__back">
      <i class="pi pi-arrow-left" aria-hidden="true" /> BattleView
    </RouterLink>
    <div class="mm-eyebrow mm-eyebrow--strong bvt__eyebrow">Replay system</div>
    <h1 class="mm-display">Thank you</h1>

    <ol class="bvt__list">
      <li v-for="(person, i) in people" :id="person.id" :key="person.id" class="bvt__person" data-testid="battleview-thanks-person">
        <span class="bvt__num" aria-hidden="true">{{ String(i + 1).padStart(2, '0') }}</span>
        <div class="bvt__body">
          <h2 class="bvt__name">{{ person.name }}</h2>
          <p v-for="(text, j) in person.paragraphs" :key="j" class="bvt__text">
            {{ text }}<template v-if="person.link && j === person.paragraphs.length - 1"> (<a
              :href="person.link"
              target="_blank"
              rel="noopener"
            >{{ person.link }}</a>)</template>
          </p>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.bvt__back {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 6px;
  margin-bottom: 22px;
  font-size: 13px;
  color: var(--mm-ink-muted);
  text-decoration: none;
}
.bvt__back:hover { color: var(--mm-ink); }
.bvt__back .pi { font-size: 11px; }
.bvt__eyebrow { margin-bottom: 8px; }

.bvt__list {
  list-style: none;
  margin: 36px 0 0;
  padding: 0;
  max-width: 74ch;
}
.bvt__person {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 0 18px;
  padding: 26px 0;
  border-top: 1px solid var(--mm-rule);
}
.bvt__person:last-child { border-bottom: 1px solid var(--mm-rule); }

.bvt__num {
  padding-top: 6px;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--mm-highlight);
}
.bvt__name {
  position: relative;
  margin: 0 0 10px;
  font-family: var(--mm-font-display);
  font-weight: 400;
  font-size: clamp(22px, 2.4vw, 28px);
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--mm-ink);
  overflow-wrap: anywhere;
}
.bvt__text {
  margin: 0;
  font-size: 15.5px;
  line-height: 1.65;
  color: var(--mm-ink-soft);
}
.bvt__text + .bvt__text { margin-top: 12px; }
.bvt__text a {
  color: var(--mm-ink);
  text-decoration: underline;
  text-decoration-color: var(--mm-highlight);
  text-underline-offset: 3px;
  overflow-wrap: anywhere;
}

@media (max-width: 560px) {
  .bvt__person { grid-template-columns: minmax(0, 1fr); }
  .bvt__num { padding: 0 0 6px; }
}
</style>
