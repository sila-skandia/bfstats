<template>
  <section class="mm-admin-card">
    <div class="mm-admin-card__head mm-admin-feedback__head">
      <h3 class="mm-admin-card__title mm-admin-card__title--strong">
        AI feedback
      </h3>
      <div class="mm-admin-feedback__head-actions">
        <div class="mm-admin-feedback__counts">
          <span class="mm-admin-feedback__count mm-admin-feedback__count--positive">
            <span aria-hidden="true">+</span>{{ positiveCount }}
          </span>
          <span class="mm-admin-feedback__count mm-admin-feedback__count--negative">
            <span aria-hidden="true">−</span>{{ negativeCount }}
          </span>
        </div>
        <select
          v-model="filterValue"
          class="mm-admin-select mm-admin-feedback__filter"
          @change="load(1)"
        >
          <option value="all">All</option>
          <option value="positive">Positive only</option>
          <option value="negative">Negative only</option>
        </select>
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

    <div v-if="error" class="mm-admin-alert mm-admin-alert--err mm-admin-feedback__alert">
      {{ error }}
    </div>

    <div v-if="items.length === 0 && !loading" class="mm-admin-empty">
      <span class="mm-admin-empty__title">No feedback yet</span>
      <span class="mm-admin-empty__desc">Feedback appears when users rate AI responses.</span>
    </div>

    <div v-else class="mm-admin-table-wrap">
      <table class="mm-admin-table">
        <thead>
          <tr>
            <th style="width: 56px">Rating</th>
            <th style="width: 220px">Prompt</th>
            <th>Response</th>
            <th style="width: 150px">Date</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in items"
            :key="entry.id"
            class="mm-admin-feedback__row"
            :class="{ 'mm-admin-feedback__row--negative': !entry.isPositive }"
            @click="toggleExpanded(entry.id)"
          >
            <td>
              <span
                class="mm-admin-feedback__badge"
                :class="entry.isPositive ? 'mm-admin-feedback__badge--positive' : 'mm-admin-feedback__badge--negative'"
              >
                {{ entry.isPositive ? '+' : '−' }}
              </span>
            </td>
            <td class="mm-admin-mono mm-admin-feedback__prompt">
              {{ truncate(entry.prompt, 120) }}
            </td>
            <td class="mm-admin-feedback__response">
              {{ truncate(entry.response, 180) }}
            </td>
            <td class="mm-admin-mono">{{ formatDate(entry.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="totalCount > pageSize" class="mm-admin-pagination">
      <span>{{ totalCount }} total · page {{ currentPage }} of {{ totalPages }}</span>
      <div class="mm-admin-pagination__controls">
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
          :disabled="currentPage <= 1"
          @click="load(currentPage - 1)"
        >
          Prev
        </button>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
          :disabled="currentPage >= totalPages"
          @click="load(currentPage + 1)"
        >
          Next
        </button>
      </div>
    </div>

    <div class="mm-admin-card__foot">
      User feedback on AI chat responses. Click a row to view full details.
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="expandedEntry"
      class="mm mm-admin-feedback__overlay"
      @click.self="expandedEntry = null"
    >
      <div class="mm-admin-feedback__detail">
        <div class="mm-admin-feedback__detail-head">
          <span
            class="mm-admin-feedback__badge"
            :class="expandedEntry.isPositive ? 'mm-admin-feedback__badge--positive' : 'mm-admin-feedback__badge--negative'"
          >
            {{ expandedEntry.isPositive ? 'POSITIVE' : 'NEGATIVE' }}
          </span>
          <span class="mm-admin-feedback__detail-date mm-admin-mono">{{ formatDate(expandedEntry.createdAt) }}</span>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
            @click="expandedEntry = null"
          >
            Close
          </button>
        </div>
        <div class="mm-admin-feedback__detail-section">
          <h4 class="mm-admin-label">Prompt</h4>
          <pre class="mm-admin-feedback__detail-text">{{ expandedEntry.prompt }}</pre>
        </div>
        <div class="mm-admin-feedback__detail-section">
          <h4 class="mm-admin-label">Response</h4>
          <pre class="mm-admin-feedback__detail-text mm-admin-feedback__detail-text--long">{{ expandedEntry.response }}</pre>
        </div>
        <div v-if="expandedEntry.comment" class="mm-admin-feedback__detail-section">
          <h4 class="mm-admin-label">Comment</h4>
          <pre class="mm-admin-feedback__detail-text">{{ expandedEntry.comment }}</pre>
        </div>
        <div v-if="expandedEntry.pageContext" class="mm-admin-feedback__detail-section">
          <h4 class="mm-admin-label">Page context</h4>
          <pre class="mm-admin-feedback__detail-text">{{ formatContext(expandedEntry.pageContext) }}</pre>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { adminDataService, type AIChatFeedbackEntry } from '@/services/adminDataService'

const items = ref<AIChatFeedbackEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const totalCount = ref(0)
const positiveCount = ref(0)
const negativeCount = ref(0)
const currentPage = ref(1)
const pageSize = 50
const filterValue = ref<'all' | 'positive' | 'negative'>('all')
const expandedEntry = ref<AIChatFeedbackEntry | null>(null)

const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize)))

