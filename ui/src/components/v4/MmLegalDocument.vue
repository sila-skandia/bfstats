<script setup lang="ts">
/**
 * Shared chrome for the Terms and Privacy pages: title block, effective date,
 * plain-English summary, sticky contents rail, and prose styling.
 *
 * Legal pages are the one place on the site where long-form reading matters
 * more than density, so the body column is measure-limited (~68ch) and the
 * contents rail only appears once there's room for it beside the text.
 */
import { onMounted, ref } from 'vue'
import type { LegalSection } from './legalDocument'

defineProps<{
  eyebrow: string
  title: string
  effectiveDate: string
  sections: LegalSection[]
}>()

const activeId = ref<string>('')

// Highlights the section currently under the reader. rootMargin pulls the
// trigger line to the upper third so a heading counts as "current" as it
// settles into view rather than when it's about to leave.
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return
  const headings = Array.from(document.querySelectorAll<HTMLElement>('.mm-legal__body [id]'))
  if (headings.length === 0) return

  const observer = new IntersectionObserver(
    entries => {
      const visible = entries.filter(e => e.isIntersecting)
      if (visible.length > 0) activeId.value = visible[0].target.id
    },
    { rootMargin: '-80px 0px -66% 0px', threshold: 0 }
  )
  headings.forEach(h => observer.observe(h))
})
</script>

<template>
  <div class="mm-container mm-section mm-legal">
    <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 8px">{{ eyebrow }}</div>
    <h1 class="mm-display">{{ title }}</h1>
    <div class="mm-legal__meta">
      <span>Effective <span class="mm-legal__meta-strong">{{ effectiveDate }}</span></span>
      <span class="mm-legal__meta-sep">·</span>
      <span>bfstats.io</span>
    </div>

    <div v-if="$slots.glance" class="mm-legal__glance">
      <slot name="glance" />
    </div>

    <div v-if="$slots.summary" class="mm-legal__summary">
      <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 10px">In short</div>
      <slot name="summary" />
    </div>

    <hr class="mm-rule" style="margin-top: 28px" />

    <div class="mm-legal__layout">
      <nav class="mm-legal__toc" aria-label="Contents">
        <div class="mm-eyebrow" style="margin-bottom: 10px">Contents</div>
        <ol>
          <li v-for="(s, i) in sections" :key="s.id">
            <a
              :href="`#${s.id}`"
              :class="{ 'mm-legal__toc-link--active': activeId === s.id }"
            >
              <span class="mm-legal__toc-num">{{ i + 1 }}</span>
              <span>{{ s.title }}</span>
            </a>
          </li>
        </ol>
      </nav>

      <article class="mm-legal__body">
        <slot />
      </article>
    </div>
  </div>
</template>

