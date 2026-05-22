<template>
  <div class="mm-admin-query">
    <!-- Query form -->
    <section class="mm-admin-card">
      <div class="mm-admin-card__body">
        <div class="mm-admin-form-grid">
          <div class="mm-admin-field--wide">
            <label class="mm-admin-label">Server</label>
            <div class="mm-admin-input-wrap">
              <input
                v-model="serverSearchQuery"
                type="text"
                placeholder="Type to search…"
                class="mm-admin-input"
                @input="onServerSearchInput"
                @focus="showServerDropdown = true"
                @blur="closeServerDropdown"
              >
              <div v-if="showServerDropdown" class="mm-admin-dropdown">
                <div
                  v-for="s in serverSuggestions"
                  :key="s.serverGuid"
                  class="mm-admin-dropdown__item"
                  @mousedown.prevent="selectServer(s)"
                >
                  {{ s.serverName }}
                </div>
                <div
                  v-if="serverSearchLoading"
                  class="mm-admin-dropdown__ghost"
                >
                  Searching…
                </div>
                <div
                  v-if="!serverSearchLoading && serverSearchQuery.length >= 2 && serverSuggestions.length === 0"
                  class="mm-admin-dropdown__ghost"
                >
                  No matches
                </div>
              </div>
            </div>
            <p v-if="selectedServer" class="mm-admin-hint">
              ‹ {{ selectedServer.serverName }}
            </p>
          </div>

          <div>
            <label class="mm-admin-label">Min score</label>
            <input
              v-model.number="filters.minScore"
              type="number"
              min="0"
              placeholder="0"
              class="mm-admin-input mm-admin-input--mono"
            >
          </div>
          <div>
            <label class="mm-admin-label">Min K/D</label>
            <input
              v-model.number="filters.minKd"
              type="number"
              min="0"
              step="0.1"
              placeholder="0"
              class="mm-admin-input mm-admin-input--mono"
            >
          </div>
          <div>
            <label class="mm-admin-label">From</label>
            <input
              v-model="filters.dateFrom"
              type="date"
              class="mm-admin-input mm-admin-input--mono"
            >
          </div>
          <div>
            <label class="mm-admin-label">To</label>
            <input
              v-model="filters.dateTo"
              type="date"
              class="mm-admin-input mm-admin-input--mono"
            >
          </div>

          <div class="mm-admin-field--wide mm-admin-query__include">
            <input
              id="mm-admin-query-include-deleted"
              v-model="includeDeletedRounds"
              type="checkbox"
              class="mm-admin-query__checkbox"
            >
            <label for="mm-admin-query-include-deleted" class="mm-admin-query__include-label">
              Include deleted rounds (to restore)
            </label>
          </div>
        </div>

        <div class="mm-admin-actions">
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary"
            :disabled="queryLoading"
            @click="runQuery"
          >
            {{ queryLoading ? 'Running…' : 'Run query' }}
          </button>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost"
            @click="clearQuery"
          >
            Clear
          </button>
        </div>
      </div>
    </section>

    <!-- Results + inspect panel -->
    <div class="mm-admin-query__main">
      <section v-if="hasQueried" class="mm-admin-card mm-admin-query__results">
        <div v-if="tableLoading" class="mm-admin-empty mm-admin-empty--loading">
          <span class="mm-admin-spinner" aria-hidden="true" />
          <span class="mm-admin-empty__text">Scanning…</span>
        </div>

        <div v-else-if="sessions.length === 0" class="mm-admin-empty">
          <span class="mm-admin-empty__title">No matches</span>
          <span class="mm-admin-empty__desc">
            No suspicious sessions for this query. Try different filters or thresholds.
          </span>
        </div>

        <template v-else>
          <div class="mm-admin-table-wrap">
            <table class="mm-admin-table mm-admin-query__table">
              <thead>
                <tr>
                  <th v-if="canDelete" class="mm-admin-query__th-select">
                    <input
                      type="checkbox"
                      :checked="allSelectableSelected"
                      :indeterminate.prop="someSelectableSelected && !allSelectableSelected"
                      :disabled="selectableRoundGroups.length === 0"
                      aria-label="Select all rounds"
                      @change="toggleSelectAll"
                    >
                  </th>
                  <th class="mm-admin-sortable" @click="onSortClick('playerName')">
                    Player <span v-if="sortField === 'playerName'" class="mm-admin-sort-icon">{{ sortOrder === -1 ? '↓' : '↑' }}</span>
                  </th>
                  <th class="mm-admin-sortable" @click="onSortClick('serverName')">
                    Server <span v-if="sortField === 'serverName'" class="mm-admin-sort-icon">{{ sortOrder === -1 ? '↓' : '↑' }}</span>
                  </th>
                  <th class="mm-admin-sortable is-num" @click="onSortClick('totalScore')">
                    Score <span v-if="sortField === 'totalScore'" class="mm-admin-sort-icon">{{ sortOrder === -1 ? '↓' : '↑' }}</span>
                  </th>
                  <th class="mm-admin-sortable is-num" @click="onSortClick('totalKills')">
                    Kills <span v-if="sortField === 'totalKills'" class="mm-admin-sort-icon">{{ sortOrder === -1 ? '↓' : '↑' }}</span>
                  </th>
                  <th class="mm-admin-sortable is-num" @click="onSortClick('kdRatio')">
                    K/D <span v-if="sortField === 'kdRatio'" class="mm-admin-sort-icon">{{ sortOrder === -1 ? '↓' : '↑' }}</span>
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="{ roundId, sessions: roundSessions } in roundGroups" :key="roundId">
                  <tr>
                    <td
                      v-if="canDelete"
                      class="mm-admin-table__group mm-admin-query__td-select"
                    >
                      <input
                        v-if="!roundSessions[0]?.roundIsDeleted"
                        type="checkbox"
                        :checked="selectedRoundIds.has(roundId)"
                        :aria-label="`Select round ${roundId}`"
                        @change="toggleRound(roundId)"
                      >
                    </td>
                    <td colspan="6" class="mm-admin-table__group">
                      {{ (roundSessions[0]?.roundStartTime ? formatDate(roundSessions[0].roundStartTime) + ' · ' : '') + roundId }}
                      <span
                        v-if="roundSessions[0]?.roundIsDeleted"
                        class="mm-admin-table__group-deleted"
                      >[deleted]</span>
                      <span
                        v-if="roundSessions.length > 1"
                        class="mm-admin-table__group-warn"
                      >{{ roundSessions.length }} exceeding</span>
                    </td>
                  </tr>
                  <tr v-for="s in roundSessions" :key="`${s.roundId}-${s.playerName}`">
                    <td v-if="canDelete" class="mm-admin-query__td-select" />
                    <td>{{ $pn(s.playerName) }}</td>
                    <td>{{ s.serverName }}</td>
                    <td class="is-num">{{ s.totalScore }}</td>
                    <td class="is-num">{{ s.totalKills }}</td>
                    <td
                      class="is-num"
                      :class="{ 'mm-admin-query__kd-high': (s.kdRatio ?? 0) >= 5 }"
                    >
                      {{ s.kdRatio != null ? s.kdRatio.toFixed(2) : '–' }}
                    </td>
                    <td>
                      <button
                        type="button"
                        class="mm-admin-cell-btn"
                        @click="viewRound(s.roundId)"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div
            v-if="canDelete && selectedRoundIds.size > 0"
            class="mm-admin-query__bulk"
          >
            <span class="mm-admin-query__bulk-info">
              {{ selectedRoundIds.size }} round{{ selectedRoundIds.size === 1 ? '' : 's' }} selected
            </span>
            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--danger mm-admin-btn--sm"
              :disabled="bulkDeleteLoading"
              @click="openBulkDeleteModal"
            >
              {{ bulkDeleteLoading ? 'Deleting…' : `Delete selected (${selectedRoundIds.size})` }}
            </button>
          </div>

          <div class="mm-admin-pagination">
            <div>
              {{ (currentPage - 1) * pageSize + 1 }}–{{ Math.min(currentPage * pageSize, totalSessions) }} of {{ totalSessions }}
            </div>
            <div class="mm-admin-pagination__controls">
              <select
                v-model.number="pageSize"
                class="mm-admin-pagination__select"
                @change="onPageSizeChange"
              >
                <option :value="25">25</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
              </select>
              <button
                type="button"
                class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
                :disabled="currentPage <= 1"
                @click="goToPage(currentPage - 1)"
              >
                Prev
              </button>
              <span>Page {{ currentPage }} of {{ totalPages }}</span>
              <button
                type="button"
                class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
                :disabled="currentPage >= totalPages"
                @click="goToPage(currentPage + 1)"
              >
                Next
              </button>
            </div>
          </div>
        </template>
      </section>

      <div
        v-if="roundDetail || roundDetailLoading"
        class="mm-admin-query__round"
      >
        <MmRoundDetailPanel
          v-if="roundDetail"
          :detail="roundDetail"
          :loading="roundDetailLoading"
          :undelete-error="undeleteError"
          :can-delete="canDelete"
          @delete="openDeleteModal"
          @undelete="onUndelete"
          @view-achievements="onViewAchievements"
        />
        <div v-else class="mm-admin-card">
          <div class="mm-admin-empty mm-admin-empty--loading">
            <span class="mm-admin-spinner" aria-hidden="true" />
            <span class="mm-admin-empty__text">Loading…</span>
          </div>
        </div>
      </div>

      <div
        v-if="showAchievementsPanel && achievementsRoundId"
        class="mm-admin-query__achievements"
      >
        <MmRoundAchievementsPanel
          :round-id="achievementsRoundId"
          :achievements="roundAchievements"
          :loading="roundAchievementsLoading"
          @close="closeAchievementsPanel"
        />
      </div>
    </div>

    <MmDeleteConfirmationModal
      v-if="roundDetail"
      :open="showDeleteModal"
      :impact="{
        achievementCountToDelete: roundDetail.achievementCountToDelete,
        observationCountToDelete: roundDetail.observationCountToDelete,
        sessionCountToDelete: roundDetail.sessionCountToDelete,
        playerCount: roundDetail.players.length,
      }"
      :loading="deleteLoading"
      :error="deleteError"
      @confirm="onDeleteConfirm"
      @cancel="showDeleteModal = false"
    />

    <!-- Bulk delete confirmation -->
    <MmBaseModal
      :model-value="showBulkDeleteModal"
      :title="`Delete ${selectedRoundIds.size} round${selectedRoundIds.size === 1 ? '' : 's'}`"
      subtitle="Bulk delete"
      size="sm"
      @close="closeBulkDeleteModal"
    >
      <p class="mm-admin-query__bulk-desc">
        Each round will be soft-deleted (achievements removed; round and
        sessions kept for recovery). Run Daily Aggregate Refresh in Cron after.
      </p>
      <p v-if="bulkDeleteError" class="mm-admin-alert mm-admin-alert--err">
        {{ bulkDeleteError }}
      </p>
      <template #footer>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost"
          :disabled="bulkDeleteLoading"
          @click="closeBulkDeleteModal"
        >
          {{ bulkDeleteDone ? 'Close' : 'Cancel' }}
        </button>
        <button
          v-if="!bulkDeleteDone"
          type="button"
          class="mm-admin-btn mm-admin-btn--danger"
          :disabled="bulkDeleteLoading"
          @click="onBulkDeleteConfirm"
        >
          {{ bulkDeleteLoading ? 'Deleting…' : `Delete ${selectedRoundIds.size} round${selectedRoundIds.size === 1 ? '' : 's'}` }}
        </button>
      </template>
    </MmBaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import MmRoundDetailPanel from '@/components/v4/admin/MmRoundDetailPanel.vue'
