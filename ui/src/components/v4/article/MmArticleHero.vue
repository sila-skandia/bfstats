<script setup lang="ts">
/**
 * The big lead image of a long-form page. With an href it is a link with a
 * play button (a recorded round to watch); without one it is a plain picture.
 */
defineProps<{
  src: string
  alt: string
  href?: string
  title?: string
  meta?: string
}>()
</script>

<template>
  <component
    :is="href ? 'a' : 'div'"
    :href="href"
    :target="href ? '_blank' : undefined"
    :rel="href ? 'noopener' : undefined"
    class="mm-article-hero"
    :class="{ 'mm-article-hero--link': href }"
  >
    <img :src="src" :alt="alt" class="mm-article-hero__img" width="640" height="360">
    <span v-if="href" class="mm-article-hero__play" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
    </span>
    <span v-if="title || meta" class="mm-article-hero__caption">
      <span v-if="title" class="mm-article-hero__title">{{ title }}</span>
      <span v-if="meta" class="mm-article-hero__meta">{{ meta }}</span>
    </span>
  </component>
</template>

<style scoped>
.mm-article-hero {
  position: relative;
  display: block;
  margin-top: 28px;
  max-width: 880px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
  color: var(--mm-ink);
}
.mm-article-hero:hover { color: var(--mm-ink); border-color: var(--mm-rule-strong); }

.mm-article-hero__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.6s ease, filter 0.3s ease;
}
.mm-article-hero:hover .mm-article-hero__img { transform: scale(1.02); filter: brightness(1.06); }

.mm-article-hero__play {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 60px;
  height: 60px;
  margin: -30px 0 0 -30px;
  display: grid;
  place-items: center;
  padding-left: 3px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mm-bg) 62%, transparent);
  border: 1px solid color-mix(in srgb, var(--mm-ink) 35%, transparent);
  backdrop-filter: blur(4px);
  transition: background 0.2s ease, transform 0.2s ease;
}
.mm-article-hero:hover .mm-article-hero__play {
  background: var(--mm-accent);
  transform: scale(1.06);
}

.mm-article-hero__caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 36px 18px 14px;
  background: linear-gradient(to top, color-mix(in srgb, var(--mm-bg) 88%, transparent), transparent);
}
.mm-article-hero__title {
  font-family: var(--mm-font-display);
  font-size: 15px;
  font-weight: 500;
}
.mm-article-hero__meta {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
}

@media (max-width: 640px) {
  .mm-article-hero__play { width: 48px; height: 48px; margin: -24px 0 0 -24px; }
}
</style>
