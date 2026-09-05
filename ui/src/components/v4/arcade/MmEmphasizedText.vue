<script setup lang="ts">
import { computed } from 'vue'
import { splitEmphasizedText } from '@/utils/emphasizedText'
import { decodePlayerName } from '@/utils/playerName'

const props = defineProps<{
  text: string
  terms?: Array<string | null | undefined>
}>()

const segments = computed(() => splitEmphasizedText(props.text, props.terms ?? []))

const displayOf = (raw: string, emphasize: boolean) =>
  emphasize ? decodePlayerName(raw) : raw
</script>

<template>
  <span class="mm-emph">
    <template
      v-for="(seg, idx) in segments"
      :key="idx"
    >
      <mark
        v-if="seg.emphasize"
        class="mm-emph__mark"
        data-testid="arcade-entity"
      >{{ displayOf(seg.text, true) }}</mark>
      <template v-else>{{ displayOf(seg.text, false) }}</template>
    </template>
  </span>
</template>

<style scoped>
.mm-emph {
  display: inline;
}

.mm-emph__mark {
  display: inline;
  font-family: var(--mm-font-mono);
  font-weight: 700;
  font-style: normal;
  letter-spacing: 0.02em;
  color: var(--mm-highlight-ink);
  background: var(--mm-highlight);
  padding: 0.06em 0.34em 0.08em;
  margin: 0;
  border-radius: 2px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
</style>
