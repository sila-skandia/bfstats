<template>
  <MmBaseModal
    :model-value="open"
    title="Delete round"
    subtitle="Destructive action"
    size="sm"
    @close="$emit('cancel')"
  >
    <p class="mm-admin-modal__desc">
      This will permanently delete the round and all related data. This cannot be undone.
    </p>

    <div class="mm-admin-modal__impact">
      <span class="mm-admin-label">Impact</span>
      <ul class="mm-admin-modal__impact-list">
        <li>
          <span class="mm-admin-modal__impact-n">{{ impact.achievementCountToDelete }}</span>
          achievements
        </li>
        <li v-if="impact.observationCountToDelete != null">
          <span class="mm-admin-modal__impact-n">{{ impact.observationCountToDelete }}</span>
          observations
        </li>
        <li v-if="impact.sessionCountToDelete != null">
          <span class="mm-admin-modal__impact-n">{{ impact.sessionCountToDelete }}</span>
          sessions
        </li>
        <li>
          <span class="mm-admin-modal__impact-n">{{ impact.playerCount }}</span>
          players in round
        </li>
      </ul>
    </div>

    <p v-if="error" class="mm-admin-alert mm-admin-alert--err mm-admin-modal__err">
      {{ error }}
    </p>

    <template #footer>
      <button
        type="button"
        class="mm-admin-btn mm-admin-btn--ghost"
        :disabled="loading"
        @click="$emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="mm-admin-btn mm-admin-btn--danger"
        :disabled="loading"
        @click="$emit('confirm')"
      >
        {{ loading ? 'Deleting…' : 'Delete round' }}
      </button>
    </template>
  </MmBaseModal>
</template>

<script setup lang="ts">
import MmBaseModal from '@/components/v4/MmBaseModal.vue'

defineProps<{
  open: boolean
  impact: {
    achievementCountToDelete: number
    observationCountToDelete?: number
    sessionCountToDelete?: number
    playerCount: number
  }
  loading?: boolean
  error?: string | null
}>()

defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<style scoped>
.mm-admin-modal__desc {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--mm-ink-soft);
  line-height: 1.5;
}

.mm-admin-modal__impact {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 10px 14px;
}

.mm-admin-modal__impact-list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12.5px;
  color: var(--mm-ink);
  line-height: 1.7;
}

.mm-admin-modal__impact-n {
  font-family: var(--mm-font-mono);
  color: var(--mm-ink);
  font-weight: 500;
  margin-right: 6px;
}

.mm-admin-modal__err {
  margin-top: 12px;
}
</style>
