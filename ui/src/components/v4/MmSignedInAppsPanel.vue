<script setup lang="ts">
// Apps signed in with this account through the browser (features/app-sign-in):
// one row per sign-in, with Sign out.
import { onMounted, ref } from 'vue'
import { parseUtc, formatLocalTooltip } from '@/utils/timeUtils'
import { APP_CLIENTS } from '@/utils/appSignIn'
import 'primeicons/primeicons.css'
import { appSignInService, type SignedInApp } from '@/services/appSignInService'

const emit = defineEmits<{ (e: 'count', count: number): void }>()

const apps = ref<SignedInApp[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const busyId = ref<string | null>(null)
const actionError = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    apps.value = await appSignInService.sessions()
    emit('count', apps.value.length)
  } catch {
    loadError.value = 'Could not load your signed-in apps.'
  } finally {
    loading.value = false
  }
}

async function signOut(app: SignedInApp) {
  busyId.value = app.id
  actionError.value = null
  try {
    await appSignInService.signOut(app.id)
    await load()
  } catch {
    actionError.value = `Could not sign out ${clientName(app.client)} on ${app.device}.`
  } finally {
    busyId.value = null
  }
}

const clientName = (client: string) => APP_CLIENTS[client] ?? client

const formatRelative = (iso: string): string => {
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return '-'
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`
  return `${Math.round(ms / (30 * 86_400_000))}mo ago`
}

const formatDay = (iso: string): string => {
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return '-'
  return new Intl.DateTimeFormat('default', { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

onMounted(load)
</script>

<template>
  <section class="mm-apps">
    <header class="mm-apps__head">
      <div class="mm-eyebrow mm-eyebrow--strong">Signed-in apps</div>
      <p class="mm-card__hint mm-apps__lead">
        Apps you allowed to use your account, such as the bfstats Sidecar tray app. Times are in your local time.
      </p>
    </header>

    <div v-if="actionError" class="mm-apps__error" role="alert">{{ actionError }}</div>

    <div v-if="loading && apps.length === 0" style="padding: 12px 0">
      <div v-for="i in 2" :key="i" class="mm-skeleton mm-skeleton--lg" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="loadError" class="mm-empty" style="padding: 28px">{{ loadError }}</div>

    <ol v-else-if="apps.length > 0" class="mm-apps__list" data-testid="signed-in-apps-list">
      <li v-for="app in apps" :key="app.id" class="mm-apps__row" :data-app="app.id">
        <span class="mm-apps__icon" aria-hidden="true"><i class="pi pi-desktop" /></span>
        <div class="mm-apps__body">
          <div class="mm-apps__name-line">
            <span class="mm-apps__device">{{ app.device }}</span>
            <span class="mm-chip">{{ clientName(app.client) }}</span>
          </div>
          <div class="mm-apps__sub">
            Signed in <span :title="formatLocalTooltip(app.createdAt)">{{ formatDay(app.createdAt) }}</span>
            <span class="mm-meta-row__sep">·</span>
            Last used <span :title="formatLocalTooltip(app.lastUsedAt)">{{ formatRelative(app.lastUsedAt) }}</span>
          </div>
        </div>
        <div class="mm-apps__actions">
          <button
            type="button"
            class="mm-btn mm-btn--inline mm-apps__signout"
            :disabled="busyId === app.id"
            :aria-label="`Sign out ${clientName(app.client)} on ${app.device}`"
            @click="signOut(app)"
          >{{ busyId === app.id ? 'Signing out…' : 'Sign out' }}</button>
        </div>
      </li>
    </ol>

    <div v-else class="mm-empty" style="padding: 28px" data-testid="signed-in-apps-empty">
      No apps are signed in with your account.
    </div>
  </section>
</template>

<style scoped>
.mm-apps__head { margin-bottom: 12px; }
.mm-apps__lead { margin-top: 4px; max-width: 540px; }

.mm-apps__error {
  border-left: 2px solid var(--mm-danger);
  background: var(--mm-bg-mute);
  color: var(--mm-danger);
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 12.5px;
}

.mm-apps__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.mm-apps__row {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  gap: 16px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--mm-rule);
}
.mm-apps__row:last-child { border-bottom: 0; }

.mm-apps__icon {
  width: 44px;
  height: 44px;
  border-radius: 4px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  color: var(--mm-accent-soft);
  display: grid;
  place-items: center;
  font-size: 18px;
}

.mm-apps__body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.mm-apps__name-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.mm-apps__device {
  font-family: var(--mm-font-display);
  font-size: 16px;
  font-weight: 500;
  color: var(--mm-ink);
  overflow-wrap: anywhere;
}
.mm-apps__sub {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 6px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
}

.mm-apps__actions { display: flex; align-items: center; gap: 10px; }
.mm-apps__actions .mm-btn:disabled { opacity: 0.45; cursor: default; }
.mm-apps__signout:hover:not(:disabled) { color: var(--mm-danger); }

@media (max-width: 720px) {
  .mm-apps__row { grid-template-columns: 44px 1fr; row-gap: 8px; }
  .mm-apps__actions { grid-column: 2; }
}
</style>
