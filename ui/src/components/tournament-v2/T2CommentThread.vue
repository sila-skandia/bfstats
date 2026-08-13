<template>
  <component
    :is="variant === 'rail' ? 'aside' : 'section'"
    class="t2-comments"
    :class="{ 't2-comments--rail': variant === 'rail' }"
  >
    <template v-if="variant === 'rail'">
      <div class="t2-comments__rail-head">
        <span
          class="t2-section-head__mark"
          style="font-size: 13px"
        >//</span>
        <span class="t2-comments__rail-title">{{ title }}</span>
        <span
          v-if="totalCount > 0"
          class="t2-comments__rail-count"
        >{{ totalCount }}</span>
        <button
          type="button"
          class="t2-comments__add-btn"
          @click="scrollToComposer"
        >
          <span aria-hidden="true">+</span> Add
        </button>
      </div>
    </template>
    <template v-else>
      <div class="t2-section-head">
        <span class="t2-section-head__mark">//</span>
        <h2 class="t2-section-head__title">{{ title }}</h2>
        <span
          v-if="totalCount > 0"
          class="t2-section-head__meta"
        >{{ totalCount }}</span>
      </div>
    </template>

    <div
      ref="scrollRef"
      class="t2-comments__scroll"
      :class="{ 't2-comments__scroll--rail': variant === 'rail' }"
    >
      <div
        v-if="loading && comments.length === 0"
        class="t2-loading"
        style="min-height: 120px"
      >
        <div class="t2-spinner" />
      </div>

      <div
        v-else-if="error"
        class="t2-empty"
      >
        Failed to load comments.
      </div>

      <div
        v-else-if="comments.length === 0"
        class="t2-empty"
      >
        No comments yet. Be the first.
      </div>

      <ul
        v-else
        class="t2-comments__list"
      >
        <li
          v-for="comment in comments"
          :key="comment.id"
          class="t2-comments__item"
        >
          <span class="t2-comments__avatar">{{ initials(comment.authorPlayerName) }}</span>

          <div class="t2-comments__item-body">
            <div class="t2-comments__item-head">
              <router-link
                :to="`/v4/players/${encodeURIComponent(comment.authorPlayerName)}`"
                class="t2-comments__author"
              >
                {{ $pn(comment.authorPlayerName) }}
              </router-link>
              <span class="t2-comments__time">{{ formatRelativeTime(comment.createdAt) }}</span>
              <span
                v-if="comment.updatedAt !== comment.createdAt"
                class="t2-comments__edited"
              >edited</span>
              <span
                v-if="canEdit(comment)"
                class="t2-comments__actions"
              >
                <button
                  type="button"
                  @click="startEdit(comment)"
                >Edit</button> ·
                <button
                  type="button"
                  class="t2-comments__actions-danger"
                  @click="deleteComment(comment.id)"
                >Del</button>
              </span>
            </div>

            <div
              v-if="editingId === comment.id"
              class="t2-comments__edit"
            >
              <div class="t2-comments__editor">
                <div class="t2-comments__toolbar">
                  <button
                    type="button"
                    class="t2-comments__tool"
                    :class="{ 'is-active': editEditorTick && editEditor?.isActive('bold') }"
                    title="Bold"
                    @click="editEditor?.chain().focus().toggleBold().run()"
                  ><strong>B</strong></button>
                  <button
                    type="button"
                    class="t2-comments__tool"
                    :class="{ 'is-active': editEditorTick && editEditor?.isActive('italic') }"
                    title="Italic"
                    @click="editEditor?.chain().focus().toggleItalic().run()"
                  ><em>I</em></button>
                  <button
                    type="button"
                    class="t2-comments__tool"
                    :class="{ 'is-active': editEditorTick && editEditor?.isActive('link') }"
                    title="Link"
                    @click="toggleLink(editEditor)"
                  >Link</button>
                  <button
                    type="button"
                    class="t2-comments__tool"
                    title="Image"
                    @click="insertImage(editEditor)"
                  >Image</button>
                </div>
                <editor-content
                  :editor="editEditor ?? undefined"
                  class="t2-comments__editor-content"
                />
              </div>
              <div class="t2-comments__form-foot">
                <span class="t2-eyebrow">Use the toolbar for formatting</span>
                <div class="t2-comments__form-foot-right">
                  <span
                    v-if="editError"
                    class="t2-comments__error"
                  >{{ editError }}</span>
                  <button
                    class="t2-btn t2-btn--outline"
                    :disabled="editSaving"
                    @click="cancelEdit"
                  >Cancel</button>
                  <button
                    class="t2-btn t2-btn--accent"
                    :disabled="editSaving"
                    @click="saveEdit(comment.id)"
                  >
                    {{ editSaving ? 'Saving…' : 'Save' }}
                  </button>
                </div>
              </div>
            </div>

            <div
              v-else
              class="t2-comments__body"
              v-html="sanitize(comment.content)"
            />
          </div>
        </li>
      </ul>

      <div
        v-if="variant === 'inline' && totalPages > 1"
        class="t2-comments__pagination"
      >
        <button
          class="t2-comments__inline-btn"
          :disabled="currentPage <= 1 || loading"
          @click="goToPage(currentPage - 1)"
        >‹</button>
        <span class="t2-eyebrow">{{ currentPage }} / {{ totalPages }}</span>
        <button
          class="t2-comments__inline-btn"
          :disabled="currentPage >= totalPages || loading"
          @click="goToPage(currentPage + 1)"
        >›</button>
      </div>

      <div
        ref="composerRef"
        class="t2-comments__composer"
      >
        <div
          v-if="!isAuthenticated"
          class="t2-comments__notice"
        >
          <button
            class="t2-btn t2-btn--accent"
            :disabled="isLoginLoading"
            @click="handleSignIn"
          >
            <i class="pi pi-discord" /> {{ isLoginLoading ? 'Redirecting…' : 'Sign in' }}
          </button>
          <span style="margin-left: 10px">to leave a comment.</span>
        </div>

        <div
          v-else-if="linkedProfiles.length === 0"
          class="t2-comments__notice"
        >
          Link a player profile on your
          <router-link
            to="/v4/dashboard"
            class="t2-comments__author"
          >dashboard</router-link>
          to post comments.
        </div>

        <form
          v-else
          class="t2-comments__form"
          @submit.prevent="submitComment"
        >
          <div class="t2-comments__postas">
            <span class="t2-comments__avatar t2-comments__avatar--sm">{{ initials(selectedProfile) }}</span>
            <span class="t2-comments__postas-label">Post as</span>
            <select
              v-if="linkedProfiles.length > 1"
              v-model="selectedProfile"
              class="t2-comments__select"
              :disabled="submitting"
            >
              <option
                v-for="p in linkedProfiles"
                :key="p.id"
                :value="p.playerName"
              >{{ $pn(p.playerName) }}</option>
            </select>
            <span
              v-else
              class="t2-comments__postas-name"
            >{{ $pn(selectedProfile) }}</span>
          </div>

          <div class="t2-comments__editor">
            <div class="t2-comments__toolbar">
              <button
                type="button"
                class="t2-comments__tool"
                :class="{ 'is-active': newEditor?.isActive('bold') }"
                title="Bold"
                @click="newEditor?.chain().focus().toggleBold().run()"
              ><strong>B</strong></button>
              <button
                type="button"
                class="t2-comments__tool"
                :class="{ 'is-active': newEditor?.isActive('italic') }"
                title="Italic"
                @click="newEditor?.chain().focus().toggleItalic().run()"
              ><em>I</em></button>
              <button
                type="button"
                class="t2-comments__tool"
                :class="{ 'is-active': newEditor?.isActive('link') }"
                title="Link"
                @click="toggleLink(newEditor)"
              >Link</button>
              <button
                type="button"
                class="t2-comments__tool"
                title="Image"
                @click="insertImage(newEditor)"
              >Image</button>
            </div>
            <editor-content
              :editor="newEditor"
              class="t2-comments__editor-content"
            />
          </div>

          <div class="t2-comments__form-foot">
            <span class="t2-eyebrow">Bold · Italic · Links · Images</span>
            <div class="t2-comments__form-foot-right">
              <span
                v-if="submitError"
                class="t2-comments__error"
              >{{ submitError }}</span>
              <button
                type="submit"
                class="t2-btn t2-btn--accent"
                :disabled="submitting || isEditorEmpty(newEditor)"
              >
                {{ submitting ? 'Posting…' : 'Post' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </component>
</template>

<script setup lang="ts">
// Icon font for the `pi pi-*` classes in this component's template. Imported
// here rather than via a <link> in index.html so it ships in this route's CSS
// chunk — it used to be a render-blocking stylesheet fetched from unpkg.com on
// every page load, including the three routes that never use an icon from it.
import 'primeicons/primeicons.css'
import { ref, shallowRef, onMounted, onBeforeUnmount, watch } from 'vue'
import DOMPurify from 'dompurify'
import { useEditor, EditorContent, Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { useAuth } from '@/composables/useAuth'
import { formatRelativeTime } from '@/utils/timeUtils'
import { decodePlayerName } from '@/utils/playerName'
import { teamRegistrationService, type LinkedPlayerName } from '@/services/teamRegistrationService'
import {
  tournamentCommentsService,
  type TournamentComment,
} from '@/services/tournamentCommentsService'

interface Props {
  /** Tournament ID or slug */
  tournamentId: string | number
  /** Match ID — when set, this thread shows/posts match-level comments instead of tournament-level */
  matchId?: number
  /** Section title — defaults to "Discussion" */
  title?: string
  /**
   * 'rail' = compact bordered sidebar widget with its own scroll region and an
   * "+ Add" shortcut that jumps to the composer (used on the Overview tab).
   * 'inline' = unboxed section matching the surrounding page flow, with
   * numbered pagination (used inside the match details modal).
   */
  variant?: 'rail' | 'inline'
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Discussion',
  variant: 'inline',
})

const { isAuthenticated, loginWithDiscord } = useAuth()

const ALLOWED_TAGS = ['p', 'strong', 'em', 'u', 'a', 'img', 'ul', 'ol', 'li', 'br', 'blockquote']
const ALLOWED_ATTR = ['href', 'src', 'alt', 'target', 'rel']

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORCE_BODY: false,
  })
}

