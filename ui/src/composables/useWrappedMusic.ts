import { ref, computed } from 'vue'

export interface WrappedTrack {
  id: string
  label: string
  mod: string
}

// Files live in public/wrapped-music/<id>.mp3 (converted from the game's .bik music)
export const WRAPPED_TRACKS: WrappedTrack[] = [
  { id: 'vanilla-slaughter4', label: "Gettin' Kicked", mod: 'Battlefield 1942' },
  { id: 'vanilla-vehicle4', label: 'Theme', mod: 'Battlefield 1942' },
  { id: 'dc-vehicle4', label: 'Theme', mod: 'Desert Combat' },
  { id: 'fh-vehicle4', label: 'Theme', mod: 'Forgotten Hope' },
  { id: 'gc-theme2', label: 'Theme', mod: 'Galactic Conquest' },
  { id: 'gc-vehicle3', label: 'Map Loading', mod: 'Galactic Conquest' },
  { id: 'interstate-discofever', label: 'Disco Fever', mod: "Interstate '82" },
  { id: 'interstate-slaughter4', label: 'Theme', mod: "Interstate '82" },
  { id: 'interstate-vehicle4', label: 'Map Loading', mod: "Interstate '82" },
  { id: 'eod-slaughter4', label: 'Theme', mod: 'Eve of Destruction' }
]

// Mod icons extracted from the game installs (.ico / serverInfo.dds → png)
export const MOD_ICONS: Record<string, string> = {
  'Battlefield 1942': modIconUrl('vanilla'),
  'Desert Combat': modIconUrl('dc'),
  'Forgotten Hope': modIconUrl('fh'),
  'Galactic Conquest': modIconUrl('gc'),
  "Interstate '82": modIconUrl('interstate'),
  'Eve of Destruction': modIconUrl('eod')
}

function modIconUrl(id: string): string {
  return `${import.meta.env.BASE_URL}wrapped-music/icons/${id}.png`
}

const DEFAULT_TRACK_ID = 'vanilla-vehicle4'
const TRACK_STORAGE_KEY = 'wrapped-music-track'
const ENABLED_STORAGE_KEY = 'wrapped-music-enabled'
const VOLUME = 0.45

function storedTrackId(): string {
  const stored = localStorage.getItem(TRACK_STORAGE_KEY)
  return WRAPPED_TRACKS.some(t => t.id === stored) ? stored! : DEFAULT_TRACK_ID
}

// Module-level singleton — the desktop and mobile layouts both render a
// control and must share one audio element / one state.
const selectedTrackId = ref(storedTrackId())
const enabled = ref(localStorage.getItem(ENABLED_STORAGE_KEY) !== 'false')
const isPlaying = ref(false)

let audio: HTMLAudioElement | null = null
let sessionActive = false
let gestureListenerAttached = false

const selectedTrack = computed(() => WRAPPED_TRACKS.find(t => t.id === selectedTrackId.value)!)

function trackUrl(id: string): string {
  return `${import.meta.env.BASE_URL}wrapped-music/${id}.mp3`
}

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
    audio.loop = true
    audio.volume = VOLUME
    audio.preload = 'none'
    audio.addEventListener('play', () => { isPlaying.value = true })
    audio.addEventListener('pause', () => { isPlaying.value = false })
  }
  return audio
}

// The wrapped auto-starts on mount without a user gesture, so the first
// play() can be rejected by the browser's autoplay policy. Retry on the
// first interaction instead.
function retryOnFirstGesture() {
  if (gestureListenerAttached) return
  gestureListenerAttached = true
  const retry = () => {
    gestureListenerAttached = false
    window.removeEventListener('pointerdown', retry)
    window.removeEventListener('keydown', retry)
    if (sessionActive && enabled.value) {
      void play()
    }
  }
  window.addEventListener('pointerdown', retry)
  window.addEventListener('keydown', retry)
}

async function play() {
  const el = ensureAudio()
  const url = trackUrl(selectedTrackId.value)
  if (!el.src.endsWith(url)) {
    el.src = url
  }
  try {
    await el.play()
  } catch {
    retryOnFirstGesture()
  }
}

export function useWrappedMusic() {
  function startSession() {
    sessionActive = true
    if (enabled.value) {
      void play()
    }
  }

  function endSession() {
    sessionActive = false
    audio?.pause()
  }

  function selectTrack(id: string) {
    selectedTrackId.value = id
    localStorage.setItem(TRACK_STORAGE_KEY, id)
    if (!enabled.value) {
      setEnabled(true)
    } else if (sessionActive) {
      void play()
    }
  }

  function setEnabled(value: boolean) {
    enabled.value = value
    localStorage.setItem(ENABLED_STORAGE_KEY, String(value))
    if (value && sessionActive) {
      void play()
    } else if (!value) {
      audio?.pause()
    }
  }

  return {
    tracks: WRAPPED_TRACKS,
    selectedTrackId,
    selectedTrack,
    enabled,
    isPlaying,
    startSession,
    endSession,
    selectTrack,
    setEnabled
  }
}
