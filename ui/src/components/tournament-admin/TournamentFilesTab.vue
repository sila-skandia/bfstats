<template>
  <div class="tournament-files-tab mm-admin">
    <!-- Add/Edit File View -->
    <div
      v-if="showForm"
      class="mm-admin-card"
    >
      <div class="mm-admin-card__head" style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span class="mm-eyebrow">Tournament Resources</span>
          <h2 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 18px; margin-top: 2px;">
            {{ editingFile ? 'Edit File' : 'Upload File' }}
          </h2>
        </div>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost"
          @click="closeForm"
        >
          Cancel
        </button>
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

        <div class="mm-admin-form-grid" style="grid-template-columns: 2fr 1fr;">
          <!-- File Name -->
          <div>
            <label class="mm-admin-label">File Name</label>
            <input
              v-model="formData.name"
              type="text"
              placeholder="e.g., skandia-mappack-v3.zip"
              class="mm-admin-input"
              :disabled="formLoading"
            >
          </div>

          <!-- Category -->
          <div>
            <label class="mm-admin-label">Category</label>
            <select
              v-model="formData.category"
              class="mm-admin-select"
              :disabled="formLoading"
            >
              <option value="Map Pack">Map Pack</option>
              <option value="Rulebook">Rulebook</option>
              <option value="Server Config">Server Config</option>
              <option value="Replays & Demos">Replays & Demos</option>
              <option value="General">General</option>
            </select>
          </div>

          <!-- File URL -->
          <div class="mm-admin-field--wide">
            <label class="mm-admin-label">Direct URL</label>
            <input
              v-model="formData.url"
              type="url"
              placeholder="https://cdn.bfstats.io/f/…"
              class="mm-admin-input mm-admin-input--mono"
              :disabled="formLoading"
            >
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
            {{ formLoading ? 'Saving...' : (editingFile ? 'Update File' : 'Upload File') }}
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

    <!-- Files List View -->
    <div
      v-else
      class="mm-admin-card"
    >
      <div class="mm-admin-card__head" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <span class="mm-eyebrow">{{ (tournament.files || []).length }} files</span>
          <h2 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 16px; margin-top: 2px;">
            Resource Downloads & Files
          </h2>
        </div>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--primary"
          @click="openAddForm"
        >
          + Upload File
        </button>
      </div>

      <div class="mm-admin-card__body" style="padding: 0;">
        <!-- Files Table -->
        <div
          v-if="tournament.files && tournament.files.length > 0"
          class="mm-admin-table-wrap"
        >
          <table class="mm-admin-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Category</th>
                <th>URL</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="file in tournament.files"
                :key="file.id"
              >
                <td style="font-weight: 500;">
                  {{ file.name }}
                </td>
                <td>
                  <span class="mm-admin-chip" style="font-size: 9px; padding: 2px 6px;">
                    {{ file.category || 'General' }}
                  </span>
                </td>
                <td class="mm-admin-mono" style="font-size: 11px; color: var(--mm-ink-muted);">
                  {{ file.url }}
                </td>
                <td style="text-align: right;">
                  <button
                    type="button"
                    class="mm-admin-cell-btn"
                    style="margin-right: 6px;"
                    @click="copyUrl(file.url)"
                  >
                    Copy URL
                  </button>
                  <button
                    type="button"
                    class="mm-admin-cell-btn"
                    style="margin-right: 6px;"
                    @click="openEditForm(file)"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    class="mm-admin-cell-btn"
                    style="color: var(--mm-danger); border-color: var(--mm-danger);"
                    @click="confirmDeleteFile(file.id, file.name)"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Empty State -->
        <div
          v-else
          class="mm-admin-empty"
        >
          <div class="mm-admin-empty__title">No Files Uploaded</div>
          <p class="mm-admin-empty__desc">
            Upload map packs, rulebooks, server configs, and custom mods for players.
          </p>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary"
            style="margin-top: 16px;"
            @click="openAddForm"
          >
            + Upload First File
          </button>
        </div>
      </div>
    </div>

    <!-- Delete File Confirmation Modal -->
    <MmBaseModal
      :model-value="deleteFileConfirmation !== null"
      title="Delete File?"
      subtitle="Confirmation"
      size="sm"
      @close="cancelDeleteFile"
    >
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <p style="margin: 0; font-size: 13px; color: var(--mm-ink-soft);">
          Are you sure you want to delete file <strong style="color: var(--mm-ink);">{{ deleteFileConfirmation?.name }}</strong>?
        </p>
        <p style="margin: 0; font-size: 11.5px; color: var(--mm-danger);">
          This action cannot be undone.
        </p>
      </div>

      <template #footer>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost"
          @click="cancelDeleteFile"
        >
          Cancel
        </button>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--danger"
          :disabled="isProcessing"
          @click="executeDeleteFile"
        >
          <span>{{ isProcessing ? 'Deleting...' : 'Delete File' }}</span>
        </button>
      </template>
    </MmBaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  adminTournamentService,
  type TournamentDetail,
  type TournamentFile
} from '@/services/adminTournamentService';
import MmBaseModal from '@/components/v4/MmBaseModal.vue';

