<template>
  <section class="mm-admin-card">
    <div class="mm-admin-card__head">
      <h3 class="mm-admin-card__title mm-admin-card__title--strong">
        Notice
      </h3>
      <p class="mm-admin-card__desc">
        Manage site-wide notice banner. Displays above all pages when active.
      </p>
    </div>

    <div class="mm-admin-notice__body">
      <div v-if="error" class="mm-admin-alert mm-admin-alert--err">{{ error }}</div>
      <div v-if="success" class="mm-admin-alert mm-admin-alert--ok">{{ success }}</div>

      <!-- Current notice preview -->
      <div v-if="currentNotice" class="mm-admin-notice__preview">
        <div class="mm-admin-notice__preview-header">
          <span class="mm-admin-notice__preview-label">Current notice</span>
          <span
            class="mm-admin-notice__type-badge"
            :class="`mm-admin-notice__type-badge--${currentNotice.type}`"
          >
            {{ currentNotice.type.toUpperCase() }}
          </span>
        </div>
        <div
          class="mm-admin-notice__preview-content"
          :class="`mm-admin-notice__preview-content--${currentNotice.type}`"
        >
          <div class="mm-admin-notice__preview-text" v-html="renderedCurrentNotice" />
        </div>
        <div class="mm-admin-notice__preview-meta">
          <span v-if="currentNotice.dismissible" class="mm-admin-notice__meta-item">Dismissible</span>
          <span v-if="currentNotice.expiresAt" class="mm-admin-notice__meta-item">
            Expires: {{ formatDate(currentNotice.expiresAt) }}
          </span>
          <span class="mm-admin-notice__meta-item">
            Created: {{ formatDate(currentNotice.createdAt) }}
          </span>
        </div>
        <div class="mm-admin-notice__preview-actions">
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
            @click="editNotice"
          >
            Edit
          </button>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--danger mm-admin-btn--sm"
            :disabled="saving"
            @click="clearNotice"
          >
            {{ saving ? 'Clearing…' : 'Clear notice' }}
          </button>
        </div>
      </div>

      <!-- No notice -->
      <div v-else-if="!isEditing && !loading" class="mm-admin-empty mm-admin-notice__empty">
        <span class="mm-admin-empty__title">No active notice</span>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--primary mm-admin-btn--sm"
          @click="isEditing = true"
        >
          Create notice
        </button>
      </div>

      <!-- Loading -->
      <div v-else-if="loading" class="mm-admin-empty mm-admin-empty--loading">
        <span class="mm-admin-spinner" aria-hidden="true" />
        <span class="mm-admin-empty__text">Loading…</span>
      </div>

      <!-- Editor -->
      <div v-if="isEditing" class="mm-admin-notice__editor">
        <div class="mm-admin-notice__editor-header">
          <span class="mm-admin-notice__editor-label">
            {{ currentNotice ? 'Edit notice' : 'Create notice' }}
          </span>
        </div>

        <div class="mm-admin-notice__form">
          <div class="mm-admin-notice__field mm-admin-notice__field--wide">
            <label class="mm-admin-label">Content (Markdown)</label>
            <textarea
              v-model="form.content"
              class="mm-admin-input mm-admin-input--mono mm-admin-notice__textarea"
              placeholder="Enter notice content… Supports **bold**, *italic*, [links](url)"
              rows="4"
            />
          </div>

          <div class="mm-admin-notice__field">
            <label class="mm-admin-label">Type</label>
            <select v-model="form.type" class="mm-admin-select">
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>
          </div>

          <div class="mm-admin-notice__field">
            <label class="mm-admin-label">Dismissible</label>
            <div class="mm-admin-notice__checkbox-wrap">
              <input
                id="mm-admin-notice-dismissible"
                v-model="form.dismissible"
                type="checkbox"
                class="mm-admin-notice__checkbox"
              >
              <label for="mm-admin-notice-dismissible" class="mm-admin-notice__checkbox-label">
                Allow users to dismiss
              </label>
            </div>
          </div>

          <div class="mm-admin-notice__field">
            <label class="mm-admin-label">Expires at (optional)</label>
            <input
              v-model="form.expiresAt"
              type="datetime-local"
              class="mm-admin-input"
            >
          </div>

          <div class="mm-admin-notice__field mm-admin-notice__field--wide">
            <label class="mm-admin-label">Preview</label>
            <div
              class="mm-admin-notice__form-preview"
              :class="`mm-admin-notice__form-preview--${form.type}`"
            >
              <div v-if="form.content" v-html="renderedFormContent" />
              <span v-else class="mm-admin-notice__form-preview-empty">
                Enter content to see preview…
              </span>
            </div>
          </div>

          <div class="mm-admin-notice__form-actions mm-admin-notice__field--wide">
            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--ghost"
              @click="cancelEdit"
            >
              Cancel
            </button>
            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--primary"
              :disabled="saving || !form.content.trim()"
              @click="saveNotice"
            >
              {{ saving ? 'Saving…' : (currentNotice ? 'Update notice' : 'Create notice') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { marked } from 'marked'
import type { SiteNotice } from '@/types/playerStatsTypes'
import { useSiteNotice } from '@/composables/useSiteNotice'
import { adminDataService } from '@/services/adminDataService'

const { setNotice: setGlobalNotice } = useSiteNotice()

const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const success = ref<string | null>(null)
const isEditing = ref(false)
const currentNotice = ref<SiteNotice | null>(null)

const form = ref({
  content: '',
  type: 'info' as 'info' | 'warning' | 'success' | 'error',
  dismissible: true,
  expiresAt: '',
})

const renderedCurrentNotice = computed(() => {
  if (!currentNotice.value?.content) return ''
  try {
    return marked(currentNotice.value.content, { breaks: true })
  } catch {
    return currentNotice.value.content
  }
})

const renderedFormContent = computed(() => {
  if (!form.value.content) return ''
  try {
    return marked(form.value.content, { breaks: true })
  } catch {
    return form.value.content
  }
})

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleString()
  } catch {
    return dateStr
  }
}

