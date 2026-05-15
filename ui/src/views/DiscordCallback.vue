<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { authService } from '@/services/authService'
import '@/styles/modern-minimal.css'

const router = useRouter()
const error = ref<string | null>(null)

onMounted(async () => {
  const urlParams = new URLSearchParams(window.location.search)
  const code = urlParams.get('code')
  const errorParam = urlParams.get('error')

  if (errorParam) {
    error.value = `Discord authorization was denied or failed: ${errorParam}`
    return
  }

  if (!code) {
    error.value = 'No authorization code received from Discord.'
    return
  }

  try {
    await authService.handleDiscordCallback(code)
    // Default landing is the V4 dashboard; legacy `/dashboard` is no
    // longer the target so the user never sees the old sidebar layout
    // even momentarily on sign-in.
    const returnPath = localStorage.getItem('discord_auth_return_path') || '/v4/dashboard'
    localStorage.removeItem('discord_auth_return_path')
    router.push(returnPath)
  } catch (err) {
    console.error('Discord callback error:', err)
    error.value = err instanceof Error ? err.message : 'An unknown error occurred during Discord authentication.'
  }
})

const redirectToHome = () => router.push('/v4/servers/bf1942')
</script>

<template>
  <div class="mm mm-callback">
    <div class="mm-callback__panel">
      <template v-if="error">
        <div class="mm-eyebrow mm-eyebrow--strong">Authentication failed</div>
        <p class="mm-callback__msg">{{ error }}</p>
        <button type="button" class="mm-btn mm-btn--accent" @click="redirectToHome">Return home</button>
      </template>
      <template v-else>
        <div class="mm-eyebrow mm-eyebrow--strong">Signing in with Discord</div>
        <div class="mm-callback__skeletons">
          <div v-for="i in 3" :key="i" class="mm-skeleton" />
        </div>
        <p class="mm-callback__msg">Completing authentication — you'll land on your dashboard shortly.</p>
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
