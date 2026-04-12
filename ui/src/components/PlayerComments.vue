<template>
  <div class="pc-card">
    <div class="pc-card-header">
      <h3 class="pc-card-title">COMMENTS</h3>
      <p class="pc-card-subtitle">COMMUNITY NOTES ON THIS PLAYER</p>
    </div>
    <div class="pc-card-body pc-space-y">

      <!-- Comment list -->
      <div v-if="loading" class="pc-center py-6">
        <div class="pc-spinner" />
      </div>

      <div v-else-if="error" class="pc-error-text">
        FAILED TO LOAD COMMENTS.
      </div>

      <div v-else-if="comments.length === 0" class="pc-muted-text">
        NO COMMENTS YET. BE THE FIRST.
      </div>

      <div v-else class="pc-space-y">
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
              {{ comment.authorPlayerName }}
            </router-link>
            <div class="pc-comment-meta-right">
              <span v-if="comment.updatedAt !== comment.createdAt" class="pc-timestamp pc-edited-tag">EDITED</span>
              <span class="pc-timestamp">{{ formatDate(comment.createdAt) }}</span>
              <template v-if="canDelete(comment)">
                <button
                  class="pc-btn pc-btn-ghost pc-btn-sm"
                  title="Edit comment"
                  @click="startEdit(comment)"
                >
                  EDIT
                </button>
                <button
                  class="pc-btn pc-btn-danger pc-btn-sm"
                  title="Delete comment"
                  @click="deleteComment(comment.id)"
                >
                  DEL
                </button>
              </template>
            </div>
          </div>

          <!-- Inline edit form -->
          <div v-if="editingId === comment.id" class="pc-edit-form">
            <textarea
              v-model="editContent"
              class="pc-textarea"
              :disabled="editSaving"
            />
            <div class="pc-form-footer">
              <span class="pc-hint">{{ editContent.length }}/2000</span>
              <div class="pc-form-footer-right">
                <span v-if="editError" class="pc-error-text">{{ editError }}</span>
                <button class="pc-btn pc-btn-ghost pc-btn-sm" :disabled="editSaving" @click="cancelEdit">CANCEL</button>
                <button
                  class="pc-btn pc-btn-primary pc-btn-sm"
                  :disabled="editSaving || !editContent.trim()"
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
            class="pc-markdown"
            v-html="renderMarkdown(comment.content)"
          />
        </div>
      </div>

      <!-- Input area -->
      <div class="pc-input-area">

        <!-- Not logged in -->
        <div v-if="!isAuthenticated" class="pc-muted-text">
          <router-link to="/dashboard" class="pc-link">SIGN IN</router-link>
          <span class="ml-1">to leave a comment.</span>
        </div>

        <!-- Logged in but no linked player profiles -->
        <div v-else-if="linkedProfiles.length === 0" class="pc-muted-text">
          Link a player profile on your
          <router-link to="/dashboard" class="pc-link">DASHBOARD</router-link>
          to post comments.
        </div>

        <!-- Logged in with profiles -->
        <form v-else @submit.prevent="submitComment" class="pc-form">
          <!-- Profile selector -->
          <div class="pc-profile-row">
            <span class="pc-label">POST AS</span>
            <select
              v-model="selectedProfile"
              class="pc-select"
              :disabled="submitting"
            >
              <option v-for="p in linkedProfiles" :key="p.id" :value="p.playerName">
                {{ p.playerName }}
              </option>
            </select>
          </div>

          <!-- Textarea -->
          <textarea
            v-model="newComment"
            class="pc-textarea"
            placeholder="Write a comment… (Markdown supported)"
            :disabled="submitting"
            maxlength="2000"
          />

          <!-- Footer row -->
          <div class="pc-form-footer">
            <span class="pc-hint">{{ newComment.length }}/2000 · Markdown supported</span>
            <div class="pc-form-footer-right">
              <span v-if="submitError" class="pc-error-text">{{ submitError }}</span>
              <button
                type="submit"
                class="pc-btn pc-btn-primary"
                :disabled="submitting || !newComment.trim()"
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
import { ref, onMounted } from 'vue';
import { marked } from 'marked';
import axios from 'axios';
import { useAuth } from '@/composables/useAuth';
import { formatRelativeTime } from '@/utils/timeUtils';
import { statsService } from '@/services/statsService';

const props = defineProps<{
  playerName: string;
}>();

const { isAuthenticated } = useAuth();

interface PlayerComment {
  id: number;
  playerName: string;
  content: string;
  authorPlayerName: string;
  createdAt: string;
  updatedAt: string;
}

interface LinkedProfile {
  id: number;
  playerName: string;
}