function editNotice() {
  if (currentNotice.value) {
    form.value = {
      content: currentNotice.value.content,
      type: currentNotice.value.type,
      dismissible: currentNotice.value.dismissible,
      expiresAt: currentNotice.value.expiresAt
        ? new Date(currentNotice.value.expiresAt).toISOString().slice(0, 16)
        : '',
    }
  }
  isEditing.value = true
}

function cancelEdit() {
  isEditing.value = false
  form.value = { content: '', type: 'info', dismissible: true, expiresAt: '' }
}

async function loadNotice() {
  loading.value = true
  error.value = null
  try {
    const data = await adminDataService.getAppData('site_notice')
    if (data && data.value) {
      currentNotice.value = JSON.parse(data.value) as SiteNotice
    } else {
      currentNotice.value = null
    }
  } catch {
    currentNotice.value = null
  } finally {
    loading.value = false
  }
}

async function saveNotice() {
  if (!form.value.content.trim()) return

  saving.value = true
  error.value = null
  success.value = null

  try {
    const noticeData: SiteNotice = {
      id: currentNotice.value?.id || crypto.randomUUID(),
      content: form.value.content.trim(),
      type: form.value.type,
      dismissible: form.value.dismissible,
      expiresAt: form.value.expiresAt ? new Date(form.value.expiresAt).toISOString() : undefined,
      createdAt: currentNotice.value?.createdAt || new Date().toISOString(),
    }

    await adminDataService.setAppData('site_notice', JSON.stringify(noticeData))
    currentNotice.value = noticeData
    setGlobalNotice(noticeData)
    isEditing.value = false
    success.value = 'Notice saved successfully.'
    form.value = { content: '', type: 'info', dismissible: true, expiresAt: '' }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save notice'
  } finally {
    saving.value = false
  }
}

async function clearNotice() {
  saving.value = true
  error.value = null
  success.value = null

  try {
    await adminDataService.deleteAppData('site_notice')
    currentNotice.value = null
    setGlobalNotice(null)
    success.value = 'Notice cleared.'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to clear notice'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadNotice()
})