import MmRoundAchievementsPanel from '@/components/v4/admin/MmRoundAchievementsPanel.vue'
import MmDeleteConfirmationModal from '@/components/v4/admin/MmDeleteConfirmationModal.vue'
import MmBaseModal from '@/components/v4/MmBaseModal.vue'
import {
  adminDataService,
  searchServersForAdmin,
  type SuspiciousSessionResponse,
  type RoundDetailResponse,
  type RoundAchievement,
  type ServerSearchResult,
} from '@/services/adminDataService'
import { formatDateTimeShort } from '@/utils/date'

const props = withDefaults(
  defineProps<{ gameFilter?: string; canDelete?: boolean }>(),
  { gameFilter: 'bf1942', canDelete: false },
)

const emit = defineEmits<{ (e: 'post-delete'): void; (e: 'post-undelete'): void }>()

const ADMIN_DATA_LAST_SEARCH_KEY = 'bf1942_admin_data_last_search'

const filters = ref({
  serverGuid: undefined as string | undefined,
  minScore: undefined as number | undefined,
  minKd: undefined as number | undefined,
  dateFrom: '' as string,
  dateTo: '' as string,
})
const serverSearchQuery = ref('')
const selectedServer = ref<ServerSearchResult | null>(null)
const serverSuggestions = ref<ServerSearchResult[]>([])
const showServerDropdown = ref(false)
const serverSearchLoading = ref(false)
let serverSearchTimeout: ReturnType<typeof setTimeout> | null = null

