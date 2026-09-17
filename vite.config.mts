// Plugins
import Components from 'unplugin-vue-components/vite'
import Vue from '@vitejs/plugin-vue'
import Vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'
import ViteFonts from 'unplugin-fonts/vite'
import { VitePWA } from 'vite-plugin-pwa';

// Utilities
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'retire-production-worker-in-dev',
      apply: 'serve',
      configureServer(server) {
        // A production PWA previously opened on this origin can otherwise serve
        // its cached index.html instead of Vite's entry point, hiding source fixes.
        server.middlewares.use((request, response, next) => {
          const path = request.url?.split('?')[0];
          const base = server.config.base;
          if (path !== `${base}sw.js` && path !== `${base}service-worker.js`) return next();
          response.setHeader('Content-Type', 'application/javascript');
          response.setHeader('Cache-Control', 'no-store');
          response.end(`
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  await self.registration.unregister();
  const pages = await self.clients.matchAll({ type: 'window' });
  await Promise.allSettled(pages.map(page => page.navigate(page.url)));
})()));
`);
        });
      },
    },
    Vue({
      template: { transformAssetUrls },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: require('./public/manifest.json'),
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 // 5 MiB, adjust as needed
      }
    }),
    // https://github.com/vuetifyjs/vuetify-loader/tree/master/packages/vite-plugin#readme
    Vuetify(),
    Components(),
    ViteFonts({
      google: {
        families: [{
          name: 'Roboto',
          styles: 'wght@100;300;400;500;700;900',
        }],
      },
    }),
  ],
  base:'/gaterunner/',
  define: { 'process.env': {} },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    extensions: [
      '.js',
      '.json',
      '.jsx',
      '.mjs',
      '.ts',
      '.tsx',
      '.vue',
    ],
  },
  server: {
    port: 3000,
  },
  css: {
    preprocessorOptions: {
      sass: {
        api: 'modern-compiler',
      },
    },
  },
  build: {
    outDir: 'docs',
  }
})
