import './assets/main.css'

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
