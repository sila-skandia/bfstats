// Tiny helpers that map raw numbers to the modern-minimal theme's semantic
// color classes. Co-located with the v4 views so they're easy to find when
// tweaking band thresholds.

export const kdClass = (kd: number | null | undefined): string => {
  if (kd == null || Number.isNaN(kd)) return 'mm-kd--mid'
  if (kd < 0.5) return 'mm-kd--poor'
  if (kd < 1.0) return 'mm-kd--low'
  if (kd < 2.0) return 'mm-kd--mid'
  if (kd < 3.0) return 'mm-kd--good'
  return 'mm-kd--elite'
}

export const streakClass = (n: number | null | undefined): string => {
  if (!n || n < 10) return 'mm-num--score'
  if (n < 25) return 'mm-kd--low'
  if (n < 50) return 'mm-kd--good'
  return 'mm-num--streak'
}

// load = fraction 0..1 (current / max). Used for server population emphasis.
export const loadClass = (load: number | null | undefined): string => {
  if (load == null || load <= 0) return 'mm-num--load-idle'
  if (load >= 0.95) return 'mm-num--load-full'
  if (load >= 0.6) return 'mm-num--load-busy'
  return 'mm-num--score'
}

// ============================================================================
// Chart palette — Neutral Depth dark mode. Use these instead of inline hex.
// All charts must read against the dark surface; we mirror the brief's
// olive accent + brightened kill red rather than the old earthy ramp.
// ============================================================================

export const MM_CHART = {
  // Surface tints — for grids, axis ink, tooltip backplates.
  ink: '#ffffff',
  inkSoft: '#c8c8c8',
  inkMuted: '#8a8a8a',
  inkFaint: '#555555',
  surface: '#131313',
  surfaceSoft: '#1a1a1a',
  surfaceMute: '#222222',
  grid: 'rgba(255, 255, 255, 0.06)',
  gridStrong: 'rgba(255, 255, 255, 0.12)',

  // Brand / accent
  accent: '#7d8849',      // olive — primary lines, bars, K/D ramp
  accentSoft: '#9aa666',  // lighter olive — hover, secondary series
  highlight: '#847d4c',   // anchor olive — used very sparingly in charts
  elite: '#b4c060',       // lifted olive — best-tier highlight

  // Semantic
  kill: '#d65a5a',        // primary kill / danger / Axis side
  killSoft: '#8a3838',    // muted kill
  success: '#7da34c',     // win / Allied side
  successSoft: '#3d5a1a',
} as const

// Team-aware coloring: map a team label to its chart color. Battlefield 1942
// canonical sides are Axis (red) and Allies (olive/green); a few maps use
// other labels (USA, NVA, etc.) — fall back to neutral inks for those.
export const teamColor = (label: string | null | undefined): string => {
  if (!label) return MM_CHART.inkSoft
  const lbl = label.toLowerCase()
  // Axis-side names
  if (lbl.includes('axis') || lbl.includes('german') || lbl.includes('red') ||
      lbl.includes('north') || lbl.includes('nva') || lbl === 'team 2') {
    return MM_CHART.kill
  }
  // Allied / olive-side names
  if (lbl.includes('alli') || lbl.includes('allied') || lbl.includes('usa') ||
      lbl.includes('blue') || lbl.includes('south') || lbl === 'team 1') {
    return MM_CHART.success
  }
  // Unknown / third-faction — accent olive
  return MM_CHART.accent
}

// Translucent overlay companion to teamColor — for chart fills.
export const teamFill = (label: string | null | undefined, opacity = 0.12): string => {
  const c = teamColor(label)
  // Convert known hexes back to rgba so chart options can use the alpha.
  const map: Record<string, [number, number, number]> = {
    [MM_CHART.kill]: [214, 90, 90],
    [MM_CHART.success]: [125, 163, 76],
    [MM_CHART.accent]: [125, 136, 73],
    [MM_CHART.inkSoft]: [200, 200, 200],
  }
  const rgb = map[c] ?? [200, 200, 200]
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity})`
}