watch(selectedServer, (s) => {
  filters.value.serverGuid = s?.serverGuid
}, { immediate: true })

const hasQueried = ref(false)
const sessions = ref<SuspiciousSessionResponse[]>([])
const totalSessions = ref(0)
const tableLoading = ref(false)
const queryLoading = ref(false)
const sortField = ref('totalScore')
const sortOrder = ref<-1 | 1>(-1)
const currentPage = ref(1)
const pageSize = ref(50)

const roundDetail = ref<RoundDetailResponse | null>(null)
const roundDetailLoading = ref(false)

const showAchievementsPanel = ref(false)
const achievementsRoundId = ref<string | null>(null)
const roundAchievements = ref<RoundAchievement[]>([])
const roundAchievementsLoading = ref(false)

const showDeleteModal = ref(false)
const deleteLoading = ref(false)
const deleteError = ref<string | null>(null)

const includeDeletedRounds = ref(false)
const undeleteError = ref<string | null>(null)

const selectedRoundIdsArray = ref<string[]>([])
const selectedRoundIds = computed(() => new Set(selectedRoundIdsArray.value))

const selectableRoundGroups = computed(() =>
  roundGroups.value.filter((g) => !g.sessions[0]?.roundIsDeleted),
)
const allSelectableSelected = computed(
  () =>
    selectableRoundGroups.value.length > 0 &&
    selectableRoundGroups.value.every((g) => selectedRoundIds.value.has(g.roundId)),
)
const someSelectableSelected = computed(() =>
  selectableRoundGroups.value.some((g) => selectedRoundIds.value.has(g.roundId)),
)

