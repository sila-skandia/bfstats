<script setup lang="ts">
/* global Audio */
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

interface Faction {
  id: string
  name: string
  flag: string
  side: 'Allies' | 'Axis'
}

const factions: Faction[] = [
  { id: 'us', name: 'US Army', flag: '🇺🇸', side: 'Allies' },
  { id: 'german', name: 'Wehrmacht', flag: '🇩🇪', side: 'Axis' },
  { id: 'japanese', name: 'Imperial Navy', flag: '🇯🇵', side: 'Axis' },
  { id: 'russian', name: 'Red Army', flag: '🇷🇺', side: 'Allies' },
  { id: 'british', name: 'Royal Army', flag: '🇬🇧', side: 'Allies' },
]

const activeFaction = ref<string>('us')

interface RadioCommand {
  id: string
  hotkey: string
  label: string
  callout: string
  category: 'Spotting' | 'Requests' | 'Response' | 'Orders'
  sound: string
  meme?: boolean
}

const commands: RadioCommand[] = [
  { id: 'boat', hotkey: '1', label: 'Enemy boat spotted!', callout: 'Enemy boat spotted!', category: 'Spotting', sound: 'ships', meme: true },
  { id: 'sub', hotkey: '2', label: 'Enemy submarine spotted!', callout: 'Enemy submarine spotted!', category: 'Spotting', sound: 'submarine' },
  { id: 'armor', hotkey: '3', label: 'Enemy armor spotted!', callout: 'Enemy armor spotted!', category: 'Spotting', sound: 'armor' },
  { id: 'roger', hotkey: '4', label: 'Roger that!', callout: 'Roger that!', category: 'Response', sound: 'roger' },
  { id: 'negative', hotkey: '5', label: 'Negative!', callout: 'Negative!', category: 'Response', sound: 'negative' },
  { id: 'medic', hotkey: '6', label: 'Medic!', callout: 'Medic!', category: 'Requests', sound: 'medic' },
  { id: 'repairs', hotkey: '7', label: 'Need repairs!', callout: 'Need repairs!', category: 'Requests', sound: 'repairs' },
  { id: 'backup', hotkey: '8', label: 'Requesting backup!', callout: 'Requesting backup!', category: 'Requests', sound: 'backup' },
  { id: 'gogogo', hotkey: '9', label: 'Go, go, go!', callout: 'Go, go, go!', category: 'Orders', sound: 'gogogo' },
  { id: 'fire', hotkey: '0', label: 'Fire in the hole!', callout: 'Fire in the hole!', category: 'Orders', sound: 'fireinhole' },
  { id: 'cover', hotkey: 'C', label: 'Cover me!', callout: 'Cover me!', category: 'Orders', sound: 'coverme' },
  { id: 'bail', hotkey: 'B', label: 'Bail out!', callout: 'Bail out!', category: 'Orders', sound: 'bailout' },
]

const hudMessage = ref<string | null>(null)
let hudTimer: number | null = null

// Audio playback: downloads ONLY the single requested audio file per click (~15-25 KB)
function playAuthenticRadioSound(soundName: string) {
  const sound = new Audio(`/radio-sounds/${activeFaction.value}/${soundName}.mp3`)
  sound.volume = 0.95
  sound.play().catch(err => {
    console.error('Audio playback error:', err)
  })
}

function triggerCommand(cmd: RadioCommand) {
  playAuthenticRadioSound(cmd.sound)

  // Show tactical HUD alert
  const currentFac = factions.find(f => f.id === activeFaction.value)?.name || 'HQ'
  hudMessage.value = `${currentFac} ❯ "${cmd.callout.toUpperCase()}"`
  if (hudTimer) window.clearTimeout(hudTimer)
  hudTimer = window.setTimeout(() => {
    hudMessage.value = null
    hudTimer = null
  }, 3500)

  // Close commo-rose on selection
  emit('update:modelValue', false)
}

function close() {
  emit('update:modelValue', false)
}

