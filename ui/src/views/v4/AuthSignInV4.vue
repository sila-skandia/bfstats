<script setup lang="ts">
// Sign-in / sign-up page: username+password, with Discord as the other
// option. Email on sign-up is optional and stored only as a keyed hash —
// the copy below has to keep saying that, it is the whole trust pitch.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authService } from '@/services/authService'
import '@/styles/modern-minimal.css'

const router = useRouter()
const route = useRoute()

const isRegister = computed(() => route.path === '/auth/register')

const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const email = ref('')
const playerName = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

const forgotMode = ref(false)
const forgotEmail = ref('')
const forgotMessage = ref<string | null>(null)

// Live username availability. Advisory only: the field never blocks on it,
// register is the authority. Debounced so typing does not hammer the API.
const usernameStatus = ref<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
let usernameTimer: number | null = null
watch(username, (value) => {
  if (usernameTimer !== null) clearTimeout(usernameTimer)
  const name = value.trim()
  if (!isRegister.value || name.length < 3) {
    usernameStatus.value = 'idle'
    return
  }
  usernameStatus.value = 'checking'
  usernameTimer = window.setTimeout(async () => {
    try {
      const result = await authService.usernameAvailable(name)
      if (username.value.trim() !== name) return // stale answer
      usernameStatus.value = result.available ? 'available' : (result.reason === 'invalid' ? 'invalid' : 'taken')
    } catch {
      usernameStatus.value = 'idle'
    }
  }, 350)
})

// Player alias typeahead against the tracked-players search. Click or
// Enter picks a suggestion; the field stays free text when the exact
// alias is not tracked yet, since the backend links anything.
interface AliasSuggestion {
  playerName: string
  totalPlayTimeMinutes?: number
  lastSeen?: string
}
const aliasSuggestions = ref<AliasSuggestion[]>([])
const aliasOpen = ref(false)
const aliasHighlighted = ref(-1)
const aliasSearching = ref(false)
let aliasTimer: number | null = null
watch(playerName, (value) => {
  if (aliasTimer !== null) clearTimeout(aliasTimer)
  const query = value.trim()
  aliasHighlighted.value = -1
  if (query.length < 2) {
    aliasSuggestions.value = []
    aliasOpen.value = false
    return
  }
  aliasTimer = window.setTimeout(async () => {
    aliasSearching.value = true
    try {
      const response = await fetch(`/stats/Players/search?query=${encodeURIComponent(query)}&pageSize=8`)
      if (!response.ok) throw new Error('search failed')
      const data = await response.json()
      const items = data.items ?? data
      if (playerName.value.trim() !== query) return // stale answer
      aliasSuggestions.value = items.map((it: { playerName: string; totalPlayTimeMinutes?: number; lastSeen?: string }) => ({
        playerName: it.playerName,
        totalPlayTimeMinutes: it.totalPlayTimeMinutes,
        lastSeen: it.lastSeen,
      }))
      aliasOpen.value = aliasSuggestions.value.length > 0
    } catch {
      aliasSuggestions.value = []
      aliasOpen.value = false
    } finally {
      aliasSearching.value = false
    }
  }, 300)
})

const pickAlias = (name: string) => {
  playerName.value = name
  aliasOpen.value = false
  aliasSuggestions.value = []
}

const onAliasKeydown = (event: KeyboardEvent) => {
  if (!aliasOpen.value || aliasSuggestions.value.length === 0) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    aliasHighlighted.value = Math.min(aliasHighlighted.value + 1, aliasSuggestions.value.length - 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    aliasHighlighted.value = Math.max(aliasHighlighted.value - 1, 0)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (aliasHighlighted.value >= 0) pickAlias(aliasSuggestions.value[aliasHighlighted.value].playerName)
  } else if (event.key === 'Escape') {
    aliasOpen.value = false
  }
}

const closeAliasOnBlur = () => {
  // Delay so the click on a suggestion lands before the list closes.
  window.setTimeout(() => { aliasOpen.value = false }, 150)
}

onBeforeUnmount(() => {
  if (usernameTimer !== null) clearTimeout(usernameTimer)
  if (aliasTimer !== null) clearTimeout(aliasTimer)
})

const submit = async () => {
  error.value = null
  if (isRegister.value && password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }
  busy.value = true
  try {
    if (isRegister.value) {
      await authService.register({
        username: username.value.trim(),
        password: password.value,
        email: email.value.trim() || null,
        playerName: playerName.value.trim() || null,
      })
    } else {
      await authService.loginWithPassword(username.value.trim(), password.value)
    }
    // discord-auth-success handling (composables/useAuth.ts) does the redirect;
    // fall back to the dashboard in case this view never registered it.
    router.push('/v4/dashboard')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Something went wrong'
  } finally {
    busy.value = false
  }
}

