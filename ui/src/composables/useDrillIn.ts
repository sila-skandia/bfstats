import { isRef, nextTick, ref, type Ref } from 'vue'

type Target = HTMLElement | null | Ref<HTMLElement | null>

/**
 * Reusable pattern for in-place drill-in views (e.g. list → detail swaps inside a tab).
 *
 * Behavior:
 *  - On `enter()`, captures the page's current scroll position and (next tick)
 *    scrolls the supplied target element into view so the user *sees* the new
 *    content rather than wondering what changed.
 *  - On `exit()`, restores the captured scroll position so "back to list"
 *    returns the user to exactly where they were.
 *
 * Usage:
 *   const drill = useDrillIn()
 *   const detailRef = ref<HTMLElement | null>(null)
 *
 *   const openDetail = (id) => {
 *     selected.value = id
 *     drill.enter(detailRef.value)
 *   }
 *   const closeDetail = () => {
 *     selected.value = null
 *     drill.exit()
 *   }
 *
 * Pass the section that becomes visible AFTER entry, not the list — the goal
 * is to land the user on the new content with a small breathing-room offset.
 */
export interface UseDrillIn {
  enter: (target?: Target) => void
  exit: () => void
  savedY: Ref<number>
}

export function useDrillIn(): UseDrillIn {
  const savedY = ref(0)

  const enter = (target?: Target) => {
    savedY.value = window.scrollY
    // Wait for the detail panel to render. If a ref was passed, read .value
    // *after* the tick so we pick up the just-mounted element.
    nextTick(() => {
      const el = isRef(target) ? target.value : target ?? null
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const exit = () => {
    // Restore *after* the list re-renders so the saved position still has content.
    nextTick(() => {
      window.scrollTo({ top: savedY.value, behavior: 'smooth' })
    })
  }

  return { enter, exit, savedY }
}
