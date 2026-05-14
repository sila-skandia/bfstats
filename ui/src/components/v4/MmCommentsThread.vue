<template>
  <section class="mm-comments">
    <header class="mm-comments__head">
      <div class="mm-eyebrow mm-eyebrow--strong">{{ title }}</div>
      <div class="mm-comments__head-hint">{{ hint }}</div>
    </header>

    <hr class="mm-rule" />

    <div v-if="loading" class="mm-comments__state">
      <div v-for="i in 3" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">Failed to load comments.</div>

    <div v-else-if="comments.length === 0" class="mm-empty">
      No comments yet. Be the first.
    </div>

    <ul v-else class="mm-comments__list">
      <li v-for="comment in comments" :key="comment.id" class="mm-comment">
        <div class="mm-comment__meta">
          <router-link
            :to="`/v4/players/${encodeURIComponent(comment.authorPlayerName)}`"
            class="mm-comment__author"
          >
            {{ $pn(comment.authorPlayerName) }}
          </router-link>
          <div class="mm-comment__meta-right">
            <span v-if="comment.updatedAt !== comment.createdAt" class="mm-eyebrow">edited</span>
            <span class="mm-eyebrow">{{ formatDate(comment.createdAt) }}</span>
            <template v-if="canEdit(comment)">
              <button class="mm-btn mm-btn--inline" @click="startEdit(comment)">Edit</button>
              <button class="mm-btn mm-btn--inline mm-btn--danger" @click="deleteComment(comment.id)">Delete</button>
            </template>
          </div>
        </div>

        <div v-if="editingId === comment.id" class="mm-comment__edit">
          <div class="mm-comment__editor">
            <div class="mm-comment__toolbar">
              <button
                type="button"
                class="mm-comment__tool"
                :class="{ 'is-active': editEditorTick && editEditor?.isActive('bold') }"
                title="Bold"
                @click="editEditor?.chain().focus().toggleBold().run()"
              ><strong>B</strong></button>
              <button
                type="button"
                class="mm-comment__tool"
                :class="{ 'is-active': editEditorTick && editEditor?.isActive('italic') }"
                title="Italic"
                @click="editEditor?.chain().focus().toggleItalic().run()"
              ><em>I</em></button>
              <button
                type="button"
                class="mm-comment__tool"
                :class="{ 'is-active': editEditorTick && editEditor?.isActive('underline') }"
                title="Underline"
                @click="editEditor?.chain().focus().toggleUnderline().run()"
              ><u>U</u></button>
              <button
                type="button"
                class="mm-comment__tool"
                :class="{ 'is-active': editEditorTick && editEditor?.isActive('link') }"
                title="Link"
                @click="toggleLink(editEditor)"
              >Link</button>
              <button
                type="button"
                class="mm-comment__tool"
                title="Image"
                @click="insertImage(editEditor)"
              >Image</button>
            </div>
            <editor-content :editor="editEditor ?? undefined" class="mm-comment__editor-content" />
          </div>
          <div class="mm-comment__form-foot">
            <span class="mm-card__hint">Use the toolbar for formatting</span>
            <div class="mm-comment__form-foot-right">
              <span v-if="editError" class="mm-comment__error">{{ editError }}</span>
              <button class="mm-btn" :disabled="editSaving" @click="cancelEdit">Cancel</button>
              <button class="mm-btn mm-btn--accent" :disabled="editSaving" @click="saveEdit(comment.id)">
                {{ editSaving ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </div>
        </div>

        <div v-else class="mm-comment__body" v-html="sanitize(comment.content)" />
      </li>
    </ul>

    <div v-if="totalPages > 1" class="mm-comments__pagination">
      <button class="mm-btn mm-btn--inline" :disabled="currentPage <= 1 || loading" @click="goToPage(currentPage - 1)">‹</button>
      <span class="mm-eyebrow">{{ currentPage }} / {{ totalPages }}</span>
      <button class="mm-btn mm-btn--inline" :disabled="currentPage >= totalPages || loading" @click="goToPage(currentPage + 1)">›</button>
    </div>

    <hr class="mm-rule" />

    <div class="mm-comments__input">
      <div v-if="!isAuthenticated" class="mm-comments__notice">
        <button class="mm-btn mm-btn--accent" @click="handleSignIn">Sign in</button>
        <span style="margin-left: 8px">to leave a comment.</span>
      </div>

      <div v-else-if="linkedProfiles.length === 0" class="mm-comments__notice">
        Link a player profile on your
        <router-link to="/v4/dashboard" class="mm-comment__author" style="text-decoration: underline">dashboard</router-link>
        to post comments.
      </div>

      <form v-else class="mm-comments__form" @submit.prevent="submitComment">
        <div class="mm-comments__profile-row">
          <span class="mm-eyebrow">Post as</span>
          <select v-model="selectedProfile" class="mm-comments__select" :disabled="submitting">
            <option v-for="p in linkedProfiles" :key="p.id" :value="p.playerName">{{ $pn(p.playerName) }}</option>
          </select>
        </div>

        <div class="mm-comment__editor">
          <div class="mm-comment__toolbar">
            <button
              type="button"
              class="mm-comment__tool"
              :class="{ 'is-active': newEditor?.isActive('bold') }"
              title="Bold"
              @click="newEditor?.chain().focus().toggleBold().run()"
            ><strong>B</strong></button>
            <button
              type="button"
              class="mm-comment__tool"
              :class="{ 'is-active': newEditor?.isActive('italic') }"
              title="Italic"
              @click="newEditor?.chain().focus().toggleItalic().run()"
            ><em>I</em></button>
            <button
              type="button"
              class="mm-comment__tool"
              :class="{ 'is-active': newEditor?.isActive('underline') }"
              title="Underline"
              @click="newEditor?.chain().focus().toggleUnderline().run()"
            ><u>U</u></button>
            <button
              type="button"
              class="mm-comment__tool"
              :class="{ 'is-active': newEditor?.isActive('link') }"
              title="Link"
              @click="toggleLink(newEditor)"
            >Link</button>
            <button
              type="button"
              class="mm-comment__tool"
              title="Image"
              @click="insertImage(newEditor)"
            >Image</button>
          </div>
          <editor-content :editor="newEditor" class="mm-comment__editor-content" />
        </div>

        <div class="mm-comment__form-foot">
          <span class="mm-card__hint">Bold · Italic · Underline · Links · Images</span>
          <div class="mm-comment__form-foot-right">
            <span v-if="submitError" class="mm-comment__error">{{ submitError }}</span>
            <button type="submit" class="mm-btn mm-btn--accent" :disabled="submitting || isEditorEmpty(newEditor)">
              {{ submitting ? 'Posting…' : 'Post' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, shallowRef, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import DOMPurify from 'dompurify'
import axios from 'axios'
import { useEditor, EditorContent, Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { useAuth } from '@/composables/useAuth'
import { formatRelativeTime } from '@/utils/timeUtils'
import { statsService } from '@/services/statsService'

export type CommentTargetKind = 'player' | 'server'

interface Props {
  /** Discriminator for which API surface to talk to */
  kind: CommentTargetKind
  /** The player name or server name */
  id: string
  /** Section title — defaults to "Comments" */
  title?: string
  /** Subtitle / hint shown under the title */
  hint?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Comments',
  hint: '',
})

const computedHint = computed(() => {
  if (props.hint) return props.hint
  return props.kind === 'player' ? 'Community notes on this player' : 'Community notes on this server'
})

const hint = computed(() => computedHint.value)
const title = computed(() => props.title)

const basePath = computed(() => {
  const segment = props.kind === 'player' ? 'players' : 'servers'
  return `/stats/${segment}/${encodeURIComponent(props.id)}/comments`
})

const { isAuthenticated, loginWithDiscord } = useAuth()

interface Comment {
  id: number
  content: string
  authorPlayerName: string
  createdAt: string
  updatedAt: string
}

interface PagedComments {
  items: Comment[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

interface LinkedProfile { id: number; playerName: string }

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

const tiptapExtensions = [
  StarterKit.configure({ heading: false, codeBlock: false, code: false, horizontalRule: false }),
  Underline,
  Link.configure({ openOnClick: false, autolink: true }),
  Image.configure({ inline: false }),
]

const newEditor = useEditor({
  extensions: tiptapExtensions,
  editorProps: { attributes: { class: 'mm-comment__editor-input' } },
})

const editEditor = shallowRef<Editor | null>(null)
const editEditorTick = ref(0)

const comments = ref<Comment[]>([])
const currentPage = ref(1)
const totalPages = ref(1)
const totalCount = ref(0)
const loading = ref(true)
const error = ref(false)
const submitting = ref(false)
const submitError = ref('')
const linkedProfiles = ref<LinkedProfile[]>([])
const selectedProfile = ref('')
const editingId = ref<number | null>(null)
const editSaving = ref(false)
const editError = ref('')

function formatDate(iso: string) { return formatRelativeTime(iso) }

function canEdit(comment: Comment) {
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

function startEdit(comment: Comment) {
  cancelEdit()
  editingId.value = comment.id
  editError.value = ''
  editEditor.value = new Editor({
    extensions: tiptapExtensions,
    content: comment.content,
    editorProps: { attributes: { class: 'mm-comment__editor-input' } },
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
    const r = await axios.get<PagedComments>(basePath.value, { params: { page, pageSize: 10 } })
    comments.value = r.data.items
    currentPage.value = r.data.page
    totalPages.value = r.data.totalPages
    totalCount.value = r.data.totalCount
  } catch { error.value = true }
  finally { loading.value = false }
}

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return
  cancelEdit()
  loadComments(page)
}

async function loadLinkedProfiles() {
  if (!isAuthenticated.value) return
  try {
    const profile = await statsService.getUserProfile()
    linkedProfiles.value = profile.playerNames.map(p => ({ id: p.id, playerName: p.playerName }))
    if (linkedProfiles.value.length > 0) selectedProfile.value = linkedProfiles.value[0].playerName
  } catch { /* not critical */ }
}

async function handleSignIn() {
  try { await loginWithDiscord() } catch { /* handled by auth service */ }
}

async function submitComment() {
  if (!newEditor.value || newEditor.value.isEmpty) return
  submitting.value = true
  submitError.value = ''
  try {
    const token = localStorage.getItem('authToken')
    const html = newEditor.value.getHTML()
    await axios.post<Comment>(
      basePath.value,
      { content: html, authorPlayerName: selectedProfile.value },
      { headers: { Authorization: `Bearer ${token}` } },
    )
    newEditor.value.commands.clearContent()
    await loadComments(1)
  } catch (err: any) {
    submitError.value = err?.response?.data?.message ?? 'Failed to post comment.'
  } finally { submitting.value = false }
}

async function saveEdit(commentId: number) {
  if (!editEditor.value || editEditor.value.isEmpty) return
  editSaving.value = true
  editError.value = ''
  try {
    const token = localStorage.getItem('authToken')
    const comment = comments.value.find(c => c.id === commentId)!
    const html = editEditor.value.getHTML()
    await axios.patch<Comment>(
      `${basePath.value}/${commentId}`,
      { content: html, authorPlayerName: comment.authorPlayerName },
      { headers: { Authorization: `Bearer ${token}` } },
    )
    cancelEdit()
    await loadComments(currentPage.value)
  } catch (err: any) {
    editError.value = err?.response?.data?.message ?? 'Failed to save.'
  } finally { editSaving.value = false }
}

async function deleteComment(commentId: number) {
  const token = localStorage.getItem('authToken')
  try {
    await axios.delete(
      `${basePath.value}/${commentId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (editingId.value === commentId) cancelEdit()
    const newPage = comments.value.length === 1 && currentPage.value > 1
      ? currentPage.value - 1
      : currentPage.value
    await loadComments(newPage)
  } catch { /* silently ignore */ }
}

onMounted(() => { loadComments(); loadLinkedProfiles() })
onBeforeUnmount(() => { newEditor.value?.destroy(); cancelEdit() })
watch(() => props.id, () => { cancelEdit(); loadComments(1) })
</script>

<style scoped>
.mm-comments { padding: 24px 0 0; }

.mm-comments__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 8px;
}

.mm-comments__head-hint {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.mm-comments__state { padding: 24px 0; }

.mm-comments__list { list-style: none; margin: 0; padding: 0; }

.mm-comment { padding: 18px 0; border-bottom: 1px solid var(--mm-rule); }
.mm-comment:last-child { border-bottom: 0; }

.mm-comment__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.mm-comment__author {
  font-family: var(--mm-font-display);
  font-size: 14px;
  font-weight: 500;
  color: var(--mm-ink);
}

.mm-comment__author:hover { color: var(--mm-accent); }

.mm-comment__meta-right { display: flex; align-items: center; gap: 10px; }

.mm-comment__body {
  font-family: var(--mm-font-display);
  font-size: 14px;
  line-height: 1.55;
  color: var(--mm-ink);
}

.mm-comment__body :deep(p) { margin: 0 0 8px; }
.mm-comment__body :deep(p:last-child) { margin-bottom: 0; }
.mm-comment__body :deep(a) { color: var(--mm-accent); text-decoration: underline; text-underline-offset: 3px; }
.mm-comment__body :deep(img) { max-width: 100%; height: auto; border: 1px solid var(--mm-rule); }
.mm-comment__body :deep(ul),
.mm-comment__body :deep(ol) { padding-left: 22px; margin: 0 0 8px; }
.mm-comment__body :deep(blockquote) {
  margin: 0 0 8px;
  padding-left: 12px;
  border-left: 2px solid var(--mm-rule-strong);
  color: var(--mm-ink-soft);
}

.mm-comment__edit { display: flex; flex-direction: column; gap: 8px; }

.mm-comment__editor { border: 1px solid var(--mm-rule); border-radius: 2px; }

.mm-comment__toolbar {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
}

.mm-comment__tool {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  background: transparent;
  border: 0;
  padding: 3px 8px;
  cursor: pointer;
  color: var(--mm-ink-muted);
  border-radius: 2px;
}

.mm-comment__tool:hover { color: var(--mm-ink); background: var(--mm-bg); }
.mm-comment__tool.is-active { color: var(--mm-ink); background: var(--mm-bg); }

.mm-comment__editor-content {
  padding: 10px 12px;
  min-height: 90px;
  font-family: var(--mm-font-display);
  font-size: 14px;
  color: var(--mm-ink);
}

.mm-comment__editor-content :deep(.mm-comment__editor-input) {
  outline: 0;
  min-height: 70px;
}

.mm-comment__editor-content :deep(p.is-editor-empty:first-child::before) {
  content: 'Write a comment…';
  color: var(--mm-ink-faint);
  pointer-events: none;
  height: 0;
  float: left;
}

.mm-comment__form-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 6px;
}

.mm-comment__form-foot-right { display: flex; align-items: center; gap: 12px; }

.mm-comment__error {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-danger);
}

.mm-comments__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 18px 0;
}

.mm-comments__input { padding: 18px 0 0; }

.mm-comments__notice {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  color: var(--mm-ink-soft);
  padding: 8px 0;
}

.mm-comments__form { display: flex; flex-direction: column; gap: 12px; }

.mm-comments__profile-row { display: flex; align-items: center; gap: 12px; }

.mm-comments__select {
  font-family: var(--mm-font-display);
  font-size: 13px;
  padding: 5px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  min-width: 180px;
}

.mm-btn--inline {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 3px 8px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-btn--inline:hover:not(:disabled) {
  border-color: var(--mm-ink);
  color: var(--mm-ink);
}

.mm-btn--danger:hover:not(:disabled) {
  border-color: var(--mm-danger);
  color: var(--mm-danger);
}

@media (max-width: 720px) {
  .mm-comment__meta { gap: 8px; }
  .mm-comments__profile-row { flex-wrap: wrap; }
  .mm-comments__select { min-width: 0; flex: 1; }
}
</style>