<style scoped>
.mm-legal__meta {
  margin-top: 10px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.mm-legal__meta-strong { color: var(--mm-ink-soft); }
.mm-legal__meta-sep { color: var(--mm-ink-faint); }

/* At-a-glance grid. This is the part people actually read, so it gets the
   top of the page and the largest type on it after the title. Each row is a
   claim + a one-line answer; the marker colour carries whether the answer is
   "nothing happens to you" (olive) or "something is stored" (neutral). */
/* Each cell carries its own border rather than the container drawing dividers
   through a 1px gap — with an odd item count that trick leaves a lit empty
   cell at the end of the last row, which reads as a broken tile. */
.mm-legal__glance {
  margin-top: 24px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.mm-legal__glance :deep(.mm-legal-fact) {
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

@media (min-width: 601px) {
  .mm-legal__glance { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 981px) {
  .mm-legal__glance { grid-template-columns: repeat(3, 1fr); }
}

.mm-legal__glance :deep(.mm-legal-fact__label) {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  display: flex;
  align-items: center;
  gap: 7px;
}

.mm-legal__glance :deep(.mm-legal-fact__label)::before {
  content: '';
  width: 5px;
  height: 5px;
  flex: 0 0 5px;
  background: var(--mm-ink-faint);
}
.mm-legal__glance :deep(.mm-legal-fact--none .mm-legal-fact__label)::before {
  background: var(--mm-accent);
  box-shadow: 0 0 6px rgba(125, 136, 73, 0.6);
}

.mm-legal__glance :deep(.mm-legal-fact__value) {
  font-family: var(--mm-font-display);
  font-size: 17px;
  line-height: 1.3;
  color: var(--mm-ink);
  letter-spacing: -0.01em;
}
.mm-legal__glance :deep(.mm-legal-fact--none .mm-legal-fact__value) {
  color: var(--mm-accent-soft);
}

.mm-legal__glance :deep(.mm-legal-fact__note) {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--mm-ink-muted);
}

/* Plain-English précis. Uses the olive anchor treatment reserved for
   section bars so it reads as the page's one highlighted block. */
.mm-legal__summary {
  margin-top: 24px;
  padding: 20px 22px;
  background: var(--mm-bg-soft);
  border-left: 2px solid var(--mm-accent);
}
.mm-legal__summary :deep(p) {
  margin: 0 0 10px;
  color: var(--mm-ink-soft);
  font-size: 14.5px;
  line-height: 1.65;
}
.mm-legal__summary :deep(p:last-child) { margin-bottom: 0; }
.mm-legal__summary :deep(strong) { color: var(--mm-ink); font-weight: 500; }

.mm-legal__layout {
  display: block;
  margin-top: 28px;
}

.mm-legal__toc { display: none; }

.mm-legal__body {
  max-width: 68ch;
  color: var(--mm-ink-soft);
  font-size: 15px;
  line-height: 1.72;
}

.mm-legal__body :deep(h2) {
  font-family: var(--mm-font-display);
  font-size: 19px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--mm-ink);
  margin: 40px 0 12px;
  scroll-margin-top: 90px;
}
.mm-legal__body :deep(h2:first-child) { margin-top: 0; }

.mm-legal__body :deep(h2 .mm-legal__num) {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.1em;
  color: var(--mm-accent-soft);
  display: block;
  margin-bottom: 6px;
}

.mm-legal__body :deep(h3) {
  font-size: 15px;
  font-weight: 500;
  color: var(--mm-ink);
  margin: 24px 0 8px;
}

.mm-legal__body :deep(p) { margin: 0 0 14px; }

.mm-legal__body :deep(ul),
.mm-legal__body :deep(ol) {
  margin: 0 0 14px;
  padding-left: 20px;
}
.mm-legal__body :deep(li) { margin-bottom: 7px; }
.mm-legal__body :deep(li::marker) { color: var(--mm-ink-faint); }

.mm-legal__body :deep(strong) { color: var(--mm-ink); font-weight: 500; }

.mm-legal__body :deep(a) {
  color: var(--mm-accent-soft);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: var(--mm-rule-strong);
}
.mm-legal__body :deep(a:hover) { text-decoration-color: var(--mm-accent-soft); }

/* Direct pointer at the control that does the thing, so a reader looking for
   "how do I delete this" doesn't have to parse a paragraph to find it. */
.mm-legal__body :deep(.mm-legal-cta) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 18px;
  padding: 11px 16px;
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-decoration: none;
  border-radius: 2px;
  transition: background-color 0.15s ease;
}
.mm-legal__body :deep(.mm-legal-cta:hover) {
  background: var(--mm-accent-soft);
  color: var(--mm-highlight-ink);
}

.mm-legal__body :deep(code) {
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
  background: var(--mm-bg-mute);
  padding: 1px 5px;
  color: var(--mm-ink-soft);
}

/* Definition-style table for "what we collect". Converts to stacked
   blocks on mobile per the global table-to-card rule. */
/* legacy base.css sets `table { font-family: <mono> }` and paints th/td with
   the old neon palette globally, so every one of those has to be restated
   here rather than merely left unset. */
.mm-legal__body :deep(.mm-legal-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 18px;
  font-size: 14px;
  font-family: var(--mm-font-display);
}
.mm-legal__body :deep(.mm-legal-table th) {
  text-align: left;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  font-weight: 400;
  background: transparent;
  padding: 0 14px 8px 0;
  border-bottom: 1px solid var(--mm-rule);
}
.mm-legal__body :deep(.mm-legal-table td) {
  padding: 11px 14px 11px 0;
  border-bottom: 1px solid var(--mm-rule);
  vertical-align: top;
  color: var(--mm-ink-soft);
}
.mm-legal__body :deep(.mm-legal-table td:first-child) {
  color: var(--mm-ink);
  white-space: nowrap;
}

@media (max-width: 720px) {
  .mm-legal__body :deep(.mm-legal-table),
  .mm-legal__body :deep(.mm-legal-table tbody),
  .mm-legal__body :deep(.mm-legal-table tr),
  .mm-legal__body :deep(.mm-legal-table td) {
    display: block;
    width: 100%;
  }
  .mm-legal__body :deep(.mm-legal-table thead) { display: none; }
  .mm-legal__body :deep(.mm-legal-table tr) {
    padding: 12px 0;
    border-bottom: 1px solid var(--mm-rule);
  }
  .mm-legal__body :deep(.mm-legal-table td) {
    padding: 0 0 4px;
    border-bottom: 0;
  }
  .mm-legal__body :deep(.mm-legal-table td:first-child) {
    font-family: var(--mm-font-mono);
    font-size: 10.5px;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--mm-ink-muted);
    white-space: normal;
  }
}

/* Contents rail only once there is genuinely room beside the measure. */
@media (min-width: 981px) {
  .mm-legal__layout {
    display: grid;
    grid-template-columns: 210px minmax(0, 1fr);
    gap: 48px;
    align-items: start;
  }

  .mm-legal__toc {
    display: block;
    position: sticky;
    top: 86px;
  }
  .mm-legal__toc ol {
    list-style: none;
    margin: 0;
    padding: 0;
    border-left: 1px solid var(--mm-rule);
  }
  .mm-legal__toc li { margin: 0; }
  .mm-legal__toc a {
    display: flex;
    gap: 8px;
    padding: 6px 0 6px 12px;
    margin-left: -1px;
    border-left: 1px solid transparent;
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--mm-ink-muted);
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .mm-legal__toc a:hover {
    color: var(--mm-ink-soft);
    border-left-color: var(--mm-rule-strong);
  }
  .mm-legal__toc-link--active {
    color: var(--mm-ink) !important;
    border-left-color: var(--mm-accent) !important;
  }
  .mm-legal__toc-num {
    font-family: var(--mm-font-mono);
    font-size: 10px;
    color: var(--mm-ink-faint);
    padding-top: 2px;
  }
}
</style>
