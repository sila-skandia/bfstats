<template>
  <section class="mm-admin-card">
    <div class="mm-admin-card__head mm-admin-comments__head">
      <h3 class="mm-admin-card__title mm-admin-card__title--strong">
        Comments
      </h3>
      <div class="mm-admin-comments__head-actions">
        <div class="mm-admin-chips" role="group" aria-label="Comment type">
          <button
            v-for="f in filters"
            :key="f.id"
            type="button"
            class="mm-admin-chip"
            :class="{ 'mm-admin-chip--active': kind === f.id }"
            @click="setKind(f.id)"
          >
            {{ f.label }} <span class="mm-admin-comments__chip-count">{{ f.count() }}</span>
          </button>
        </div>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
          :disabled="loading"
          @click="load()"
        >
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="mm-admin-alert mm-admin-alert--err mm-admin-comments__alert">
      {{ error }}
    </div>

    <div v-if="items.length === 0 && !loading" class="mm-admin-empty">
      <span class="mm-admin-empty__title">No comments</span>
      <span class="mm-admin-empty__desc">Comments left on server and player pages appear here.</span>
    </div>

    <div v-else class="mm-admin-table-wrap">
      <table class="mm-admin-table">
        <thead>
          <tr>
            <th style="width: 150px">Posted</th>
            <th style="width: 220px">On</th>
            <th style="width: 180px">Author</th>
            <th>Comment</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="c in items" :key="`${c.kind}-${c.id}`">
            <tr class="mm-admin-comments__row" @click="toggle(c)">
              <td class="mm-admin-mono mm-admin-comments__date" :title="formatLocalTooltip(c.createdAt)">
                {{ formatAbsoluteTime(c.createdAt) }}
                <span v-if="wasEdited(c)" class="mm-admin-comments__edited" :title="`Edited ${formatLocalTooltip(c.updatedAt)}`">edited</span>
              </td>
              <td class="mm-admin-comments__target">
                <span class="mm-admin-comments__kind" :class="`mm-admin-comments__kind--${c.kind}`">
                  {{ c.kind === 'server' ? 'Server' : 'Player' }}
                </span>
                <router-link :to="targetLink(c)" class="mm-admin-comments__link" :title="$pn(c.target)" @click.stop>
                  {{ $pn(c.target) }}
                </router-link>
              </td>
              <td class="mm-admin-comments__author">
                <router-link
                  :to="`/v4/players/${encodeURIComponent(c.authorPlayerName)}`"
                  class="mm-admin-comments__link"
                  @click.stop
                >
                  {{ $pn(c.authorPlayerName) }}
                </router-link>
                <span v-if="c.authorAccount" class="mm-admin-comments__account" :title="c.authorAccount">
                  {{ c.authorAccount }}
                </span>
              </td>
              <td class="mm-admin-comments__excerpt">
                {{ excerpt(c.content) }}
              </td>
            </tr>
            <tr v-if="isExpanded(c)" class="mm-admin-comments__detail-row">
              <td colspan="4">
                <div class="mm-admin-comments__body" v-html="sanitize(c.content)" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div v-if="totalCount > pageSize" class="mm-admin-pagination">
      <span>{{ totalCount }} total · page {{ currentPage }} of {{ totalPages }}</span>
      <div class="mm-admin-pagination__controls">
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
          :disabled="currentPage <= 1 || loading"
          @click="load(currentPage - 1)"
        >
          Prev
        </button>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
          :disabled="currentPage >= totalPages || loading"
          @click="load(currentPage + 1)"
        >
          Next
        </button>
      </div>
    </div>

    <div class="mm-admin-card__foot">
      Comments left on server and player pages, newest first. Click a row to read it in full. Times are in your local time.
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import DOMPurify from 'dompurify'
import { adminDataService, type AdminCommentEntry } from '@/services/adminDataService'
import { formatAbsoluteTime, formatLocalTooltip, parseUtc } from '@/utils/timeUtils'

type Kind = 'all' | 'server' | 'player'

const items = ref<AdminCommentEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const totalCount = ref(0)
const serverCount = ref(0)
const playerCount = ref(0)
const currentPage = ref(1)
const pageSize = 25
const kind = ref<Kind>('all')
const expandedKey = ref<string | null>(null)

