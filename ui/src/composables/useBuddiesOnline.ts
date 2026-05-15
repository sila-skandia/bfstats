import { computed, onMounted, onUnmounted, ref } from 'vue'
import { fetchDashboardData } from '@/services/dashboardService'

/**
 * Tracks how many of the signed-in user's buddies are currently online.
 *
 * Sources from `/stats/auth/dashboard` (same endpoint the V4 dashboard
 * uses for its squad list). We deliberately reuse it rather than adding
 * a dedicated buddies-online endpoint — the dashboard payload is cheap
 * and the round-trip count is already accurate.
 *
 * Polls every 60s while the avatar is mounted. Silently zero on errors
 * (typically: user not signed in) so the badge cleanly disappears.
 */
export function useBuddiesOnline() {
  const onlineCount = ref(0)
  let timer: number | undefined

  const fetchOnlineCount = async (): Promise<void> => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      onlineCount.value = 0
      return
    }
    try {
      const data = await fetchDashboardData()
      onlineCount.value = data?.onlineBuddies?.length ?? 0
    } catch {
      onlineCount.value = 0
    }
  }

  onMounted(() => {
    void fetchOnlineCount()
    // Poll every 60s — same cadence the landing meta refreshes at.
    timer = window.setInterval(() => void fetchOnlineCount(), 60_000)
  })

  onUnmounted(() => {
    if (timer) window.clearInterval(timer)
  })

  return {
    onlineCount,
    hasOnlineBuddies: computed(() => onlineCount.value > 0),
    refresh: fetchOnlineCount,
  }
}
