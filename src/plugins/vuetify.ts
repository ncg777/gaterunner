/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

// Composables
import { createVuetify } from 'vuetify'

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  defaults: {
    VTextField: { density: 'compact', variant: 'outlined' },
    VSelect: { density: 'compact', variant: 'outlined' },
    VBtn: { rounded: 'sm' },
  },
  theme: {
    defaultTheme: 'dark',
    themes: {
      dark: {
        dark: true,
        colors: {
          background: '#171a1f',
          surface: '#22262d',
          'surface-bright': '#353c46',
          'surface-light': '#2b3038',
          'surface-variant': '#414954',
          'on-surface': '#dce1e8',
          primary: '#d6bd82',
          'on-primary': '#25251f',
          secondary: '#74bba9',
          'on-secondary': '#0b211e',
          info: '#72a9a0',
          success: '#74bba9',
          warning: '#e6a23c',
          error: '#d85b4d',
        },
      },
    },
  },
})
