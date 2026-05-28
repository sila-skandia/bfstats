import { ref } from 'vue'

// Module-level reactive flag shared between the router guards and the shell component.
export const isNavigating = ref(false)
