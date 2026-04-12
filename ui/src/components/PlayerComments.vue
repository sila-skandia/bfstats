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
        Failed to load comments.
      </div>

      <div v-else-if="comments.length === 0" class="text-sm text-neutral-500 font-mono py-2">
        NO COMMENTS YET. BE THE FIRST.
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="comment in comments"
          :key="comment.id"
          class="border border-[var(--border-color)] rounded p-3 space-y-1"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-mono text-neon-cyan truncate">{{ comment.authorEmail }}</span>
            <div class="flex items-center gap-2 flex-shrink-0">
              <span class="text-[10px] text-neutral-500 font-mono">{{ formatDate(comment.createdAt) }}</span>
              <button
                v-if="canDelete(comment)"
                class="text-[10px] text-neutral-600 hover:text-red-400 font-mono transition-colors"
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
        <div v-if="!isAuthenticated" class="text-sm text-neutral-500 font-mono">
          <span>Sign in to leave a comment. </span>
          <button
            class="explorer-link font-mono text-sm"
            @click="emit('request-login')"
          >
            SIGN IN
          </button>
        </div>

        <form v-else @submit.prevent="submitComment" class="space-y-2">
          <textarea
            v-model="newComment"
            class="explorer-input w-full h-24 resize-none font-mono text-sm"
            placeholder="Write a comment… (Markdown supported)"
            :disabled="submitting"
            maxlength="2000"
          />
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

const props = defineProps<{
  playerName: string;
}>();

const emit = defineEmits<{
  (e: 'request-login'): void;
}>();

const { isAuthenticated, user } = useAuth();

interface PlayerComment {
  id: number;
  playerName: string;
  content: string;
  authorEmail: string;
  createdAt: string;
  updatedAt: string;
}

const comments = ref<PlayerComment[]>([]);
const loading = ref(true);
const error = ref(false);
const newComment = ref('');
const submitting = ref(false);
const submitError = ref('');

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(content: string): string {
  return marked.parse(content) as string;
}

function formatDate(isoString: string): string {
  return formatRelativeTime(isoString);
}

function canDelete(comment: PlayerComment): boolean {
  return isAuthenticated.value && user.value?.email === comment.authorEmail;
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

async function submitComment() {
  if (!newComment.value.trim()) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const token = localStorage.getItem('authToken');
    const response = await axios.post<PlayerComment>(
      `/stats/players/${encodeURIComponent(props.playerName)}/comments`,
      { content: newComment.value.trim() },
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

onMounted(loadComments);
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
  color: var(--neon-cyan);
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
}
.comment-markdown :deep(strong) {
  color: var(--text-primary, #e5e5e5);
}
</style>
