<template>
  <MmBaseModal
    :model-value="isOpen"
    :title="match ? `${match.team1?.name || 'Team 1'} vs ${match.team2?.name || 'Team 2'}` : 'Match Files & Comments'"
    :subtitle="match?.scheduledDate ? `Match · ${formatDate(match.scheduledDate)}` : 'Match Files & Comments'"
    size="lg"
    @close="emit('close')"
  >
    <div style="padding: 0 4px 14px;">
      <nav class="mm-admin-tabs">
        <button
          type="button"
          :class="['mm-admin-tab', activeSubTab === 'files' && 'mm-admin-tab--active']"
          @click="activeSubTab = 'files'"
        >
          Files & Demos
        </button>
        <button
          type="button"
          :class="['mm-admin-tab', activeSubTab === 'comments' && 'mm-admin-tab--active']"
          @click="activeSubTab = 'comments'"
        >
          Referee Comments <span v-if="comments.length" class="mm-tab-badge">{{ comments.length }}</span>
        </button>
      </nav>
    </div>

    <!-- Files & Demos Tab Content -->
    <div v-if="activeSubTab === 'files'" class="files-tab-container">
      <div class="file-dropzone" @click="triggerFileInput">
        <input
          ref="fileInputRef"
          type="file"
          accept=".bf1942demo,.zip,.png,.jpg,.jpeg"
          style="display: none;"
          @change="handleFileUpload"
        >
        <div style="font-family: var(--mm-font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mm-ink-muted);">
          Drop .bf1942demo · .zip · .png — or click to upload
        </div>
      </div>

      <!-- Files List Table -->
      <div v-if="files.length > 0" class="mm-admin-table-wrap" style="margin-top: 14px;">
        <table class="mm-admin-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Tags</th>
              <th>Uploaded</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="file in files" :key="file.id">
              <td>{{ file.name }}</td>
              <td>
                <span class="mm-admin-chip" style="font-size: 9px; padding: 2px 6px;">
                  {{ getFileCategoryLabel(file.name) }}
                </span>
              </td>
              <td class="mm-admin-mono" style="font-size: 11px; color: var(--mm-ink-muted);">
                {{ formatDate(file.createdAt) }}
              </td>
              <td style="text-align: right;">
                <a
                  :href="file.url"
                  target="_blank"
                  rel="noopener"
                  class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
                  style="margin-right: 6px;"
                >
                  Download
                </a>
                <button
                  type="button"
                  class="mm-admin-btn mm-admin-btn--danger mm-admin-btn--sm"
                  @click="deleteFile(file.id)"
                >
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="mm-admin-empty" style="padding: 24px;">
        <span class="mm-admin-empty__desc">No match recordings or files uploaded yet.</span>
      </div>
    </div>

    <!-- Referee Comments Tab Content -->
    <div v-else-if="activeSubTab === 'comments'" class="comments-tab-container">
      <div class="comments-stream">
        <div v-for="c in comments" :key="c.id" class="comment-item">
          <div class="comment-avatar">
            {{ (c.author || 'Referee').charAt(0).toUpperCase() }}
          </div>
          <div class="comment-content">
            <div class="comment-header">
              <span class="comment-author">{{ c.author || 'Referee' }}</span>
              <span class="comment-sep">•</span>
              <span class="comment-time">{{ formatDate(c.createdAt) }}</span>
            </div>
            <div class="comment-body">
              {{ c.text }}
            </div>
          </div>
        </div>

        <div v-if="comments.length === 0" class="mm-admin-empty" style="padding: 24px;">
          <span class="mm-admin-empty__desc">No referee comments yet. Start the discussion below.</span>
        </div>
      </div>

      <div class="add-comment-row" style="margin-top: 18px; display: flex; gap: 10px;">
        <input
          v-model="newCommentText"
          class="mm-admin-input"
          placeholder="Add a referee comment…"
          @keyup.enter="postComment"
        >
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--primary"
          :disabled="!newCommentText.trim() || submittingComment"
          @click="postComment"
        >
          Post
        </button>
      </div>
    </div>

    <template #footer>
      <button
        type="button"
        class="mm-admin-btn mm-admin-btn--ghost"
        @click="emit('close')"
      >
        Close
      </button>
    </template>
  </MmBaseModal>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import MmBaseModal from '@/components/v4/MmBaseModal.vue';

interface MatchFile {
  id: number;
  name: string;
  url: string;
  createdAt: string;
}

interface RefereeComment {
  id: number;
  author: string;
  text: string;
  createdAt: string;
}

const props = defineProps<{
  isOpen: boolean;
  tournamentId: number;
  match: {
    id: number;
    scheduledDate?: string;
    team1?: { name: string };
    team2?: { name: string };
  } | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'refresh'): void;
}>();

const activeSubTab = ref<'files' | 'comments'>('files');
const fileInputRef = ref<HTMLInputElement | null>(null);

const files = ref<MatchFile[]>([]);
const comments = ref<RefereeComment[]>([]);
const newCommentText = ref('');
const submittingComment = ref(false);

const triggerFileInput = () => {
  fileInputRef.value?.click();
};

const handleFileUpload = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (!target.files?.length) return;
  const file = target.files[0];

  // Simulating/Adding file
  files.value.push({
    id: Date.now(),
    name: file.name,
    url: URL.createObjectURL(file),
    createdAt: new Date().toISOString()
  });

  target.value = '';
};

const deleteFile = (fileId: number) => {
  files.value = files.value.filter(f => f.id !== fileId);
};

const getFileCategoryLabel = (filename: string): string => {
  if (filename.endsWith('.bf1942demo')) return 'Demo';
  if (filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'Screenshot';
  if (filename.endsWith('.zip')) return 'Archive';
  return 'File';
};

const postComment = () => {
  if (!newCommentText.value.trim()) return;
  submittingComment.value = true;
  comments.value.push({
    id: Date.now(),
    author: 'Referee',
    text: newCommentText.value.trim(),
    createdAt: new Date().toISOString()
  });
  newCommentText.value = '';
  submittingComment.value = false;
};

const formatDate = (dateString?: string): string => {
  if (!dateString) return '';
  const d = new Date(dateString);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
</script>

<style scoped>
.file-dropzone {
  border: 1px dashed var(--mm-rule-strong);
  border-radius: 2px;
  padding: 24px;
  text-align: center;
  cursor: pointer;
  background: var(--mm-bg);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.file-dropzone:hover {
  border-color: var(--mm-ink);
  background: var(--mm-bg-soft);
}

.comments-stream {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 280px;
  overflow-y: auto;
}

.comment-item {
  display: flex;
  gap: 12px;
}

.comment-avatar {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid var(--mm-rule-strong);
  display: grid;
  place-items: center;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  flex-shrink: 0;
  background: var(--mm-bg-soft);
}

.comment-header {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.comment-sep {
  margin: 0 4px;
  color: var(--mm-ink-faint);
}

.comment-body {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--mm-ink-soft);
  margin-top: 3px;
}
</style>