async function load(page?: number) {
  if (page != null) currentPage.value = page
  loading.value = true
  error.value = null
  try {
    const isPositive = filterValue.value === 'all' ? null : filterValue.value === 'positive'
    const res = await adminDataService.getAIChatFeedback(currentPage.value, pageSize, isPositive)
    items.value = res.items
    totalCount.value = res.totalCount
    positiveCount.value = res.positiveCount
    negativeCount.value = res.negativeCount
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load feedback'
    items.value = []
  } finally {
    loading.value = false
  }
}

function toggleExpanded(id: number) {
  const entry = items.value.find((e) => e.id === id)
  expandedEntry.value = expandedEntry.value?.id === id ? null : entry ?? null
}

function truncate(text: string, max: number): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function formatContext(ctx: string): string {
  try {
    return JSON.stringify(JSON.parse(ctx), null, 2)
  } catch {
    return ctx
  }
}

onMounted(() => load())

defineExpose({ load })
</script>

<style scoped>
.mm-admin-feedback__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.mm-admin-feedback__head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.mm-admin-feedback__counts {
  display: flex;
  gap: 10px;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  font-weight: 500;
}

.mm-admin-feedback__count--positive { color: var(--mm-success); }
.mm-admin-feedback__count--negative { color: var(--mm-danger); }

.mm-admin-feedback__filter {
  width: auto;
  padding: 5px 24px 5px 10px;
  font-size: 12px;
  background-position: calc(100% - 14px) 50%, calc(100% - 9px) 50%;
}

.mm-admin-feedback__alert { margin: 0 18px; }

.mm-admin-feedback__row {
  cursor: pointer;
}

.mm-admin-feedback__row--negative td:first-child {
  box-shadow: inset 2px 0 0 var(--mm-danger);
}

.mm-admin-feedback__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid transparent;
}

.mm-admin-feedback__badge--positive {
  color: var(--mm-success);
  background: rgba(125, 163, 76, 0.10);
  border-color: rgba(125, 163, 76, 0.40);
}

.mm-admin-feedback__badge--negative {
  color: var(--mm-danger);
  background: rgba(214, 90, 90, 0.10);
  border-color: rgba(214, 90, 90, 0.40);
}

.mm-admin-feedback__prompt {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-admin-feedback__response {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--mm-ink-muted);
}

/* Detail overlay */
.mm-admin-feedback__overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.mm-admin-feedback__detail {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  max-width: 800px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  padding: 18px 20px;
  color: var(--mm-ink);
}

.mm-admin-feedback__detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-admin-feedback__detail-date {
  flex: 1;
  font-size: 11.5px;
  color: var(--mm-ink-muted);
}

.mm-admin-feedback__detail-section {
  margin-bottom: 14px;
}

.mm-admin-feedback__detail-text {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  color: var(--mm-ink);
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 10px 12px;
  margin: 6px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  max-height: 200px;
  overflow-y: auto;
}

.mm-admin-feedback__detail-text--long { max-height: 300px; }
</style>
