<script setup lang="ts">
// /auth/app: an app on this computer asks to sign in with the visitor's
// account (features/app-sign-in). Signed out, the visitor goes through the
// normal sign-in and comes back here. Nothing leaves this page without a click:
// Allow mints a one-time code and sends the browser to the app's loopback
// listener; Deny sends it there with error=access_denied. A request the API
// would refuse gets an error page and no way back to the address it named.
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { AppSignInError, appSignInService } from '@/services/appSignInService'
import { allowUrl, denyUrl, parseAppSignIn } from '@/utils/appSignIn'
import { decodePlayerName } from '@/utils/playerName'
import '@/styles/modern-minimal.css'

const route = useRoute()
const router = useRouter()
const { isAuthenticated, user } = useAuth()

const parsed = computed(() => parseAppSignIn(route.query))
const request = computed(() => (parsed.value.ok ? parsed.value.request : null))

const busy = ref(false)
const error = ref<string | null>(null)
/** Set once the browser is on its way back to the app. */
const leaving = ref<'allowed' | 'denied' | null>(null)

const accountName = computed(() => (user.value?.name ? decodePlayerName(user.value.name) : 'your account'))

onMounted(() => {
  // An invalid request is shown as such, signed in or not.
  if (!parsed.value.ok || isAuthenticated.value) return
  router.replace({ path: '/auth/login', query: { returnTo: route.fullPath } })
})

async function allow() {
  const r = request.value
  if (!r || busy.value) return
  busy.value = true
  error.value = null
  try {
    const { code } = await appSignInService.authorize({
      client: r.client,
      device: r.device,
      redirectUri: r.redirectUri,
      state: r.state,
      codeChallenge: r.codeChallenge,
      codeChallengeMethod: r.codeChallengeMethod,
    })
    leaving.value = 'allowed'
    // The page's own copy of the redirect URI, the one it checked.
    window.location.replace(allowUrl(r.redirectUri, code, r.state))
  } catch (e) {
    busy.value = false
    // apiClient's own errors: the site's sign-in lapsed. Sign in again and come back.
    const lapsed = e instanceof AppSignInError ? e.status === 401
      : e instanceof Error && /Authentication required|Session expired/.test(e.message)
    if (lapsed) {
      router.replace({ path: '/auth/login', query: { returnTo: route.fullPath } })
      return
    }
    error.value = e instanceof Error ? e.message : 'Could not sign the app in.'
  }
}

function deny() {
  const r = request.value
  if (!r || busy.value) return
  leaving.value = 'denied'
  window.location.replace(denyUrl(r.redirectUri, r.state))
}
</script>

