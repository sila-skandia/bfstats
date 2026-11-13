import { ref } from 'vue'

/** One posed hero a mod offers for forum signatures (api/Signatures). */
export interface SignatureScene {
  id: string
  label: string
  kind: 'soldier' | 'vehicle' | 'plane' | string
  backdrop?: string | null
}

export interface SignatureMod {
  id: string
  name: string
  short: string
  gameIds: string[]
  accent: string
  scenes: SignatureScene[]
}

const mods = ref<SignatureMod[]>([])
const failed = ref(false)
let loading: Promise<void> | null = null

/** The signature art catalogue, fetched once per page. */
export function useSignatureCatalogue() {
  if (!loading) {
    loading = fetch('/stats/signatures/catalogue')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((doc: { mods: SignatureMod[] }) => { mods.value = doc.mods ?? [] })
      .catch(() => { failed.value = true; loading = null })
  }
  return { mods, failed }
}

/** The hero art of one scene, for the picker's cards. */
export const sceneArtUrl = (mod: string, scene: string) =>
  `/stats/signatures/art/${encodeURIComponent(mod)}/${encodeURIComponent(scene)}.webp`
