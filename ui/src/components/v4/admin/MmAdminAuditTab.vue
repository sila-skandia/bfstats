<template>
  <section class="mm-admin-card">
    <div class="mm-admin-card__head mm-admin-audit__head">
      <h3 class="mm-admin-card__title mm-admin-card__title--strong">
        Deletion log
      </h3>
      <button
        type="button"
        class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
        :disabled="auditLoading"
        @click="load"
      >
        Refresh
      </button>
    </div>

    <div v-if="auditLoading" class="mm-admin-empty mm-admin-empty--loading">
      <span class="mm-admin-spinner" aria-hidden="true" />
      <span class="mm-admin-empty__text">Loading…</span>
    </div>

    <div v-else-if="items.length === 0" class="mm-admin-empty">
      <span class="mm-admin-empty__title">No entries</span>
      <span class="mm-admin-empty__desc">No deletions have been recorded yet.</span>
    </div>

    <template v-else>
      <div class="mm-admin-table-wrap">
        <table class="mm-admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Target</th>
              <th>Admin</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in items"
              :key="e.id"
            >
              <td class="mm-admin-mono">{{ formatDate(e.timestamp) }}</td>
              <td>{{ e.action }}</td>
              <td class="mm-admin-mono">{{ e.targetType }} {{ e.targetId ?? '' }}</td>
              <td>{{ e.adminEmail }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-if="totalCount > items.length"
        class="mm-admin-card__foot"
      >
        Showing {{ items.length }} of {{ totalCount }}
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminDataService, type AuditLogEntry } from '@/services/adminDataService'
import { formatDateTimeShort } from '@/utils/date'

const items = ref<AuditLogEntry[]>([])
const totalCount = ref(0)
const auditLoading = ref(false)

function formatDate(iso: string): string {
  return formatDateTimeShort(iso)
}

async function load() {
  auditLoading.value = true
  try {
    const res = await adminDataService.getAuditLog(1, 50)
    items.value = res.items
    totalCount.value = res.totalCount
  } catch {
    items.value = []
    totalCount.value = 0
  } finally {
    auditLoading.value = false
  }
}

defineExpose({ load })

onMounted(load)
</script>

<style scoped>
.mm-admin-audit__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
</style>