const submitForgot = async () => {
  busy.value = true
  forgotMessage.value = null
  try {
    forgotMessage.value = await authService.forgotPassword(username.value.trim(), forgotEmail.value.trim())
  } catch {
    forgotMessage.value = 'If the username and email match an account, reset instructions have been sent.'
  } finally {
    busy.value = false
  }
}

const signInWithDiscord = () => authService.initiateDiscordLogin({ returnPath: '/v4/dashboard' })
</script>

<template>
  <div class="mm mm-signin">
    <div class="mm-signin__panel">
      <div class="mm-eyebrow mm-eyebrow--strong">
        {{ isRegister ? 'Create account' : 'Sign in' }}
      </div>

      <!-- Forgotten-password flow swaps the panel content -->
      <form v-if="forgotMode" class="mm-signin__form" @submit.prevent="submitForgot">
        <p class="mm-signin__note">
          Enter the username and the email you registered with. If they match,
          reset instructions are sent to that address.
        </p>
        <label class="mm-signin__field">
          <span class="mm-signin__field-label">Username</span>
          <input v-model="username" type="text" class="mm-signin__input" autocomplete="username" required />
        </label>
        <label class="mm-signin__field">
          <span class="mm-signin__field-label">Email</span>
          <input v-model="forgotEmail" type="email" class="mm-signin__input" autocomplete="email" required />
        </label>
        <p v-if="forgotMessage" class="mm-signin__note">{{ forgotMessage }}</p>
        <div class="mm-signin__actions">
          <button type="submit" class="mm-btn mm-btn--accent" :disabled="busy">
            {{ busy ? 'Sending…' : 'Send reset instructions' }}
          </button>
          <button type="button" class="mm-signin__link" @click="forgotMode = false">Back to sign in</button>
        </div>
      </form>

      <template v-else>
        <div class="mm-signin__tabs">
          <RouterLink
            class="mm-signin__tab"
            :class="{ 'mm-signin__tab--active': !isRegister }"
            to="/auth/login"
          >Sign in</RouterLink>
          <RouterLink
            class="mm-signin__tab"
            :class="{ 'mm-signin__tab--active': isRegister }"
            to="/auth/register"
          >Create account</RouterLink>
        </div>

        <form class="mm-signin__form" @submit.prevent="submit">
          <label class="mm-signin__field">
            <span class="mm-signin__field-label">Username</span>
            <input
              v-model="username"
              type="text"
              class="mm-signin__input"
              autocomplete="username"
              required
              minlength="3"
              maxlength="24"
            />
            <span
              v-if="isRegister && usernameStatus !== 'idle'"
              class="mm-signin__status"
              :class="`mm-signin__status--${usernameStatus}`"
            >
              <template v-if="usernameStatus === 'checking'">Checking…</template>
              <template v-else-if="usernameStatus === 'available'">Available</template>
              <template v-else-if="usernameStatus === 'taken'">Already taken</template>
              <template v-else>Use 3-24 letters, digits, or _ . -</template>
            </span>
          </label>
          <label class="mm-signin__field">
            <span class="mm-signin__field-label">Password</span>
            <input
              v-model="password"
              type="password"
              class="mm-signin__input"
              autocomplete="current-password"
              required
              :minlength="isRegister ? 8 : undefined"
            />
          </label>

          <template v-if="isRegister">
            <label class="mm-signin__field">
              <span class="mm-signin__field-label">Confirm password</span>
              <input
                v-model="confirmPassword"
                type="password"
                class="mm-signin__input"
                autocomplete="new-password"
                required
                minlength="8"
              />
            </label>
            <label class="mm-signin__field">
              <span class="mm-signin__field-label">Email</span>
              <span class="mm-signin__hint">Optional. Used only for password recovery, stored as a one-way code, never as the address itself.</span>
              <input v-model="email" type="email" class="mm-signin__input" autocomplete="email" />
            </label>
            <div class="mm-signin__field">
              <span class="mm-signin__field-label">Your player name</span>
              <span class="mm-signin__hint">Optional. Links your tracked in-game alias to this account.</span>
              <div class="mm-signin__typeahead">
                <input
                  v-model="playerName"
                  type="text"
                  class="mm-signin__input"
                  autocomplete="off"
                  @keydown="onAliasKeydown"
                  @focus="aliasSuggestions.length > 0 && (aliasOpen = true)"
                  @blur="closeAliasOnBlur"
                />
                <ul v-if="aliasOpen" class="mm-signin__suggestions">
                  <li
                    v-for="(s, i) in aliasSuggestions"
                    :key="s.playerName"
                    class="mm-signin__suggestion"
                    :class="{ 'mm-signin__suggestion--active': i === aliasHighlighted }"
                    @mousedown.prevent="pickAlias(s.playerName)"
                    @mouseenter="aliasHighlighted = i"
                  >
                    <span class="mm-signin__suggestion-name">{{ $pn(s.playerName) }}</span>
                    <span v-if="s.totalPlayTimeMinutes != null" class="mm-signin__suggestion-meta">
                      {{ Math.round(s.totalPlayTimeMinutes / 60) }}h
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </template>

          <p v-if="error" class="mm-signin__error">{{ error }}</p>

          <div class="mm-signin__actions">
            <button type="submit" class="mm-btn mm-btn--accent mm-signin__submit" :disabled="busy">
              {{ busy ? 'Working…' : isRegister ? 'Create account' : 'Sign in' }}
            </button>
            <button
              v-if="!isRegister"
              type="button"
              class="mm-signin__link"
              @click="forgotMode = true"
            >Forgot password?</button>
          </div>
        </form>

        <div class="mm-signin__divider"><span>or</span></div>

        <button type="button" class="mm-btn mm-btn--accent mm-signin__discord" @click="signInWithDiscord">
          <svg class="mm-signin__discord-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
            <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"/>
          </svg>
          Continue with Discord
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mm-signin {
  min-height: 100vh;
  background: var(--mm-bg);
  display: grid;
  place-items: center;
  padding: 32px;
}

