import { parseUtc } from '@/utils/timeUtils'
import type { PlayerTrendPoint } from '@/services/playerTrendService'

export type TrendRange = '30d' | '7d' | 'weekday'

export interface BuiltSeries {
  timestamps: string[]
  values: number[]
  prev: number[] | null
  band: { hi: number[]; lo: number[] } | null
  xTicks: { i: number; text: string }[]
  tsLabel: (i: number) => string
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const TREND_WEEKDAYS = WEEKDAYS

const hourFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dayShortFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const monthDayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

function floorToHour(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0)
}

function floorToFourHours(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(d.getHours() / 4) * 4, 0, 0, 0)
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function parsed(points: PlayerTrendPoint[]): { t: Date; v: number }[] {
  return points
    .map(p => ({ t: parseUtc(p.timestamp), v: p.avgPlayers }))
    .filter(p => !Number.isNaN(p.t.getTime()))
}

export function buildTrendSeries(
  points: PlayerTrendPoint[],
  range: TrendRange,
  weekday: number,
  showPrev: boolean,
): BuiltSeries {
  const now = new Date()
  const rows = parsed(points)

  if (range === 'weekday') {
    return buildWeekday(rows, weekday, now)
  }

  const days = range === '7d' ? 7 : 30
  const spanHours = range === '7d' ? 1 : 4
  const start = new Date(now.getTime() - days * 86_400_000)
  const floor = spanHours === 1 ? floorToHour : floorToFourHours
  const origin = floor(start).getTime()
  const end = floor(now).getTime()
  const step = spanHours * 3_600_000

  const buckets = new Map<number, number[]>()
  for (const row of rows) {
    if (row.t < start) continue
    const key = floor(row.t).getTime()
    const list = buckets.get(key)
    if (list) list.push(row.v)
    else buckets.set(key, [row.v])
  }

  const keys: number[] = []
  for (let t = origin; t <= end; t += step) keys.push(t)
  const timestamps = keys.map(k => new Date(k).toISOString())
  const values = keys.map(k => avg(buckets.get(k) ?? [0]))

  let prev: number[] | null = null
  if (showPrev) {
    const prevStart = new Date(start.getTime() - days * 86_400_000)
    const prevBuckets = new Map<number, number[]>()
    for (const row of rows) {
      if (row.t < prevStart || row.t >= start) continue
      const shifted = new Date(row.t.getTime() + days * 86_400_000)
      const key = floor(shifted).getTime()
      const list = prevBuckets.get(key)
      if (list) list.push(row.v)
      else prevBuckets.set(key, [row.v])
    }
    prev = keys.map(k => {
      const list = prevBuckets.get(k)
      return list ? avg(list) : 0
    })
  }

  const every = range === '7d' ? 24 : 30
  const xTicks = keys.map((k, i) => ({ i, t: new Date(k) }))
    .filter((_, i) => i % every === 0)
    .map(({ i, t }) => ({
      i,
      text: range === '7d' ? dayShortFmt.format(t) : monthDayFmt.format(t),
    }))

  const tsLabel = (i: number) => {
    const d = new Date(keys[i] ?? 0)
    const day = range === '7d' ? dayShortFmt.format(d) : monthDayFmt.format(d)
    return `${day} ${hourFmt.format(d)}`
  }

  return { timestamps, values, prev, band: null, xTicks, tsLabel }
}

function buildWeekday(
  rows: { t: Date; v: number }[],
  weekday: number,
  now: Date,
): BuiltSeries {
  const start = new Date(now.getTime() - 30 * 86_400_000)
  const byHour: number[][] = Array.from({ length: 24 }, () => [])
  for (const row of rows) {
    if (row.t < start) continue
    if (row.t.getDay() !== weekday) continue
    byHour[row.t.getHours()].push(row.v)
  }

  const values = byHour.map(h => avg(h))
  const hi = byHour.map(h => (h.length ? Math.max(...h) : 0))
  const lo = byHour.map(h => (h.length ? Math.min(...h) : 0))
  const timestamps = values.map((_, h) => {
    const d = new Date(now)
    d.setHours(h, 0, 0, 0)
    return d.toISOString()
  })
  const xTicks = [0, 4, 8, 12, 16, 20].map(h => ({
    i: h,
    text: `${String(h).padStart(2, '0')}:00`,
  }))
  const wd = WEEKDAYS[weekday] ?? 'Day'
  const tsLabel = (i: number) => `${wd.slice(0, 3)} ${String(i).padStart(2, '0')}:00`

  return {
    timestamps,
    values,
    prev: null,
    band: { hi, lo },
    xTicks,
    tsLabel,
  }
}

export function trendInsights(values: number[]): { peak: number; peakIndex: number; avg: number; pctChange: number } {
  if (values.length === 0) {
    return { peak: 0, peakIndex: 0, avg: 0, pctChange: 0 }
  }
  let peak = -1
  let peakIndex = 0
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (values[i] > peak) {
      peak = values[i]
      peakIndex = i
    }
  }
  const avgVal = sum / values.length
  const q = Math.max(1, Math.floor(values.length / 4))
  const first = avg(values.slice(0, q))
  const last = avg(values.slice(-q))
  const pctChange = first > 0 ? Math.round(((last - first) / first) * 100) : 0
  return { peak, peakIndex, avg: avgVal, pctChange }
}

export function methodNote(range: TrendRange, weekday: number): string {
  if (range === '7d') return 'Hourly average player counts · last 7 days'
  if (range === '30d') return '4-hour average player counts · last 30 days'
  return `Hour-of-day average across every ${WEEKDAYS[weekday]} in the last 30 days`
}