defineExpose({ load: loadNotice })
</script>

<style scoped>
.mm-admin-notice__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 18px 18px;
}

.mm-admin-notice__preview {
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  overflow: hidden;
  background: var(--mm-bg);
}

.mm-admin-notice__preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--mm-bg-soft);
  border-bottom: 1px solid var(--mm-rule);
}

.mm-admin-notice__preview-label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-admin-notice__type-badge {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.10em;
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid transparent;
}

.mm-admin-notice__type-badge--info {
  color: var(--mm-ink);
  border-color: var(--mm-rule-strong);
}
.mm-admin-notice__type-badge--warning {
  color: var(--mm-load-busy);
  border-color: rgba(197, 162, 58, 0.40);
}
.mm-admin-notice__type-badge--success {
  color: var(--mm-success);
  border-color: rgba(125, 163, 76, 0.40);
}
.mm-admin-notice__type-badge--error {
  color: var(--mm-danger);
  border-color: rgba(214, 90, 90, 0.40);
}

.mm-admin-notice__preview-content {
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--mm-ink);
}

.mm-admin-notice__preview-content--info { background: var(--mm-bg-soft); }
.mm-admin-notice__preview-content--warning {
  background: rgba(197, 162, 58, 0.08);
  border-left: 2px solid var(--mm-load-busy);
}
.mm-admin-notice__preview-content--success {
  background: rgba(125, 163, 76, 0.08);
  border-left: 2px solid var(--mm-success);
}
.mm-admin-notice__preview-content--error {
  background: rgba(214, 90, 90, 0.08);
  border-left: 2px solid var(--mm-danger);
}

.mm-admin-notice__preview-text :deep(p) { margin: 0; }
.mm-admin-notice__preview-text :deep(p + p) { margin-top: 8px; }

.mm-admin-notice__preview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
}

.mm-admin-notice__meta-item {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
}

.mm-admin-notice__preview-actions {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--mm-rule);
}

.mm-admin-notice__empty { gap: 14px; }

.mm-admin-notice__editor {
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  overflow: hidden;
  background: var(--mm-bg);
}

.mm-admin-notice__editor-header {
  padding: 8px 12px;
  background: var(--mm-bg-soft);
  border-bottom: 1px solid var(--mm-rule);
}

.mm-admin-notice__editor-label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-admin-notice__form {
  padding: 14px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 640px) {
  .mm-admin-notice__form { grid-template-columns: 1fr; }
}

.mm-admin-notice__field--wide { grid-column: 1 / -1; }

.mm-admin-notice__textarea {
  min-height: 6rem;
  resize: vertical;
}

.mm-admin-notice__checkbox-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}

.mm-admin-notice__checkbox {
  width: 14px;
  height: 14px;
  accent-color: var(--mm-accent);
}

.mm-admin-notice__checkbox-label {
  font-size: 13px;
  color: var(--mm-ink);
}

.mm-admin-notice__form-preview {
  padding: 12px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule);
  font-size: 13px;
  line-height: 1.5;
  min-height: 2.5rem;
  color: var(--mm-ink);
  background: var(--mm-bg-soft);
}

.mm-admin-notice__form-preview--warning {
  background: rgba(197, 162, 58, 0.08);
  border-color: rgba(197, 162, 58, 0.40);
}
.mm-admin-notice__form-preview--success {
  background: rgba(125, 163, 76, 0.08);
  border-color: rgba(125, 163, 76, 0.40);
}
.mm-admin-notice__form-preview--error {
  background: rgba(214, 90, 90, 0.08);
  border-color: rgba(214, 90, 90, 0.40);
}

.mm-admin-notice__form-preview :deep(p) { margin: 0; }
.mm-admin-notice__form-preview :deep(p + p) { margin-top: 8px; }

.mm-admin-notice__form-preview-empty {
  color: var(--mm-ink-muted);
  font-style: italic;
}

.mm-admin-notice__form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
}
</style>
