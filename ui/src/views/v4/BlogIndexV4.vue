<script setup lang="ts">
/** /blog: every post, newest first (features/blog/README.md). */
import { formatPostDate, listPosts } from '@/content/blog/posts'

const posts = listPosts()
</script>

<template>
  <div class="mm-container mm-section blog-index">
    <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 8px">Blog</div>
    <h1 class="mm-display">How it's built</h1>
    <p class="blog-index__lede">
      Notes on building bfstats.io and BattleView: the recorder, the replay, and what the game does under the hood.
    </p>

    <div v-if="posts.length === 0" class="mm-empty">No posts yet</div>

    <ul v-else class="blog-index__list">
      <li v-for="p in posts" :key="p.slug">
        <router-link :to="`/blog/${p.slug}`" class="blog-index__post">
          <div class="blog-index__text">
            <div class="blog-index__meta">
              <span v-if="p.draft" class="blog-index__draft">Draft</span>
              <time v-if="p.date" :datetime="p.date">{{ formatPostDate(p.date) }}</time>
              <span>{{ p.minutes }} min read</span>
            </div>
            <h2 class="blog-index__title">{{ p.title }}</h2>
            <p v-if="p.lede" class="blog-index__summary">{{ p.lede }}</p>
          </div>
          <div v-if="p.hero" class="blog-index__thumb">
            <img v-if="p.hero.kind === 'img'" :src="p.hero.src" :alt="p.hero.alt" loading="lazy">
            <img v-else-if="p.hero.poster" :src="p.hero.poster" :alt="p.hero.alt" loading="lazy">
          </div>
        </router-link>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.blog-index__lede {
  margin: 14px 0 0;
  max-width: 60ch;
  font-size: 16px;
  line-height: 1.6;
  color: var(--mm-ink-soft);
}

.blog-index__list {
  list-style: none;
  margin: 32px 0 0;
  padding: 0;
  max-width: 880px;
  border-top: 1px solid var(--mm-rule);
}
.blog-index__list li { border-bottom: 1px solid var(--mm-rule); }

.blog-index__post {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  padding: 22px 0;
  color: var(--mm-ink);
}
@media (min-width: 721px) {
  .blog-index__post { grid-template-columns: 1fr 220px; gap: 24px; align-items: center; }
}
.blog-index__post:hover .blog-index__title { color: var(--mm-accent-soft); }
.blog-index__post:hover .blog-index__thumb img { transform: scale(1.03); }

.blog-index__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.blog-index__draft {
  padding: 0 6px;
  border: 1px solid var(--mm-accent);
  color: var(--mm-accent-soft);
}
.blog-index__title {
  margin: 8px 0 0;
  font-family: var(--mm-font-display);
  font-size: 22px;
  font-weight: 400;
  letter-spacing: -0.01em;
  transition: color 0.15s ease;
}
.blog-index__summary {
  margin: 8px 0 0;
  max-width: 64ch;
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--mm-ink-soft);
}

.blog-index__thumb {
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
}
.blog-index__thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.6s ease;
}
@media (prefers-reduced-motion: reduce) {
  .blog-index__thumb img { transition: none; }
}
</style>