function initials(playerName: string): string {
  const decoded = decodePlayerName(playerName || '').trim()
  return decoded ? decoded.charAt(0).toUpperCase() : '?'
}

const tiptapExtensions = [
  StarterKit.configure({ heading: false, codeBlock: false, code: false, horizontalRule: false }),
  Link.configure({ openOnClick: false, autolink: true }),
  Image.configure({ inline: false }),
]

const newEditor = useEditor({
  extensions: tiptapExtensions,
  editorProps: { attributes: { class: 't2-comments__editor-input' } },
})

const editEditor = shallowRef<Editor | null>(null)
const editEditorTick = ref(0)

const comments = ref<TournamentComment[]>([])
const currentPage = ref(1)
const totalPages = ref(1)
const totalCount = ref(0)
const loading = ref(true)
const error = ref(false)
const submitting = ref(false)
const submitError = ref('')
const linkedProfiles = ref<LinkedPlayerName[]>([])
const selectedProfile = ref('')
const editingId = ref<number | null>(null)
const editSaving = ref(false)
const editError = ref('')
const isLoginLoading = ref(false)

const scrollRef = ref<HTMLElement | null>(null)
const composerRef = ref<HTMLElement | null>(null)

function scrollToComposer() {
  const scrollEl = scrollRef.value
  const composerEl = composerRef.value
  if (!scrollEl || !composerEl) return
  scrollEl.scrollTo({ top: composerEl.offsetTop, behavior: 'smooth' })
  const editable = composerEl.querySelector<HTMLElement>('.t2-comments__editor-input')
  if (editable) setTimeout(() => editable.focus(), 300)
}

