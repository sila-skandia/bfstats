<script setup lang="ts">
import { computed } from 'vue'
import { sceneArtUrl, useSignatureCatalogue, type SignatureMod } from '@/composables/useSignatureCatalogue'

/**
 * Pick the mod a forum signature is drawn from, then the scene: each card is the
 * scene's own hero art, the game's models posed mid-action.
 */
interface Props {
  mod: string
  scene: string
  /** Offer a first chip that leaves the mod to the server ("" in `mod`). */
  autoLabel?: string
  /** The mod the auto chip stands for, so its scenes can be shown. */
  autoMod?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'update:mod': [mod: string]; 'update:scene': [scene: string] }>()

const { mods, failed } = useSignatureCatalogue()

const activeMod = computed<SignatureMod | undefined>(() => {
  const id = props.mod || props.autoMod || 'bf1942'
  return mods.value.find(m => m.id === id) ?? mods.value[0]
})

const activeScene = computed(() =>
  activeMod.value?.scenes.find(s => s.id === props.scene)?.id ?? activeMod.value?.scenes[0]?.id ?? '')

function pickMod(id: string) {
  emit('update:mod', id)
  const next = mods.value.find(m => m.id === (id || props.autoMod))
  // Keep the same kind of shot where the new mod has it (armour stays armour).
  if (next && !next.scenes.some(s => s.id === props.scene)) emit('update:scene', '')
}
</script>

<template>
  <div class="mm-sap">
    <p v-if="failed" class="mm-card__hint">The scene list could not be loaded; the default art is used.</p>
    <div class="mm-sap__mods" role="radiogroup" aria-label="Mod">
      <button
        v-if="autoLabel !== undefined"
        type="button"
        role="radio"
        class="mm-sap__mod"
        :class="{ 'is-active': !mod }"
        :aria-checked="!mod"
        @click="pickMod('')"
      >
        {{ autoLabel }}
      </button>
      <button
        v-for="m in mods"
        :key="m.id"
        type="button"
        role="radio"
        class="mm-sap__mod"
        :class="{ 'is-active': mod === m.id }"
        :aria-checked="mod === m.id"
        :title="m.name"
        :style="{ '--sap-accent': m.accent }"
        @click="pickMod(m.id)"
      >
        <span class="mm-sap__swatch" aria-hidden="true" />
        {{ m.short }}
      </button>
    </div>

    <div v-if="activeMod" class="mm-sap__scenes" role="radiogroup" :aria-label="`${activeMod.name} scenes`">
      <button
        v-for="s in activeMod.scenes"
        :key="s.id"
        type="button"
        role="radio"
        class="mm-sap__scene"
        :class="{ 'is-active': activeScene === s.id }"
        :aria-checked="activeScene === s.id"
        :style="{ '--sap-accent': activeMod.accent }"
        @click="emit('update:scene', s.id)"
      >
        <img :src="sceneArtUrl(activeMod.id, s.id)" :alt="s.label" loading="lazy" class="mm-sap__art" />
        <span class="mm-sap__label">{{ s.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.mm-sap { display: flex; flex-direction: column; gap: 12px; }

.mm-sap__mods { display: flex; flex-wrap: wrap; gap: 6px; }

.mm-sap__mod {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 6px 10px;
  background: transparent;
  color: var(--mm-ink-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease, background-color 0.12s ease;
}

.mm-sap__mod:hover { border-color: var(--mm-ink); color: var(--mm-ink); }

.mm-sap__mod.is-active { border-color: var(--mm-ink); background: var(--mm-ink); color: var(--mm-bg); }

.mm-sap__swatch {
  width: 9px;
  height: 9px;
  background: var(--sap-accent, var(--mm-accent));
  transform: skewX(-14deg);
}

.mm-sap__scenes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
}

.mm-sap__scene {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  background:
    linear-gradient(115deg, transparent 58%, color-mix(in srgb, var(--sap-accent) 22%, transparent) 58% 66%, transparent 66%),
    radial-gradient(ellipse at 75% 60%, var(--mm-bg-mute) 0%, var(--mm-bg) 75%);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  cursor: pointer;
  overflow: hidden;
  text-align: left;
  transition: border-color 0.12s ease, transform 0.12s ease;
}

.mm-sap__scene:hover { border-color: var(--mm-ink-soft); }

.mm-sap__scene.is-active {
  border-color: var(--sap-accent);
  box-shadow: inset 0 0 0 1px var(--sap-accent);
}

.mm-sap__art {
  display: block;
  width: 100%;
  aspect-ratio: 8 / 5;
  object-fit: contain;
  object-position: right bottom;
}

.mm-sap__label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  padding: 5px 8px 6px;
  background: color-mix(in srgb, var(--mm-bg) 70%, transparent);
  border-top: 1px solid var(--mm-rule);
}

.mm-sap__scene.is-active .mm-sap__label { color: var(--sap-accent); }

@media (max-width: 640px) {
  .mm-sap__scenes { grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .mm-sap__label { font-size: 9px; padding: 4px 6px 5px; }
}
</style>
