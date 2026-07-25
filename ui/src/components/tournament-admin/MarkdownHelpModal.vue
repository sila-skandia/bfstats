<template>
  <MmBaseModal
    :model-value="isOpen"
    title="Markdown Formatting"
    subtitle="Syntax Reference"
    size="md"
    @close="emit('close')"
  >
    <div class="markdown-help-body">
      <table class="mm-admin-table">
        <thead>
          <tr>
            <th>Syntax</th>
            <th>Renders as</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="mm-admin-mono" style="font-size: 12px; color: var(--mm-ink-soft);">
              # Heading
            </td>
            <td style="font-weight: 600; font-size: 14px;">
              Heading
            </td>
          </tr>
          <tr>
            <td class="mm-admin-mono" style="font-size: 12px; color: var(--mm-ink-soft);">
              **bold**
            </td>
            <td style="font-weight: 700;">
              bold
            </td>
          </tr>
          <tr>
            <td class="mm-admin-mono" style="font-size: 12px; color: var(--mm-ink-soft);">
              *italic*
            </td>
            <td style="font-style: italic;">
              italic
            </td>
          </tr>
          <tr>
            <td class="mm-admin-mono" style="font-size: 12px; color: var(--mm-ink-soft);">
              - list item
            </td>
            <td>• list item</td>
          </tr>
          <tr>
            <td class="mm-admin-mono" style="font-size: 12px; color: var(--mm-ink-soft);">
              [label](url)
            </td>
            <td><span style="color: var(--mm-accent);">label</span></td>
          </tr>
          <tr>
            <td class="mm-admin-mono" style="font-size: 12px; color: var(--mm-ink-soft);">
              `code`
            </td>
            <td>
              <span style="font-family: var(--mm-font-mono); font-size: 12px; background: var(--mm-bg-mute); padding: 1px 5px; border-radius: 2px;">code</span>
            </td>
          </tr>
          <tr>
            <td class="mm-admin-mono" style="font-size: 12px; color: var(--mm-ink-soft);">
              > quote
            </td>
            <td style="border-left: 2px solid var(--mm-rule-strong); padding-left: 8px; color: var(--mm-ink-muted);">
              quote
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <button
        type="button"
        class="mm-admin-btn mm-admin-btn--primary"
        @click="emit('close')"
      >
        Got it
      </button>
    </template>
  </MmBaseModal>
</template>

<script setup lang="ts">
import MmBaseModal from '@/components/v4/MmBaseModal.vue';

defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();
</script>

<style scoped>
.markdown-help-body {
  padding: 0;
}
</style>