function canEdit(comment: TournamentComment) {
  return isAuthenticated.value && linkedProfiles.value.some(p => p.playerName === comment.authorPlayerName)
}

function isEditorEmpty(editor: Editor | null | undefined): boolean {
  return !editor || editor.isEmpty
}

function toggleLink(editor: Editor | null | undefined) {
  if (!editor) return
  if (editor.isActive('link')) {
    editor.chain().focus().unsetLink().run()
  } else {
    const url = window.prompt('URL')
    if (url) editor.chain().focus().setLink({ href: url, target: '_blank', rel: 'noopener noreferrer' }).run()
  }
}

function insertImage(editor: Editor | null | undefined) {
  if (!editor) return
  const url = window.prompt('Image URL (https only)')
  if (url && url.startsWith('https://')) editor.chain().focus().setImage({ src: url }).run()
}

function startEdit(comment: TournamentComment) {
  cancelEdit()
  editingId.value = comment.id
  editError.value = ''
  editEditor.value = new Editor({
    extensions: tiptapExtensions,
    content: comment.content,
    editorProps: { attributes: { class: 't2-comments__editor-input' } },
    onTransaction: () => { editEditorTick.value++ },
  })
}

function cancelEdit() {
  editEditor.value?.destroy()
  editEditor.value = null
  editingId.value = null
  editError.value = ''
}

