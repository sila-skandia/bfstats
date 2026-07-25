<template>
  <div class="tournament-posts-tab mm-admin">
    <!-- Edit/Create Form View -->
    <div
      v-if="showForm"
      class="mm-admin-card"
    >
      <div class="mm-admin-card__head" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <span class="mm-eyebrow">News & Announcements</span>
          <h2 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 18px; margin-top: 2px;">
            {{ editingPost ? 'Edit Post' : 'New Announcement' }}
          </h2>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
            style="font-family: var(--mm-font-mono); font-size: 11px; text-transform: uppercase; color: var(--mm-accent);"
            @click="showMarkdownHelp = true"
          >
            Markdown Help
          </button>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost"
            @click="closeForm"
          >
            Cancel
          </button>
        </div>
      </div>

      <div class="mm-admin-card__body">
        <!-- Error Message -->
        <div
          v-if="formError"
          class="mm-admin-alert mm-admin-alert--err"
          style="margin-bottom: 14px;"
        >
          {{ formError }}
        </div>

        <!-- Post Title -->
        <div style="margin-bottom: 16px;">
          <label class="mm-admin-label">Title</label>
          <input
            v-model="formData.title"
            type="text"
            placeholder="e.g., Playoff bracket seeded or Roster lock reminder"
            class="mm-admin-input"
            :disabled="formLoading"
          >
        </div>

        <!-- Post Content 2-column Editor & Live Preview -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <label class="mm-admin-label">Body · Markdown</label>
            <textarea
              v-model="formData.content"
              rows="10"
              placeholder="Write your post content here. Markdown syntax is supported..."
              class="mm-admin-input mm-admin-input--mono"
              style="resize: vertical; line-height: 1.6;"
              :disabled="formLoading"
            />
          </div>

          <div>
            <label class="mm-admin-label">Live Preview</label>
            <div style="border: 1px solid var(--mm-rule); border-radius: 2px; background: var(--mm-bg-mute); padding: 14px; min-height: 214px;">
              <div style="font-family: var(--mm-font-display); font-size: 16px; font-weight: 500; color: var(--mm-ink);">
                {{ formData.title || 'Post Title Preview' }}
              </div>
              <div
                class="markdown-content"
                style="font-family: var(--mm-font-display); font-size: 13.5px; line-height: 1.65; color: var(--mm-ink-soft); margin-top: 10px;"
                v-html="renderedContent || 'Enter content to see live markdown preview…'"
              />
            </div>
          </div>
        </div>

        <!-- Form Actions -->
        <div class="mm-admin-actions" style="margin-top: 20px;">
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary"
            :disabled="formLoading || !isFormValid"
            @click="submitForm"
          >
            {{ formLoading ? 'Publishing...' : (editingPost ? 'Update Post' : 'Publish') }}
          </button>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost"
            :disabled="formLoading"
            @click="closeForm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <!-- Posts Feed View -->
    <div
      v-else
      class="mm-admin-card"
    >
      <div class="mm-admin-card__head" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <span class="mm-eyebrow">{{ displayPosts.length }} announcements</span>
          <h2 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 16px; margin-top: 2px;">
            Announcements & News Feed
          </h2>
        </div>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--primary"
          @click="openAddForm"
        >
          + New Announcement
        </button>
      </div>

      <div class="mm-admin-card__body">
        <div
          v-if="displayPosts.length > 0"
          style="display: flex; flex-direction: column; gap: 14px;"
        >
          <div
            v-for="post in displayPosts"
            :key="post.id"
            class="mm-admin-card"
            style="padding: 18px 20px;"
          >
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
              <div>
                <div style="font-family: var(--mm-font-display); font-size: 17px; font-weight: 500; color: var(--mm-ink);">
                  {{ post.title }}
                </div>
                <div class="mm-admin-mono" style="font-size: 10px; color: var(--mm-ink-muted); margin-top: 4px;">
                  {{ post.author || 'Admin' }} · Posted {{ formatDate(post.createdAt) }}
                </div>
              </div>
              <div style="display: flex; gap: 8px;">
                <button
                  type="button"
                  class="mm-admin-cell-btn"
                  @click="openEditForm(post)"
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="mm-admin-cell-btn"
                  style="color: var(--mm-danger); border-color: var(--mm-danger);"
                  @click="confirmDeletePost(post.id, post.title)"
                >
                  Delete
                </button>
              </div>
            </div>
            <div
              class="markdown-content"
              style="font-family: var(--mm-font-display); font-size: 13.5px; line-height: 1.65; color: var(--mm-ink-soft); margin-top: 12px;"
              v-html="renderMarkdown(post.content)"
            />
          </div>
        </div>

        <!-- Empty State -->
        <div
          v-else
          class="mm-admin-empty"
        >
          <div class="mm-admin-empty__title">No Announcements Published</div>
          <p class="mm-admin-empty__desc">
            Publish news updates, rule changes, or tournament schedule announcements.
          </p>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary"
            style="margin-top: 16px;"
            @click="openAddForm"
          >
            + New Announcement
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Post Confirmation Modal -->
    <MmBaseModal
      :model-value="deletePostConfirmation !== null"
      title="Delete Post?"
      subtitle="Confirmation"
      size="sm"
      @close="cancelDeletePost"
    >
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <p style="margin: 0; font-size: 13px; color: var(--mm-ink-soft);">
          Are you sure you want to delete post <strong style="color: var(--mm-ink);">{{ deletePostConfirmation?.title }}</strong>?
        </p>
        <p style="margin: 0; font-size: 11.5px; color: var(--mm-danger);">
          This action cannot be undone.
        </p>
      </div>

      <template #footer>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost"
          @click="cancelDeletePost"
        >
          Cancel
        </button>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--danger"
          :disabled="isProcessing"
          @click="executeDeletePost"
        >
          <span>{{ isProcessing ? 'Deleting...' : 'Delete Post' }}</span>
        </button>
      </template>
    </MmBaseModal>

    <!-- Markdown Help Modal -->
    <MarkdownHelpModal
      :is-open="showMarkdownHelp"
      @close="showMarkdownHelp = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { marked } from 'marked';
