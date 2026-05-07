<template>
  <div class="pc-card">
    <div class="pc-card-header">
      <h3 class="pc-card-title">
        COMMENTS
      </h3>
      <p class="pc-card-subtitle">
        COMMUNITY NOTES ON THIS SERVER
      </p>
    </div>
    <div class="pc-card-body">
      <!-- Comment list -->
      <div
        v-if="loading"
        class="pc-center pc-py"
      >
        <div class="pc-spinner" />
      </div>

      <div
        v-else-if="error"
        class="pc-error-text pc-py"
      >
        FAILED TO LOAD COMMENTS.
      </div>

      <div
        v-else-if="comments.length === 0"
        class="pc-muted-text pc-py"
      >
        NO COMMENTS YET. BE THE FIRST.
      </div>

      <div
        v-else
        class="pc-comment-list"
      >
        <div
          v-for="comment in comments"
          :key="comment.id"
          class="pc-comment"
        >
          <div class="pc-comment-meta">
            <router-link
              :to="`/players/${encodeURIComponent(comment.authorPlayerName)}`"
              class="pc-author-link"
            >
              {{ $pn(comment.authorPlayerName) }}
            </router-link>
            <div class="pc-comment-meta-right">
              <span
                v-if="comment.updatedAt !== comment.createdAt"
                class="pc-edited-tag"
              >EDITED</span>
              <span class="pc-timestamp">{{ formatDate(comment.createdAt) }}</span>
              <template v-if="canEdit(comment)">
                <button
                  class="pc-btn pc-btn-ghost pc-btn-sm"
                  @click="startEdit(comment)"
                >
                  EDIT
                </button>
                <button
                  class="pc-btn pc-btn-danger pc-btn-sm"
                  @click="deleteComment(comment.id)"
                >
                  DEL
                </button>
              </template>
            </div>
          </div>

          <!-- Inline edit form -->
          <div
            v-if="editingId === comment.id"
            class="pc-edit-form"
          >
            <div class="pc-editor-wrapper">
              <div class="pc-toolbar">
                <button
                  type="button"
                  class="pc-tool"
                  :class="{ active: editEditorTick && editEditor?.isActive('bold') }"
                  title="Bold"
                  @click="editEditor?.chain().focus().toggleBold().run()"
                >
                  <strong>B</strong>
                </button>
                <button
                  type="button"
                  class="pc-tool"
                  :class="{ active: editEditorTick && editEditor?.isActive('italic') }"
                  title="Italic"
                  @click="editEditor?.chain().focus().toggleItalic().run()"
                >
                  <em>I</em>
                </button>
                <button
                  type="button"
                  class="pc-tool"
                  :class="{ active: editEditorTick && editEditor?.isActive('underline') }"
                  title="Underline"
                  @click="editEditor?.chain().focus().toggleUnderline().run()"
                >
                  <u>U</u>
                </button>
                <button
                  type="button"
                  class="pc-tool"
                  :class="{ active: editEditorTick && editEditor?.isActive('link') }"
                  title="Link"
                  @click="toggleLink(editEditor)"
                >
                  🔗
                </button>
                <button
                  type="button"
                  class="pc-tool"
                  title="Image"
                  @click="insertImage(editEditor)"
                >
                  🖼
                </button>
              </div>
              <editor-content
                :editor="editEditor ?? undefined"
                class="pc-editor-content"
              />
            </div>
            <div class="pc-form-footer">
              <span class="pc-hint">Markdown not used — use toolbar for formatting</span>
              <div class="pc-form-footer-right">
                <span
                  v-if="editError"
                  class="pc-error-text"
                >{{ editError }}</span>
                <button
                  class="pc-btn pc-btn-ghost pc-btn-sm"
                  :disabled="editSaving"
                  @click="cancelEdit"
                >
                  CANCEL
                </button>
                <button
                  class="pc-btn pc-btn-primary pc-btn-sm"
                  :disabled="editSaving"
                  @click="saveEdit(comment.id)"
                >
                  {{ editSaving ? 'SAVING…' : 'SAVE' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Rendered content -->
          <div
            v-else
            class="pc-comment-body"
            v-html="sanitize(comment.content)"
          />
        </div>
      </div>

      <!-- Pagination -->
      <div
        v-if="totalPages > 1"
        class="pc-pagination"
      >
        <button
          class="pc-btn pc-btn-ghost pc-btn-sm"
          :disabled="currentPage <= 1 || loading"
          @click="goToPage(currentPage - 1)"
        >
          &#8249;
        </button>
        <span class="pc-page-label">{{ currentPage }} / {{ totalPages }}</span>
        <button
          class="pc-btn pc-btn-ghost pc-btn-sm"
          :disabled="currentPage >= totalPages || loading"
          @click="goToPage(currentPage + 1)"
        >
          &#8250;
        </button>
      </div>

      <!-- Input area -->
      <div class="pc-input-area">
        <!-- Not logged in -->
        <div
          v-if="!isAuthenticated"
          class="pc-muted-text"
        >
          <button
            class="pc-link"
            @click="handleSignIn"
          >
            SIGN IN
          </button>
          <span class="ml-1">to leave a comment.</span>
        </div>

        <!-- Logged in but no linked player profiles -->
        <div
          v-else-if="linkedProfiles.length === 0"
          class="pc-muted-text"
        >
          Link a player profile on your
          <router-link
            to="/dashboard"
            class="pc-link"
          >
            DASHBOARD
          </router-link>
          to post comments.
        </div>

        <!-- Logged in with profiles -->
        <form
          v-else
          class="pc-form"
          @submit.prevent="submitComment"
        >
          <!-- Profile selector -->
          <div class="pc-profile-row">
            <span class="pc-label">POST AS</span>
            <select
              v-model="selectedProfile"
              class="pc-select"
              :disabled="submitting"
            >
              <option
                v-for="p in linkedProfiles"
                :key="p.id"
                :value="p.playerName"
              >
                {{ $pn(p.playerName) }}
              </option>
            </select>
          </div>

          <!-- Rich text editor -->
          <div class="pc-editor-wrapper">
            <div class="pc-toolbar">
              <button
                type="button"
                class="pc-tool"
                :class="{ active: newEditor?.isActive('bold') }"
                title="Bold"
                @click="newEditor?.chain().focus().toggleBold().run()"
              >
                <strong>B</strong>
              </button>
              <button
                type="button"
                class="pc-tool"
                :class="{ active: newEditor?.isActive('italic') }"
                title="Italic"
                @click="newEditor?.chain().focus().toggleItalic().run()"
              >
                <em>I</em>
              </button>
              <button
                type="button"
                class="pc-tool"
                :class="{ active: newEditor?.isActive('underline') }"
                title="Underline"
                @click="newEditor?.chain().focus().toggleUnderline().run()"
              >
                <u>U</u>
              </button>
              <button
                type="button"
                class="pc-tool"
                :class="{ active: newEditor?.isActive('link') }"
                title="Link"
                @click="toggleLink(newEditor)"
              >
                🔗
              </button>
              <button
                type="button"
                class="pc-tool"
                title="Image"
                @click="insertImage(newEditor)"
              >
                🖼
              </button>
            </div>
            <editor-content
              :editor="newEditor"
              class="pc-editor-content"
            />
          </div>

          <!-- Footer row -->
          <div class="pc-form-footer">
            <span class="pc-hint">Bold · Italic · Underline · Links · Images</span>
            <div class="pc-form-footer-right">
              <span
                v-if="submitError"
                class="pc-error-text"
              >{{ submitError }}</span>
              <button
                type="submit"
                class="pc-btn pc-btn-primary"
                :disabled="submitting || isEditorEmpty(newEditor)"
              >
                {{ submitting ? 'POSTING…' : 'POST' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue';
import DOMPurify from 'dompurify';
import axios from 'axios';
import { useEditor, EditorContent, Editor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { useAuth } from '@/composables/useAuth';
import { formatRelativeTime } from '@/utils/timeUtils';
import { statsService } from '@/services/statsService';

const props = defineProps<{ serverName: string }>();

const { isAuthenticated, loginWithDiscord } = useAuth();

interface ServerComment {
  id: number;
  serverName: string;
  content: string;
  authorPlayerName: string;
  createdAt: string;
  updatedAt: string;
}

interface PagedComments {
  items: ServerComment[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface LinkedProfile { id: number; playerName: string; }

const ALLOWED_TAGS = ['p', 'strong', 'em', 'u', 'a', 'img', 'ul', 'ol', 'li', 'br', 'blockquote'];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'target', 'rel'];

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORCE_BODY: false,
  });
}

const tiptapExtensions = [
  StarterKit.configure({ heading: false, codeBlock: false, code: false, horizontalRule: false }),
  Underline,
  Link.configure({ openOnClick: false, autolink: true }),
  Image.configure({ inline: false }),
];

// New comment editor
const newEditor = useEditor({
  extensions: tiptapExtensions,
  editorProps: { attributes: { class: 'pc-editor' } },
});

// Edit editor (created/destroyed per-comment).
// Must use shallowRef — deep reactive wrapping of a Tiptap Editor hangs ProseMirror.
const editEditor = shallowRef<Editor | null>(null);
// Bumped on every transaction so toolbar active states re-render.
const editEditorTick = ref(0);

const comments = ref<ServerComment[]>([]);
const currentPage = ref(1);
const totalPages = ref(1);
const totalCount = ref(0);
const loading = ref(true);
const error = ref(false);
const submitting = ref(false);
const submitError = ref('');
const linkedProfiles = ref<LinkedProfile[]>([]);
const selectedProfile = ref('');
const editingId = ref<number | null>(null);
const editSaving = ref(false);
const editError = ref('');

function formatDate(iso: string) { return formatRelativeTime(iso); }

function canEdit(comment: ServerComment) {
  return isAuthenticated.value && linkedProfiles.value.some(p => p.playerName === comment.authorPlayerName);
}

function isEditorEmpty(editor: Editor | null | undefined): boolean {
  return !editor || editor.isEmpty;
}

function toggleLink(editor: Editor | null | undefined) {
  if (!editor) return;
  if (editor.isActive('link')) {
    editor.chain().focus().unsetLink().run();
  } else {
    const url = window.prompt('URL');
    if (url) editor.chain().focus().setLink({ href: url, target: '_blank', rel: 'noopener noreferrer' }).run();
  }
}

function insertImage(editor: Editor | null | undefined) {
  if (!editor) return;
  const url = window.prompt('Image URL (https only)');
  if (url && url.startsWith('https://')) editor.chain().focus().setImage({ src: url }).run();
}

function startEdit(comment: ServerComment) {
  cancelEdit();
  editingId.value = comment.id;
  editError.value = '';
  editEditor.value = new Editor({
    extensions: tiptapExtensions,
    content: comment.content,
    editorProps: { attributes: { class: 'pc-editor' } },
    onTransaction: () => { editEditorTick.value++; },
  });
}

function cancelEdit() {
  editEditor.value?.destroy();
  editEditor.value = null;
  editingId.value = null;
  editError.value = '';
}

async function loadComments(page = currentPage.value) {
  loading.value = true;
  error.value = false;
  try {
    const r = await axios.get<PagedComments>(
      `/stats/servers/${encodeURIComponent(props.serverName)}/comments`,
      { params: { page, pageSize: 10 } }
    );
    comments.value = r.data.items;
    currentPage.value = r.data.page;
    totalPages.value = r.data.totalPages;
    totalCount.value = r.data.totalCount;
  } catch { error.value = true; }
  finally { loading.value = false; }
}

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return;
  cancelEdit();
  loadComments(page);
}

async function loadLinkedProfiles() {
  if (!isAuthenticated.value) return;
  try {
    const profile = await statsService.getUserProfile();
    linkedProfiles.value = profile.playerNames.map(p => ({ id: p.id, playerName: p.playerName }));
    if (linkedProfiles.value.length > 0) selectedProfile.value = linkedProfiles.value[0].playerName;
  } catch { /* not critical */ }
}

async function handleSignIn() {
  try { await loginWithDiscord(); } catch { /* handled by auth service */ }
}

async function submitComment() {
  if (!newEditor.value || newEditor.value.isEmpty) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const token = localStorage.getItem('authToken');
    const html = newEditor.value.getHTML();
    await axios.post<ServerComment>(
      `/stats/servers/${encodeURIComponent(props.serverName)}/comments`,
      { content: html, authorPlayerName: selectedProfile.value },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    newEditor.value.commands.clearContent();
    await loadComments(1);
  } catch (err: any) {
    submitError.value = err?.response?.data?.message ?? 'Failed to post comment.';
  } finally { submitting.value = false; }
}

async function saveEdit(commentId: number) {
  if (!editEditor.value || editEditor.value.isEmpty) return;
  editSaving.value = true;
  editError.value = '';
  try {
    const token = localStorage.getItem('authToken');
    const comment = comments.value.find(c => c.id === commentId)!;
    const html = editEditor.value.getHTML();
    await axios.patch<ServerComment>(
      `/stats/servers/${encodeURIComponent(props.serverName)}/comments/${commentId}`,
      { content: html, authorPlayerName: comment.authorPlayerName },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    cancelEdit();
    await loadComments(currentPage.value);
  } catch (err: any) {
    editError.value = err?.response?.data?.message ?? 'Failed to save.';
  } finally { editSaving.value = false; }
}

async function deleteComment(commentId: number) {
  const token = localStorage.getItem('authToken');
  try {
    await axios.delete(
      `/stats/servers/${encodeURIComponent(props.serverName)}/comments/${commentId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (editingId.value === commentId) cancelEdit();
    // If this was the last item on the page, go back one page
    const newPage = comments.value.length === 1 && currentPage.value > 1
      ? currentPage.value - 1
      : currentPage.value;
    await loadComments(newPage);
  } catch { /* silently ignore */ }
}

onMounted(() => { loadComments(); loadLinkedProfiles(); });
onBeforeUnmount(() => { newEditor.value?.destroy(); cancelEdit(); });
</script>

<style scoped>
/* ── Card ────────────────────────────────────────────────────────────────── */
.pc-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.3s ease;
}
.pc-card:hover {
  border-color: rgba(245, 158, 11, 0.3);
  box-shadow: 0 0 30px rgba(245, 158, 11, 0.1);
}
.pc-card-header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
  background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%);
}
.pc-card-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--neon-cyan);
  margin: 0;
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
}
.pc-card-subtitle {
  font-size: 0.625rem;
  color: var(--text-muted, #737373);
  font-family: 'JetBrains Mono', monospace;
  margin-top: 0.25rem;
}
.pc-card-body { padding: 0.75rem; }
@media (min-width: 640px) { .pc-card-body { padding: 1rem; } }

/* ── Layout helpers ──────────────────────────────────────────────────────── */
.pc-py { padding: 0.5rem 0; }
.pc-center { display: flex; align-items: center; justify-content: center; }
.pc-comment-list { display: flex; flex-direction: column; gap: 0; }

/* ── Spinner ─────────────────────────────────────────────────────────────── */
.pc-spinner {
  width: 1.25rem; height: 1.25rem;
  border: 2px solid var(--border-color);
  border-top-color: var(--neon-cyan);
  border-radius: 50%;
  animation: pc-spin 0.8s linear infinite;
}
@keyframes pc-spin { to { transform: rotate(360deg); } }

/* ── Text helpers ─────────────────────────────────────────────────────────── */
.pc-muted-text { font-size: 0.8rem; color: var(--text-muted, #737373); font-family: 'JetBrains Mono', monospace; }
.pc-error-text { font-size: 0.75rem; color: #f87171; font-family: 'JetBrains Mono', monospace; }
.pc-link { color: var(--neon-cyan); font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; text-decoration: underline; background: none; border: none; cursor: pointer; padding: 0; }
.pc-link:hover { color: #00ffff; }

/* ── Comments ────────────────────────────────────────────────────────────── */
.pc-comment {
  padding: 0.625rem 0.75rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
  margin-bottom: 0.5rem;
  transition: background 0.2s;
}
.pc-comment:hover { background: rgba(255, 255, 255, 0.05); }
.pc-comment:last-child { margin-bottom: 0; }

.pc-comment-meta {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.5rem; margin-bottom: 0.375rem;
}
.pc-comment-meta-right { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
.pc-author-link {
  font-size: 0.75rem; font-family: 'JetBrains Mono', monospace; font-weight: 700;
  color: var(--neon-cyan); text-decoration: none; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.pc-author-link:hover { color: #00ffff; text-decoration: underline; }
.pc-timestamp { font-size: 0.6rem; color: var(--text-muted, #737373); font-family: 'JetBrains Mono', monospace; }
.pc-edited-tag { font-size: 0.6rem; color: var(--text-muted, #737373); font-family: 'JetBrains Mono', monospace; font-style: italic; }

/* ── Comment body (rendered HTML) ───────────────────────────────────────── */
.pc-comment-body { font-size: 0.875rem; color: #d4d4d4; line-height: 1.55; }
.pc-comment-body :deep(p) { margin-bottom: 0.4rem; }
.pc-comment-body :deep(p:last-child) { margin-bottom: 0; }
.pc-comment-body :deep(a) { color: var(--neon-cyan); text-decoration: underline; }
.pc-comment-body :deep(strong) { color: #e5e5e5; font-weight: 700; }
.pc-comment-body :deep(em) { opacity: 0.85; }
.pc-comment-body :deep(u) { text-decoration: underline; }
.pc-comment-body :deep(ul), .pc-comment-body :deep(ol) { margin-left: 1.25rem; margin-bottom: 0.4rem; }
.pc-comment-body :deep(blockquote) { border-left: 3px solid var(--neon-cyan, #00e5ff); padding-left: 0.75rem; opacity: 0.85; margin: 0 0 0.4rem; }
.pc-comment-body :deep(img) { max-width: 100%; border-radius: 4px; margin-top: 0.25rem; }

/* ── Pagination ──────────────────────────────────────────────────────────── */
.pc-pagination {
  display: flex; align-items: center; justify-content: center; gap: 0.75rem;
  padding: 0.5rem 0 0.25rem;
}
.pc-page-label { font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; color: var(--text-muted, #737373); }

/* ── Input area ──────────────────────────────────────────────────────────── */
.pc-input-area { border-top: 1px solid var(--border-color); padding-top: 0.875rem; margin-top: 0.75rem; }
.pc-form { display: flex; flex-direction: column; gap: 0.625rem; }
.pc-profile-row { display: flex; align-items: center; gap: 0.5rem; }
.pc-label { font-size: 0.625rem; font-family: 'JetBrains Mono', monospace; color: var(--text-muted, #737373); white-space: nowrap; }
.pc-select {
  flex: 1; padding: 0.35rem 0.5rem; font-size: 0.8rem; font-family: 'JetBrains Mono', monospace;
  background: var(--bg-card, #0d0d18); border: 1px solid var(--border-color); border-radius: 4px;
  color: var(--text-primary, #e5e5e5); cursor: pointer; transition: border-color 0.2s;
}
.pc-select:focus { outline: none; border-color: var(--neon-cyan); }
.pc-select:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Tiptap editor wrapper ───────────────────────────────────────────────── */
.pc-editor-wrapper {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  overflow: hidden;
  transition: border-color 0.2s;
}
.pc-editor-wrapper:focus-within { border-color: var(--neon-cyan); }

.pc-toolbar {
  display: flex; gap: 2px; padding: 0.3rem 0.4rem;
  background: rgba(0,0,0,0.3); border-bottom: 1px solid var(--border-color);
}
.pc-tool {
  padding: 0.2rem 0.45rem; font-size: 0.8rem; min-width: 1.75rem; text-align: center;
  background: transparent; border: 1px solid transparent; border-radius: 3px;
  color: var(--text-secondary, #a3a3a3); cursor: pointer; transition: all 0.15s;
  font-family: inherit; line-height: 1.4;
}
.pc-tool:hover { background: rgba(255,255,255,0.08); color: var(--text-primary, #e5e5e5); }
.pc-tool.active { background: rgba(0, 229, 255, 0.15); color: var(--neon-cyan); border-color: rgba(0,229,255,0.3); }

.pc-editor-content { background: var(--bg-card, #0d0d18); }
.pc-editor-content :deep(.pc-editor) {
  min-height: 5rem; padding: 0.625rem 0.75rem;
  font-size: 0.875rem; color: var(--text-primary, #e5e5e5);
  font-family: inherit; line-height: 1.55; outline: none;
}
.pc-editor-content :deep(.pc-editor p) { margin-bottom: 0.4rem; }
.pc-editor-content :deep(.pc-editor p:last-child) { margin-bottom: 0; }
.pc-editor-content :deep(.pc-editor a) { color: var(--neon-cyan); text-decoration: underline; }
.pc-editor-content :deep(.pc-editor img) { max-width: 100%; border-radius: 4px; }
.pc-editor-content :deep(.ProseMirror-focused) { outline: none; }
.pc-editor-content :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: var(--text-muted, #737373);
  pointer-events: none;
  float: left;
  height: 0;
}

/* ── Edit form ───────────────────────────────────────────────────────────── */
.pc-edit-form { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.25rem; }

/* ── Form footer ─────────────────────────────────────────────────────────── */
.pc-form-footer { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
.pc-form-footer-right { display: flex; align-items: center; gap: 0.5rem; }
.pc-hint { font-size: 0.6rem; color: var(--text-muted, #737373); font-family: 'JetBrains Mono', monospace; }

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.pc-btn {
  padding: 0.35rem 0.75rem; font-size: 0.75rem; font-weight: 600;
  letter-spacing: 0.04em; font-family: 'JetBrains Mono', monospace;
  border-radius: 4px; cursor: pointer; transition: all 0.2s ease;
  border: 1px solid transparent; text-transform: uppercase; line-height: 1.4;
}
.pc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pc-btn-primary { background: var(--neon-cyan); color: var(--bg-dark, #0a0a0f); border-color: var(--neon-cyan); }
.pc-btn-primary:hover:not(:disabled) { background: #00ffff; border-color: #00ffff; box-shadow: 0 0 16px rgba(0,229,255,0.4); }
.pc-btn-ghost { background: transparent; color: var(--text-secondary, #a3a3a3); border-color: var(--border-color); }
.pc-btn-ghost:hover:not(:disabled) { color: var(--text-primary, #e5e5e5); border-color: var(--neon-cyan); }
.pc-btn-danger { background: transparent; color: #f87171; border-color: var(--border-color); }
.pc-btn-danger:hover:not(:disabled) { color: #fca5a5; border-color: #f87171; }
.pc-btn-sm { padding: 0.2rem 0.5rem; font-size: 0.65rem; }
</style>
