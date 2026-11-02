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
import MmMediaFrame from '@/components/v4/article/MmMediaFrame.vue'
import type { ArticleMedia } from '@/components/v4/article/media'

const route = useRoute()
const post = computed(() => getPost(String(route.params.slug)))

const lightbox = ref<ArticleMedia | null>(null)
const open = (m: ArticleMedia) => { lightbox.value = m }

// The router sets a generic title; the post knows its own.
watchEffect(() => {
  if (post.value) document.title = `${post.value.title} · bfstats.io`
})
</script>

<template>
  <div class="mm-container mm-section blog-post">
    <template v-if="post">
      <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 8px">{{ post.eyebrow }}</div>
      <h1 class="mm-display">{{ post.title }}</h1>
      <div class="blog-post__meta">
        <span v-if="post.draft" class="blog-post__draft">Draft</span>
        <time v-if="post.date" :datetime="post.date">{{ formatPostDate(post.date) }}</time>
        <span>{{ post.minutes }} min read</span>
      </div>
      <p v-if="post.lede" class="blog-post__lede">{{ post.lede }}</p>

      <MmArticleHero
        v-if="post.hero && post.heroLink"
        :href="post.heroLink"
        :src="post.hero.src"
        :alt="post.hero.alt"
        :title="post.heroTitle"
        :meta="post.heroMeta"
      />
      <figure v-else-if="post.hero" class="mm-figure blog-post__hero">
        <MmMediaFrame :media="post.hero" :label="post.hero.alt || post.title" :lazy="false" @open="open" />
        <figcaption v-if="post.heroTitle || post.heroMeta">
          <span v-if="post.heroTitle" class="mm-figure__label">{{ post.heroTitle }}</span>
          {{ post.heroMeta }}
        </figcaption>
      </figure>

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

.blog-post__hero {
  margin-top: 28px;
  max-width: 880px;
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
