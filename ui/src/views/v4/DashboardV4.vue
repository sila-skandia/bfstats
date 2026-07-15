<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { fetchDashboardData, type DashboardResponse, type OnlineBuddy, type FavoriteServer } from '@/services/dashboardService'
import { statsService, type UserPlayerNameEntry } from '@/services/statsService'
import { kdClass, loadClass } from './mmTokens'
import { decodePlayerName } from '@/utils/playerName'
import { parseUtc, formatLocalTooltip } from '@/utils/timeUtils'
import MmAddBuddyModal from '@/components/v4/MmAddBuddyModal.vue'
import MmAddServerModal from '@/components/v4/MmAddServerModal.vue'
import MmAddAliasModal from '@/components/v4/MmAddAliasModal.vue'

const router = useRouter()
const { user, isAuthenticated, logout } = useAuth()

type Tab = 'squad' | 'aliases' | 'servers' | 'tournaments'
const activeTab = ref<Tab>('squad')
const tabs: { id: Tab; label: string }[] = [
  { id: 'squad', label: 'Squad' },
  { id: 'aliases', label: 'Aliases' },
  { id: 'servers', label: 'Servers' },
  { id: 'tournaments', label: 'Tournaments' },
]

const data = ref<DashboardResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const showAddBuddy = ref(false)
const showAddServer = ref(false)
const showAddAlias = ref(false)

const aliases = ref<UserPlayerNameEntry[]>([])
const aliasesLoading = ref(false)

const load = async () => {
  if (!isAuthenticated.value) return
  loading.value = true
  error.value = null
  try {
    data.value = await fetchDashboardData()
  } catch (e) {
    error.value = 'Dashboard feed unavailable.'
  } finally {
    loading.value = false
  }
}

const loadAliases = async () => {
  if (!isAuthenticated.value) return
  aliasesLoading.value = true
  try {
    aliases.value = await statsService.getPlayerNames()
  } catch (e) {
    console.error('Failed to load aliases', e)
  } finally {
    aliasesLoading.value = false
  }
}

onMounted(() => {
  void load()
  void loadAliases()
})

const onlineBuddies = computed<OnlineBuddy[]>(() => data.value?.onlineBuddies ?? [])
const favouriteServers = computed<FavoriteServer[]>(() => data.value?.favoriteServers ?? [])
const offlineBuddies = computed(() => data.value?.offlineBuddies ?? [])
const totalSquad = computed(() => onlineBuddies.value.length + offlineBuddies.value.length)

const displayName = computed(() => user.value?.name ? decodePlayerName(user.value.name) : 'recruit')

const kdValue = (b: OnlineBuddy): number => {
  if (b.currentDeaths === 0) return b.currentKills
  return b.currentKills / b.currentDeaths
}

const monogram = (name: string): string => {
  const decoded = decodePlayerName(name)
  return decoded.charAt(0).toUpperCase() || '?'
}

const formatHours = (mins: number): string => {
  if (!mins) return '0h'
  const h = mins / 60
  if (h < 24) return `${Math.round(h)}h`
  const d = Math.floor(h / 24)
  return `${d}d ${Math.round(h % 24)}h`
}

