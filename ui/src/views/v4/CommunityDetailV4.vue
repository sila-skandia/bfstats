<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchCommunity, type PlayerCommunity } from '@/services/playerRelationshipsApi'

const route = useRoute()
const router = useRouter()

const community = ref<PlayerCommunity | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const activeTab = ref<'members' | 'servers'>('members')

const cohesionPercentage = computed(() =>
  community.value ? Math.round(community.value.cohesionScore * 100) : 0,
)

const statusLabel = computed(() => {
  const c = community.value
  if (!c?.isActive) return 'Inactive'
  if (c.cohesionScore >= 0.7) return 'Tight-knit'
  if (c.cohesionScore >= 0.5) return 'Active'
  return 'Emerging'
})

const statusTone = computed(() => {
  const c = community.value
  if (!c?.isActive) return 'off' as const
  return 'on' as const
})

const loadCommunity = async () => {
  loading.value = true
  error.value = null
  try {
    const communityId = route.params.id as string
    community.value = await fetchCommunity(decodeURIComponent(communityId))
  } catch (err) {
    error.value = 'Failed to load community details'
    console.error(err)
  } finally {
    loading.value = false
  }
}

const formatDate = (iso: string): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const coreSet = computed(() => new Set(community.value?.coreMembers ?? []))

const sortedMembers = computed(() => {
  const list = community.value?.members ?? []
  return [...list].sort((a, b) => {
    const aCore = coreSet.value.has(a) ? 0 : 1
    const bCore = coreSet.value.has(b) ? 0 : 1
    if (aCore !== bCore) return aCore - bCore
    return a.localeCompare(b)
  })
})

onMounted(loadCommunity)
</script>

<template>
  <div class="mm-container mm-section">
    <div class="mm-meta-row" style="margin-bottom: 14px">
      <a
        href="#"
        class="mm-meta-row__strong"
        style="text-decoration: underline; text-underline-offset: 3px"
        @click.prevent="router.back()"
      >← Back</a>
    </div>

    <div v-if="loading" style="padding: 32px 0">
      <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 12px" />
    </div>

    <div v-else-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="loadCommunity">Retry</button>
    </div>

    <template v-else-if="community">
      <header style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap">
        <div style="min-width: 0">
          <h1 class="mm-display">
            {{ community.name }}
          </h1>
          <p class="mm-card__hint" style="margin-top: 4px; font-family: var(--mm-font-mono)">{{ community.id }}</p>
        </div>
        <span class="mm-chip" :class="{ 'mm-chip--off': statusTone === 'off' }">
          <span class="mm-chip__dot" />{{ statusLabel }}
        </span>
      </header>

      <hr class="mm-rule" style="margin-top: 24px" />

      <div class="mm-stats" style="border-top: 0; margin-top: 0">
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Members</div>
          <div class="mm-stat__value">{{ community.memberCount }}</div>
          <div class="mm-stat__delta">{{ community.coreMembers.length }} core</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Cohesion</div>
          <div class="mm-stat__value">{{ cohesionPercentage }}<span class="mm-stat__suffix">%</span></div>
          <div class="mm-stat__delta">co-play strength</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Avg sessions / pair</div>
          <div class="mm-stat__value">{{ community.avgSessionsPerPair.toFixed(1) }}</div>
          <div class="mm-stat__delta">shared rounds per duo</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Primary servers</div>
          <div class="mm-stat__value">{{ community.primaryServers.length }}</div>
          <div class="mm-stat__delta">recurring meeting points</div>
        </div>
      </div>

      <div class="mm-card__hint" style="margin-top: 16px">
        Formed {{ formatDate(community.formationDate) }} · last active {{ formatDate(community.lastActiveDate) }}
      </div>

      <div class="mm-tabs" style="margin-top: 28px">
        <button
          v-for="t in [
            { id: 'members', label: `Members · ${community.memberCount}` },
            { id: 'servers', label: `Servers · ${community.primaryServers.length}` },
          ]"
          :key="t.id"
          type="button"
          class="mm-tab"
          :class="{ 'mm-tab--active': activeTab === t.id }"
          @click="activeTab = t.id as 'members' | 'servers'"
        >{{ t.label }}</button>
      </div>

      <div v-if="activeTab === 'members'" style="margin-top: 12px">
        <table class="mm-list">
          <thead>
            <tr>
              <th>Player</th>
              <th style="width: 120px">Role</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="member in sortedMembers"
              :key="member"
              @click="router.push(`/v4/players/${encodeURIComponent(member)}`)"
            >
              <td class="mm-list__name-cell">
                <div class="mm-list__name">
                  <span class="mm-list__name-primary">{{ $pn(member) }}</span>
                </div>
              </td>
              <td data-cell-label="Role">
                <span v-if="coreSet.has(member)" class="mm-chip"><span class="mm-chip__dot" />Core</span>
                <span v-else class="is-muted">Member</span>
              </td>
            </tr>
            <tr v-if="sortedMembers.length === 0">
              <td colspan="2" class="mm-empty" style="border: 0">No members recorded.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="activeTab === 'servers'" style="margin-top: 12px">
        <table class="mm-list">
          <thead>
            <tr>
              <th>Server</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="server in community.primaryServers"
              :key="server"
              @click="router.push(`/v4/servers/detail/${encodeURIComponent(server)}`)"
            >
              <td class="mm-list__name-cell">
                <div class="mm-list__name">
                  <span class="mm-list__name-primary">{{ server }}</span>
                </div>
              </td>
            </tr>
            <tr v-if="community.primaryServers.length === 0">
              <td class="mm-empty" style="border: 0">No primary servers recorded.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
