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
        @click="switchTab('query')"
      >
        Query
      </button>
      <button
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'audit' }"
        @click="switchTab('audit')"
      >
        Audit
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'cron' }"
        @click="switchTab('cron')"
      >
        Cron
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'merge' }"
        @click="switchTab('merge')"
      >
        Merge
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'access' }"
        @click="switchTab('access')"
      >
        Access
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'notice' }"
        @click="switchTab('notice')"
      >
        Notice
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'ai-feedback' }"
        @click="switchTab('ai-feedback')"
      >
        AI feedback
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="mm-admin-tab"
        :class="{ 'mm-admin-tab--active': activeTab === 'tournaments' }"
        @click="switchTab('tournaments')"
      >
        Tournaments
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
          @click="switchTab('cron'); showPostDeleteAggregateHint = false"
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
          @click="switchTab('cron'); showPostUndeleteAggregateHint = false"
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

    <div v-if="isAdmin" v-show="activeTab === 'tournaments'">
      <AdminTournamentsV4 />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MmAdminQueryTab from '@/components/v4/admin/MmAdminQueryTab.vue'
import MmAdminAuditTab from '@/components/v4/admin/MmAdminAuditTab.vue'
import MmAdminCronTab from '@/components/v4/admin/MmAdminCronTab.vue'
import MmAdminMergeTab from '@/components/v4/admin/MmAdminMergeTab.vue'
import MmAdminAccessTab from '@/components/v4/admin/MmAdminAccessTab.vue'
import MmAdminNoticeTab from '@/components/v4/admin/MmAdminNoticeTab.vue'
import MmAdminAIFeedbackTab from '@/components/v4/admin/MmAdminAIFeedbackTab.vue'
import AdminTournamentsV4 from '@/views/v4/AdminTournamentsV4.vue'
import { useAuth } from '@/composables/useAuth'
import '@/styles/mm-admin.css'

type TabName = 'query' | 'audit' | 'cron' | 'merge' | 'access' | 'notice' | 'ai-feedback' | 'tournaments'

const route = useRoute()
const router = useRouter()
const { isAdmin } = useAuth()

const ADMIN_DATA_GAME_FILTER_KEY = 'bf1942_admin_data_game_filter'

const gameTypes = [
  { id: 'bf1942', label: 'BF1942' },
]

const VALID_TABS: TabName[] = ['query', 'audit', 'cron', 'merge', 'access', 'notice', 'ai-feedback', 'tournaments']

const activeTab = ref<TabName>('query')
const activeGameFilter = ref<string>('bf1942')
const showPostDeleteAggregateHint = ref(false)
const showPostUndeleteAggregateHint = ref(false)
const auditTabRef = ref<InstanceType<typeof MmAdminAuditTab> | null>(null)
const accessTabRef = ref<InstanceType<typeof MmAdminAccessTab> & { load?: () => void } | null>(null)
const noticeTabRef = ref<InstanceType<typeof MmAdminNoticeTab> & { load?: () => void } | null>(null)
const aiFeedbackTabRef = ref<InstanceType<typeof MmAdminAIFeedbackTab> & { load?: () => void } | null>(null)
const mergeTabRef = ref<InstanceType<typeof MmAdminMergeTab> & { load?: () => void } | null>(null)

function switchTab(tab: TabName) {
  if (!VALID_TABS.includes(tab)) return
  activeTab.value = tab

  // Sync tab into URL query parameters so refreshes keep active tab
  if (route.query.tab !== tab) {
    void router.replace({
      query: {
        ...route.query,
        tab
      }
    })
  }

  // Trigger load callbacks for tab components when selected
  if (tab === 'audit') auditTabRef.value?.load?.()
  else if (tab === 'merge') mergeTabRef.value?.load?.()
  else if (tab === 'access') accessTabRef.value?.load?.()
  else if (tab === 'notice') noticeTabRef.value?.load?.()
  else if (tab === 'ai-feedback') aiFeedbackTabRef.value?.load?.()
}

function setGameFilter(id: string) {
  if (!gameTypes.some((g) => g.id === id)) return
  activeGameFilter.value = id
  try {
    localStorage.setItem(ADMIN_DATA_GAME_FILTER_KEY, id)
  } catch { /* ignore */ }
}

const syncTabFromRoute = () => {
  const qTab = route.query.tab as string
  if (qTab && VALID_TABS.includes(qTab as TabName)) {
    activeTab.value = qTab as TabName
  }
}

watch(() => route.query.tab, () => {
  syncTabFromRoute()
})

onMounted(() => {
  syncTabFromRoute()
  try {
    const saved = localStorage.getItem(ADMIN_DATA_GAME_FILTER_KEY)
    if (saved && gameTypes.some((g) => g.id === saved)) activeGameFilter.value = saved
  } catch { /* ignore */ }
})
</script>
