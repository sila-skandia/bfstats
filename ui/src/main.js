import './assets/main.css'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { decodePlayerName } from './utils/playerName'

const app = createApp(App)
app.use(router)
// Recover Cyrillic names that arrive as cp1252-decoded mojibake. Available in
// every template as $pn(name) for display contexts; URLs and DB lookups still use raw.
app.config.globalProperties.$pn = decodePlayerName
app.mount('#app')

// Custom Web Component for counting animation
if (!customElements.get('num-count')) {
  class NumCount extends HTMLElement {
    connectedCallback() {
      const to = parseFloat(this.dataset.to)
      if (isNaN(to)) return
      const raw = String(this.dataset.to)
      const decs = this.dataset.decimals != null ? +this.dataset.decimals : (raw.indexOf('.') >= 0 ? raw.split('.')[1].length : 0)
      const dur = this.dataset.dur ? +this.dataset.dur : 1100
      const delay = this.dataset.delay ? +this.dataset.delay : 0
      const self = this
      
      const fmt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: decs, maximumFractionDigits: decs })
      
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches) {
        this.textContent = fmt(to)
        return
      }
      
      const ease = (t) => 1 - Math.pow(1 - t, 3)
      this.textContent = fmt(0)
      
      const run = (start) => {
        const step = (now) => {
          const t = Math.min(1, (now - start) / dur)
          self.textContent = fmt(decs > 0 ? to * ease(t) : Math.round(to * ease(t)))
          if (t < 1) self._raf = requestAnimationFrame(step)
          else self.textContent = fmt(to)
        }
        self._raf = requestAnimationFrame(step)
      }
      
      this._to = setTimeout(() => { run(performance.now()) }, delay)
    }
    
    disconnectedCallback() {
      cancelAnimationFrame(this._raf)
      clearTimeout(this._to)
    }
  }
  customElements.define('num-count', NumCount)
}