.mm-signin__panel {
  max-width: 420px;
  width: 100%;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 36px 32px;
  background: var(--mm-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

.mm-signin__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-signin__tab {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  padding: 8px 12px;
  text-decoration: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s ease;
}
.mm-signin__tab:hover {
  color: var(--mm-ink);
}
.mm-signin__tab--active {
  color: var(--mm-ink);
  border-bottom-color: var(--mm-accent);
}

.mm-signin__form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mm-signin__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-signin__field-label {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
}

.mm-signin__hint {
  font-family: var(--mm-font-body);
  font-size: 11.5px;
  color: var(--mm-ink-soft);
  line-height: 1.4;
}

.mm-signin__input {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  color: var(--mm-ink);
  font-family: var(--mm-font-body);
  font-size: 14px;
  padding: 9px 11px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.mm-signin__input:focus {
  outline: none;
  border-color: var(--mm-accent);
  box-shadow: 0 0 0 3px rgba(125, 136, 73, 0.18);
}

/* Live availability status under the username field */
.mm-signin__status {
  font-family: var(--mm-font-body);
  font-size: 11.5px;
  line-height: 1.4;
}
.mm-signin__status--checking { color: var(--mm-ink-soft); }
.mm-signin__status--available { color: var(--mm-success); }
.mm-signin__status--taken,
.mm-signin__status--invalid { color: var(--mm-danger); }

/* Alias typeahead */
.mm-signin__typeahead {
  position: relative;
}

.mm-signin__suggestions {
  position: absolute;
  z-index: 10;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  max-height: 240px;
  overflow-y: auto;
}

.mm-signin__suggestion {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 7px 10px;
  cursor: pointer;
}
.mm-signin__suggestion--active {
  background: var(--mm-accent-soft);
}

.mm-signin__suggestion-name {
  font-family: var(--mm-font-body);
  font-size: 13px;
  color: var(--mm-ink);
}

.mm-signin__suggestion-meta {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-soft);
  flex-shrink: 0;
}

.mm-signin__actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 2px;
}

.mm-signin__submit {
  min-width: 140px;
}

.mm-signin__link {
  background: transparent;
  border: none;
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-body);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}
.mm-signin__link:hover {
  color: var(--mm-ink);
}

.mm-signin__divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.mm-signin__divider::before,
.mm-signin__divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--mm-rule);
}

.mm-signin__discord {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.mm-signin__discord-icon {
  flex-shrink: 0;
}

.mm-signin__note {
  font-family: var(--mm-font-body);
  font-size: 12px;
  color: var(--mm-ink-soft);
  line-height: 1.5;
  margin: 0;
}

.mm-signin__error {
  font-family: var(--mm-font-body);
  font-size: 12.5px;
  color: var(--mm-danger);
  margin: 0;
}
</style>