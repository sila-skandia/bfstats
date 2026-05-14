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