const filters: { id: Kind; label: string; count: () => number }[] = [
  { id: 'all', label: 'All', count: () => serverCount.value + playerCount.value },
  { id: 'server', label: 'Servers', count: () => serverCount.value },
  { id: 'player', label: 'Players', count: () => playerCount.value },
]

const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize)))

async function load(page?: number) {
  if (page != null) currentPage.value = page
  loading.value = true
  error.value = null
  expandedKey.value = null
  try {
    const res = await adminDataService.listComments(currentPage.value, pageSize, kind.value)
    items.value = res.items
    totalCount.value = res.totalCount
    serverCount.value = res.serverCount
    playerCount.value = res.playerCount
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load comments'
    items.value = []
  } finally {
    loading.value = false
  }
}

function setKind(next: Kind) {
  if (kind.value === next) return
  kind.value = next
  void load(1)
}

const keyOf = (c: AdminCommentEntry) => `${c.kind}-${c.id}`
const isExpanded = (c: AdminCommentEntry) => expandedKey.value === keyOf(c)
function toggle(c: AdminCommentEntry) {
  expandedKey.value = isExpanded(c) ? null : keyOf(c)
}

function targetLink(c: AdminCommentEntry): string {
  return c.kind === 'server'
    ? `/v4/servers/detail/${encodeURIComponent(c.target)}`
    : `/v4/players/${encodeURIComponent(c.target)}`
}

const ALLOWED_TAGS = ['p', 'strong', 'em', 'u', 'a', 'img', 'ul', 'ol', 'li', 'br', 'blockquote']
const ALLOWED_ATTR = ['href', 'src', 'alt', 'target', 'rel']

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false })
}

/** Plain-text preview of the stored HTML. */
function excerpt(html: string, max = 160): string {
  const doc = new window.DOMParser().parseFromString(sanitize(html), 'text/html')
  const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return doc.body.querySelector('img') ? '[image]' : ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

function wasEdited(c: AdminCommentEntry): boolean {
  return parseUtc(c.updatedAt).getTime() - parseUtc(c.createdAt).getTime() > 60 * 1000
}

onMounted(() => load())

defineExpose({ load })
</script>

<style scoped>
.mm-admin-comments__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.mm-admin-comments__head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.mm-admin-comments__chip-count {
  margin-left: 4px;
  opacity: 0.7;
  font-family: var(--mm-font-mono);
}

.mm-admin-comments__alert { margin: 0 18px; }

.mm-admin-comments__row { cursor: pointer; }

.mm-admin-comments__date {
  font-size: 12px;
  white-space: nowrap;
  color: var(--mm-ink-muted);
  vertical-align: top;
}

.mm-admin-comments__edited {
  display: block;
  font-size: 10.5px;
  color: var(--mm-ink-faint);
}

.mm-admin-comments__target,
.mm-admin-comments__author {
  vertical-align: top;
  max-width: 220px;
}

.mm-admin-comments__kind {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 5px;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-admin-comments__kind--server {
  color: var(--mm-accent-soft);
  border-color: var(--mm-accent-soft);
}

.mm-admin-comments__link {
  color: var(--mm-ink);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.mm-admin-comments__link:hover {
  color: var(--mm-accent-soft);
  text-decoration: underline;
}

.mm-admin-comments__account {
  display: block;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-admin-comments__excerpt {
  vertical-align: top;
  font-size: 12.5px;
  color: var(--mm-ink-muted);
  line-height: 1.45;
  min-width: 220px;
}

.mm-admin-comments__detail-row td {
  background: var(--mm-bg-soft);
}

.mm-admin-comments__body {
  font-size: 13px;
  line-height: 1.55;
  color: var(--mm-ink);
  overflow-wrap: anywhere;
}

.mm-admin-comments__body :deep(p) { margin: 0 0 8px; }
.mm-admin-comments__body :deep(p:last-child) { margin-bottom: 0; }
.mm-admin-comments__body :deep(img) { max-width: 100%; height: auto; }
.mm-admin-comments__body :deep(a) { color: var(--mm-accent-soft); }
.mm-admin-comments__body :deep(blockquote) {
  margin: 0 0 8px;
  padding-left: 10px;
  border-left: 2px solid var(--mm-rule-strong);
  color: var(--mm-ink-muted);
}
</style>
