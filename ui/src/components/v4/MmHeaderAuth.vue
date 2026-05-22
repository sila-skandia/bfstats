<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useBuddiesOnline } from '@/composables/useBuddiesOnline'

const router = useRouter()
const { isAuthenticated, user, loginWithDiscord } = useAuth()
const { onlineCount, hasOnlineBuddies } = useBuddiesOnline()

// Two-letter monogram fallback when there's no avatar URL on file
// (the current UserProfile doesn't carry an avatar hash — to be filled
// in once the dashboard mocks land and we extend the profile shape).
const initials = computed<string>(() => {
  const name = user.value?.name ?? ''
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
})

const onAvatarClick = () => {
  router.push('/v4/dashboard')
}

const onSignIn = async () => {
  try { await loginWithDiscord() } catch { /* user-cancelled — silent */ }
}
</script>

<template>
  <div class="mm-header-auth">
    <button
      v-if="!isAuthenticated"
      type="button"
      class="mm-header-auth__signin"
      @click="onSignIn"
    >Sign in</button>

    <button
      v-else
      type="button"
      class="mm-header-auth__avatar"
      :title="`${user?.name ?? 'Signed in'}${hasOnlineBuddies ? ` · ${onlineCount} buddies online` : ''}`"
      :aria-label="hasOnlineBuddies ? `Signed in. ${onlineCount} buddies online.` : 'Signed in'"
      @click="onAvatarClick"
    >
      <span class="mm-header-auth__monogram">{{ initials }}</span>
      <span v-if="hasOnlineBuddies" class="mm-header-auth__badge">
        {{ onlineCount > 9 ? '9+' : onlineCount }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.mm-header-auth {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.mm-header-auth__signin {
  background: transparent;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  padding: 6px 14px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.mm-header-auth__signin:hover {
  background: var(--mm-accent);
  border-color: var(--mm-accent);
  color: var(--mm-highlight-ink);
}

.mm-header-auth__avatar {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid var(--mm-accent-soft);
  background: var(--mm-bg-soft);
  color: var(--mm-accent-soft);
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
  box-shadow:
    0 0 0 1px rgba(125, 136, 73, 0.35),
    0 0 10px rgba(125, 136, 73, 0.28);
  transition: border-color 0.15s ease, background-color 0.15s ease,
              box-shadow 0.15s ease, color 0.15s ease;
}
.mm-header-auth__avatar:hover {
  border-color: #b4c060;
  background: var(--mm-bg-mute);
  color: #b4c060;
  box-shadow:
    0 0 0 1px rgba(180, 192, 96, 0.55),
    0 0 14px rgba(180, 192, 96, 0.45);
}

.mm-header-auth__monogram {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
}

/* Badge — small olive-green pill in the top-right of the avatar that
   shows the number of buddies currently online. The badge has a tight
   pulse so it reads as "live" without being a constant attention-grab. */
.mm-header-auth__badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--mm-success);
  border: 2px solid var(--mm-bg);
  color: var(--mm-highlight-ink);
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  font-weight: 700;
  line-height: 12px;
  text-align: center;
  letter-spacing: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: content-box;
  animation: mm-header-auth-pulse 2.4s ease-in-out infinite;
}

@keyframes mm-header-auth-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
</style>
