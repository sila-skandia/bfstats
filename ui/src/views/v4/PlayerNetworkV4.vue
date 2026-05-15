<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchPlayerStats } from '@/services/playerStatsService'
import { decodePlayerName } from '@/utils/playerName'
import MmPlayerNetworkGraph from '@/components/v4/MmPlayerNetworkGraph.vue'
import MmPingProximityOrbit from '@/components/v4/MmPingProximityOrbit.vue'

const route = useRoute()
const router = useRouter()

const rawName = computed(() => decodeURIComponent(route.params.playerName as string))
const displayName = computed(() => decodePlayerName(rawName.value))

const primaryServerGuid = ref<string | null>(null)
const primaryServerName = ref<string | null>(null)

const loadPrimaryServer = async () => {
  try {
    const stats = await fetchPlayerStats(rawName.value)
    const top = stats.servers?.[0]
    if (top) {
      primaryServerGuid.value = top.serverGuid
      primaryServerName.value = top.serverName
    } else {
      primaryServerGuid.value = null
      primaryServerName.value = null
    }
  } catch {
    primaryServerGuid.value = null
    primaryServerName.value = null
  }
}

onMounted(loadPrimaryServer)
watch(rawName, loadPrimaryServer)

const goPlayer = (name: string) => {
  router.push(`/v4/players/${encodeURIComponent(name)}`)
}
</script>

<template>
  <div class="mm-container mm-section">
    <div class="mm-meta-row" style="margin-bottom: 14px">
      <router-link
        :to="`/v4/players/${encodeURIComponent(rawName)}`"
        class="mm-meta-row__strong"
        style="text-decoration: underline; text-underline-offset: 3px"
      >
        ← Back to {{ displayName }}
      </router-link>
    </div>

    <h1 class="mm-display">
      Network
      <span class="mm-display__muted">· {{ displayName }}</span>
    </h1>

    <hr class="mm-rule" style="margin-top: 24px; margin-bottom: 24px" />

    <section class="mm-section--tight">
      <MmPlayerNetworkGraph
        :player-name="rawName"
        @player-click="goPlayer"
      />
    </section>

    <section v-if="primaryServerGuid && primaryServerName" class="mm-section--tight" style="margin-top: 32px">
      <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px">
        Proximity orbit · {{ primaryServerName }}
      </div>
      <MmPingProximityOrbit
        seamless
        :server-guid="primaryServerGuid"
        :server-name="primaryServerName"
        @player-click="goPlayer"
      />
    </section>
  </div>
</template>
