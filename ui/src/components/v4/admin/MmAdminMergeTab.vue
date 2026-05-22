<template>
  <section class="mm-admin-card mm-admin-merge">
    <div class="mm-admin-card__head mm-admin-merge__head">
      <h3 class="mm-admin-card__title mm-admin-card__title--strong">
        Duplicate servers
      </h3>
      <p class="mm-admin-card__desc">
        On-demand servers can come back online with a new GUID from upstream.
        Groups below share the same Game / IP / Port / Name and are likely the
        same physical server. The default primary is the currently-live GUID
        (so the next poll won't create another duplicate); falls back to the
        most-active GUID when none are live. All data is re-pointed and
        aggregates recalc in the background.
      </p>
      <div class="mm-admin-merge__head-actions">
        <input
          v-model="searchQuery"
          type="search"
          class="mm-admin-input mm-admin-input--mono mm-admin-merge__search"
          placeholder="Filter by name / IP / GUID"
        >
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
          :disabled="loading"
          @click="load"
        >
          Refresh
        </button>
      </div>
    </div>

    <div class="mm-admin-merge__body">
      <div v-if="error" class="mm-admin-alert mm-admin-alert--err">{{ error }}</div>
      <div v-if="successMsg" class="mm-admin-alert mm-admin-alert--ok">{{ successMsg }}</div>

      <div v-if="loading" class="mm-admin-empty mm-admin-empty--loading">
        <span class="mm-admin-spinner" aria-hidden="true" />
        <span class="mm-admin-empty__text">Scanning…</span>
      </div>

      <div v-else-if="candidates.length === 0" class="mm-admin-empty">
        <span class="mm-admin-empty__title">No duplicates</span>
        <span class="mm-admin-empty__desc">
          No groups of servers share the same Game / IP / Port / Name for the selected game.
        </span>
      </div>

      <div v-else-if="filteredCandidates.length === 0" class="mm-admin-empty">
        <span class="mm-admin-empty__title">No matches</span>
        <span class="mm-admin-empty__desc">
          No duplicate groups match "{{ searchQuery }}". Clear the filter to see all {{ candidates.length }} group(s).
        </span>
      </div>

      <ul v-else class="mm-admin-merge__list">
        <li
          v-for="{ candidate: c, originalIndex: idx } in filteredCandidates"
          :key="`${c.game}|${c.ip}|${c.port}|${c.name}`"
          class="mm-admin-merge__item"
        >
          <header class="mm-admin-merge__item-head">
            <div class="mm-admin-merge__item-title">
              <span class="mm-admin-merge__item-name">{{ c.name || '(no name)' }}</span>
              <span class="mm-admin-merge__item-mono">{{ c.ip }}:{{ c.port }}</span>
              <span class="mm-admin-merge__item-tag">{{ c.game }}</span>
            </div>
            <div class="mm-admin-merge__item-meta">
              {{ c.guids.length }} GUIDs · {{ c.totalSessions.toLocaleString() }} sessions · {{ formatHours(c.totalPlaytimeMinutes) }}
            </div>
          </header>

          <div class="mm-admin-table-wrap">
            <table class="mm-admin-table mm-admin-merge__table">
              <thead>
                <tr>
                  <th>Primary</th>
                  <th>GUID</th>
                  <th>Online</th>
                  <th class="is-num">Sessions</th>
                  <th class="is-num">Playtime</th>
                  <th>First</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="g in c.guids" :key="g.serverGuid">
                  <td>
                    <input
                      :name="`primary-${idx}`"
                      type="radio"
                      :checked="primarySelections[idx] === g.serverGuid"
                      @change="primarySelections[idx] = g.serverGuid"
                    >
                  </td>
                  <td class="mm-admin-mono">{{ g.serverGuid }}</td>
                  <td>
                    <span
                      :class="['mm-admin-merge__badge', g.isOnline ? 'mm-admin-merge__badge--on' : 'mm-admin-merge__badge--off']"
                    >
                      {{ g.isOnline ? 'Live' : 'Offline' }}
                    </span>
                  </td>
                  <td class="is-num">{{ g.sessionCount.toLocaleString() }}</td>
                  <td class="is-num">{{ formatHours(g.playtimeMinutes) }}</td>
                  <td class="mm-admin-mono">{{ g.firstSession ? formatDate(g.firstSession) : '—' }}</td>
                  <td class="mm-admin-mono">{{ g.lastSession ? formatDate(g.lastSession) : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mm-admin-merge__item-actions">
            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--primary mm-admin-btn--sm"
              :disabled="merging === idx"
              @click="confirmMerge(idx)"
            >
              {{ merging === idx ? 'Merging…' : 'Merge' }}
            </button>
          </div>
        </li>
      </ul>
    </div>

    <!-- Manual search & merge -->
    <div class="mm-admin-merge__manual">
      <div class="mm-admin-merge__head mm-admin-merge__manual-head">
        <h3 class="mm-admin-card__title mm-admin-card__title--strong">
          Manual merge
        </h3>
        <p class="mm-admin-card__desc">
          Search for servers by name and select any combination to merge —
          useful for servers that changed GUID <em>and</em> name/IP.
        </p>
        <div class="mm-admin-merge__head-actions">
          <input
            v-model="manualSearch"
            type="search"
            class="mm-admin-input mm-admin-input--mono mm-admin-merge__search"
            placeholder="Search server name…"
            @keydown.enter="doManualSearch"
          >
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
            :disabled="manualSearching || !manualSearch.trim()"
            @click="doManualSearch"
          >
            {{ manualSearching ? 'Searching…' : 'Search' }}
          </button>
        </div>
      </div>

      <div v-if="manualSearchError" class="mm-admin-alert mm-admin-alert--err mm-admin-merge__manual-alert">
        {{ manualSearchError }}
      </div>

      <template v-if="manualResults.length > 0">
        <p class="mm-admin-merge__manual-hint">
          Check servers to include · set primary with the radio · then merge
        </p>
        <div class="mm-admin-table-wrap mm-admin-merge__manual-table-wrap">
          <table class="mm-admin-table mm-admin-merge__table">
            <thead>
              <tr>
                <th>Include</th>
                <th>Primary</th>
                <th>Name</th>
                <th>GUID</th>
                <th>IP:port</th>
                <th class="is-num">All-time players</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in manualResults"
                :key="r.serverGuid"
                :class="{ 'mm-admin-merge__manual-row--selected': manualSelected.has(r.serverGuid) }"
              >
                <td>
                  <input
                    type="checkbox"
                    :checked="manualSelected.has(r.serverGuid)"
                    @change="toggleManualSelect(r.serverGuid)"
                  >
                </td>
                <td>
                  <input
                    type="radio"
                    name="manual-primary"
                    :value="r.serverGuid"
                    :checked="manualPrimary === r.serverGuid"
                    :disabled="!manualSelected.has(r.serverGuid)"
                    @change="manualPrimary = r.serverGuid"
                  >
                </td>
                <td class="mm-admin-merge__item-name">{{ r.serverName }}</td>
                <td class="mm-admin-mono">{{ r.serverGuid }}</td>
                <td class="mm-admin-mono">{{ r.serverIp }}{{ r.serverPort ? `:${r.serverPort}` : '' }}</td>
                <td class="is-num">{{ r.totalPlayersAllTime?.toLocaleString() ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mm-admin-merge__manual-actions">
          <span class="mm-admin-merge__manual-hint-sm">
            {{ manualSelected.size }} selected · primary: {{ manualPrimary || 'none' }}
          </span>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary mm-admin-btn--sm"
            :disabled="manualSelected.size < 2 || !manualPrimary || manualMerging"
            @click="confirmManualMerge"
          >
            {{ manualMerging ? 'Merging…' : 'Merge selected' }}
          </button>
        </div>
      </template>
    </div>

    <!-- Confirm modal (auto-detected) -->
    <MmBaseModal
      :model-value="confirmIdx !== null"
      title="Confirm merge"
      size="md"
      @close="confirmIdx = null"
    >
      <p class="mm-admin-merge__modal-text">
        Merge <strong>{{ confirmDuplicateGuids.length }}</strong> duplicate GUID(s) into primary
        <code class="mm-admin-mono">{{ confirmPrimaryGuid }}</code>?
      </p>
      <ul class="mm-admin-merge__modal-dupes">
        <li v-for="g in confirmDuplicateGuids" :key="g">
          <code class="mm-admin-mono">{{ g }}</code>
        </li>
      </ul>
      <p class="mm-admin-merge__modal-note">
        Sessions, rounds, achievements, online counts, tournaments, and favorites
        are re-pointed. Duplicate Server rows are hard-deleted. Aggregates rebuild
        in the background.
      </p>
      <template #footer>
        <button type="button" class="mm-admin-btn mm-admin-btn--ghost" @click="confirmIdx = null">Cancel</button>
        <button type="button" class="mm-admin-btn mm-admin-btn--primary" @click="performMerge">Merge</button>
      </template>
    </MmBaseModal>

    <!-- Confirm modal (manual) -->
    <MmBaseModal
      :model-value="manualConfirm !== null"
      title="Confirm manual merge"
      size="md"
      @close="manualConfirm = null"
    >
      <template v-if="manualConfirm">
        <p class="mm-admin-merge__modal-text">
          Merge <strong>{{ manualConfirm.duplicateGuids.length }}</strong> GUID(s) into primary
          <code class="mm-admin-mono">{{ manualConfirm.primaryGuid }}</code>?
        </p>
        <ul class="mm-admin-merge__modal-dupes">
          <li v-for="g in manualConfirm.duplicateGuids" :key="g">
            <code class="mm-admin-mono">{{ g }}</code>
          </li>
        </ul>
        <p class="mm-admin-merge__modal-note">
          Sessions, rounds, achievements, online counts, tournaments, and favorites
          are re-pointed. Duplicate Server rows are hard-deleted. Aggregates rebuild
          in the background.
        </p>
      </template>
      <template #footer>
        <button type="button" class="mm-admin-btn mm-admin-btn--ghost" @click="manualConfirm = null">Cancel</button>
        <button type="button" class="mm-admin-btn mm-admin-btn--primary" @click="performManualMerge">Merge</button>
      </template>
    </MmBaseModal>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import {
  adminDataService,
  searchServersForAdmin,
  type ServerMergeCandidate,
  type ServerSearchResult,
} from '@/services/adminDataService'
import { formatDateTimeShort } from '@/utils/date'
import MmBaseModal from '@/components/v4/MmBaseModal.vue'

const props = defineProps<{ gameFilter: string }>()

const candidates = ref<ServerMergeCandidate[]>([])
const primarySelections = ref<string[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const successMsg = ref<string | null>(null)
const merging = ref<number | null>(null)
const confirmIdx = ref<number | null>(null)
const searchQuery = ref('')

const filteredCandidates = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const all = candidates.value.map((candidate, originalIndex) => ({ candidate, originalIndex }))
  if (!q) return all
  return all.filter(({ candidate: c }) =>
    c.name.toLowerCase().includes(q)
    || c.ip.toLowerCase().includes(q)
    || String(c.port).includes(q)
    || c.guids.some((g) => g.serverGuid.toLowerCase().includes(q)),
  )
})

const confirmPrimaryGuid = computed(() =>
  confirmIdx.value === null ? '' : primarySelections.value[confirmIdx.value],
)
const confirmDuplicateGuids = computed(() => {
  if (confirmIdx.value === null) return []
  const c = candidates.value[confirmIdx.value]
  const primary = primarySelections.value[confirmIdx.value]
  return c.guids.map((g) => g.serverGuid).filter((g) => g !== primary)
})

function formatDate(iso: string): string {
  return formatDateTimeShort(iso)
}

function formatHours(minutes: number): string {
  if (!minutes) return '0h'
  const h = minutes / 60
  if (h < 1) return `${Math.round(minutes)}m`
  if (h < 100) return `${h.toFixed(1)}h`
  return `${Math.round(h).toLocaleString()}h`
}

function pickDefaultPrimary(c: ServerMergeCandidate): string {
  const live = c.guids.find((g) => g.isOnline)
  return (live ?? c.guids[0])?.serverGuid ?? ''
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await adminDataService.getServerMergeCandidates(props.gameFilter)
    candidates.value = res
    primarySelections.value = res.map(pickDefaultPrimary)
  } catch (e) {
    candidates.value = []
    primarySelections.value = []
    error.value = e instanceof Error ? e.message : 'Failed to load merge candidates'
  } finally {
    loading.value = false
  }
}

function confirmMerge(idx: number) {
  successMsg.value = null
  error.value = null
  if (!primarySelections.value[idx]) {
    error.value = 'Pick a primary GUID first'
    return
  }
  confirmIdx.value = idx
}

async function performMerge() {
  const idx = confirmIdx.value
  if (idx === null) return
  const primaryGuid = primarySelections.value[idx]
  const duplicateGuids = confirmDuplicateGuids.value
  confirmIdx.value = null
  merging.value = idx
  try {
    const res = await adminDataService.mergeServers({ primaryGuid, duplicateGuids })
    successMsg.value =
      `Merged ${res.duplicateGuids.length} GUID(s) into ${res.primaryGuid}. ` +
      `Re-pointed ${res.repointedSessions} sessions, ${res.repointedRounds} rounds. ` +
      `Aggregates recalculating in the background.`
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Merge failed'
  } finally {
    merging.value = null
  }
}

// ---- Manual search & merge ----
const manualSearch = ref('')
const manualResults = ref<ServerSearchResult[]>([])
const manualSearching = ref(false)
const manualSelected = ref<Set<string>>(new Set())
const manualPrimary = ref('')
const manualConfirm = ref<{ primaryGuid: string; duplicateGuids: string[] } | null>(null)
const manualSearchError = ref<string | null>(null)
const manualMerging = ref(false)

async function doManualSearch() {
  if (!manualSearch.value.trim()) return
  manualSearching.value = true
  manualSearchError.value = null
  manualSelected.value = new Set()
  manualPrimary.value = ''
  try {
    const results = await searchServersForAdmin(manualSearch.value, 30, props.gameFilter || 'bf1942')
    manualResults.value = results
    manualSelected.value = new Set(results.map(r => r.serverGuid))
    const top = results.reduce<typeof results[0] | null>((best, r) =>
      !best || (r.totalPlayersAllTime ?? 0) > (best.totalPlayersAllTime ?? 0) ? r : best, null)
    manualPrimary.value = top?.serverGuid ?? ''
  } catch (e) {
    manualSearchError.value = e instanceof Error ? e.message : 'Search failed'
    manualResults.value = []
  } finally {
    manualSearching.value = false
  }
}

function toggleManualSelect(guid: string) {
  const s = new Set(manualSelected.value)
  if (s.has(guid)) {
    s.delete(guid)
    if (manualPrimary.value === guid) manualPrimary.value = ''
  } else {
    s.add(guid)
    if (!manualPrimary.value) manualPrimary.value = guid
  }
  manualSelected.value = s
}

function confirmManualMerge() {
  if (!manualPrimary.value || manualSelected.value.size < 2) return
  manualConfirm.value = {
    primaryGuid: manualPrimary.value,
    duplicateGuids: [...manualSelected.value].filter(g => g !== manualPrimary.value),
  }
}

async function performManualMerge() {
  if (!manualConfirm.value) return
  const { primaryGuid, duplicateGuids } = manualConfirm.value
  manualConfirm.value = null
  manualMerging.value = true
  error.value = null
  try {
    const res = await adminDataService.mergeServers({ primaryGuid, duplicateGuids })
    successMsg.value =
      `Merged ${res.duplicateGuids.length} GUID(s) into ${res.primaryGuid}. ` +
      `Re-pointed ${res.repointedSessions} sessions, ${res.repointedRounds} rounds. ` +
      `Aggregates recalculating in the background.`
    manualResults.value = []
    manualSelected.value = new Set()
    manualPrimary.value = ''
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Merge failed'
  } finally {
    manualMerging.value = false
  }
}

watch(() => props.gameFilter, () => {
  load()
  manualResults.value = []
  manualSelected.value = new Set()
  manualPrimary.value = ''
})

defineExpose({ load })

onMounted(load)
</script>

<style scoped>
.mm-admin-merge { padding-bottom: 8px; }

.mm-admin-merge__head {
  padding: 14px 18px;
  border-bottom: 1px solid var(--mm-rule);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
}

.mm-admin-merge__head .mm-admin-card__title,
.mm-admin-merge__head .mm-admin-card__desc { flex: 1 1 100%; }

.mm-admin-merge__head-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.mm-admin-merge__search {
  width: 18rem;
  max-width: 100%;
  padding: 6px 10px;
  font-size: 12.5px;
}

.mm-admin-merge__body {
  padding: 14px 18px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mm-admin-merge__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mm-admin-merge__item {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-admin-merge__item-head {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-admin-merge__item-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.mm-admin-merge__item-name {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  font-weight: 500;
  color: var(--mm-ink);
}

.mm-admin-merge__item-mono {
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  color: var(--mm-ink-muted);
}

.mm-admin-merge__item-tag {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.10em;
  padding: 2px 6px;
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink-soft);
  border-radius: 2px;
  text-transform: uppercase;
}

.mm-admin-merge__item-meta {
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  color: var(--mm-ink-muted);
  margin-left: auto;
}

.mm-admin-merge__table thead th { padding: 7px 12px; font-size: 9.5px; }
.mm-admin-merge__table tbody td { padding: 7px 12px; }

.mm-admin-merge__badge {
  display: inline-block;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.10em;
  padding: 2px 6px;
  border-radius: 2px;
  text-transform: uppercase;
}

.mm-admin-merge__badge--on {
  color: var(--mm-success);
  background: rgba(125, 163, 76, 0.10);
  border: 1px solid rgba(125, 163, 76, 0.40);
}

.mm-admin-merge__badge--off {
  color: var(--mm-ink-muted);
  border: 1px solid var(--mm-rule);
}

.mm-admin-merge__item-actions {
  display: flex;
  justify-content: flex-end;
  padding: 10px 12px;
  gap: 8px;
}

.mm-admin-merge__manual {
  border-top: 1px solid var(--mm-rule);
  margin-top: 18px;
}

.mm-admin-merge__manual-head { border-bottom: none; }
.mm-admin-merge__manual-alert { margin: 0 18px; }
.mm-admin-merge__manual-table-wrap { padding: 0 18px; }
.mm-admin-merge__manual-row--selected td { background: rgba(125, 136, 73, 0.06); }

.mm-admin-merge__manual-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 10px 18px 14px;
}

.mm-admin-merge__manual-hint {
  font-size: 12px;
  color: var(--mm-ink-muted);
  margin: 6px 18px 0;
}

.mm-admin-merge__manual-hint-sm {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
}

.mm-admin-merge__modal-text {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--mm-ink);
  line-height: 1.5;
}

.mm-admin-merge__modal-dupes {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  max-height: 8rem;
  overflow-y: auto;
  font-size: 12.5px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 8px 12px;
}

.mm-admin-merge__modal-dupes li { padding: 2px 0; }

.mm-admin-merge__modal-note {
  font-size: 12px;
  color: var(--mm-ink-muted);
  margin: 0;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .mm-admin-merge__table thead { display: none; }
  .mm-admin-merge__table tbody tr {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--mm-rule);
  }
  .mm-admin-merge__table td {
    padding: 0;
    border: none;
    font-size: 12px;
  }
  .mm-admin-merge__table .is-num { text-align: left; }
  .mm-admin-merge__item-head { flex-direction: column; align-items: flex-start; }
  .mm-admin-merge__item-meta { margin-left: 0; }
}
</style>
