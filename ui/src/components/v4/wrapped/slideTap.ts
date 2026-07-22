// Whole-slide click-to-advance is a desktop affordance. On mobile the slide
// body is a scroller — a tap must never double as navigation (it made
// scrolling feel booby-trapped); the edge tap bands, the intro prompt, and
// the bottom bar navigate instead.
export function clickAdvancesSlide(): boolean {
  return window.matchMedia('(min-width: 1024px)').matches
}