const showBulkDeleteModal = ref(false)
const bulkDeleteLoading = ref(false)
const bulkDeleteDone = ref(false)
const bulkDeleteError = ref<string | null>(null)

function formatDate(iso: string): string {
  return formatDateTimeShort(iso)
}

onMounted(() => {
  try {
    const raw = localStorage.getItem(ADMIN_DATA_LAST_SEARCH_KEY)
    if (!raw) return
    const s = JSON.parse(raw) as {
      filters?: { serverGuid?: string; minScore?: number; minKd?: number; dateFrom?: string; dateTo?: string }
      serverSearchQuery?: string
      serverGuid?: string
      serverName?: string
      includeDeletedRounds?: boolean
    }
    if (s.filters) {
      filters.value = {
        serverGuid: s.filters.serverGuid,
        minScore: s.filters.minScore,
        minKd: s.filters.minKd,
        dateFrom: s.filters.dateFrom ?? '',
        dateTo: s.filters.dateTo ?? '',
      }
    }
    if (s.serverSearchQuery != null) serverSearchQuery.value = s.serverSearchQuery
    if (s.serverGuid && s.serverName) {
      selectedServer.value = { serverGuid: s.serverGuid, serverName: s.serverName }
    }
    if (typeof s.includeDeletedRounds === 'boolean') includeDeletedRounds.value = s.includeDeletedRounds
  } catch { /* ignore */ }
})

