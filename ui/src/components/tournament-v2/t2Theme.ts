import type { PublicTournamentDetail } from '@/services/publicTournamentService'
import { isValidHex, normalizeHex, hexToRgb, rgbToHex } from '@/utils/colorUtils'

/**
 * V2 league layout theme resolution.
 * The layout derives most tints with CSS color-mix, but legacy components
 * reused inside V2 (MatchDetailsModal, team modals) take concrete hex props —
 * this mirrors the CSS derivation for those consumers.
 */

export const T2_DEFAULTS = {
  bg: '#14100c',
  text: '#f2ece0',
  accent: '#c8a24a',
} as const

const mixHex = (a: string, b: string, t: number): string => {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra || !rb) return a
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t)
  return rgbToHex(mix(ra.r, rb.r), mix(ra.g, rb.g), mix(ra.b, rb.b))
}

export interface T2Theme {
  bg: string
  text: string
  accent: string
  surface: string // text 4% into bg
  card: string // text 7% into bg
  muted: string // text 55% into bg
}

export function resolveT2Theme(tournament: PublicTournamentDetail | null | undefined): T2Theme {
  const pick = (raw: string | undefined | null, fallback: string): string => {
    const normalized = normalizeHex(raw ?? '')
    return isValidHex(normalized) ? normalized : fallback
  }

  const bg = pick(tournament?.theme?.backgroundColour, T2_DEFAULTS.bg)
  const text = pick(tournament?.theme?.textColour, T2_DEFAULTS.text)
  const accent = pick(tournament?.theme?.accentColour, T2_DEFAULTS.accent)

  return {
    bg,
    text,
    accent,
    surface: mixHex(bg, text, 0.04),
    card: mixHex(bg, text, 0.07),
    muted: mixHex(bg, text, 0.55),
  }
}
