<template>
  <div class="explorer-card">
    <div class="explorer-card-header">
      <h3 class="explorer-card-title">COMMENTS</h3>
      <p class="text-[10px] text-neutral-500 font-mono mt-1">COMMUNITY NOTES ON THIS PLAYER</p>
    </div>
    <div class="explorer-card-body space-y-4">

      <!-- Comment list -->
      <div v-if="loading" class="flex items-center justify-center py-6">
        <div class="explorer-spinner" />
      </div>

      <div v-else-if="error" class="text-sm text-red-400 font-mono py-2">
        FAILED TO LOAD COMMENTS.
      </div>

      <div v-else-if="comments.length === 0" class="text-sm text-neutral-500 font-mono py-2">
        NO COMMENTS YET. BE THE FIRST.
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="comment in comments"
          :key="comment.id"
          class="border border-[var(--border-color)] rounded p-3 space-y-2 bg-[var(--bg-panel)]"
        >
          <div class="flex items-center justify-between gap-2">
            <router-link
              :to="`/players/${encodeURIComponent(comment.authorPlayerName)}`"
              class="explorer-link text-xs font-mono font-bold truncate"
            >
              {{ comment.authorPlayerName }}
            </router-link>
            <div class="flex items-center gap-3 flex-shrink-0">
              <span class="text-[10px] text-neutral-500 font-mono">{{ formatDate(comment.createdAt) }}</span>
              <button
                v-if="canDelete(comment)"
                class="explorer-btn explorer-btn--ghost explorer-btn--sm text-red-400 hover:text-red-300"
                title="Delete comment"
                @click="deleteComment(comment.id)"
              >
                DEL
              </button>
            </div>
          </div>
          <div
            class="text-sm text-neutral-300 comment-markdown"
            v-html="renderMarkdown(comment.content)"
          />
        </div>
      </div>

      <!-- Input area -->
      <div class="border-t border-[var(--border-color)] pt-4">

        <!-- Not logged in -->
        <div v-if="!isAuthenticated" class="text-sm text-neutral-500 font-mono">
          <router-link to="/dashboard" class="explorer-link font-mono text-sm">
            SIGN IN
          </router-link>
          <span class="ml-1">to leave a comment.</span>
        </div>

        <!-- Logged in but no linked player profiles -->
        <div v-else-if="linkedProfiles.length === 0" class="text-sm text-neutral-500 font-mono">
          Link a player profile on your
          <router-link to="/dashboard" class="explorer-link font-mono text-sm">DASHBOARD</router-link>
          to post comments.
        </div>

        <!-- Logged in with profiles -->
        <form v-else @submit.prevent="submitComment" class="space-y-3">
          <!-- Profile selector -->
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-mono text-neutral-500 flex-shrink-0">POST AS</span>
            <select
              v-model="selectedProfile"
              class="explorer-select flex-1 text-sm font-mono"
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
            class="w-full h-24 resize-none font-mono text-sm bg-[var(--bg-panel)] border border-[var(--border-color)] rounded p-3 text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-[var(--neon-cyan,#00e5ff)] transition-colors"
            placeholder="Write a comment… (Markdown supported)"
            :disabled="submitting"
            maxlength="2000"
          />

          <!-- Footer row -->
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] text-neutral-600 font-mono">{{ newComment.length }}/2000 · Markdown supported</span>
            <div class="flex items-center gap-2">
              <span v-if="submitError" class="text-xs text-red-400 font-mono">{{ submitError }}</span>
              <button
                type="submit"
                class="explorer-btn explorer-btn--primary explorer-btn--sm"
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

const { isAuthenticated, user } = useAuth();

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
.comment-markdown :deep(p) {
  margin-bottom: 0.5rem;
  line-height: 1.5;
}
.comment-markdown :deep(p:last-child) {
  margin-bottom: 0;
}
.comment-markdown :deep(a) {
  color: var(--neon-cyan, #00e5ff);
  text-decoration: underline;
}
.comment-markdown :deep(ul),
.comment-markdown :deep(ol) {
  margin-left: 1.25rem;
  margin-bottom: 0.5rem;
}
.comment-markdown :deep(code) {
  background: rgba(0, 0, 0, 0.3);
  padding: 0.1rem 0.3rem;
  border-radius: 0.2rem;
  font-size: 0.85em;
}
.comment-markdown :deep(blockquote) {
  border-left: 3px solid var(--neon-cyan, #00e5ff);
  padding-left: 0.75rem;
  opacity: 0.85;
  margin-left: 0;
  margin-bottom: 0.5rem;
}
.comment-markdown :deep(strong) {
  color: var(--text-primary, #e5e5e5);
}
</style>
