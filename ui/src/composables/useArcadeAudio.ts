/* global Audio */
import { ref } from 'vue'

const storedMuted = typeof localStorage !== 'undefined' ? localStorage.getItem('bfstats:arcade-muted') : null
const isMuted = ref<boolean>(storedMuted === null ? true : storedMuted === 'true')

export function useArcadeAudio() {
  const toggleMute = () => {
    isMuted.value = !isMuted.value
    localStorage.setItem('bfstats:arcade-muted', String(isMuted.value))
  }

  const playSound = (soundName: string, faction: string = 'us') => {
    if (isMuted.value) return
    try {
      const audio = new Audio(`/radio-sounds/${faction}/${soundName}.mp3`)
      audio.volume = 0.75
      audio.play().catch(() => {
        // Suppressed by browser autoplay policy if user hasn't interacted
      })
    } catch {
      // Audio unsupported or failed
    }
  }

  const playRoger = () => playSound('roger')
  const playNegative = () => playSound('negative')
  const playGoGoGo = () => playSound('gogogo')
  const playMedic = () => playSound('medic')

  return {
    isMuted,
    toggleMute,
    playRoger,
    playNegative,
    playGoGoGo,
    playMedic,
  }
}
