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
import { loadPresetLibrary } from './presets'
import { presetStorageErrorMessage } from './presetStorage'

// Device-local preference; offline export always creates its own context.
Tone.setContext(createLiveContext(readLiveBuffering()), true)

async function startApp() {
  try {
    const initialLibrary = await loadPresetLibrary()
    const app = createApp(App, { initialLibrary })
    registerPlugins(app)
    app.mount('#app')
  } catch (error) {
    console.error('Unable to load preset storage.', error)
    const root = document.getElementById('app')
    if (root) root.textContent = `Unable to load saved presets. ${presetStorageErrorMessage(error)} Your stored presets have been preserved. Reload GateRunner to retry.`
  }
}

void startApp()
