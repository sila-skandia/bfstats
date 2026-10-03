<script setup lang="ts">
// Sign-in / sign-up page: username+password, with Discord as the other
// option. Email on sign-up is optional and stored only as a keyed hash —
// the copy below has to keep saying that, it is the whole trust pitch.
import { computed, ref } from 'vue'
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
        <label class="mm-signin__label">
          Username
          <input v-model="username" type="text" class="mm-signin__input" autocomplete="username" required />
        </label>
        <label class="mm-signin__label">
          Email
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
          <label class="mm-signin__label">
            Username
            <input
              v-model="username"
              type="text"
              class="mm-signin__input"
              :autocomplete="isRegister ? 'username' : 'username'"
              required
              minlength="3"
              maxlength="24"
            />
          </label>
          <label class="mm-signin__label">
            Password
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
            <label class="mm-signin__label">
              Confirm password
              <input
                v-model="confirmPassword"
                type="password"
                class="mm-signin__input"
                autocomplete="new-password"
                required
                minlength="8"
              />
            </label>
            <label class="mm-signin__label">
              Email
              <span class="mm-signin__hint">Optional — used only for password recovery. Stored as a one-way code, never as the address itself.</span>
              <input v-model="email" type="email" class="mm-signin__input" autocomplete="email" />
            </label>
            <label class="mm-signin__label">
              Your player name
              <span class="mm-signin__hint">Optional — links your tracked in-game alias to this account.</span>
              <input v-model="playerName" type="text" class="mm-signin__input" />
            </label>
          </template>

          <p v-if="error" class="mm-signin__error">{{ error }}</p>

          <div class="mm-signin__actions">
            <button type="submit" class="mm-btn mm-btn--accent" :disabled="busy">
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
  padding: 32px;
  background: var(--mm-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 16px;
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
}
.mm-signin__tab--active {
  color: var(--mm-ink);
  border-bottom-color: var(--mm-accent);
}

.mm-signin__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mm-signin__label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
}

.mm-signin__hint {
  font-family: var(--mm-font-body);
  font-size: 11.5px;
  letter-spacing: 0;
  text-transform: none;
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
  padding: 8px 10px;
}
.mm-signin__input:focus {
  outline: none;
  border-color: var(--mm-accent);
}

.mm-signin__actions {
  display: flex;
  align-items: center;
  gap: 16px;
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