async function loadComments(page = currentPage.value) {
  loading.value = true
  error.value = false
  try {
    const r = await tournamentCommentsService.getComments(props.tournamentId, {
      matchId: props.matchId ?? null,
      page,
      pageSize: props.variant === 'rail' ? 20 : 10,
    })
    comments.value = r.items
    currentPage.value = r.page
    totalPages.value = r.totalPages
    totalCount.value = r.totalCount
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return
  cancelEdit()
  loadComments(page)
}

async function loadLinkedProfiles() {
  if (!isAuthenticated.value) return
  try {
    linkedProfiles.value = await teamRegistrationService.getLinkedPlayerNames()
    if (linkedProfiles.value.length > 0) selectedProfile.value = linkedProfiles.value[0].playerName
  } catch {
    // not critical
  }
}

async function handleSignIn() {
  isLoginLoading.value = true
  try {
    await loginWithDiscord()
  } catch {
    // handled by auth service
  } finally {
    isLoginLoading.value = false
  }
}

async function submitComment() {
  if (!newEditor.value || newEditor.value.isEmpty) return
  submitting.value = true
  submitError.value = ''
  try {
    const html = newEditor.value.getHTML()
    await tournamentCommentsService.createComment(props.tournamentId, {
      content: html,
      authorPlayerName: selectedProfile.value,
      matchId: props.matchId ?? null,
    })
    newEditor.value.commands.clearContent()
    await loadComments(1)
  } catch (err: any) {
    submitError.value = err?.message ?? 'Failed to post comment.'
  } finally {
    submitting.value = false
  }
}

async function saveEdit(commentId: number) {
  if (!editEditor.value || editEditor.value.isEmpty) return
  editSaving.value = true
  editError.value = ''
  try {
    const comment = comments.value.find(c => c.id === commentId)!
    const html = editEditor.value.getHTML()
    await tournamentCommentsService.editComment(props.tournamentId, commentId, {
      content: html,
      authorPlayerName: comment.authorPlayerName,
      matchId: props.matchId ?? null,
    })
    cancelEdit()
    await loadComments(currentPage.value)
  } catch (err: any) {
    editError.value = err?.message ?? 'Failed to save.'
  } finally {
    editSaving.value = false
  }
}

async function deleteComment(commentId: number) {
  try {
    await tournamentCommentsService.deleteComment(props.tournamentId, commentId)
    if (editingId.value === commentId) cancelEdit()
    const newPage = comments.value.length === 1 && currentPage.value > 1
      ? currentPage.value - 1
      : currentPage.value
    await loadComments(newPage)
  } catch {
    // silently ignore
  }
}

onMounted(() => { loadComments(); loadLinkedProfiles() })
onBeforeUnmount(() => { newEditor.value?.destroy(); cancelEdit() })
watch(() => [props.tournamentId, props.matchId], () => { cancelEdit(); loadComments(1) })
watch(isAuthenticated, () => { loadLinkedProfiles() })
</script>

<style scoped>
.t2-comments { margin-top: 40px; }

.t2-comments--rail {
  margin-top: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--t-rule);
  border-radius: 2px;
  background: var(--t-surface);
  max-height: 560px;
}

