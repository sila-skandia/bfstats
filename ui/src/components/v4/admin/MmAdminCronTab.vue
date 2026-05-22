<template>
  <section class="mm-admin-card">
    <div class="mm-admin-card__head">
      <h3 class="mm-admin-card__title mm-admin-card__title--strong">
        Cron
      </h3>
      <p class="mm-admin-card__desc">
        Trigger background jobs on demand. After deleting a round, run
        <strong>Daily Aggregate Refresh</strong> to recalc kills/deaths for
        affected periods.
      </p>
    </div>

    <div class="mm-admin-cron__body">
      <div v-if="jobError" class="mm-admin-alert mm-admin-alert--err">{{ jobError }}</div>
      <div v-if="jobSuccess" class="mm-admin-alert mm-admin-alert--ok">{{ jobSuccess }}</div>

      <ul class="mm-admin-cron__list">
        <li class="mm-admin-cron__item mm-admin-cron__item--priority">
          <div class="mm-admin-cron__body-text">
            <span class="mm-admin-cron__name">Daily Aggregate Refresh</span>
            <span class="mm-admin-cron__desc">
              ServerHourlyPatterns, HourlyPlayerPredictions, MapGlobalAverages.
              Run after round delete.
            </span>
          </div>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary mm-admin-btn--sm"
            :disabled="jobRunning !== null"
            @click="runJob('daily-aggregate-refresh', true)"
          >
            {{ jobRunning === 'daily-aggregate-refresh' ? 'Running…' : 'Run' }}
          </button>
        </li>

        <li class="mm-admin-cron__item">
          <div class="mm-admin-cron__body-text">
            <span class="mm-admin-cron__name">Weekly Cleanup</span>
            <span class="mm-admin-cron__desc">
              Stale this_week best scores, prune ServerOnlineCounts.
            </span>
          </div>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
            :disabled="jobRunning !== null"
            @click="runJob('weekly-cleanup', true)"
          >
            {{ jobRunning === 'weekly-cleanup' ? 'Running…' : 'Run' }}
          </button>
        </li>

        <li class="mm-admin-cron__item">
          <div class="mm-admin-cron__body-text">
            <span class="mm-admin-cron__name">Aggregate Backfill (tier)</span>
            <span class="mm-admin-cron__desc">
              Tier 1–4 by recency. Fire-and-forget; check logs.
            </span>
          </div>
          <div class="mm-admin-cron__actions">
            <select v-model.number="aggregateBackfillTier" class="mm-admin-select mm-admin-cron__select">
              <option :value="1">1</option>
              <option :value="2">2</option>
              <option :value="3">3</option>
              <option :value="4">4</option>
            </select>
            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
              :disabled="jobRunning !== null"
              @click="runJob('aggregate-backfill-tier', false)"
            >
              Start tier {{ aggregateBackfillTier }}
            </button>
          </div>
        </li>

        <li class="mm-admin-cron__item">
          <div class="mm-admin-cron__body-text">
            <span class="mm-admin-cron__name">Aggregate Backfill (full)</span>
            <span class="mm-admin-cron__desc">All tiers. Fire-and-forget.</span>
          </div>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
            :disabled="jobRunning !== null"
            @click="runJob('aggregate-backfill', false)"
          >
            Start
          </button>
        </li>

        <li class="mm-admin-cron__item">
          <div class="mm-admin-cron__body-text">
            <span class="mm-admin-cron__name">Server Map Stats Backfill</span>
            <span class="mm-admin-cron__desc">Full from Rounds; daily only ~2 months.</span>
          </div>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
            :disabled="jobRunning !== null"
            @click="runJob('server-map-stats-backfill', false)"
          >
            Start
          </button>
        </li>

        <li class="mm-admin-cron__item">
          <div class="mm-admin-cron__body-text">
            <span class="mm-admin-cron__name">Map Hourly Patterns Backfill</span>
            <span class="mm-admin-cron__desc">Full from Rounds; daily ~60 days.</span>
          </div>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
            :disabled="jobRunning !== null"
            @click="runJob('map-hourly-patterns-backfill', false)"
          >
            Start
          </button>
        </li>

        <li class="mm-admin-cron__item">
          <div class="mm-admin-cron__body-text">
            <span class="mm-admin-cron__name">Run All</span>
            <span class="mm-admin-cron__desc">Daily refresh + weekly cleanup. Fire-and-forget.</span>
          </div>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
            :disabled="jobRunning !== null"
            @click="runJob('run-all', false)"
          >
            Run all
          </button>
        </li>

        <li
          v-if="neo4jEnabled"
          class="mm-admin-cron__item mm-admin-cron__item--neo4j"
        >
          <div class="mm-admin-cron__body-text">
            <span class="mm-admin-cron__name">Neo4j Sync (Player Relationships)</span>
            <span class="mm-admin-cron__desc">
              Sync player co-play data to graph database. Last {{ neo4jSyncDays }} days.
              <span v-if="neo4jStatus" class="mm-admin-cron__neo4j-status">
                Schema: {{ neo4jStatus.isUpToDate ? '✓ up-to-date' : `⚠ ${neo4jStatus.pendingCount} pending` }}
              </span>
            </span>
          </div>
          <div class="mm-admin-cron__actions">
            <select v-model.number="neo4jSyncDays" class="mm-admin-select mm-admin-cron__select">
              <option :value="1">1 day</option>
              <option :value="7">7 days</option>
              <option :value="30">30 days</option>
              <option :value="90">90 days</option>
            </select>
            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--primary mm-admin-btn--sm"
              :disabled="jobRunning !== null"
              @click="runJob('neo4j-sync', true)"
            >
              {{ jobRunning === 'neo4j-sync' ? 'Syncing…' : 'Sync' }}
            </button>
          </div>
        </li>

        <li
          v-if="!neo4jEnabled && neo4jChecked"
          class="mm-admin-cron__item mm-admin-cron__item--disabled"
        >
          <div class="mm-admin-cron__body-text">
            <span class="mm-admin-cron__name">Neo4j Sync</span>
            <span class="mm-admin-cron__desc">Neo4j is not enabled in API configuration.</span>
          </div>
        </li>

        <li
          v-if="neo4jEnabled"
          class="mm-admin-cron__item mm-admin-cron__item--neo4j"
        >
          <div class="mm-admin-cron__body-text">
            <span class="mm-admin-cron__name">Detect Player Communities</span>
            <span class="mm-admin-cron__desc">
              Run community detection algorithms to identify player squads
              and social networks. Uses Louvain algorithm for clustering.
            </span>
          </div>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary mm-admin-btn--sm"
            :disabled="jobRunning !== null"
            @click="runJob('community-detection', true)"
          >
            {{ jobRunning === 'community-detection' ? 'Detecting…' : 'Detect' }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import * as adminJobsService from '@/services/adminJobsService'

const jobRunning = ref<string | null>(null)
const jobError = ref<string | null>(null)
const jobSuccess = ref<string | null>(null)
const aggregateBackfillTier = ref(1)
const neo4jSyncDays = ref(7)
const neo4jEnabled = ref(false)
const neo4jChecked = ref(false)
const neo4jStatus = ref<{
  appliedCount: number
  pendingCount: number
  isUpToDate: boolean
  appliedMigrations: string[]
  pendingMigrations: string[]
} | null>(null)

onMounted(async () => {
  try {
    neo4jStatus.value = await adminJobsService.getNeo4jMigrationStatus()
    neo4jEnabled.value = true
  } catch {
    neo4jEnabled.value = false
  } finally {
    neo4jChecked.value = true
  }
})

async function runJob(jobKey: string, _isBlocking: boolean) {
  jobError.value = null
  jobSuccess.value = null
  jobRunning.value = jobKey

  if (jobKey === 'neo4j-sync') {
    try {
      const res = await adminJobsService.triggerNeo4jSync(neo4jSyncDays.value)
      if (res.success) {
        jobSuccess.value = `Synced ${res.relationshipsProcessed} relationships in ${res.durationMs}ms`
        try {
          neo4jStatus.value = await adminJobsService.getNeo4jMigrationStatus()
        } catch { /* migration status is optional */ }
      } else {
        jobError.value = res.errorMessage || 'Neo4j sync failed'
      }
    } catch (e) {
      jobError.value = e instanceof Error ? e.message : 'Neo4j sync failed'
    } finally {
      jobRunning.value = null
    }
    return
  }

  let fn: () => Promise<{ message?: string; error?: string }>
  switch (jobKey) {
    case 'daily-aggregate-refresh':
      fn = adminJobsService.triggerDailyAggregateRefresh
      break
    case 'weekly-cleanup':
      fn = adminJobsService.triggerWeeklyCleanup
      break
    case 'aggregate-backfill-tier':
      fn = () => adminJobsService.triggerAggregateBackfillTier(aggregateBackfillTier.value)
      break
    case 'aggregate-backfill':
      fn = adminJobsService.triggerAggregateBackfill
      break
    case 'server-map-stats-backfill':
      fn = adminJobsService.triggerServerMapStatsBackfill
      break
    case 'map-hourly-patterns-backfill':
      fn = adminJobsService.triggerMapHourlyPatternsBackfill
      break
    case 'run-all':
      fn = adminJobsService.triggerRunAll
      break
    case 'community-detection':
      fn = adminJobsService.triggerCommunityDetection
      break
    default:
      jobRunning.value = null
      return
  }
  try {
    const res = await fn()
    jobSuccess.value = res.message ?? (_isBlocking ? 'Done.' : 'Started. Check logs.')
  } catch (e) {
    jobError.value = e instanceof Error ? e.message : 'Job failed'
  } finally {
    jobRunning.value = null
  }
}
</script>

<style scoped>
.mm-admin-cron__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 18px 18px;
}

