<script setup lang="ts">
/**
 * Draws a blog post's blocks (src/content/blog/posts.ts) with the BattleView
 * pieces: figures that open full screen, code with Copy, olive-topped cards
 * and numbered steps. Cards, steps and notes hold blocks of their own.
 */
import type { Block } from '@/content/blog/posts'
import MmCodeBlock from './MmCodeBlock.vue'
import MmMediaFrame from './MmMediaFrame.vue'
import type { ArticleMedia } from './media'

defineProps<{ blocks: Block[] }>()
const emit = defineEmits<{ open: [media: ArticleMedia] }>()
const open = (m: ArticleMedia) => emit('open', m)
const dev = import.meta.env.DEV
</script>

<template>
  <template v-for="(b, i) in blocks" :key="i">
    <component
      :is="`h${Math.min(Math.max(b.level, 2), 4)}`"
      v-if="b.type === 'heading'"
      :id="b.id"
      class="mm-article__heading"
      :class="`mm-article__heading--${Math.min(Math.max(b.level, 2), 4)}`"
      v-html="b.html"
    />

    <div v-else-if="b.type === 'html'" class="mm-article__html" v-html="b.html" />

    <MmCodeBlock v-else-if="b.type === 'code'" :code="b.code" class="mm-article__code" />

    <div
      v-else-if="b.type === 'figures'"
      class="mm-article__figures"
      :class="`mm-article__figures--${Math.min(b.figures.length, 3)}`"
    >
      <figure v-for="f in b.figures" :key="f.media.src" class="mm-figure">
        <MmMediaFrame
          :media="f.media"
          :label="f.label ?? f.caption ?? f.media.alt"
          :aspect="b.figures.length === 1 ? 'natural' : 'video'"
          @open="open"
        />
        <figcaption v-if="f.label || f.caption">
          <span v-if="f.label" class="mm-figure__label">{{ f.label }}</span>
          {{ f.caption }}
        </figcaption>
      </figure>
    </div>

    <ol v-else-if="b.type === 'steps'" class="mm-steps">
      <li v-for="(item, j) in b.items" :key="j">
        <span v-if="item.head" class="mm-steps__head" v-html="item.head" />
        <MmArticleBlocks :blocks="item.blocks" @open="open" />
      </li>
    </ol>

    <div v-else-if="b.type === 'cards'" class="mm-article__cards" :class="{ 'mm-article__cards--pair': b.cards.length > 1 }">
      <section
        v-for="card in b.cards"
        :key="card.id"
        class="mm-article-card mm-prose"
        :aria-labelledby="card.title ? card.id : undefined"
      >
        <div v-if="card.kicker" class="mm-article-card__kicker">{{ card.kicker }}</div>
        <h3 v-if="card.title" :id="card.id" class="mm-article-card__title" v-html="card.title" />
        <MmArticleBlocks :blocks="card.blocks" @open="open" />
      </section>
    </div>

    <aside v-else-if="b.type === 'note'" class="mm-article__note">
      <MmArticleBlocks :blocks="b.blocks" @open="open" />
    </aside>

    <p v-else-if="b.type === 'missing' && dev" class="mm-article__missing">
      Missing file: <code>{{ b.file }}</code> is not in this post's folder.
    </p>
  </template>
</template>

<style scoped>
.mm-article__heading {
  margin: 40px 0 12px;
  font-family: var(--mm-font-display);
  font-weight: 400;
  letter-spacing: -0.01em;
  color: var(--mm-ink);
  scroll-margin-top: 80px;
}
.mm-article__heading--2 { font-size: 24px; }
.mm-article__heading--3 { margin-top: 28px; font-size: 18px; }
.mm-article__heading--4 {
  margin-top: 24px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-accent-soft);
}

.mm-article__html :deep(> :last-child) { margin-bottom: 0; }
.mm-article__html + .mm-article__html { margin-top: 14px; }
.mm-article__html :deep(hr) {
  margin: 32px 0;
  border: 0;
  border-top: 1px solid var(--mm-rule);
}
.mm-article__html :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
.mm-article__html :deep(th),
.mm-article__html :deep(td) {
  padding: 6px 10px;
  border-bottom: 1px solid var(--mm-rule);
  text-align: left;
}
.mm-article__html :deep(th) { color: var(--mm-ink); font-weight: 500; }

.mm-article__code { margin: 14px 0; }

.mm-article__figures {
  margin: 24px 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 721px) {
  .mm-article__figures--2 { grid-template-columns: 1fr 1fr; }
  .mm-article__figures--3 { grid-template-columns: repeat(3, 1fr); gap: 8px; }
}

.mm-article__cards {
  margin: 24px 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 981px) {
  .mm-article__cards--pair { grid-template-columns: 1fr 1fr; }
}

.mm-article__note {
  margin: 20px 0;
  padding: 2px 0 2px 16px;
  border-left: 2px solid var(--mm-accent);
  color: var(--mm-ink-muted);
}

.mm-article__missing {
  margin: 16px 0;
  padding: 10px 12px;
  border: 1px dashed var(--mm-danger);
  color: var(--mm-danger);
  font-size: 13px;
}
</style>