.t2-comments__rail-head {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--t-rule);
  flex: none;
}

.t2-comments__rail-title {
  font-family: var(--t-font-display);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--t-text);
}

.t2-comments__rail-count {
  font-family: var(--t-font-mono);
  font-size: 11px;
  color: var(--t-muted);
}

.t2-comments__add-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  font-family: var(--t-font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--t-accent);
  background: transparent;
  border: 1px solid var(--t-rule-strong);
  border-radius: 2px;
  padding: 6px 11px;
  cursor: pointer;
  transition: border-color 0.13s ease, color 0.13s ease;
}

.t2-comments__add-btn:hover { border-color: var(--t-accent); color: var(--t-text); }

.t2-comments__scroll--rail { overflow-y: auto; flex: 1; padding: 0 16px; }

.t2-comments__list { list-style: none; margin: 0; padding: 0; }

.t2-comments__item { display: flex; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--t-rule); }
.t2-comments__item:last-child { border-bottom: 0; }

.t2-comments__avatar {
  flex: none;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  background: var(--t-surface);
  border: 1px solid var(--t-rule-strong);
  color: var(--t-muted);
  font-family: var(--t-font-mono);
  font-weight: 600;
  font-size: 12px;
  border-radius: 2px;
}

.t2-comments__avatar--sm { width: 26px; height: 26px; font-size: 10px; }

.t2-comments__item-body { min-width: 0; flex: 1; }

.t2-comments__item-head {
  display: flex;
  align-items: baseline;
  gap: 9px;
  flex-wrap: wrap;
}

.t2-comments__author {
  font-family: var(--t-font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--t-text);
}

.t2-comments__author:hover { color: var(--t-accent); }

.t2-comments__time {
  font-family: var(--t-font-mono);
  font-size: 10px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--t-faint);
}

.t2-comments__edited {
  font-family: var(--t-font-mono);
  font-size: 10px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--t-faint);
}

.t2-comments__actions {
  margin-left: auto;
  font-family: var(--t-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--t-faint);
  opacity: 0;
  transition: opacity 0.13s ease;
  white-space: nowrap;
}

.t2-comments__item:hover .t2-comments__actions,
.t2-comments__item:focus-within .t2-comments__actions { opacity: 1; }

.t2-comments__actions button {
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  color: var(--t-muted);
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
}

.t2-comments__actions button:hover { color: var(--t-text); }
.t2-comments__actions-danger:hover { color: var(--t-kill) !important; }

.t2-comments__body {
  margin-top: 6px;
  font-family: var(--t-font-body);
  font-size: 14px;
  line-height: 1.55;
  color: var(--t-muted);
}

.t2-comments__body :deep(p) { margin: 0 0 8px; }
.t2-comments__body :deep(p:last-child) { margin-bottom: 0; }
.t2-comments__body :deep(strong),
.t2-comments__body :deep(b) { font-weight: 700; color: var(--t-text); }
.t2-comments__body :deep(em),
.t2-comments__body :deep(i) { font-style: italic; }
.t2-comments__body :deep(a) { color: var(--t-accent); text-decoration: underline; text-underline-offset: 3px; }
.t2-comments__body :deep(img) { max-width: 100%; height: auto; border: 1px solid var(--t-rule); }
.t2-comments__body :deep(ul),
.t2-comments__body :deep(ol) { padding-left: 22px; margin: 0 0 8px; }
.t2-comments__body :deep(blockquote) {
  margin: 0 0 8px;
  padding-left: 12px;
  border-left: 2px solid var(--t-rule-strong);
  color: var(--t-faint);
}