function onServerSearchInput() {
  selectedServer.value = null
  if (serverSearchTimeout) clearTimeout(serverSearchTimeout)
  serverSearchTimeout = setTimeout(() => {
    const q = serverSearchQuery.value.trim()
    if (q.length < 2) {
      serverSuggestions.value = []
      return
    }
    serverSearchLoading.value = true
    searchServersForAdmin(q, 20, props.gameFilter || 'bf1942')
      .then((r) => { serverSuggestions.value = r })
      .finally(() => { serverSearchLoading.value = false })
  }, 300)
}

function selectServer(s: ServerSearchResult) {
  selectedServer.value = s
  serverSearchQuery.value = s.serverName
  serverSuggestions.value = []
  showServerDropdown.value = false
}

function closeServerDropdown() {
  setTimeout(() => { showServerDropdown.value = false }, 150)
}

async function runQuery() {
  queryLoading.value = true
  hasQueried.value = true
  currentPage.value = 1
  await loadSessions()
  queryLoading.value = false
  try {
    const saved: Record<string, unknown> = {
      filters: { ...filters.value },
      serverSearchQuery: serverSearchQuery.value,
      serverGuid: selectedServer.value?.serverGuid,
      serverName: selectedServer.value?.serverName,
      includeDeletedRounds: includeDeletedRounds.value,
    }
    localStorage.setItem(ADMIN_DATA_LAST_SEARCH_KEY, JSON.stringify(saved))
  } catch { /* ignore */ }
}

function clearQuery() {
  filters.value = { serverGuid: undefined, minScore: undefined, minKd: undefined, dateFrom: '', dateTo: '' }
  selectedServer.value = null
  serverSearchQuery.value = ''
  sessions.value = []
  totalSessions.value = 0
  hasQueried.value = false
  roundDetail.value = null
  selectedRoundIdsArray.value = []
}

function toggleRound(roundId: string) {
  const set = new Set(selectedRoundIdsArray.value)
  if (set.has(roundId)) set.delete(roundId)
  else set.add(roundId)
  selectedRoundIdsArray.value = [...set]
}

function toggleSelectAll() {
  if (allSelectableSelected.value) {
    selectedRoundIdsArray.value = []
  } else {
    selectedRoundIdsArray.value = selectableRoundGroups.value.map((g) => g.roundId)
  }
}

function openBulkDeleteModal() {
  bulkDeleteError.value = null
  bulkDeleteDone.value = false
  showBulkDeleteModal.value = true
}

function closeBulkDeleteModal() {
  showBulkDeleteModal.value = false
  bulkDeleteDone.value = false
  bulkDeleteError.value = null
}

async function onBulkDeleteConfirm() {
  const ids = [...selectedRoundIds.value]
  bulkDeleteLoading.value = true
  bulkDeleteError.value = null
  try {
    await adminDataService.deleteRounds(ids)
    bulkDeleteDone.value = true
    selectedRoundIdsArray.value = []
    showBulkDeleteModal.value = false
    emit('post-delete')
    if (hasQueried.value) loadSessions()
    if (roundDetail.value && ids.includes(roundDetail.value.roundId)) {
      roundDetail.value = null
    }
  } catch (e) {
    bulkDeleteDone.value = true
    bulkDeleteError.value = e instanceof Error ? e.message : String(e)
  } finally {
    bulkDeleteLoading.value = false
  }
}

async function loadSessions() {
  tableLoading.value = true
  try {
    const dateFrom = filters.value.dateFrom ? `${filters.value.dateFrom}T00:00:00Z` : undefined
    const dateTo = filters.value.dateTo ? `${filters.value.dateTo}T23:59:59Z` : undefined
    const res = await adminDataService.querySuspiciousSessions(
      {
        serverGuid: filters.value.serverGuid,
        minScore: filters.value.minScore,
        minKd: filters.value.minKd,
        dateFrom,
        dateTo,
        includeDeletedRounds: includeDeletedRounds.value,
        game: props.gameFilter || 'bf1942',
      },
      currentPage.value,
      pageSize.value,
      sortField.value,
      sortOrder.value,
    )
    const items = res.items ?? []
    sessions.value = items
    const api = res as { totalCount?: number; totalItems?: number }
    totalSessions.value = api.totalCount ?? api.totalItems ?? items.length
  } catch {
    sessions.value = []
    totalSessions.value = 0
  } finally {
    tableLoading.value = false
  }
}

