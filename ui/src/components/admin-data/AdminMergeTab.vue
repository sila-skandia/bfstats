<template>
  <section class="portal-card portal-merge">
    <div class="portal-merge-head">
      <h3 class="portal-merge-title">
        [ DUPLICATE SERVERS ]
      </h3>
      <p class="portal-merge-desc">
        On-demand servers can come back online with a new GUID from upstream. Groups below share the same Game / IP / Port / Name and are likely the same physical server. The default primary is the currently-live GUID (so the next poll won't create another duplicate); falls back to the most-active GUID when none are live. All data is re-pointed and aggregates recalc in the background.
      </p>
      <div class="portal-merge-head-actions">
        <input
          v-model="searchQuery"
          type="search"
          class="portal-input portal-input--mono portal-merge-search"
          placeholder="filter by name / ip / guid"
        >
        <button
          type="button"
          class="portal-btn portal-btn--ghost portal-btn--sm"
          :disabled="loading"
          @click="load"
        >
          refresh
        </button>
      </div>
    </div>

    <div
      v-if="error"
      class="portal-cron-err"
    >
      {{ error }}
    </div>
    <div
      v-if="successMsg"
      class="portal-cron-ok"
    >
      {{ successMsg }}
    </div>

    <template v-if="loading">
      <div class="portal-empty portal-empty--loading">
        <span class="portal-empty-dash">—</span>
        <span class="portal-empty-text">scanning...</span>
      </div>
    </template>
    <template v-else-if="candidates.length === 0">
      <div class="portal-empty">
        <span class="portal-empty-dash">∅</span>
        <span class="portal-empty-title">no duplicates</span>
        <span class="portal-empty-desc">No groups of servers share the same Game / IP / Port / Name for the selected game.</span>
      </div>
    </template>
    <template v-else-if="filteredCandidates.length === 0">
      <div class="portal-empty">
        <span class="portal-empty-dash">∅</span>
        <span class="portal-empty-title">no matches</span>
        <span class="portal-empty-desc">No duplicate groups match "{{ searchQuery }}". Clear the filter to see all {{ candidates.length }} group(s).</span>
      </div>
    </template>
    <template v-else>
      <ul class="portal-merge-list">
        <li
          v-for="{ candidate: c, originalIndex: idx } in filteredCandidates"
          :key="`${c.game}|${c.ip}|${c.port}|${c.name}`"
          class="portal-merge-item"
        >
          <header class="portal-merge-item-head">
            <div class="portal-merge-item-title">
              <span class="portal-merge-item-name">{{ c.name || '(no name)' }}</span>
              <span class="portal-merge-item-mono">{{ c.ip }}:{{ c.port }}</span>
              <span class="portal-merge-item-tag">{{ c.game }}</span>
            </div>
            <div class="portal-merge-item-meta">
              {{ c.guids.length }} GUIDs · {{ c.totalSessions.toLocaleString() }} sessions · {{ formatHours(c.totalPlaytimeMinutes) }}
            </div>
          </header>

          <table class="portal-merge-table">
            <thead>
              <tr>
                <th>primary</th>
                <th>guid</th>
                <th>online</th>
                <th>sessions</th>
                <th>playtime</th>
                <th>first</th>
                <th>last</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="g in c.guids"
                :key="g.serverGuid"
              >
                <td>
                  <input
                    :name="`primary-${idx}`"
                    type="radio"
                    :checked="primarySelections[idx] === g.serverGuid"
                    @change="primarySelections[idx] = g.serverGuid"
                  >
                </td>
                <td class="portal-merge-mono">
                  {{ g.serverGuid }}
                </td>
                <td>
                  <span :class="['portal-merge-badge', g.isOnline ? 'portal-merge-badge--on' : 'portal-merge-badge--off']">
                    {{ g.isOnline ? 'live' : 'offline' }}
                  </span>
                </td>
                <td class="portal-merge-mono">
                  {{ g.sessionCount.toLocaleString() }}
                </td>
                <td class="portal-merge-mono">
                  {{ formatHours(g.playtimeMinutes) }}
                </td>
                <td class="portal-merge-mono">
                  {{ g.firstSession ? formatDate(g.firstSession) : '—' }}
                </td>
                <td class="portal-merge-mono">
                  {{ g.lastSession ? formatDate(g.lastSession) : '—' }}
                </td>
              </tr>
            </tbody>
          </table>

          <div class="portal-merge-item-actions">
            <button
              type="button"
              class="portal-btn portal-btn--primary portal-btn--sm"
              :disabled="merging === idx"
              @click="confirmMerge(idx)"
            >
              {{ merging === idx ? 'merging...' : 'merge' }}
            </button>
          </div>
        </li>
      </ul>
    </template>

    <!-- Confirm modal -->
    <div
      v-if="confirmIdx !== null"
      class="portal-merge-modal"
      role="dialog"
      aria-modal="true"
      @click.self="confirmIdx = null"
    >
      <div class="portal-merge-modal-card">
        <h4 class="portal-merge-modal-title">Confirm merge</h4>
        <p class="portal-merge-modal-text">
          Merge <strong>{{ confirmDuplicateGuids.length }}</strong> duplicate GUID(s) into primary
          <code class="portal-merge-mono">{{ confirmPrimaryGuid }}</code>?
        </p>
        <ul class="portal-merge-modal-dupes">
          <li
            v-for="g in confirmDuplicateGuids"
            :key="g"
          >
            <code class="portal-merge-mono">{{ g }}</code>
          </li>
        </ul>
        <p class="portal-merge-modal-note">
          Sessions, rounds, achievements, online counts, tournaments, and favorites are re-pointed. Duplicate Server rows are hard-deleted. Aggregates rebuild in the background.
        </p>
        <div class="portal-merge-modal-actions">
          <button
            type="button"
            class="portal-btn portal-btn--ghost portal-btn--sm"
            @click="confirmIdx = null"
          >
            cancel
          </button>
          <button
            type="button"
            class="portal-btn portal-btn--primary portal-btn--sm"
            @click="performMerge"
          >
            merge
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { adminDataService, type ServerMergeCandidate } from '@/services/adminDataService';
import { formatDateTimeShort } from '@/utils/date';

const props = defineProps<{ gameFilter: string }>();

const candidates = ref<ServerMergeCandidate[]>([]);
const primarySelections = ref<string[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const successMsg = ref<string | null>(null);
const merging = ref<number | null>(null);
const confirmIdx = ref<number | null>(null);
const searchQuery = ref('');

const filteredCandidates = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const all = candidates.value.map((candidate, originalIndex) => ({ candidate, originalIndex }));
  if (!q) return all;
  return all.filter(({ candidate: c }) =>
    c.name.toLowerCase().includes(q)
    || c.ip.toLowerCase().includes(q)
    || String(c.port).includes(q)
    || c.guids.some((g) => g.serverGuid.toLowerCase().includes(q))
  );
});

