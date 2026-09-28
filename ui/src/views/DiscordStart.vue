<script setup lang="ts">
// Sign-in on behalf of another bfstats site (play.bfstats.io's REPLAY feed):
// /auth/discord/start?returnTo=<page> goes to Discord and, from the callback,
// back to that page. See services/authReturn.ts and features/replay-feed.
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { authService } from '@/services/authService'
import { safeReturnUrl } from '@/services/authReturn'
import '@/styles/modern-minimal.css'

const router = useRouter()
const error = ref<string | null>(null)

onMounted(async () => {
  const returnTo = safeReturnUrl(new URLSearchParams(window.location.search).get('returnTo'))
  try {
    await authService.initiateDiscordLogin({ returnPath: '/v4/dashboard', returnUrl: returnTo })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Discord sign-in could not start.'
  }
})

const redirectToHome = () => router.push('/v4/servers/bf1942')
</script>

<template>
  <div class="mm mm-callback">
    <div class="mm-callback__panel">
      <template v-if="error">
        <div class="mm-eyebrow mm-eyebrow--strong">Sign-in unavailable</div>
        <p class="mm-callback__msg">{{ error }}</p>
        <button type="button" class="mm-btn mm-btn--accent" @click="redirectToHome">Return home</button>
      </template>
      <template v-else>
        <div class="mm-eyebrow mm-eyebrow--strong">Signing in with Discord</div>
        <div class="mm-callback__skeletons">
          <div v-for="i in 3" :key="i" class="mm-skeleton" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mm-callback {
  min-height: 100vh;
  background: var(--mm-bg);
  display: grid;
  place-items: center;
  padding: 32px;
}

.mm-callback__panel {
  max-width: 460px;
  width: 100%;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 32px;
  background: var(--mm-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mm-callback__skeletons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mm-callback__msg {
  font-family: var(--mm-font-display);
  font-size: 14px;
  color: var(--mm-ink-soft);
  line-height: 1.5;
  margin: 0;
}
</style>