import {
  adminTournamentService,
  type TournamentDetail,
  type TournamentPost,
  type CreateTournamentPostRequest,
  type UpdateTournamentPostRequest
} from '@/services/adminTournamentService';
import MmBaseModal from '@/components/v4/MmBaseModal.vue';
import MarkdownHelpModal from '@/components/tournament-admin/MarkdownHelpModal.vue';

const props = defineProps<{
  tournament: TournamentDetail;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
}>();

// Posts data (loaded separately from tournament)
const posts = ref<TournamentPost[]>([]);

// Form state
const showForm = ref(false);
const editingPost = ref<TournamentPost | null>(null);
const formLoading = ref(false);
const formError = ref<string | null>(null);
const showPreview = ref(false);

const formData = ref({
  title: '',
  content: '',
  status: 'draft' as 'draft' | 'published',
  publishAt: ''
});
const showMarkdownHelp = ref(false);

const isFormValid = computed(() => {
  return formData.value.title.trim() && formData.value.content.trim();
});

const displayPosts = computed(() => {
  return posts.value.length > 0 ? posts.value : (props.tournament?.posts || []);
});

const renderMarkdown = (content: string): string => {
  if (!content || !content.trim()) return '';
  try {
    return marked(content, { breaks: true });
  } catch {
    return content;
  }
};

const renderedContent = computed(() => {
  return renderMarkdown(formData.value.content);
});

// Delete state
const deletePostConfirmation = ref<{ id: number; title: string } | null>(null);
const isProcessing = ref(false);

// Formatting
const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
};

// Helper to convert ISO string to datetime-local format
const toDateTimeLocal = (isoString: string | null): string => {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch {
    return '';
  }
};

// Helper to convert datetime-local to ISO string
const fromDateTimeLocal = (localString: string): string | null => {
  if (!localString) return null;
  try {
    const date = new Date(localString);
    return date.toISOString();
  } catch {
    return null;
  }
};

