import { computed, ref } from 'vue'

const STORAGE_KEY = 'bfstats_visited_servers_v1'
const MAX_ENTRIES = 20
const RECENCY_WINDOW_DAYS = 30

export interface VisitedServerRecord {
  guid: string
  name: string
  game: string
  lastVisitedAt: string
  visitCount: number
}

type StoredShape = VisitedServerRecord[]

const visited = ref<VisitedServerRecord[]>(loadFromStorage())

function loadFromStorage(): VisitedServerRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredShape
    if (!Array.isArray(parsed)) return []
    const cutoff = Date.now() - RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000
    return parsed
      .filter(entry => entry && entry.guid && entry.name)
      .filter(entry => {
        const ts = new Date(entry.lastVisitedAt).getTime()
        return Number.isFinite(ts) && ts >= cutoff
      })
  } catch {
    return []
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visited.value))
  } catch {
    // storage may be unavailable in private browsing — silent no-op is fine
  }
}

export function useVisitedServers() {
  const recordVisit = (guid: string, name: string, game: string): void => {
    if (!guid || !name) return
    const now = new Date().toISOString()
    const existing = visited.value.find(v => v.guid === guid)
    if (existing) {
      existing.lastVisitedAt = now
      existing.name = name
      existing.game = game || existing.game
      existing.visitCount = (existing.visitCount || 0) + 1
    } else {
      visited.value = [
        { guid, name, game, lastVisitedAt: now, visitCount: 1 },
        ...visited.value
      ]
    }
    visited.value = visited.value
      .sort((a, b) => new Date(b.lastVisitedAt).getTime() - new Date(a.lastVisitedAt).getTime())
      .slice(0, MAX_ENTRIES)
    persist()
  }

  const forget = (guid: string): void => {
    visited.value = visited.value.filter(v => v.guid !== guid)
    persist()
  }

  const clearAll = (): void => {
    visited.value = []
    persist()
  }

  const topForGame = (game: string, limit: number = 3) => computed(() =>
    visited.value
      .filter(v => !game || v.game === game)
      .sort((a, b) => {
        const recencyDiff = new Date(b.lastVisitedAt).getTime() - new Date(a.lastVisitedAt).getTime()
        if (Math.abs(recencyDiff) > 24 * 60 * 60 * 1000) return recencyDiff
        return (b.visitCount || 0) - (a.visitCount || 0)
      })
      .slice(0, limit)
  )

  const hasAny = computed(() => visited.value.length > 0)

  return {
    visited: computed(() => visited.value),
    hasAny,
    recordVisit,
    forget,
    clearAll,
    topForGame,
  }
}
