<template>
  <div class="tournament-weeks-tab mm-admin">
    <!-- Add/Edit Week View -->
    <div
      v-if="showForm"
      class="mm-admin-card"
    >
      <div class="mm-admin-card__head" style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span class="mm-admin-label" style="margin-bottom: 2px;">Schedule Boundary</span>
          <h2 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 18px;">
            {{ editingWeek ? 'Edit Week' : 'Create Week' }}
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

        <div class="mm-admin-form-grid" style="grid-template-columns: 2fr 1fr 1fr;">
          <!-- Week Name -->
          <div>
            <label class="mm-admin-label">Week Name</label>
            <input
              v-model="formData.week"
              type="text"
              placeholder="e.g., Week 1 · Omaha Beach"
              class="mm-admin-input"
              :disabled="formLoading"
            >
          </div>

          <!-- Start Date -->
          <div>
            <label class="mm-admin-label">Start Date</label>
            <input
              v-model="formData.startDate"
              type="date"
              class="mm-admin-input mm-admin-input--mono"
              :disabled="formLoading"
            >
          </div>

          <!-- End Date -->
          <div>
            <label class="mm-admin-label">End Date</label>
            <input
              v-model="formData.endDate"
              type="date"
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
            {{ formLoading ? 'Saving...' : (editingWeek ? 'Update Week' : 'Create Week') }}
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

    <!-- Weeks List View -->
    <div
      v-else
      class="mm-admin-card"
    >
      <div class="mm-admin-card__head" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <span class="mm-admin-label" style="margin-bottom: 2px;">{{ (tournament.weekDates || []).length }} scheduled weeks</span>
          <h2 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 16px;">
            Tournament Schedule Weeks
          </h2>
        </div>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--primary"
          @click="openAddForm"
        >
          + Add Week
        </button>
      </div>

      <div class="mm-admin-card__body" style="padding: 0;">
        <!-- Weeks Table -->
        <div
          v-if="tournament.weekDates && tournament.weekDates.length > 0"
          class="mm-admin-table-wrap"
        >
          <table class="mm-admin-table">
            <thead>
              <tr>
                <th>Week Name</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th class="is-num">Matches</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="w in tournament.weekDates"
                :key="w.id"
              >
                <td style="font-weight: 500;">
                  {{ w.week }}
                </td>
                <td class="mm-admin-mono" style="font-size: 11px;">
                  {{ formatDateOnly(w.startDate) }}
                </td>
                <td class="mm-admin-mono" style="font-size: 11px;">
                  {{ formatDateOnly(w.endDate) }}
                </td>
                <td class="is-num">
                  {{ getMatchCountForWeek(w.week) }}
                </td>
                <td style="text-align: right;">
                  <button
                    type="button"
                    class="mm-admin-cell-btn"
                    style="margin-right: 6px;"
                    @click="openEditForm(w)"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    class="mm-admin-cell-btn"
                    style="color: var(--mm-danger); border-color: var(--mm-danger);"
                    @click="confirmDeleteWeek(w.id, w.week)"
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
          <div class="mm-admin-empty__title">No Scheduled Weeks</div>
          <p class="mm-admin-empty__desc">
            Define week boundaries to organize match scheduling and weekly leaderboards.
          </p>
        </div>
      </div>
    </div>

    <!-- Delete Week Confirmation Modal -->
    <MmBaseModal
      :model-value="!!deleteWeekConfirmation"
      title="Delete Week?"
      subtitle="Destructive Action"
      size="sm"
      @close="cancelDeleteWeek"
    >
      <p style="margin: 0 0 12px; font-size: 13px; color: var(--mm-ink-soft); line-height: 1.5;">
        Are you sure you want to delete week <strong style="color: var(--mm-ink);">{{ deleteWeekConfirmation?.name }}</strong>?
      </p>
      <p style="margin: 0; font-size: 12px; color: var(--mm-ink-muted); line-height: 1.4;">
        This action cannot be undone.
      </p>

      <template #footer>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost"
          :disabled="isProcessing"
          @click="cancelDeleteWeek"
        >
          Cancel
        </button>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--danger"
          :disabled="isProcessing"
          @click="executeDeleteWeek"
        >
          {{ isProcessing ? 'Deleting...' : 'Delete Week' }}
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
  type TournamentWeekDate
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
const editingWeek = ref<TournamentWeekDate | null>(null);
const formLoading = ref(false);
const formError = ref<string | null>(null);

const formData = ref({
  week: '',
  startDate: '',
  endDate: ''
});

const isFormValid = computed(() => {
  return formData.value.week.trim() && formData.value.startDate && formData.value.endDate;
});

// Delete state
const deleteWeekConfirmation = ref<{ id: number; name: string } | null>(null);
const isProcessing = ref(false);

// Formatting & Helpers
const formatDateOnly = (dateString: string): string => {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const getMatchCountForWeek = (weekName: string): number => {
  if (!props.tournament?.matches) return 0;
  return props.tournament.matches.filter(m => m.week === weekName).length;
};

// Form handlers
const openAddForm = () => {
  editingWeek.value = null;
  formData.value = { week: '', startDate: '', endDate: '' };
  formError.value = null;
  showForm.value = true;
};

const openEditForm = (week: TournamentWeekDate) => {
  editingWeek.value = week;
  formData.value = {
    week: week.week,
    startDate: week.startDate,
    endDate: week.endDate
  };
  formError.value = null;
  showForm.value = true;
};

const closeForm = () => {
  showForm.value = false;
  editingWeek.value = null;
  formError.value = null;
};

const submitForm = async () => {
  if (!isFormValid.value) return;

  formLoading.value = true;
  formError.value = null;

  try {
    if (editingWeek.value?.id) {
      await adminTournamentService.updateWeek(
        props.tournament.id,
        editingWeek.value.id,
        {
          week: formData.value.week,
          startDate: formData.value.startDate,
          endDate: formData.value.endDate
        }
      );
    } else {
      await adminTournamentService.createWeek(props.tournament.id, {
        week: formData.value.week,
        startDate: formData.value.startDate,
        endDate: formData.value.endDate
      });
    }
    closeForm();
    emit('refresh');
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Failed to save week';
    console.error('Error saving week:', err);
  } finally {
    formLoading.value = false;
  }
};

// Delete handlers
const confirmDeleteWeek = (weekId: number | undefined, weekName: string) => {
  if (!weekId) return;
  deleteWeekConfirmation.value = { id: weekId, name: weekName };
};

const cancelDeleteWeek = () => {
  deleteWeekConfirmation.value = null;
  isProcessing.value = false;
};

const executeDeleteWeek = async () => {
  if (!deleteWeekConfirmation.value) return;

  isProcessing.value = true;
  try {
    await adminTournamentService.deleteWeek(props.tournament.id, deleteWeekConfirmation.value.id);
    deleteWeekConfirmation.value = null;
    emit('refresh');
  } catch (err) {
    console.error('Error deleting week:', err);
  } finally {
    isProcessing.value = false;
  }
};

// Expose load method for parent to trigger refresh
const load = () => {
  // Weeks data comes from parent, nothing to load here
};

defineExpose({ load });
</script>

<style scoped>
</style>
