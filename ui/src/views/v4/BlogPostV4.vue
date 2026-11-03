<script setup lang="ts">
/**
 * One blog post at /blog/:slug, drawn like /battleview. Posts are markdown
 * files under src/content/blog/ (features/blog/README.md).
 */
import { computed, ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { formatPostDate, getPost } from '@/content/blog/posts'
import MmArticleBlocks from '@/components/v4/article/MmArticleBlocks.vue'
import MmArticleHero from '@/components/v4/article/MmArticleHero.vue'
import MmLightbox from '@/components/v4/article/MmLightbox.vue'
import type { ArticleMedia } from '@/components/v4/article/media'

const route = useRoute()
const post = computed(() => getPost(String(route.params.slug)))

const lightbox = ref<ArticleMedia | null>(null)
const open = (m: ArticleMedia) => { lightbox.value = m }

// A hero without heroLink is drawn behind the title instead of below it.
const banner = computed(() => !!post.value?.hero && !post.value.heroLink)

// The router sets a generic title; the post knows its own.
watchEffect(() => {
  if (post.value) document.title = `${post.value.title} · bfstats.io`
})
</script>

<template>
  <div class="mm-container mm-section blog-post">
    <template v-if="post">
      <header class="blog-post__head" :class="{ 'blog-post__head--banner': banner }">
        <template v-if="banner && post.hero">
          <img
            :src="post.hero.src"
            alt=""
            class="blog-post__banner-img"
            :style="post.heroFocus ? { objectPosition: post.heroFocus } : undefined"
          >
          <button
            type="button"
            class="blog-post__banner-open"
            :aria-label="`Open ${post.hero.alt || 'the header image'} full screen`"
            :title="post.hero.alt || 'Open full screen'"
            @click="open(post.hero)"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" />
            </svg>
          </button>
        </template>
        <div class="blog-post__head-text">
          <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 8px">{{ post.eyebrow }}</div>
          <h1 class="mm-display">{{ post.title }}</h1>
          <div class="blog-post__meta">
            <span v-if="post.draft" class="blog-post__draft">Draft</span>
            <time v-if="post.date" :datetime="post.date">{{ formatPostDate(post.date) }}</time>
            <span>{{ post.minutes }} min read</span>
          </div>
          <p v-if="post.lede" class="blog-post__lede">{{ post.lede }}</p>
        </div>
      </header>

      <MmArticleHero
        v-if="post.hero && post.heroLink"
        :href="post.heroLink"
        :src="post.hero.src"
        :alt="post.hero.alt"
        :title="post.heroTitle"
        :meta="post.heroMeta"
      />

      <article class="blog-post__body mm-prose">
        <MmArticleBlocks :blocks="post.blocks" @open="open" />
      </article>

      <MmLightbox :media="lightbox" @close="lightbox = null" />
    </template>

    <template v-else>
      <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 8px">Blog</div>
      <h1 class="mm-display">Post not found</h1>
      <p class="blog-post__lede">
        There's no post at this address. <router-link to="/blog">See all posts</router-link>.
      </p>
    </template>
  </div>
</template>

<style scoped>
.blog-post__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  margin-top: 10px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.blog-post__draft {
  padding: 1px 6px;
  border: 1px solid var(--mm-accent);
  color: var(--mm-accent-soft);
}

.blog-post__lede {
  margin: 14px 0 0;
  max-width: 60ch;
  font-size: 16px;
  line-height: 1.6;
  color: var(--mm-ink-soft);
}
.blog-post__lede a {
  color: var(--mm-accent-soft);
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* A plain hero sits behind the title: the image fills the header, and a
   black-to-clear gradient from the top keeps the title readable over it.
   A hero with heroLink keeps BattleView's 16:9 play-button frame below. */
.blog-post__head--banner {
  position: relative;
  display: flex;
  min-height: clamp(280px, 30vw, 380px);
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  background: #000;
}
.blog-post__head--banner::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(
    to bottom,
    rgb(0 0 0 / 0.95) 0%,
    rgb(0 0 0 / 0.88) 45%,
    rgb(0 0 0 / 0.45) 75%,
    rgb(0 0 0 / 0) 100%
  );
}
.blog-post__banner-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.9) brightness(0.85);
}
.blog-post__head--banner .blog-post__meta { color: var(--mm-ink-soft); }
.blog-post__head--banner .blog-post__head-text {
  position: relative;
  z-index: 2;
  padding: 36px 40px 64px;
}
.blog-post__banner-open {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--mm-ink) 30%, transparent);
  background: rgb(0 0 0 / 0.55);
  color: var(--mm-ink);
  cursor: zoom-in;
  backdrop-filter: blur(4px);
  transition: background 0.2s ease, border-color 0.2s ease;
}
.blog-post__banner-open:hover { background: var(--mm-accent); border-color: var(--mm-accent); }
.blog-post__banner-open:focus-visible { outline: 2px solid var(--mm-accent); outline-offset: 2px; }
@media (max-width: 640px) {
  .blog-post__head--banner { min-height: 240px; }
  .blog-post__head--banner .blog-post__head-text { padding: 24px 18px 56px; }
}

/* Text runs at a reading measure; figures and cards may use the full 880. */
.blog-post__body {
  margin-top: 32px;
  max-width: 880px;
  font-size: 15.5px;
  line-height: 1.7;
}
.blog-post__body :deep(.mm-article__html),
.blog-post__body :deep(.mm-article__heading),
.blog-post__body :deep(.mm-steps),
.blog-post__body :deep(.mm-article__note) {
  max-width: 70ch;
}
.blog-post__body :deep(.mm-article-card) { font-size: 14.5px; }
</style>