// Load posts
const loadPosts = async () => {
  try {
    posts.value = await adminTournamentService.getPosts(props.tournament.id);
  } catch (err) {
    console.error('Error loading posts:', err);
    posts.value = [];
  }
};

// Form handlers
const openAddForm = () => {
  editingPost.value = null;
  formData.value = { title: '', content: '', status: 'draft', publishAt: '' };
  formError.value = null;
  showPreview.value = false;
  showForm.value = true;
};

const openEditForm = (post: TournamentPost) => {
  editingPost.value = post;
  formData.value = {
    title: post.title,
    content: post.content,
    status: post.status,
    publishAt: toDateTimeLocal(post.publishAt)
  };
  formError.value = null;
  showPreview.value = false;
  showForm.value = true;
};

const closeForm = () => {
  showForm.value = false;
  editingPost.value = null;
  formError.value = null;
};

const submitForm = async () => {
  if (!isFormValid.value) return;

  formLoading.value = true;
  formError.value = null;

  try {
    if (editingPost.value?.id) {
      const updateData: UpdateTournamentPostRequest = {
        title: formData.value.title,
        content: formData.value.content,
        status: formData.value.status,
        publishAt: fromDateTimeLocal(formData.value.publishAt)
      };
      await adminTournamentService.updatePost(
        props.tournament.id,
        editingPost.value.id,
        updateData
      );
    } else {
      const createData: CreateTournamentPostRequest = {
        title: formData.value.title,
        content: formData.value.content,
        status: formData.value.status,
        publishAt: fromDateTimeLocal(formData.value.publishAt)
      };
      await adminTournamentService.createPost(props.tournament.id, createData);
    }
    closeForm();
    await loadPosts();
    emit('refresh');
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Failed to save post';
    console.error('Error saving post:', err);
  } finally {
    formLoading.value = false;
  }
};

// Delete handlers
const confirmDeletePost = (postId: number, postTitle: string) => {
  deletePostConfirmation.value = { id: postId, title: postTitle };
};

const cancelDeletePost = () => {
  deletePostConfirmation.value = null;
  isProcessing.value = false;
};

const executeDeletePost = async () => {
  if (!deletePostConfirmation.value) return;

  isProcessing.value = true;
  try {
    await adminTournamentService.deletePost(props.tournament.id, deletePostConfirmation.value.id);
    deletePostConfirmation.value = null;
    await loadPosts();
    emit('refresh');
  } catch (err) {
    console.error('Error deleting post:', err);
  } finally {
    isProcessing.value = false;
  }
};

// Expose load method for parent to trigger refresh when tab is selected
const load = () => {
  loadPosts();
};

onMounted(() => {
  loadPosts();
});

defineExpose({ load });
</script>

<style scoped>
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  color: var(--mm-ink);
  font-weight: 500;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}

.markdown-content :deep(h1) { font-size: 1.4rem; }
.markdown-content :deep(h2) { font-size: 1.2rem; }
.markdown-content :deep(h3) { font-size: 1.05rem; }

.markdown-content :deep(p) {
  margin-bottom: 0.75rem;
  color: var(--mm-ink-soft);
  line-height: 1.6;
}

.markdown-content :deep(strong) {
  font-weight: 600;
  color: var(--mm-ink);
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin-left: 1.5rem;
  margin-bottom: 0.75rem;
}

.markdown-content :deep(li) {
  margin-bottom: 0.25rem;
  color: var(--mm-ink-soft);
}

.markdown-content :deep(a) {
  color: var(--mm-accent);
  text-decoration: underline;
}

.markdown-content :deep(code) {
  background: var(--mm-bg);
  padding: 0.125rem 0.375rem;
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 0.875em;
  color: var(--mm-ink);
}

.markdown-content :deep(blockquote) {
  border-left: 3px solid var(--mm-rule-strong);
  padding-left: 1rem;
  margin-left: 0;
  color: var(--mm-ink-muted);
}
</style>