.t2-comments__edit { margin-top: 6px; display: flex; flex-direction: column; gap: 8px; }

.t2-comments__editor { border: 1px solid var(--t-rule-strong); border-radius: 2px; background: var(--t-bg); }

.t2-comments__toolbar {
  display: flex;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--t-rule);
}

.t2-comments__tool {
  font-family: var(--t-font-mono);
  font-size: 11px;
  background: transparent;
  border: 0;
  padding: 5px 9px;
  cursor: pointer;
  color: var(--t-muted);
  border-radius: 2px;
}

.t2-comments__tool:hover { color: var(--t-text); background: var(--t-card); }
.t2-comments__tool.is-active { color: var(--t-text); background: var(--t-card); }

.t2-comments__editor-content {
  padding: 12px 13px;
  min-height: 104px;
  font-family: var(--t-font-display);
  font-size: 14px;
  color: var(--t-text);
}

.t2-comments__editor-content :deep(.t2-comments__editor-input) {
  outline: 0;
  min-height: 80px;
}

.t2-comments__editor-content :deep(strong),
.t2-comments__editor-content :deep(b) { font-weight: 700; }
.t2-comments__editor-content :deep(em),
.t2-comments__editor-content :deep(i) { font-style: italic; }

.t2-comments__editor-content :deep(p.is-editor-empty:first-child::before) {
  content: 'Write a comment…';
  color: var(--t-faint);
  pointer-events: none;
  height: 0;
  float: left;
}

.t2-comments__form-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 11px;
}

.t2-comments__form-foot-right { display: flex; align-items: center; gap: 12px; }

.t2-comments__error {
  font-family: var(--t-font-mono);
  font-size: 10.5px;
  color: var(--t-kill);
}

.t2-comments__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 18px 0;
}

.t2-comments__composer { padding: 16px 0 18px; }
.t2-comments__scroll:not(.t2-comments__scroll--rail) .t2-comments__composer {
  border-top: 1px solid var(--t-rule);
  margin-top: 4px;
}

.t2-comments__notice {
  font-family: var(--t-font-body);
  font-size: 13.5px;
  color: var(--t-muted);
  padding: 8px 0;
  display: flex;
  align-items: center;
}

.t2-comments__form { display: flex; flex-direction: column; gap: 12px; }

.t2-comments__postas { display: flex; align-items: center; gap: 9px; }

.t2-comments__postas-label {
  font-family: var(--t-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--t-muted);
}

.t2-comments__postas-name {
  font-family: var(--t-font-display);
  font-weight: 600;
  font-size: 13px;
  color: var(--t-text);
}

.t2-comments__select {
  font-family: var(--t-font-body);
  font-size: 13px;
  padding: 5px 8px;
  background: var(--t-bg);
  border: 1px solid var(--t-rule);
  border-radius: 2px;
  color: var(--t-text);
  min-width: 160px;
}

.t2-comments__inline-btn {
  font-family: var(--t-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 3px 8px;
  border: 1px solid var(--t-rule);
  border-radius: 2px;
  background: transparent;
  color: var(--t-muted);
  cursor: pointer;
}

.t2-comments__inline-btn:hover:not(:disabled) {
  border-color: var(--t-text);
  color: var(--t-text);
}

.t2-comments__inline-btn:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 720px) {
  .t2-comments--rail { max-height: none; }
  .t2-comments__postas { flex-wrap: wrap; }
  .t2-comments__select { min-width: 0; flex: 1; }
}
</style>
