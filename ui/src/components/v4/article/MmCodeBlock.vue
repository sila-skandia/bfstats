<script setup lang="ts">
/** A command or file snippet with a Copy button. */
import { onBeforeUnmount, ref } from 'vue'

const props = defineProps<{ code: string }>()

const copied = ref(false)
let timer: number | undefined

const copy = async () => {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    window.clearTimeout(timer)
    timer = window.setTimeout(() => { copied.value = false }, 1600)
  } catch {
    /* clipboard blocked: the text is still selectable */
  }
}
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <div class="mm-code-block">
    <pre><code>{{ code }}</code></pre>
    <button type="button" class="mm-code-block__copy" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
  </div>
</template>

<style scoped>
.mm-code-block {
  position: relative;
  margin: 8px 0;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
}
.mm-code-block pre {
  margin: 0;
  padding: 10px 70px 10px 12px;
  overflow-x: auto;
}
.mm-code-block pre code {
  font-family: var(--mm-font-mono);
  color: var(--mm-ink);
  background: none;
  padding: 0;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre;
}
.mm-code-block__copy {
  position: absolute;
  top: 6px;
  right: 6px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  padding: 3px 8px;
  cursor: pointer;
}
.mm-code-block__copy:hover { color: var(--mm-ink); border-color: var(--mm-ink-muted); }
</style>
