import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Resolves to true the first time `target` comes near the viewport, then stops
 * observing. Used to defer mounting below-the-fold sections whose chunks are
 * expensive — the comments thread pulls in TipTap + DOMPurify (~343KB raw), and
 * downloading that during initial page load competes with the API calls the
 * visible part of the page is waiting on.
 *
 * `rootMargin` deliberately fires ahead of the fold so the chunk is usually in
 * flight before the section is actually on screen.
 *
 * Falls back to true immediately where IntersectionObserver is unavailable
 * (older browsers, jsdom) so content is never withheld.
 */
export function useInViewport(
  target: Ref<HTMLElement | null>,
  rootMargin = '600px',
): Ref<boolean> {
  const visible = ref(false)
  let observer: IntersectionObserver | null = null

  onMounted(() => {
    if (typeof IntersectionObserver === 'undefined') {
      visible.value = true
      return
    }
    observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          visible.value = true
          observer?.disconnect()
          observer = null
        }
      },
      { rootMargin },
    )
    if (target.value) observer.observe(target.value)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  return visible
}
