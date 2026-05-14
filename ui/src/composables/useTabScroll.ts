import { nextTick, watch, type Ref } from 'vue'

/**
 * Reusable pattern for tabbed pages where the tab content lives in the middle
 * of a long scrollable page. Without this, clicking a tab while scrolled
 * elsewhere on the page silently swaps content the user can't see.
 *
 * What it does:
 *  - Watches the active-tab ref. On every change, smooth-scrolls the tabs bar
 *    into view *if* it's currently off-screen. If it's already roughly at the
 *    top of the viewport (i.e. the user is already looking at it), this is a
 *    no-op — no jarring micro-scrolls on every click.
 *
 * Usage:
 *   const activeTab = ref<'overview' | 'players' | …>('overview')
 *   const tabsBarRef = ref<HTMLElement | null>(null)
 *   useTabScroll(tabsBarRef, activeTab)
 *
 * Template:
 *   <div ref="tabsBarRef" class="mm-tabs" style="scroll-margin-top: 16px">
 *     <button …>…</button>
 *   </div>
 *
 * Why a composable vs inline: every V4 page with tabs needs this. Inlining
 * the watcher per-page guarantees one will be forgotten — exactly what
 * happened with ServerDetailsV4 before this lifted out.
 */
export function useTabScroll<T>(
  tabsBarRef: Ref<HTMLElement | null>,
  activeTab: Ref<T>,
): void {
  watch(activeTab, () => {
    nextTick(() => {
      const el = tabsBarRef.value
      if (!el) return
      const rect = el.getBoundingClientRect()
      // Skip if the tabs bar is already roughly at the top of the viewport —
      // avoids janking the page when the user is already looking at the tabs.
      if (rect.top < -20 || rect.top > 120) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  })
}
