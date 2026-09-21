/**
 * main.ts
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

// Plugins
import { registerPlugins } from '@/plugins'

// Components
import App from './App.vue'

// Composables
import { createApp } from 'vue'

import './registerServiceWorker'
import * as Tone from 'tone'
import { createLiveContext, readLiveBuffering } from './audio/liveAudio'

// Device-local preference; offline export always creates its own context.
Tone.setContext(createLiveContext(readLiveBuffering()), true)

const app = createApp(App)

registerPlugins(app)

app.mount('#app')
