<template>
  <div>
    <div
      v-if="!renderedRules && !renderedRegistrationRules"
      class="t2-empty"
    >
      No rules published yet.
    </div>

    <div
      v-else
      class="t2-rules"
    >
      <div v-if="renderedRules">
        <div class="t2-section-head">
          <span class="t2-section-head__mark">//</span>
          <h2 class="t2-section-head__title">General rules</h2>
        </div>
        <div
          class="t2-md t2-rules__prose"
          v-html="renderedRules"
        />
      </div>

      <div v-if="renderedRegistrationRules">
        <div class="t2-section-head">
          <span class="t2-section-head__mark">//</span>
          <h2 class="t2-section-head__title">Registration</h2>
        </div>
        <div
          class="t2-md"
          v-html="renderedRegistrationRules"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import type { PublicTournamentDetail } from '@/services/publicTournamentService'

const props = defineProps<{ tournament: PublicTournamentDetail }>()

// Markdown is validated server-side before storage (MarkdownSanitizer)
const render = (md: string | undefined): string => {
  if (!md?.trim()) return ''
  try {
    return marked(md, { breaks: true }) as string
  } catch {
    return ''
  }
}

const renderedRules = computed(() => render(props.tournament.rules))
const renderedRegistrationRules = computed(() => render(props.tournament.registrationRules))
</script>