<template>
  <div class="mm mm-appsign">
    <main class="mm-appsign__panel" data-testid="app-sign-in">
      <template v-if="!parsed.ok">
        <div class="mm-eyebrow mm-eyebrow--strong">App sign-in</div>
        <h1 class="mm-appsign__title">This sign-in link is not valid</h1>
        <p class="mm-appsign__reason" role="alert" data-testid="app-sign-in-error">{{ parsed.reason }}</p>
        <p class="mm-appsign__note">Start the sign-in again from the app. Nothing was shared.</p>
        <RouterLink to="/v4/dashboard" class="mm-btn">Go to your dashboard</RouterLink>
      </template>

      <template v-else-if="!isAuthenticated">
        <div class="mm-eyebrow mm-eyebrow--strong">App sign-in</div>
        <p class="mm-appsign__note">Taking you to sign in…</p>
      </template>

      <template v-else-if="leaving">
        <div class="mm-eyebrow mm-eyebrow--strong">App sign-in</div>
        <h1 class="mm-appsign__title">
          {{ leaving === 'allowed' ? `Returning to ${request!.clientName}` : 'Sign-in declined' }}
        </h1>
        <p class="mm-appsign__note" role="status">
          {{ leaving === 'allowed' ? 'The app finishes signing in. You can close this tab once it says so.' : 'The app was told. You can close this tab.' }}
        </p>
      </template>

      <template v-else-if="request">
        <div class="mm-eyebrow mm-eyebrow--strong">App sign-in</div>
        <h1 class="mm-appsign__title">
          Allow <span class="mm-appsign__app">{{ request.clientName }}</span>
          on <span class="mm-appsign__device" data-testid="app-sign-in-device">{{ request.device }}</span>
          to use your account?
        </h1>

        <p class="mm-appsign__as">
          Signed in as <strong>{{ accountName }}</strong>
        </p>

        <section class="mm-appsign__grants" aria-label="What the app can do">
          <div class="mm-appsign__label">It will be able to</div>
          <ul>
            <li>Read and change your game profiles</li>
            <li>See your account name</li>
          </ul>
        </section>

        <p class="mm-appsign__note">
          Allow only if you just started signing in from the app on this computer. It stays signed in
          until you sign it out, here under Dashboard, Signed-in apps, or in the app.
        </p>
        <p class="mm-appsign__target">Returns to {{ request.returnsTo }}</p>

        <p v-if="error" class="mm-appsign__reason" role="alert">{{ error }}</p>

        <div class="mm-appsign__actions">
          <button type="button" class="mm-btn" :disabled="busy" data-testid="app-sign-in-deny" @click="deny">Deny</button>
          <button type="button" class="mm-btn mm-btn--accent" :disabled="busy" data-testid="app-sign-in-allow" @click="allow">
            {{ busy ? 'Allowing…' : 'Allow' }}
          </button>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.mm-appsign {
  min-height: 100vh;
  background: var(--mm-bg);
  display: grid;
  place-items: center;
  padding: 32px 16px;
}

.mm-appsign__panel {
  max-width: 460px;
  width: 100%;
  border: 1px solid var(--mm-rule);
  border-top: 2px solid var(--mm-accent);
  border-radius: 2px;
  padding: 32px;
  background: var(--mm-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

.mm-appsign__title {
  margin: 0;
  font-family: var(--mm-font-display);
  font-size: 22px;
  font-weight: 500;
  line-height: 1.35;
  color: var(--mm-ink);
  overflow-wrap: anywhere;
}
.mm-appsign__app { color: var(--mm-accent-soft); }
.mm-appsign__device {
  font-family: var(--mm-font-mono);
  font-size: 0.85em;
  color: var(--mm-ink);
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  padding: 1px 6px;
}

.mm-appsign__as {
  margin: 0;
  font-size: 13px;
  color: var(--mm-ink-muted);
}
.mm-appsign__as strong { color: var(--mm-ink); font-weight: 500; }

.mm-appsign__grants {
  border: 1px solid var(--mm-rule);
  border-left: 2px solid var(--mm-accent);
  background: var(--mm-bg);
  border-radius: 2px;
  padding: 12px 14px;
}
.mm-appsign__label {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  margin-bottom: 6px;
}
.mm-appsign__grants ul { margin: 0; padding-left: 18px; color: var(--mm-ink); font-size: 14px; line-height: 1.7; }

.mm-appsign__note {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--mm-ink-muted);
}
.mm-appsign__target {
  margin: 0;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-faint);
}
.mm-appsign__reason {
  margin: 0;
  border-left: 2px solid var(--mm-danger);
  background: var(--mm-bg-mute);
  color: var(--mm-danger);
  padding: 8px 12px;
  font-size: 13px;
}

.mm-appsign__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 4px;
}
.mm-appsign__actions .mm-btn:disabled { opacity: 0.5; cursor: default; }

.mm-appsign__panel > .mm-btn { align-self: flex-start; }

@media (max-width: 480px) {
  .mm-appsign { padding: 16px; place-items: start center; }
  .mm-appsign__panel { padding: 24px 18px; }
  .mm-appsign__actions { flex-direction: column-reverse; }
  .mm-appsign__actions .mm-btn { width: 100%; text-align: center; }
}
</style>