const props = defineProps<{
  tournament: TournamentDetail;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
}>();

// Form state
const showForm = ref(false);
const editingFile = ref<TournamentFile | null>(null);
const formLoading = ref(false);
const formError = ref<string | null>(null);

const formData = ref({
  name: '',
  url: '',
  category: ''
});

const isFormValid = computed(() => {
  return formData.value.name.trim() && formData.value.url.trim();
});

// Delete state
const deleteFileConfirmation = ref<{ id: number; name: string } | null>(null);
const isProcessing = ref(false);

// Formatting & Helpers
const copyUrl = (url: string) => {
  if (navigator?.clipboard?.writeText) {
    void navigator.clipboard.writeText(url);
  }
};

// Form handlers
const openAddForm = () => {
  editingFile.value = null;
  formData.value = { name: '', url: '', category: '' };
  formError.value = null;
  showForm.value = true;
};

const openEditForm = (file: TournamentFile) => {
  editingFile.value = file;
  formData.value = {
    name: file.name,
    url: file.url,
    category: file.category || ''
  };
  formError.value = null;
  showForm.value = true;
};

const closeForm = () => {
  showForm.value = false;
  editingFile.value = null;
  formError.value = null;
};

const submitForm = async () => {
  if (!isFormValid.value) return;

  formLoading.value = true;
  formError.value = null;

  try {
    if (editingFile.value?.id) {
      const updateData: Partial<Omit<TournamentFile, 'id'>> = {
        name: formData.value.name,
        url: formData.value.url
      };
      if (formData.value.category) {
        updateData.category = formData.value.category;
      }
      await adminTournamentService.updateFile(props.tournament.id, editingFile.value.id, updateData);
    } else {
      const createData: Omit<TournamentFile, 'id'> = {
        name: formData.value.name,
        url: formData.value.url,
        uploadedAt: new Date().toISOString()
      };
      if (formData.value.category) {
        createData.category = formData.value.category;
      }
      await adminTournamentService.createFile(props.tournament.id, createData);
    }
    closeForm();
    emit('refresh');
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Failed to save file';
    console.error('Error saving file:', err);
  } finally {
    formLoading.value = false;
  }
};

// Delete handlers
const confirmDeleteFile = (fileId: number, fileName: string) => {
  deleteFileConfirmation.value = { id: fileId, name: fileName };
};

const cancelDeleteFile = () => {
  deleteFileConfirmation.value = null;
  isProcessing.value = false;
};

const executeDeleteFile = async () => {
  if (!deleteFileConfirmation.value) return;

  isProcessing.value = true;
  try {
    await adminTournamentService.deleteFile(props.tournament.id, deleteFileConfirmation.value.id);
    deleteFileConfirmation.value = null;
    emit('refresh');
  } catch (err) {
    console.error('Error deleting file:', err);
  } finally {
    isProcessing.value = false;
  }
};

// Expose load method for parent to trigger refresh
const load = () => {
  // Files data comes from parent, nothing to load here
};

defineExpose({ load });
</script>