function onKeydown(e: KeyboardEvent) {
  if (!props.modelValue) return
  if (e.key === 'Escape') {
    close()
    return
  }
  const key = e.key.toUpperCase()
  const match = commands.find(c => c.hotkey.toUpperCase() === key)
  if (match) {
    e.preventDefault()
    triggerCommand(match)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (hudTimer) window.clearTimeout(hudTimer)
})
</script>

<template>
  <div>
    <!-- Tactical HUD Banner on Screen -->
    <Teleport to="body">
      <Transition name="hud-fade">
        <div v-if="hudMessage" class="mm-hud-banner">
          <div class="mm-hud-banner__glow">
            <span class="mm-hud-banner__led">●</span>
            <span class="mm-hud-banner__tag">[RADIO TRANSMISSION]</span>
            <span class="mm-hud-banner__msg">{{ hudMessage }}</span>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Commo-Rose Dialog Modal -->
    <Teleport to="body">
      <div v-if="modelValue" class="mm-radio-backdrop" @click="close">
        <div class="mm-radio-modal" @click.stop>
          <!-- Radio Header -->
          <div class="mm-radio-modal__head">
            <div class="mm-radio-modal__channel">
              <span class="mm-radio-modal__led" />
              <span class="mm-radio-modal__freq">CH 24.2 MHz · F8 RADIO</span>
            </div>
            <span class="mm-radio-modal__hint">Press hotkey or click</span>
            <button
              type="button"
              class="mm-radio-modal__close"
              aria-label="Close radio"
              @click="close"
            >
              ✕
            </button>
          </div>

          <!-- Faction Band Selector -->
          <div class="mm-radio-factions">
            <button
              v-for="fac in factions"
              :key="fac.id"
              type="button"
              class="mm-radio-fac-btn"
              :class="{ 'mm-radio-fac-btn--active': activeFaction === fac.id }"
              @click="activeFaction = fac.id"
            >
              <span class="mm-radio-fac-btn__flag">{{ fac.flag }}</span>
              <span class="mm-radio-fac-btn__name">{{ fac.name }}</span>
            </button>
          </div>

          <!-- Vintage radio tuner display -->
          <div class="mm-radio-tuner">
            <div class="mm-radio-tuner__dial">
              <span class="mm-radio-tuner__needle" />
              <span class="mm-radio-tuner__marks">| · · · | · · · | · · · | · · · |</span>
            </div>
            <div class="mm-radio-tuner__station">
              BAND: {{ factions.find(f => f.id === activeFaction)?.name.toUpperCase() }} (44kHz AUTHENTIC)
            </div>
          </div>

          <!-- Radio Commands Grid -->
          <div class="mm-radio-grid">
            <button
              v-for="cmd in commands"
              :key="cmd.id"
              type="button"
              class="mm-radio-btn"
              :class="{ 'mm-radio-btn--meme': cmd.meme }"
              @click="triggerCommand(cmd)"
            >
              <span class="mm-radio-btn__key">[{{ cmd.hotkey }}]</span>
              <span class="mm-radio-btn__label">{{ cmd.label }}</span>
              <span v-if="cmd.meme" class="mm-radio-btn__chip">MEME</span>
            </button>
          </div>

          <!-- Footer note -->
          <div class="mm-radio-modal__foot">
            <span>5 Authentic Factions · Press <strong>R</strong> to toggle anywhere</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mm-hud-banner {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  pointer-events: none;
}

.mm-hud-banner__glow {
  background: rgba(14, 20, 12, 0.94);
  border: 1.5px solid #7da34c;
  color: #a7d465;
  box-shadow: 0 0 16px rgba(125, 163, 76, 0.4), 0 4px 18px rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  padding: 8px 18px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--mm-font-mono);
  font-size: 13px;
  letter-spacing: 0.06em;
}

.mm-hud-banner__led {
  color: #7da34c;
  animation: hud-blink 0.7s infinite alternate;
}