const totalPages = computed(() => Math.max(1, Math.ceil(totalSessions.value / pageSize.value)))

const roundGroups = computed(() => {
  const map = new Map<string, SuspiciousSessionResponse[]>()
  const order: string[] = []
  for (const s of sessions.value) {
    const id = s.roundId || '—'
    if (!map.has(id)) {
      map.set(id, [])
      order.push(id)
    }
    map.get(id)!.push(s)
  }
  return order.map((roundId) => ({ roundId, sessions: map.get(roundId)! }))
})

function onSortClick(field: string) {
  const next = sortField.value === field ? (sortOrder.value === -1 ? 1 : -1) : -1
  sortField.value = field
  sortOrder.value = next as -1 | 1
  currentPage.value = 1
  loadSessions()
}

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadSessions()
}

function onPageSizeChange() {
  currentPage.value = 1
  loadSessions()
}

async function viewRound(roundId: string) {
  closeAchievementsPanel()
  undeleteError.value = null
  roundDetail.value = null
  roundDetailLoading.value = true
  try {
    roundDetail.value = await adminDataService.getRoundDetail(roundId)
  } finally {
    roundDetailLoading.value = false
  }
}

function openDeleteModal() {
  deleteError.value = null
  showDeleteModal.value = true
}

function onViewAchievements() {
  if (!roundDetail.value) return
  achievementsRoundId.value = roundDetail.value.roundId
  showAchievementsPanel.value = true
  roundAchievements.value = []
  roundAchievementsLoading.value = true
  adminDataService.getRoundAchievements(roundDetail.value.roundId)
    .then((list) => { roundAchievements.value = list })
    .catch(() => { roundAchievements.value = [] })
    .finally(() => { roundAchievementsLoading.value = false })
}

function closeAchievementsPanel() {
  showAchievementsPanel.value = false
  achievementsRoundId.value = null
  roundAchievements.value = []
}

async function onDeleteConfirm() {
  if (!roundDetail.value) return
  deleteError.value = null
  deleteLoading.value = true
  try {
    await adminDataService.deleteRound(roundDetail.value.roundId)
    showDeleteModal.value = false
    roundDetail.value = null
    emit('post-delete')
    if (hasQueried.value) loadSessions()
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : 'Delete failed'
  } finally {
    deleteLoading.value = false
  }
}

async function onUndelete() {
  if (!roundDetail.value) return
  undeleteError.value = null
  roundDetailLoading.value = true
  try {
    await adminDataService.undeleteRound(roundDetail.value.roundId)
    emit('post-undelete')
    const id = roundDetail.value.roundId
    roundDetail.value = await adminDataService.getRoundDetail(id)
    if (hasQueried.value) loadSessions()
  } catch (e) {
    undeleteError.value = e instanceof Error ? e.message : 'Undelete failed'
  } finally {
    roundDetailLoading.value = false
  }
}
</script>

<style scoped>
.mm-admin-query__include {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 6px;
}

.mm-admin-query__checkbox {
  width: 14px;
  height: 14px;
  accent-color: var(--mm-accent);
}

.mm-admin-query__include-label {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  margin: 0;
}

.mm-admin-query__th-select,
.mm-admin-query__td-select {
  width: 36px;
  text-align: center;
}

.mm-admin-query__table .is-num { text-align: right; }

.mm-admin-query__kd-high {
  color: var(--mm-load-busy);
  font-weight: 500;
}

.mm-admin-query__bulk {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 10px 14px;
  border-top: 1px solid var(--mm-rule);
  background: var(--mm-bg-soft);
  font-size: 12px;
}

.mm-admin-query__bulk-info {
  color: var(--mm-ink-muted);
}

.mm-admin-query__bulk-desc {
  margin: 0;
  font-size: 13px;
  color: var(--mm-ink-soft);
  line-height: 1.5;
}
</style>
