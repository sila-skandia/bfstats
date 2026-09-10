<script setup lang="ts">
import MmBaseModal from '@/components/v4/MmBaseModal.vue'

export interface FormContributingSession {
  sessionId: number
  roundId?: string
  date: string
  mapName: string
  kills: number
  deaths: number
  kd: number
  deltaPercent: number
  teamResult: 'win' | 'loss' | 'tie' | 'unknown'
}

export interface FormInsight {
  status: 'surge' | 'slump' | 'steady' | 'dormant'
  badge: string
  label: string
  deltaPercent: number
  recentKd: number
  detail: string
  lifetimeKd: number
  lifetimeKills: number
  lifetimeDeaths: number
  sampleKills: number
  sampleDeaths: number
  sampleSize: number
  daysSincePlayed: number
  contributingSessions: FormContributingSession[]
}

defineProps<{
  modelValue: boolean
  playerName: string
  form: FormInsight | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const formatNumber = (n: number | null | undefined): string => {
  if (n == null) return '0'
  return n.toLocaleString()
}
</script>

<template>
  <MmBaseModal
    :model-value="modelValue"
    size="lg"
    title="# Current form"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="!form" class="mm-empty">
      No telemetry recorded for this combat profile.
    </div>

    <div v-else class="mm-form-modal">
      <!-- 1. Verdict bar -->
      <section class="mm-form-verdict" :class="`mm-form-verdict--${form.status}`">
        <div class="mm-form-verdict__badge">
          <span class="mm-form-dot" />
          <span class="mm-form-verdict__tag">{{ form.badge }}</span>
          <span class="mm-form-verdict__label">{{ form.label }}</span>
        </div>
        <div class="mm-form-verdict__narrative">
          <template v-if="form.status === 'surge'">
            <strong>+{{ form.deltaPercent }}%</strong> vs career average over the last {{ form.sampleSize }} sessions.
          </template>
          <template v-else-if="form.status === 'slump'">
            <strong>{{ form.deltaPercent }}%</strong> vs career average over the last {{ form.sampleSize }} sessions.
          </template>
          <template v-else-if="form.status === 'steady'">
            <strong>{{ form.deltaPercent >= 0 ? '+' : '' }}{{ form.deltaPercent }}%</strong> vs career average over the last {{ form.sampleSize }} sessions.
          </template>
          <template v-else>
            Inactive. Last round played was <strong>{{ Math.round(form.daysSincePlayed) }} days ago</strong>.
          </template>
        </div>
      </section>

      <!-- 2. Formula -->
      <section class="mm-form-section">
        <div class="mm-eyebrow mm-eyebrow--strong">Formula</div>
        <div class="mm-formula-box">
          <div class="mm-formula-line">
            <span class="mm-formula-kw">DELTA (%)</span>
            <span class="mm-formula-op">=</span>
            <span class="mm-formula-expr">((Recent K/D - Career K/D) / Career K/D) * 100</span>
          </div>
        </div>

        <div class="mm-calc-grid">
          <div class="mm-calc-card">
            <div class="mm-calc-card__title">Career baseline</div>
            <div class="mm-calc-card__val">{{ form.lifetimeKd.toFixed(2) }}</div>
            <div class="mm-calc-card__meta">
              <span class="mm-num--kill">{{ formatNumber(form.lifetimeKills) }} k</span>
              <span class="mm-num__sep">/</span>
              <span class="mm-num--death">{{ formatNumber(form.lifetimeDeaths) }} d</span>
            </div>
          </div>

          <div class="mm-calc-card">
            <div class="mm-calc-card__title">Last {{ form.sampleSize }} sessions</div>
            <div class="mm-calc-card__val">{{ form.recentKd.toFixed(2) }}</div>
            <div class="mm-calc-card__meta">
              <span class="mm-num--kill">{{ formatNumber(form.sampleKills) }} k</span>
              <span class="mm-num__sep">/</span>
              <span class="mm-num--death">{{ formatNumber(form.sampleDeaths) }} d</span>
            </div>
          </div>

          <div class="mm-calc-card" :class="`mm-calc-card--${form.status}`">
            <div class="mm-calc-card__title">Calculated shift</div>
            <div class="mm-calc-card__val mm-calc-card__val--delta">
              {{ form.deltaPercent >= 0 ? '+' : '' }}{{ form.deltaPercent }}%
            </div>
            <div class="mm-calc-card__meta">
              <span class="mm-calc-card__badge-inline">{{ form.badge }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 3. Thresholds -->
      <section class="mm-form-section">
        <div class="mm-eyebrow mm-eyebrow--strong">Thresholds</div>
        <div class="mm-rubric-table">
          <div
            class="mm-rubric-row"
            :class="{ 'mm-rubric-row--active': form.status === 'surge' }"
          >
            <div class="mm-rubric-cell mm-rubric-cell--badge">
              <span class="mm-form-badge mm-form--surge">[SURGE]</span>
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--rule">
              <code>DELTA &gt;= +15%</code>
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--desc">
              Recent combat efficiency significantly above career average.
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--status">
              <span v-if="form.status === 'surge'" class="mm-chip mm-chip--active">ACTIVE</span>
            </div>
          </div>

          <div
            class="mm-rubric-row"
            :class="{ 'mm-rubric-row--active': form.status === 'steady' }"
          >
            <div class="mm-rubric-cell mm-rubric-cell--badge">
              <span class="mm-form-badge mm-form--steady">[STEADY]</span>
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--rule">
              <code>-15% &lt; DELTA &lt; +15%</code>
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--desc">
              Tracking within expected baseline variance.
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--status">
              <span v-if="form.status === 'steady'" class="mm-chip mm-chip--active">ACTIVE</span>
            </div>
          </div>

          <div
            class="mm-rubric-row"
            :class="{ 'mm-rubric-row--active': form.status === 'slump' }"
          >
            <div class="mm-rubric-cell mm-rubric-cell--badge">
              <span class="mm-form-badge mm-form--slump">[SLUMP]</span>
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--rule">
              <code>DELTA &lt;= -15%</code>
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--desc">
              Recent combat performance substantially below career average.
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--status">
              <span v-if="form.status === 'slump'" class="mm-chip mm-chip--active">ACTIVE</span>
            </div>
          </div>

          <div
            class="mm-rubric-row"
            :class="{ 'mm-rubric-row--active': form.status === 'dormant' }"
          >
            <div class="mm-rubric-cell mm-rubric-cell--badge">
              <span class="mm-form-badge mm-form--dormant">[DORMANT]</span>
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--rule">
              <code>INACTIVE &gt; 30d OR N = 0</code>
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--desc">
              No rounds recorded in the preceding 30 days.
            </div>
            <div class="mm-rubric-cell mm-rubric-cell--status">
              <span v-if="form.status === 'dormant'" class="mm-chip mm-chip--active">ACTIVE</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 4. Recent sessions -->
      <section v-if="form.contributingSessions && form.contributingSessions.length > 0" class="mm-form-section">
        <div class="mm-eyebrow mm-eyebrow--strong">
          Recent sessions (last {{ form.contributingSessions.length }})
        </div>
        <div class="mm-sessions-table-wrap">
          <table class="mm-sessions-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Map</th>
                <th>Result</th>
                <th class="is-num">K / D</th>
                <th class="is-num">Session K/D</th>
                <th class="is-num">Vs Baseline</th>
                <th class="is-num">Round</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="s in form.contributingSessions"
                :key="s.sessionId"
                class="mm-sessions-table__row"
              >
                <td class="mm-sessions-table__date">{{ s.date }}</td>
                <td class="mm-sessions-table__map">{{ s.mapName }}</td>
                <td>
                  <span
                    class="mm-result-tag"
                    :class="`mm-result-tag--${s.teamResult}`"
                  >
                    [{{ s.teamResult === 'win' ? 'W' : s.teamResult === 'loss' ? 'L' : s.teamResult === 'tie' ? 'D' : '?' }}]
                  </span>
                </td>
                <td class="is-num">
                  <span class="mm-num--kill">{{ s.kills }}</span>
                  <span class="mm-num__sep">/</span>
                  <span class="mm-num--death">{{ s.deaths }}</span>
                </td>
                <td class="is-num mm-sessions-table__kd">{{ s.kd.toFixed(2) }}</td>
                <td
                  class="is-num mm-sessions-table__delta"
                  :class="s.deltaPercent >= 15 ? 'is-surge' : s.deltaPercent <= -15 ? 'is-slump' : 'is-steady'"
                >
                  {{ s.deltaPercent >= 0 ? '+' : '' }}{{ s.deltaPercent }}%
                </td>
                <td class="is-num">
                  <router-link
                    v-if="s.roundId"
                    :to="{
                      path: `/v4/rounds/${encodeURIComponent(s.roundId)}/report`,
                      query: { players: playerName },
                    }"
                    class="mm-round-link"
                    @click="emit('update:modelValue', false)"
                  >
                    Inspect [-&gt;]
                  </router-link>
                  <span v-else class="mm-round-link--none">--</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="mm-modal-actions">
        <button
          type="button"
          class="mm-btn mm-btn--secondary"
          @click="emit('update:modelValue', false)"
        >
          Dismiss
        </button>
      </div>
    </template>
  </MmBaseModal>
</template>

<style scoped>
.mm-form-modal {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 1. Verdict */
.mm-form-verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--mm-radius-sm, 3px);
  background: var(--mm-surface-soft, #161616);
  border-left: 3px solid var(--mm-ink-faint, #555555);
}

.mm-form-verdict--surge {
  border-left-color: var(--mm-success, #22c55e);
  background: rgba(34, 197, 94, 0.08);
}

.mm-form-verdict--slump {
  border-left-color: var(--mm-danger, #ef4444);
  background: rgba(239, 68, 68, 0.08);
}

.mm-form-verdict--steady {
  border-left-color: var(--mm-ink, #ffffff);
  background: rgba(255, 255, 255, 0.04);
}

.mm-form-verdict--dormant {
  border-left-color: var(--mm-ink-muted, #8a8a8a);
  background: rgba(255, 255, 255, 0.02);
}

.mm-form-verdict__badge {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mm-form-verdict__tag {
  font-family: var(--mm-font-mono);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.mm-form-verdict--surge .mm-form-verdict__tag { color: var(--mm-success, #22c55e); }
.mm-form-verdict--slump .mm-form-verdict__tag { color: var(--mm-danger, #ef4444); }
.mm-form-verdict--steady .mm-form-verdict__tag { color: var(--mm-ink, #ffffff); }
.mm-form-verdict--dormant .mm-form-verdict__tag { color: var(--mm-ink-muted, #8a8a8a); }

.mm-form-verdict__label {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-soft, #c8c8c8);
}

.mm-form-verdict__narrative {
  font-size: 13px;
  line-height: 1.5;
  color: var(--mm-ink-soft, #c8c8c8);
}

.mm-form-verdict__narrative strong {
  color: var(--mm-ink, #ffffff);
}

/* 2. Formula */
.mm-form-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mm-formula-box {
  padding: 12px 16px;
  background: #0d0d0d;
  border: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.1));
  border-radius: var(--mm-radius-sm, 3px);
  font-family: var(--mm-font-mono);
}

.mm-formula-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
}

.mm-formula-kw {
  color: #60a5fa;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.mm-formula-op {
  color: var(--mm-ink-muted, #8a8a8a);
}

.mm-formula-expr {
  color: #facc15;
  letter-spacing: 0.02em;
}

/* 3. Calc Grid */
.mm-calc-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

@media (max-width: 680px) {
  .mm-calc-grid {
    grid-template-columns: 1fr;
  }
}

.mm-calc-card {
  padding: 12px 14px;
  background: var(--mm-surface-soft, #161616);
  border: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.08));
  border-radius: var(--mm-radius-sm, 3px);
  display: flex;
  flex-direction: column;
}

.mm-calc-card__title {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted, #8a8a8a);
  margin-bottom: 6px;
}

.mm-calc-card__val {
  font-family: var(--mm-font-mono);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--mm-ink, #ffffff);
  line-height: 1.1;
  margin-bottom: 8px;
}

.mm-calc-card__val--delta {
  color: #60a5fa;
}

.mm-calc-card--surge .mm-calc-card__val--delta {
  color: var(--mm-success, #22c55e);
}

.mm-calc-card--slump .mm-calc-card__val--delta {
  color: var(--mm-danger, #ef4444);
}

.mm-calc-card__meta {
  margin-top: auto;
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.mm-calc-card__badge-inline {
  font-weight: 700;
  letter-spacing: 0.06em;
}

.mm-calc-card--surge .mm-calc-card__badge-inline { color: var(--mm-success, #22c55e); }
.mm-calc-card--slump .mm-calc-card__badge-inline { color: var(--mm-danger, #ef4444); }
.mm-calc-card--steady .mm-calc-card__badge-inline { color: var(--mm-ink, #ffffff); }
.mm-calc-card--dormant .mm-calc-card__badge-inline { color: var(--mm-ink-muted, #8a8a8a); }

/* 4. Rubric table */
.mm-rubric-table {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.mm-rubric-row {
  display: grid;
  grid-template-columns: 100px 170px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--mm-radius-sm, 3px);
  background: var(--mm-surface-soft, #161616);
  border: 1px solid transparent;
  font-size: 12px;
  transition: background 0.15s ease, border-color 0.15s ease;
}

@media (max-width: 768px) {
  .mm-rubric-row {
    grid-template-columns: 90px 1fr;
    gap: 6px 10px;
  }
  .mm-rubric-cell--desc {
    grid-column: 1 / -1;
  }
}

.mm-rubric-row--active {
  border-color: rgba(96, 165, 250, 0.4);
  background: rgba(96, 165, 250, 0.08);
}

.mm-rubric-cell--rule code {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: #fbbf24;
}

.mm-rubric-cell--desc {
  color: var(--mm-ink-soft, #c8c8c8);
  line-height: 1.4;
}

.mm-chip--active {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  padding: 2px 7px;
  border-radius: 2px;
  background: #2563eb;
  color: #ffffff;
  font-weight: 700;
}

/* 5. Contributing sessions table */
.mm-sessions-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.08));
  border-radius: var(--mm-radius-sm, 3px);
}

.mm-sessions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;
}

.mm-sessions-table th {
  padding: 8px 12px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted, #8a8a8a);
  background: #0f0f0f;
  border-bottom: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.1));
}

.mm-sessions-table td {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.mm-sessions-table__row:hover td {
  background: rgba(255, 255, 255, 0.03);
}

.mm-sessions-table__date {
  font-family: var(--mm-font-mono);
  color: var(--mm-ink-muted, #8a8a8a);
  white-space: nowrap;
}

.mm-sessions-table__map {
  color: var(--mm-ink, #ffffff);
  font-weight: 500;
}

.mm-result-tag {
  font-family: var(--mm-font-mono);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.06em;
}

.mm-result-tag--win { color: var(--mm-success, #22c55e); }
.mm-result-tag--loss { color: var(--mm-danger, #ef4444); }
.mm-result-tag--tie { color: var(--mm-ink-muted, #8a8a8a); }
.mm-result-tag--unknown { color: var(--mm-ink-faint, #555555); }

.mm-sessions-table__kd {
  font-family: var(--mm-font-mono);
  font-weight: 600;
  color: var(--mm-ink, #ffffff);
}

.mm-sessions-table__delta {
  font-family: var(--mm-font-mono);
  font-weight: 600;
}

.mm-sessions-table__delta.is-surge { color: var(--mm-success, #22c55e); }
.mm-sessions-table__delta.is-slump { color: var(--mm-danger, #ef4444); }
.mm-sessions-table__delta.is-steady { color: var(--mm-ink-soft, #c8c8c8); }

.mm-round-link {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: #60a5fa;
  text-decoration: none;
  white-space: nowrap;
}

.mm-round-link:hover {
  text-decoration: underline;
}

.mm-round-link--none {
  color: var(--mm-ink-faint, #555555);
}

.mm-modal-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