@keyframes hud-blink {
  from { opacity: 0.3; }
  to { opacity: 1; }
}

.mm-hud-banner__tag {
  color: #7d8849;
  font-weight: 600;
  font-size: 11px;
}

.mm-hud-banner__msg {
  color: #f1f5e8;
  font-weight: 600;
}

.hud-fade-enter-active,
.hud-fade-leave-active {
  transition: all 0.25s ease;
}

.hud-fade-enter-from,
.hud-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -12px);
}

.mm-radio-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(2px);
  z-index: 9999;
  display: grid;
  place-items: center;
  padding: 16px;
}

.mm-radio-modal {
  background: #191c18;
  border: 1.5px solid #4a5438;
  border-radius: 6px;
  width: 100%;
  max-width: 540px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(125, 136, 73, 0.15);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mm-radio-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #232720;
  border-bottom: 1px solid #363d2e;
}

.mm-radio-modal__channel {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-radio-modal__led {
  width: 7px;
  height: 7px;
  background: #7da34c;
  border-radius: 50%;
  box-shadow: 0 0 6px #7da34c;
}

.mm-radio-modal__freq {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  font-weight: 600;
  color: #cfd8c1;
}

.mm-radio-modal__hint {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: #8c977d;
}

.mm-radio-modal__close {
  background: transparent;
  border: none;
  color: #8c977d;
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 2px;
}

.mm-radio-modal__close:hover {
  color: #fff;
  background: #363d2e;
}

.mm-radio-factions {
  display: flex;
  gap: 4px;
  padding: 8px 14px;
  background: #1c201a;
  border-bottom: 1px solid #2d3326;
  overflow-x: auto;
}

.mm-radio-fac-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #141712;
  border: 1px solid #2d3326;
  border-radius: 3px;
  padding: 4px 8px;
  color: #8c977d;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;
}

.mm-radio-fac-btn:hover {
  color: #cfd8c1;
  border-color: #4a5438;
}

.mm-radio-fac-btn--active {
  background: #2a3124;
  border-color: #7da34c;
  color: #e5f0d5;
  box-shadow: 0 0 6px rgba(125, 163, 76, 0.2);
}

.mm-radio-fac-btn__flag {
  font-size: 12px;
}

.mm-radio-fac-btn__name {
  font-weight: 600;
}

.mm-radio-tuner {
  background: #121411;
  border-bottom: 1px solid #2d3326;
  padding: 8px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mm-radio-tuner__dial {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: #6a7458;
  letter-spacing: 0.12em;
  position: relative;
  display: inline-flex;
  align-items: center;
}

.mm-radio-tuner__needle {
  position: absolute;
  left: 45%;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: #e27d3c;
  box-shadow: 0 0 4px #e27d3c;
}

.mm-radio-tuner__station {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  color: #9ab85c;
  letter-spacing: 0.05em;
}

.mm-radio-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 14px;
}

.mm-radio-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #232720;
  border: 1px solid #3a4332;
  border-radius: 3px;
  padding: 8px 10px;
  color: #dce3d3;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  transition: all 0.12s ease;
  position: relative;
}

.mm-radio-btn:hover {
  background: #2f362a;
  border-color: #7da34c;
  color: #fff;
  transform: translateY(-1px);
}

.mm-radio-btn--meme {
  border-color: rgba(226, 125, 60, 0.45);
}

.mm-radio-btn--meme:hover {
  border-color: #e27d3c;
}

.mm-radio-btn__key {
  color: #8c977d;
  font-weight: 600;
  font-size: 10px;
}

.mm-radio-btn__label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-radio-btn__chip {
  font-size: 8px;
  background: rgba(226, 125, 60, 0.25);
  color: #e27d3c;
  padding: 1px 4px;
  border-radius: 2px;
  font-weight: 600;
}

.mm-radio-modal__foot {
  padding: 8px 14px;
  background: #1c201a;
  border-top: 1px solid #2d3326;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  color: #7a846b;
  text-align: center;
}
</style>