.mm-admin-cron__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.mm-admin-cron__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-admin-cron__item:last-child {
  border-bottom: 0;
}

.mm-admin-cron__item--priority {
  background: rgba(125, 136, 73, 0.08);
  margin: 0 -18px;
  padding: 12px 18px;
}

.mm-admin-cron__item--neo4j {
  border-left: 2px solid var(--mm-accent);
  padding-left: 12px;
  margin-left: -14px;
}

.mm-admin-cron__item--disabled {
  opacity: 0.55;
}

.mm-admin-cron__item--disabled .mm-admin-cron__name {
  text-decoration: line-through;
}

.mm-admin-cron__body-text {
  flex: 1 1 16rem;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mm-admin-cron__name {
  font-family: var(--mm-font-display);
  font-size: 13px;
  font-weight: 500;
  color: var(--mm-ink);
}

.mm-admin-cron__desc {
  font-size: 12px;
  color: var(--mm-ink-muted);
  line-height: 1.5;
}

.mm-admin-cron__desc strong {
  color: var(--mm-ink);
  font-weight: 500;
}

.mm-admin-cron__neo4j-status {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-faint);
  margin-left: 8px;
}

.mm-admin-cron__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.mm-admin-cron__select {
  padding: 5px 24px 5px 10px;
  font-size: 12px;
  background-position: calc(100% - 14px) 50%, calc(100% - 9px) 50%;
  width: auto;
}
</style>