const formatRelative = (iso: string): string => {
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return '—'
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`
  return `${Math.round(ms / (30 * 86_400_000))}mo ago`
}

const goPlayer = (name: string) => router.push(`/v4/players/${encodeURIComponent(name)}`)
const goProfileWrapped = () => {
  if (user.value?.id) router.push(`/v4/wrapped/profile/${user.value.id}`)
}
const goServer = (name: string) => router.push(`/v4/servers/detail/${encodeURIComponent(name)}`)

const joinServer = (joinLink: string) => {
  if (!joinLink) return
  // Battlefield join URLs are bf2:// or similar — let the OS handle the protocol.
  window.location.href = joinLink
}

const removeFavourite = async (id: number) => {
  try {
    await statsService.removeFavoriteServer(id)
    await load()
  } catch (e) {
    console.error('Failed to remove favourite server', e)
  }
}

const onBuddyAdded = async () => {
  showAddBuddy.value = false
  await load()
}
const onServerAdded = async () => {
  showAddServer.value = false
  await load()
}
const onAliasAdded = async () => {
  await loadAliases()
}
const removeAlias = async (id: number) => {
  try {
    await statsService.removePlayerName(id)
    await loadAliases()
  } catch (e) {
    console.error('Failed to remove alias', e)
  }
}

const handleSignOut = () => {
  logout()
  router.push('/v4/servers/bf1942')
}
</script>

<template>
  <div class="mm-container mm-section">
    <!-- Welcome -->
    <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 8px">Welcome back</div>
    <h1 class="mm-display">
      Hello, <span class="mm-dash__name">{{ displayName }}</span>
    </h1>
    <p class="mm-display" style="font-size: clamp(14px, 1.4vw, 18px); margin-top: 6px; color: var(--mm-ink-soft)">
      <template v-if="onlineBuddies.length > 0">
        {{ onlineBuddies.length }} of your squad {{ onlineBuddies.length === 1 ? 'is' : 'are' }} deployed right now.
      </template>
      <template v-else-if="totalSquad > 0">
        No squad members in combat right now.
      </template>
      <template v-else>
        Add buddies to track when they go online.
      </template>
    </p>

    <hr class="mm-rule" style="margin-top: 24px" />

    <!-- Loading / error -->
    <div v-if="loading" style="padding: 24px 0">
      <div v-for="i in 4" :key="i" class="mm-skeleton mm-skeleton--lg" style="margin-bottom: 12px" />
    </div>
    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <template v-else>
      <!-- Tabs: squad (default) / servers — same pattern as the
           server-detail and player-detail tab rails. -->
      <div class="mm-tabs" style="margin-top: 24px">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          class="mm-tab"
          :class="{ 'mm-tab--active': activeTab === t.id }"
          @click="activeTab = t.id"
        >
          {{ t.label }}
          <span v-if="t.id === 'squad'" class="mm-tab__badge">{{ onlineBuddies.length }}</span>
          <span v-else-if="t.id === 'aliases'" class="mm-tab__badge">{{ aliases.length }}</span>
          <span v-else-if="t.id === 'servers'" class="mm-tab__badge">{{ favouriteServers.length }}</span>
        </button>
      </div>

      <!-- Squad tab -->
      <section v-if="activeTab === 'squad'" style="margin-top: 24px">
        <header class="mm-dash__section-head">
          <div class="mm-eyebrow mm-eyebrow--strong">Squad · in combat</div>
          <div class="mm-dash__section-meta">
            <span><span class="mm-meta-row__strong">{{ onlineBuddies.length }}</span> online · {{ totalSquad }} total</span>
            <button type="button" class="mm-btn mm-btn--inline" @click="showAddBuddy = true">+ Add</button>
          </div>
        </header>

        <ol v-if="onlineBuddies.length > 0" class="mm-dash__squad">
          <li
            v-for="buddy in onlineBuddies"
            :key="`${buddy.playerName}-${buddy.serverGuid}`"
            class="mm-dash__squad-row"
          >
            <span class="mm-dash__monogram">{{ monogram(buddy.playerName) }}</span>
            <div class="mm-dash__squad-body">
              <button
                type="button"
                class="mm-dash__squad-name"
                @click="goPlayer(buddy.playerName)"
              >{{ $pn(buddy.playerName) }}</button>
              <div class="mm-dash__squad-sub">
                <button
                  type="button"
                  class="mm-dash__squad-server"
                  @click="goServer(buddy.serverName)"
                >{{ buddy.serverName }}</button>
                <span class="mm-meta-row__sep">·</span>
                <span>{{ buddy.currentMap || '—' }}</span>
              </div>
              <div class="mm-dash__squad-stats">
                <span>K <span class="mm-num--kill">{{ buddy.currentKills }}</span></span>
                <span class="mm-meta-row__sep">·</span>
                <span>D <span class="mm-num--death">{{ buddy.currentDeaths }}</span></span>
                <span class="mm-meta-row__sep">·</span>
                <span :class="kdClass(kdValue(buddy))">{{ kdValue(buddy).toFixed(2) }} K/D</span>
              </div>
            </div>
            <button
              v-if="buddy.joinLink"
              type="button"
              class="mm-btn mm-btn--inline mm-dash__join"
              @click="joinServer(buddy.joinLink)"
            >Join</button>
          </li>
        </ol>

        <div v-else-if="totalSquad === 0" class="mm-empty" style="padding: 28px">
          No squad yet — add some buddies to see when they're playing.
        </div>

        <!-- Offline buddies — always shown so the user sees their full
             squad, not just whoever happens to be online right now. -->
        <div v-if="offlineBuddies.length > 0" class="mm-dash__offline">
          <div class="mm-eyebrow" style="margin-bottom: 10px">
            Offline · {{ offlineBuddies.length }}
          </div>
          <ol class="mm-dash__offline-list">
            <li
              v-for="b in offlineBuddies"
              :key="b.playerName"
              class="mm-dash__offline-row"
              @click="goPlayer(b.playerName)"
            >
              <span class="mm-dash__monogram mm-dash__monogram--muted">{{ monogram(b.playerName) }}</span>
              <div class="mm-dash__offline-body">
                <span class="mm-dash__offline-name">{{ $pn(b.playerName) }}</span>
                <span class="mm-dash__offline-sub">
                  Last seen <span :title="formatLocalTooltip(b.lastSeen)">{{ formatRelative(b.lastSeen) }}</span> ·
                  {{ formatHours(b.totalPlayTimeMinutes) }} total
                </span>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <!-- Aliases tab -->
      <section v-if="activeTab === 'aliases'" style="margin-top: 24px">
        <header class="mm-dash__section-head">
          <div class="mm-eyebrow mm-eyebrow--strong">Aliases · your accounts</div>
          <div class="mm-dash__section-meta">
            <span><span class="mm-meta-row__strong">{{ aliases.length }}</span> linked</span>
            <button type="button" class="mm-btn mm-btn--inline" @click="showAddAlias = true">+ Add</button>
          </div>
        </header>

        <div v-if="aliases.length > 0" style="margin-bottom: 16px">
          <button type="button" class="mm-btn mm-btn--accent" @click="goProfileWrapped">View Your Wrapped →</button>
        </div>

        <div v-if="aliasesLoading" style="padding: 12px 0">
          <div v-for="i in 3" :key="i" class="mm-skeleton mm-skeleton--lg" style="margin-bottom: 10px" />
        </div>

        <ol v-else-if="aliases.length > 0" class="mm-dash__alias-list">
          <li
            v-for="alias in aliases"
            :key="alias.id"
            class="mm-dash__alias-row"
          >
            <span class="mm-dash__monogram">{{ monogram(alias.playerName) }}</span>
            <div class="mm-dash__alias-body">
              <button
                type="button"
                class="mm-dash__squad-name"
                @click="goPlayer(alias.playerName)"
              >{{ $pn(alias.playerName) }}</button>
              <span class="mm-dash__offline-sub">
                Linked <span :title="formatLocalTooltip(alias.createdAt)">{{ formatRelative(alias.createdAt) }}</span>
              </span>
            </div>
            <button
              type="button"
              class="mm-btn mm-btn--inline mm-dash__remove"
              @click="removeAlias(alias.id)"
              title="Remove alias"
            >×</button>
          </li>
        </ol>

        <div v-else class="mm-empty" style="padding: 28px">
          No aliases linked yet — add your in-game names so we know it's you.
        </div>
      </section>

      <!-- Servers tab -->
      <section v-if="activeTab === 'servers'" style="margin-top: 24px">
        <header class="mm-dash__section-head">
          <div class="mm-eyebrow mm-eyebrow--strong">Favourite servers</div>
          <div class="mm-dash__section-meta">
            <span><span class="mm-meta-row__strong">{{ favouriteServers.filter(s => s.currentPlayers > 0).length }}</span> active</span>
            <button type="button" class="mm-btn mm-btn--inline" @click="showAddServer = true">+ Add</button>
          </div>
        </header>

        <div v-if="favouriteServers.length > 0" class="mm-dash__servers">
          <article
            v-for="srv in favouriteServers"
            :key="srv.id"
            class="mm-dash__server"
            @click="goServer(srv.serverName)"
          >
            <header class="mm-dash__server-head">
              <span class="mm-dash__server-name">{{ srv.serverName }}</span>
              <span class="mm-chip" :class="{ 'mm-chip--off': srv.currentPlayers === 0 }">
                <span class="mm-chip__dot" />
                {{ srv.currentPlayers > 0 ? 'Online' : 'Quiet' }}
              </span>
            </header>
            <div class="mm-dash__server-map">{{ srv.currentMap || '—' }}</div>
            <div class="mm-dash__server-load">
              <span>
                <span :class="loadClass(srv.maxPlayers ? srv.currentPlayers / srv.maxPlayers : 0)">{{ srv.currentPlayers }}</span>
                <span style="color: var(--mm-ink-faint)"> / {{ srv.maxPlayers }}</span>
              </span>
              <div class="mm-list__bar" style="flex: 1; margin: 0 0 0 12px">
                <div
                  class="mm-list__bar-fill"
                  :class="{ 'mm-list__bar-fill--accent': srv.maxPlayers && srv.currentPlayers / srv.maxPlayers >= 0.66 }"
                  :style="{ width: (srv.maxPlayers ? Math.min(100, (srv.currentPlayers / srv.maxPlayers) * 100) : 0) + '%' }"
                />
              </div>
            </div>
            <div class="mm-dash__server-actions">
              <button
                v-if="srv.joinLink"
                type="button"
                class="mm-btn mm-btn--inline"
                @click.stop="joinServer(srv.joinLink)"
              >Join</button>
              <button
                type="button"
                class="mm-btn mm-btn--inline mm-dash__remove"
                @click.stop="removeFavourite(srv.id)"
                title="Remove from favourites"
              >×</button>
            </div>
          </article>
        </div>
        <div v-else class="mm-empty" style="padding: 28px">
          No favourite servers yet — pin servers to keep an eye on their status.
        </div>
      </section>

      <!-- Tournaments tab — shortcut into the legacy tournament admin
           surface. Tournament views retain their current layout for now,
           so this is just a wayfinding panel rather than a port. -->
      <section v-if="activeTab === 'tournaments'" style="margin-top: 24px">
        <header class="mm-dash__section-head">
          <div class="mm-eyebrow mm-eyebrow--strong">Tournaments</div>
        </header>
        <p class="mm-card__hint" style="margin-top: 8px; max-width: 540px">
          Create or manage competitive brackets across multiple rounds.
          Tournament pages keep their existing layout — open them to
          continue.
        </p>
        <p style="margin-top: 16px; display: flex; gap: 10px; flex-wrap: wrap">
          <router-link to="/tournaments" class="mm-btn mm-btn--accent">Open tournaments →</router-link>
        </p>
      </section>

      <!-- Account footer (sign out) -->
      <section class="mm-dash__account">
        <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 10px">Account</div>
        <div class="mm-dash__account-row">
          <div class="mm-dash__account-info">
            <div class="mm-dash__account-name">{{ user?.name ?? '—' }}</div>
            <div class="mm-dash__account-email">{{ user?.email ?? '' }}</div>
          </div>
          <button type="button" class="mm-btn" @click="handleSignOut">Sign out →</button>
        </div>
      </section>
    </template>

    <MmAddBuddyModal v-if="showAddBuddy" @close="showAddBuddy = false" @added="onBuddyAdded" />
    <MmAddServerModal v-if="showAddServer" @close="showAddServer = false" @added="onServerAdded" />
    <MmAddAliasModal v-if="showAddAlias" @close="showAddAlias = false" @added="onAliasAdded" />
  </div>
</template>

<style scoped>
.mm-dash__name {
  font-style: italic;
  color: var(--mm-accent);
}

.mm-dash__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.mm-dash__section-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-dash__squad {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.mm-dash__squad-row {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: 16px;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid var(--mm-rule);
}
.mm-dash__squad-row:last-child { border-bottom: 0; }

.mm-dash__monogram {
  width: 44px;
  height: 44px;
  border-radius: 4px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-weight: 600;
  font-size: 18px;
  display: grid;
  place-items: center;
}

.mm-dash__squad-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }

.mm-dash__squad-name {
  background: transparent;
  border: 0;
  padding: 0;
  text-align: left;
  cursor: pointer;
  font-family: var(--mm-font-display);
  font-size: 16px;
  font-weight: 500;
  color: var(--mm-ink);
}
.mm-dash__squad-name:hover { color: var(--mm-accent); }

.mm-dash__squad-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-dash__squad-server {
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: var(--mm-success);
  font: inherit;
  text-transform: uppercase;
  letter-spacing: inherit;
}
.mm-dash__squad-server:hover { color: var(--mm-accent); }

.mm-dash__squad-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  color: var(--mm-ink-soft);
  margin-top: 2px;
}

.mm-dash__join { flex-shrink: 0; }

.mm-dash__servers {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.mm-dash__server {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}
.mm-dash__server:hover { border-color: var(--mm-ink); background: var(--mm-bg-soft); }

.mm-dash__server-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mm-dash__server-name {
  font-family: var(--mm-font-display);
  font-size: 15px;
  font-weight: 500;
  color: var(--mm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.mm-dash__server-map {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-dash__server-load {
  display: flex;
  align-items: center;
  font-family: var(--mm-font-mono);
  font-size: 14px;
  margin-top: 4px;
}

.mm-dash__server-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.mm-dash__remove {
  margin-left: auto;
  font-family: var(--mm-font-mono);
  font-size: 14px;
  color: var(--mm-ink-muted);
}
.mm-dash__remove:hover { color: var(--mm-kill); }

.mm-dash__account {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--mm-rule);
}

.mm-dash__account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.mm-dash__account-info { min-width: 0; }
.mm-dash__account-name {
  font-family: var(--mm-font-display);
  font-size: 16px;
  color: var(--mm-ink);
}
.mm-dash__account-email {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
}

.mm-dash__offline {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px dashed var(--mm-rule);
}

.mm-dash__alias-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.mm-dash__alias-row {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  gap: 16px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--mm-rule);
}
.mm-dash__alias-row:last-child { border-bottom: 0; }

.mm-dash__alias-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }

.mm-dash__offline-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.mm-dash__offline-row {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 14px;
  align-items: center;
  padding: 10px 0;
  cursor: pointer;
  border-bottom: 1px solid var(--mm-rule);
}
.mm-dash__offline-row:last-child { border-bottom: 0; }
.mm-dash__offline-row:hover .mm-dash__offline-name { color: var(--mm-accent); }

.mm-dash__monogram--muted {
  width: 36px;
  height: 36px;
  font-size: 15px;
  color: var(--mm-ink-muted);
  background: transparent;
  border-color: var(--mm-rule);
}

.mm-dash__offline-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }

.mm-dash__offline-name {
  font-family: var(--mm-font-display);
  font-size: 14px;
  color: var(--mm-ink-soft);
  transition: color 0.12s ease;
}

.mm-dash__offline-sub {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
}

.mm-tab__badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--mm-bg-soft);
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
}
.mm-tab--active .mm-tab__badge {
  background: var(--mm-accent);
  color: var(--mm-highlight-ink);
}

.mm-dash__account-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
