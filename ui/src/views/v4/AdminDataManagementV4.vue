<template>
  <div class="mm mm-admin">
    <header class="mm-admin-header">
      <div>
        <h1 class="mm-admin-header__title">Data intel</h1>
        <p class="mm-admin-header__sub">
          Trace anomalous sessions. Modded servers, inflated stats,
          manipulation patterns.
        </p>
      </div>
      <div class="mm-admin-chips">
        <button
          v-for="g in gameTypes"
          :key="g.id"
          type="button"
          class="mm-admin-chip"
          :class="{ 'mm-admin-chip--active': activeGameFilter === g.id }"
          @click="setGameFilter(g.id)"
        >
          {{ g.label }}
        </button>
      </div>
    </header>

    <nav class="mm-admin-tabs" aria-label="Admin tabs">
      <button
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'query' }"
        @click="activeTab = 'query'"
      >
        Query
      </button>
      <button
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'audit' }"
        @click="activeTab = 'audit'; auditTabRef?.load?.()"
      >
        Audit
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'cron' }"
        @click="activeTab = 'cron'"
      >
        Cron
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'merge' }"
        @click="activeTab = 'merge'; mergeTabRef?.load?.()"
      >
        Merge
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'access' }"
        @click="activeTab = 'access'; accessTabRef?.load?.()"
      >
        Access
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'notice' }"
        @click="activeTab = 'notice'; noticeTabRef?.load?.()"
      >
        Notice
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'ai-feedback' }"
        @click="activeTab = 'ai-feedback'; aiFeedbackTabRef?.load?.()"
      >
        AI feedback
      </button>
    </nav>

    <div v-if="showPostDeleteAggregateHint" class="mm-admin-banner">
      <span class="mm-admin-banner__text">
        Round marked as deleted (achievements removed; round and sessions kept).
        Aggregate stats may be stale — run Daily Aggregate Refresh in Cron to recalc.
      </span>
      <div class="mm-admin-banner__actions">
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--primary mm-admin-btn--sm"
          @click="activeTab = 'cron'; showPostDeleteAggregateHint = false"
        >
          Go to Cron
        </button>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
          @click="showPostDeleteAggregateHint = false"
        >
          Dismiss
        </button>
      </div>
    </div>

    <div v-if="showPostUndeleteAggregateHint" class="mm-admin-banner">
      <span class="mm-admin-banner__text">
        Round restored. Aggregate stats may be stale — run Daily Aggregate
        Refresh in Cron to recalc. Achievements need to be rebuilt separately.
      </span>
      <div class="mm-admin-banner__actions">
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--primary mm-admin-btn--sm"
          @click="activeTab = 'cron'; showPostUndeleteAggregateHint = false"
        >
          Go to Cron
        </button>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
          @click="showPostUndeleteAggregateHint = false"
        >
          Dismiss
        </button>
      </div>
    </div>

    <div v-show="activeTab === 'query'">
      <MmAdminQueryTab
        :game-filter="activeGameFilter"
        :can-delete="isAdmin"
        @post-delete="showPostDeleteAggregateHint = true"
        @post-undelete="showPostUndeleteAggregateHint = true"
      />
    </div>

    <div v-show="activeTab === 'audit'">
      <MmAdminAuditTab ref="auditTabRef" />
    </div>

    <div v-if="isAdmin" v-show="activeTab === 'cron'">
      <MmAdminCronTab />
    </div>

    <div v-if="isAdmin" v-show="activeTab === 'merge'">
      <MmAdminMergeTab ref="mergeTabRef" :game-filter="activeGameFilter" />
    </div>

    <div v-show="activeTab === 'access'">
      <MmAdminAccessTab ref="accessTabRef" />
    </div>

    <div v-if="isAdmin" v-show="activeTab === 'notice'">
      <MmAdminNoticeTab ref="noticeTabRef" />
    </div>

    <div v-if="isAdmin" v-show="activeTab === 'ai-feedback'">
      <MmAdminAIFeedbackTab ref="aiFeedbackTabRef" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MmAdminQueryTab from '@/components/v4/admin/MmAdminQueryTab.vue'
import MmAdminAuditTab from '@/components/v4/admin/MmAdminAuditTab.vue'
import MmAdminCronTab from '@/components/v4/admin/MmAdminCronTab.vue'
import MmAdminMergeTab from '@/components/v4/admin/MmAdminMergeTab.vue'
import MmAdminAccessTab from '@/components/v4/admin/MmAdminAccessTab.vue'
import MmAdminNoticeTab from '@/components/v4/admin/MmAdminNoticeTab.vue'
import MmAdminAIFeedbackTab from '@/components/v4/admin/MmAdminAIFeedbackTab.vue'
import { useAuth } from '@/composables/useAuth'
import '@/styles/mm-admin.css'

const { isAdmin } = useAuth()

const ADMIN_DATA_GAME_FILTER_KEY = 'bf1942_admin_data_game_filter'

const gameTypes = [
  { id: 'bf1942', label: 'BF1942' },
  { id: 'fh2', label: 'FH2' },
  { id: 'bfvietnam', label: 'BFV' },
]

const activeTab = ref<'query' | 'audit' | 'cron' | 'merge' | 'access' | 'notice' | 'ai-feedback'>('query')
const activeGameFilter = ref<string>('bf1942')
const showPostDeleteAggregateHint = ref(false)
const showPostUndeleteAggregateHint = ref(false)
const auditTabRef = ref<InstanceType<typeof MmAdminAuditTab> | null>(null)
const accessTabRef = ref<InstanceType<typeof MmAdminAccessTab> & { load?: () => void } | null>(null)
const noticeTabRef = ref<InstanceType<typeof MmAdminNoticeTab> & { load?: () => void } | null>(null)
const aiFeedbackTabRef = ref<InstanceType<typeof MmAdminAIFeedbackTab> & { load?: () => void } | null>(null)
const mergeTabRef = ref<InstanceType<typeof MmAdminMergeTab> & { load?: () => void } | null>(null)

function setGameFilter(id: string) {
  if (!gameTypes.some((g) => g.id === id)) return
  activeGameFilter.value = id
  try {
    localStorage.setItem(ADMIN_DATA_GAME_FILTER_KEY, id)
  } catch { /* ignore */ }
}

onMounted(() => {
  try {
    const saved = localStorage.getItem(ADMIN_DATA_GAME_FILTER_KEY)
    if (saved && gameTypes.some((g) => g.id === saved)) activeGameFilter.value = saved
  } catch { /* ignore */ }
})
</script>