const comments = ref<PlayerComment[]>([]);
const loading = ref(true);
const error = ref(false);
const newComment = ref('');
const submitting = ref(false);
const submitError = ref('');
const linkedProfiles = ref<LinkedProfile[]>([]);
const selectedProfile = ref('');

// Edit state
const editingId = ref<number | null>(null);
const editContent = ref('');
const editSaving = ref(false);
const editError = ref('');

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(content: string): string {
  return marked.parse(content) as string;
}

function formatDate(isoString: string): string {
  return formatRelativeTime(isoString);
}

function canDelete(comment: PlayerComment): boolean {
  if (!isAuthenticated.value) return false;
  return linkedProfiles.value.some(p => p.playerName === comment.authorPlayerName);
}

async function loadComments() {
  loading.value = true;
  error.value = false;
  try {
    const response = await axios.get<PlayerComment[]>(
      `/stats/players/${encodeURIComponent(props.playerName)}/comments`
    );
    comments.value = response.data;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}

async function loadLinkedProfiles() {
  if (!isAuthenticated.value) return;
  try {
    const profile = await statsService.getUserProfile();
    linkedProfiles.value = profile.playerNames.map(p => ({ id: p.id, playerName: p.playerName }));
    if (linkedProfiles.value.length > 0) {
      selectedProfile.value = linkedProfiles.value[0].playerName;
    }
  } catch {
    // Not critical — leave empty
  }
}

async function submitComment() {
  if (!newComment.value.trim() || !selectedProfile.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const token = localStorage.getItem('authToken');
    const response = await axios.post<PlayerComment>(
      `/stats/players/${encodeURIComponent(props.playerName)}/comments`,
      { content: newComment.value.trim(), authorPlayerName: selectedProfile.value },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    comments.value.push(response.data);
    newComment.value = '';
  } catch (err: any) {
    submitError.value = err?.response?.data?.message ?? 'Failed to post comment.';
  } finally {
    submitting.value = false;
  }
}

function startEdit(comment: PlayerComment) {
  editingId.value = comment.id;
  editContent.value = comment.content;
  editError.value = '';
}

function cancelEdit() {
  editingId.value = null;
  editContent.value = '';
  editError.value = '';
}

async function saveEdit(commentId: number) {
  if (!editContent.value.trim()) return;
  editSaving.value = true;
  editError.value = '';
  try {
    const token = localStorage.getItem('authToken');
    const comment = comments.value.find(c => c.id === commentId)!;
    const response = await axios.patch<PlayerComment>(
      `/stats/players/${encodeURIComponent(props.playerName)}/comments/${commentId}`,
      { content: editContent.value.trim(), authorPlayerName: comment.authorPlayerName },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const idx = comments.value.findIndex(c => c.id === commentId);
    if (idx !== -1) comments.value[idx] = response.data;
    cancelEdit();
  } catch (err: any) {
    editError.value = err?.response?.data?.message ?? 'Failed to save.';
  } finally {
    editSaving.value = false;
  }
}

async function deleteComment(commentId: number) {
  const token = localStorage.getItem('authToken');
  try {
    await axios.delete(
      `/stats/players/${encodeURIComponent(props.playerName)}/comments/${commentId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    comments.value = comments.value.filter(c => c.id !== commentId);
  } catch {
    // silently ignore
  }
}

onMounted(() => {
  loadComments();
  loadLinkedProfiles();
});
</script>

<style scoped>
/* ── Card shell ─────────────────────────────────────────────────────────── */
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
.pc-card-body {
  padding: 0.75rem;
}
@media (min-width: 640px) {
  .pc-card-body { padding: 1rem; }
}

/* ── Layout helpers ──────────────────────────────────────────────────────── */
.pc-space-y > * + * { margin-top: 0.75rem; }
.pc-center { display: flex; align-items: center; justify-content: center; }

/* ── Spinner ─────────────────────────────────────────────────────────────── */
.pc-spinner {
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid var(--border-color);
  border-top-color: var(--neon-cyan);
  border-radius: 50%;
  animation: pc-spin 0.8s linear infinite;
}
@keyframes pc-spin { to { transform: rotate(360deg); } }

/* ── Text helpers ────────────────────────────────────────────────────────── */
.pc-muted-text {
  font-size: 0.8rem;
  color: var(--text-muted, #737373);
  font-family: 'JetBrains Mono', monospace;
  padding: 0.25rem 0;
}
.pc-error-text {
  font-size: 0.75rem;
  color: #f87171;
  font-family: 'JetBrains Mono', monospace;
}
.pc-link {
  color: var(--neon-cyan);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  text-decoration: underline;
}
.pc-link:hover { color: #00ffff; }

/* ── Individual comment ──────────────────────────────────────────────────── */
.pc-comment {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.75rem;
  background: var(--bg-panel);
}
.pc-comment-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.pc-comment-meta-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}
.pc-author-link {
  font-size: 0.75rem;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  color: var(--neon-cyan);
  text-decoration: none;
  truncate: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.pc-author-link:hover { color: #00ffff; text-decoration: underline; }
.pc-timestamp {
  font-size: 0.625rem;
  color: var(--text-muted, #737373);
  font-family: 'JetBrains Mono', monospace;
}

/* ── Markdown content ────────────────────────────────────────────────────── */
.pc-markdown { font-size: 0.875rem; color: #d4d4d4; line-height: 1.5; }
.pc-markdown :deep(p) { margin-bottom: 0.5rem; }
.pc-markdown :deep(p:last-child) { margin-bottom: 0; }
.pc-markdown :deep(a) { color: var(--neon-cyan); text-decoration: underline; }
.pc-markdown :deep(ul), .pc-markdown :deep(ol) { margin-left: 1.25rem; margin-bottom: 0.5rem; }
.pc-markdown :deep(code) {
  background: rgba(0,0,0,0.3);
  padding: 0.1rem 0.3rem;
  border-radius: 0.2rem;
  font-size: 0.85em;
}
.pc-markdown :deep(blockquote) {
  border-left: 3px solid var(--neon-cyan, #00e5ff);
  padding-left: 0.75rem;
  opacity: 0.85;
  margin-left: 0;
  margin-bottom: 0.5rem;
}
.pc-markdown :deep(strong) { color: #e5e5e5; }

/* ── Input area ──────────────────────────────────────────────────────────── */
.pc-input-area {
  border-top: 1px solid var(--border-color);
  padding-top: 1rem;
  margin-top: 0.75rem;
}
.pc-form { display: flex; flex-direction: column; gap: 0.625rem; }
.pc-profile-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.pc-label {
  font-size: 0.625rem;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-muted, #737373);
  white-space: nowrap;
}
.pc-select {
  flex: 1;
  padding: 0.35rem 0.5rem;
  font-size: 0.8rem;
  font-family: 'JetBrains Mono', monospace;
  background: var(--bg-card, #0d0d18);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary, #e5e5e5);
  cursor: pointer;
  transition: border-color 0.2s;
}
.pc-select:focus {
  outline: none;
  border-color: var(--neon-cyan);
  box-shadow: 0 0 15px rgba(245, 158, 11, 0.2);
}
.pc-select:disabled { opacity: 0.5; cursor: not-allowed; }

.pc-textarea {
  width: 100%;
  height: 6rem;
  resize: none;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  background: var(--bg-card, #0d0d18);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary, #e5e5e5);
  padding: 0.625rem 0.75rem;
  transition: border-color 0.2s;
}
.pc-textarea::placeholder { color: var(--text-muted, #737373); }
.pc-textarea:focus {
  outline: none;
  border-color: var(--neon-cyan);
  box-shadow: 0 0 15px rgba(245, 158, 11, 0.2);
}
.pc-textarea:disabled { opacity: 0.5; cursor: not-allowed; }

.pc-form-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.pc-form-footer-right { display: flex; align-items: center; gap: 0.5rem; }
.pc-hint {
  font-size: 0.625rem;
  color: var(--text-muted, #737373);
  font-family: 'JetBrains Mono', monospace;
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.pc-btn {
  padding: 0.35rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  font-family: 'JetBrains Mono', monospace;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
  text-transform: uppercase;
  line-height: 1.4;
}
.pc-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.pc-btn-primary {
  background: var(--neon-cyan);
  color: var(--bg-dark, #0a0a0f);
  border-color: var(--neon-cyan);
}
.pc-btn-primary:hover:not(:disabled) {
  background: #00ffff;
  border-color: #00ffff;
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.4);
}

.pc-btn-danger {
  background: transparent;
  color: #f87171;
  border-color: var(--border-color);
}
.pc-btn-danger:hover:not(:disabled) {
  color: #fca5a5;
  border-color: #f87171;
}

.pc-btn-sm { padding: 0.2rem 0.5rem; font-size: 0.65rem; }

.pc-btn-ghost {
  background: transparent;
  color: var(--text-secondary, #a3a3a3);
  border-color: var(--border-color);
}
.pc-btn-ghost:hover:not(:disabled) {
  color: var(--text-primary, #e5e5e5);
  border-color: var(--neon-cyan);
}

.pc-edited-tag {
  color: var(--text-muted, #737373);
  font-style: italic;
  font-size: 0.6rem;
}

.pc-edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
</style>