const confirmPrimaryGuid = computed(() =>
  confirmIdx.value === null ? '' : primarySelections.value[confirmIdx.value]
);
const confirmDuplicateGuids = computed(() => {
  if (confirmIdx.value === null) return [];
  const c = candidates.value[confirmIdx.value];
  const primary = primarySelections.value[confirmIdx.value];
  return c.guids.map((g) => g.serverGuid).filter((g) => g !== primary);
});

function formatDate(iso: string): string {
  return formatDateTimeShort(iso);
}

function formatHours(minutes: number): string {
  if (!minutes) return '0h';
  const h = minutes / 60;
  if (h < 1) return `${Math.round(minutes)}m`;
  if (h < 100) return `${h.toFixed(1)}h`;
  return `${Math.round(h).toLocaleString()}h`;
}

function pickDefaultPrimary(c: ServerMergeCandidate): string {
  // Prefer the currently-live GUID — that's the one upstream is reporting now,
  // so merging into it stops the next poll from creating yet another duplicate.
  // The service already orders guids by playtime desc, so among multiple live
  // candidates we still pick the most active one. Fall back to highest playtime
  // when none are live.
  const live = c.guids.find((g) => g.isOnline);
  return (live ?? c.guids[0])?.serverGuid ?? '';
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await adminDataService.getServerMergeCandidates(props.gameFilter);
    candidates.value = res;
    primarySelections.value = res.map(pickDefaultPrimary);
  } catch (e) {
    candidates.value = [];
    primarySelections.value = [];
    error.value = e instanceof Error ? e.message : 'Failed to load merge candidates';
  } finally {
    loading.value = false;
  }
}

function confirmMerge(idx: number) {
  successMsg.value = null;
  error.value = null;
  if (!primarySelections.value[idx]) {
    error.value = 'Pick a primary GUID first';
    return;
  }
  confirmIdx.value = idx;
}

async function performMerge() {
  const idx = confirmIdx.value;
  if (idx === null) return;
  const primaryGuid = primarySelections.value[idx];
  const duplicateGuids = confirmDuplicateGuids.value;
  confirmIdx.value = null;
  merging.value = idx;
  try {
    const res = await adminDataService.mergeServers({ primaryGuid, duplicateGuids });
    successMsg.value =
      `Merged ${res.duplicateGuids.length} GUID(s) into ${res.primaryGuid}. ` +
      `Re-pointed ${res.repointedSessions} sessions, ${res.repointedRounds} rounds. ` +
      `Aggregates recalculating in the background.`;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Merge failed';
  } finally {
    merging.value = null;
  }
}

watch(() => props.gameFilter, () => {
  load();
});

defineExpose({ load });

onMounted(load);
</script>

<style scoped>
.portal-merge { padding-bottom: 0.5rem; }
.portal-merge-head { padding: 1rem 1.25rem; border-bottom: 1px solid var(--portal-border); display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0.75rem; }
.portal-merge-title { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.12em; color: var(--portal-accent); margin: 0 0 0.25rem; font-family: ui-monospace, monospace; flex: 1 1 100%; }
.portal-merge-desc { font-size: 0.8rem; color: var(--portal-text); margin: 0; line-height: 1.45; flex: 1 1 60%; min-width: 16rem; }
.portal-merge-head-actions { margin-left: auto; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.portal-merge-search { width: 18rem; max-width: 100%; padding: 0.4rem 0.6rem; font-size: 0.78rem; }

.portal-merge-list { list-style: none; margin: 0; padding: 0.5rem 1.25rem 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
.portal-merge-item { background: var(--portal-surface-elevated); border: 1px solid var(--portal-border); border-radius: 2px; }
.portal-merge-item-head { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--portal-border); }
.portal-merge-item-title { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.portal-merge-item-name { font-size: 0.85rem; font-weight: 600; color: var(--portal-text-bright); }
.portal-merge-item-mono { font-family: ui-monospace, monospace; font-size: 0.75rem; color: var(--portal-text); }
.portal-merge-item-tag { font-size: 0.65rem; font-weight: 600; letter-spacing: 0.08em; padding: 0.1rem 0.4rem; border: 1px solid var(--portal-border); color: var(--portal-accent); border-radius: 2px; text-transform: uppercase; font-family: ui-monospace, monospace; }
.portal-merge-item-meta { font-size: 0.75rem; color: var(--portal-text); margin-left: auto; font-family: ui-monospace, monospace; }

.portal-merge-table { width: 100%; font-size: 0.78rem; border-collapse: collapse; }
.portal-merge-table th { text-align: left; padding: 0.4rem 0.75rem; background: var(--portal-surface); color: var(--portal-accent); font-weight: 600; letter-spacing: 0.06em; font-family: ui-monospace, monospace; border-bottom: 1px solid var(--portal-border); font-size: 0.7rem; }
.portal-merge-table td { padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--portal-border); color: var(--portal-text-bright); }
.portal-merge-mono { font-family: ui-monospace, monospace; font-size: 0.75rem; }

.portal-merge-badge { display: inline-block; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.08em; padding: 0.1rem 0.4rem; border-radius: 2px; font-family: ui-monospace, monospace; text-transform: uppercase; }
.portal-merge-badge--on { color: var(--portal-accent); background: var(--portal-accent-dim); border: 1px solid rgba(0, 229, 160, 0.3); }
.portal-merge-badge--off { color: var(--portal-text); background: rgba(255, 255, 255, 0.03); border: 1px solid var(--portal-border); }

.portal-merge-item-actions { display: flex; justify-content: flex-end; padding: 0.6rem 0.75rem; gap: 0.5rem; }

.portal-merge-modal { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 1rem; }
.portal-merge-modal-card { background: var(--portal-surface); border: 1px solid var(--portal-border); border-radius: 2px; padding: 1.25rem; max-width: 32rem; width: 100%; }
.portal-merge-modal-title { font-size: 0.9rem; font-weight: 600; color: var(--portal-text-bright); margin: 0 0 0.75rem; letter-spacing: 0.06em; }
.portal-merge-modal-text { font-size: 0.85rem; color: var(--portal-text-bright); margin: 0 0 0.75rem; line-height: 1.4; }
.portal-merge-modal-dupes { list-style: none; padding: 0 0 0 0.5rem; margin: 0 0 0.75rem; max-height: 8rem; overflow-y: auto; font-size: 0.75rem; }
.portal-merge-modal-dupes li { padding: 0.15rem 0; }
.portal-merge-modal-note { font-size: 0.75rem; color: var(--portal-text); margin: 0 0 1rem; line-height: 1.4; opacity: 0.85; }
.portal-merge-modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }

@media (max-width: 640px) {
  .portal-merge-table thead { display: none; }
  .portal-merge-table tbody tr { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--portal-border); }
  .portal-merge-table td { padding: 0; border: none; font-size: 0.75rem; }
  .portal-merge-table td:nth-child(1) { grid-row: span 6; align-self: start; }
  .portal-merge-table td:nth-child(2) { font-weight: 600; }
  .portal-merge-table td:nth-child(2)::before { content: 'guid: '; color: var(--portal-accent); font-weight: 400; }
  .portal-merge-table td:nth-child(3)::before { content: 'status: '; color: var(--portal-accent); }
  .portal-merge-table td:nth-child(4)::before { content: 'sessions: '; color: var(--portal-accent); }
  .portal-merge-table td:nth-child(5)::before { content: 'playtime: '; color: var(--portal-accent); }
  .portal-merge-table td:nth-child(6)::before { content: 'first: '; color: var(--portal-accent); }
  .portal-merge-table td:nth-child(7)::before { content: 'last: '; color: var(--portal-accent); }
  .portal-merge-item-head { flex-direction: column; align-items: flex-start; }
  .portal-merge-item-meta { margin-left: 0; }
}
</style>
