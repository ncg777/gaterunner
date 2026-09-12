var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// public/manifest.json
var require_manifest = __commonJS({
  "public/manifest.json"(exports, module) {
    module.exports = {
      short_name: "GateRunner",
      name: "GateRunner",
      icons: [
        {
          src: "logo32.png",
          sizes: "32x32",
          type: "image/png"
        },
        {
          src: "logo192.png",
          type: "image/png",
          sizes: "192x192"
        },
        {
          src: "logo512.png",
          type: "image/png",
          sizes: "512x512"
        }
      ],
      start_url: ".",
      display: "standalone",
      theme_color: "#00ff00",
      background_color: "#000000"
    };
  }
});

// vite.config.mts
import Components from "file:///D:/repos/gaterunner/node_modules/unplugin-vue-components/dist/vite.js";
import Vue from "file:///D:/repos/gaterunner/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import Vuetify, { transformAssetUrls } from "file:///D:/repos/gaterunner/node_modules/vite-plugin-vuetify/dist/index.mjs";
import ViteFonts from "file:///D:/repos/gaterunner/node_modules/unplugin-fonts/dist/vite.mjs";
import { VitePWA } from "file:///D:/repos/gaterunner/node_modules/vite-plugin-pwa/dist/index.js";
import { defineConfig } from "file:///D:/repos/gaterunner/node_modules/vite/dist/node/index.js";
import { fileURLToPath, URL } from "node:url";
var __vite_injected_original_import_meta_url = "file:///D:/repos/gaterunner/vite.config.mts";
var vite_config_default = defineConfig({
  plugins: [
    Vue({
      template: { transformAssetUrls }
    }),
    VitePWA({
      registerType: "autoUpdate",
      manifest: require_manifest(),
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
        // 5 MiB, adjust as needed
      }
    }),
    // https://github.com/vuetifyjs/vuetify-loader/tree/master/packages/vite-plugin#readme
    Vuetify(),
    Components(),
    ViteFonts({
      google: {
        families: [{
          name: "Roboto",
          styles: "wght@100;300;400;500;700;900"
        }]
      }
    })
  ],
  base: "/gaterunner/",
  define: { "process.env": {} },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", __vite_injected_original_import_meta_url))
    },
    extensions: [
      ".js",
      ".json",
      ".jsx",
      ".mjs",
      ".ts",
      ".tsx",
      ".vue"
    ]
  },
  server: {
    port: 3e3
  },
  css: {
    preprocessorOptions: {
      sass: {
        api: "modern-compiler"
      }
    }
  },
  build: {
    outDir: "docs"
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsicHVibGljL21hbmlmZXN0Lmpzb24iLCAidml0ZS5jb25maWcubXRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJ7XHJcbiAgXCJzaG9ydF9uYW1lXCI6IFwiR2F0ZVJ1bm5lclwiLFxyXG4gIFwibmFtZVwiOiBcIkdhdGVSdW5uZXJcIixcclxuICBcImljb25zXCI6IFtcclxuICAgIHtcclxuICAgICAgXCJzcmNcIjogXCJsb2dvMzIucG5nXCIsXHJcbiAgICAgIFwic2l6ZXNcIjogXCIzMngzMlwiLFxyXG4gICAgICBcInR5cGVcIjogXCJpbWFnZS9wbmdcIlxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgXCJzcmNcIjogXCJsb2dvMTkyLnBuZ1wiLFxyXG4gICAgICBcInR5cGVcIjogXCJpbWFnZS9wbmdcIixcclxuICAgICAgXCJzaXplc1wiOiBcIjE5MngxOTJcIlxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgXCJzcmNcIjogXCJsb2dvNTEyLnBuZ1wiLFxyXG4gICAgICBcInR5cGVcIjogXCJpbWFnZS9wbmdcIixcclxuICAgICAgXCJzaXplc1wiOiBcIjUxMng1MTJcIlxyXG4gICAgfVxyXG4gIF0sXHJcbiAgXCJzdGFydF91cmxcIjogXCIuXCIsXHJcbiAgXCJkaXNwbGF5XCI6IFwic3RhbmRhbG9uZVwiLFxyXG4gIFwidGhlbWVfY29sb3JcIjogXCIjMDBmZjAwXCIsXHJcbiAgXCJiYWNrZ3JvdW5kX2NvbG9yXCI6IFwiIzAwMDAwMFwiXHJcbn1cclxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxyZXBvc1xcXFxnYXRlcnVubmVyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJEOlxcXFxyZXBvc1xcXFxnYXRlcnVubmVyXFxcXHZpdGUuY29uZmlnLm10c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRDovcmVwb3MvZ2F0ZXJ1bm5lci92aXRlLmNvbmZpZy5tdHNcIjsvLyBQbHVnaW5zXHJcbmltcG9ydCBDb21wb25lbnRzIGZyb20gJ3VucGx1Z2luLXZ1ZS1jb21wb25lbnRzL3ZpdGUnXHJcbmltcG9ydCBWdWUgZnJvbSAnQHZpdGVqcy9wbHVnaW4tdnVlJ1xyXG5pbXBvcnQgVnVldGlmeSwgeyB0cmFuc2Zvcm1Bc3NldFVybHMgfSBmcm9tICd2aXRlLXBsdWdpbi12dWV0aWZ5J1xyXG5pbXBvcnQgVml0ZUZvbnRzIGZyb20gJ3VucGx1Z2luLWZvbnRzL3ZpdGUnXHJcbmltcG9ydCB7IFZpdGVQV0EgfSBmcm9tICd2aXRlLXBsdWdpbi1wd2EnO1xyXG5cclxuLy8gVXRpbGl0aWVzXHJcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnXHJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGgsIFVSTCB9IGZyb20gJ25vZGU6dXJsJ1xyXG5cclxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICBwbHVnaW5zOiBbXHJcbiAgICBWdWUoe1xyXG4gICAgICB0ZW1wbGF0ZTogeyB0cmFuc2Zvcm1Bc3NldFVybHMgfSxcclxuICAgIH0pLFxyXG4gICAgVml0ZVBXQSh7XHJcbiAgICAgIHJlZ2lzdGVyVHlwZTogJ2F1dG9VcGRhdGUnLFxyXG4gICAgICBtYW5pZmVzdDogcmVxdWlyZSgnLi9wdWJsaWMvbWFuaWZlc3QuanNvbicpLFxyXG4gICAgICB3b3JrYm94OiB7XHJcbiAgICAgICAgbWF4aW11bUZpbGVTaXplVG9DYWNoZUluQnl0ZXM6IDUgKiAxMDI0ICogMTAyNCAvLyA1IE1pQiwgYWRqdXN0IGFzIG5lZWRlZFxyXG4gICAgICB9XHJcbiAgICB9KSxcclxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS92dWV0aWZ5anMvdnVldGlmeS1sb2FkZXIvdHJlZS9tYXN0ZXIvcGFja2FnZXMvdml0ZS1wbHVnaW4jcmVhZG1lXHJcbiAgICBWdWV0aWZ5KCksXHJcbiAgICBDb21wb25lbnRzKCksXHJcbiAgICBWaXRlRm9udHMoe1xyXG4gICAgICBnb29nbGU6IHtcclxuICAgICAgICBmYW1pbGllczogW3tcclxuICAgICAgICAgIG5hbWU6ICdSb2JvdG8nLFxyXG4gICAgICAgICAgc3R5bGVzOiAnd2dodEAxMDA7MzAwOzQwMDs1MDA7NzAwOzkwMCcsXHJcbiAgICAgICAgfV0sXHJcbiAgICAgIH0sXHJcbiAgICB9KSxcclxuICBdLFxyXG4gIGJhc2U6Jy9nYXRlcnVubmVyLycsXHJcbiAgZGVmaW5lOiB7ICdwcm9jZXNzLmVudic6IHt9IH0sXHJcbiAgcmVzb2x2ZToge1xyXG4gICAgYWxpYXM6IHtcclxuICAgICAgJ0AnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4vc3JjJywgaW1wb3J0Lm1ldGEudXJsKSksXHJcbiAgICB9LFxyXG4gICAgZXh0ZW5zaW9uczogW1xyXG4gICAgICAnLmpzJyxcclxuICAgICAgJy5qc29uJyxcclxuICAgICAgJy5qc3gnLFxyXG4gICAgICAnLm1qcycsXHJcbiAgICAgICcudHMnLFxyXG4gICAgICAnLnRzeCcsXHJcbiAgICAgICcudnVlJyxcclxuICAgIF0sXHJcbiAgfSxcclxuICBzZXJ2ZXI6IHtcclxuICAgIHBvcnQ6IDMwMDAsXHJcbiAgfSxcclxuICBjc3M6IHtcclxuICAgIHByZXByb2Nlc3Nvck9wdGlvbnM6IHtcclxuICAgICAgc2Fzczoge1xyXG4gICAgICAgIGFwaTogJ21vZGVybi1jb21waWxlcicsXHJcbiAgICAgIH0sXHJcbiAgICB9LFxyXG4gIH0sXHJcbiAgYnVpbGQ6IHtcclxuICAgIG91dERpcjogJ2RvY3MnLFxyXG4gIH1cclxufSlcclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFDRSxZQUFjO0FBQUEsTUFDZCxNQUFRO0FBQUEsTUFDUixPQUFTO0FBQUEsUUFDUDtBQUFBLFVBQ0UsS0FBTztBQUFBLFVBQ1AsT0FBUztBQUFBLFVBQ1QsTUFBUTtBQUFBLFFBQ1Y7QUFBQSxRQUNBO0FBQUEsVUFDRSxLQUFPO0FBQUEsVUFDUCxNQUFRO0FBQUEsVUFDUixPQUFTO0FBQUEsUUFDWDtBQUFBLFFBQ0E7QUFBQSxVQUNFLEtBQU87QUFBQSxVQUNQLE1BQVE7QUFBQSxVQUNSLE9BQVM7QUFBQSxRQUNYO0FBQUEsTUFDRjtBQUFBLE1BQ0EsV0FBYTtBQUFBLE1BQ2IsU0FBVztBQUFBLE1BQ1gsYUFBZTtBQUFBLE1BQ2Ysa0JBQW9CO0FBQUEsSUFDdEI7QUFBQTtBQUFBOzs7QUN2QkEsT0FBTyxnQkFBZ0I7QUFDdkIsT0FBTyxTQUFTO0FBQ2hCLE9BQU8sV0FBVywwQkFBMEI7QUFDNUMsT0FBTyxlQUFlO0FBQ3RCLFNBQVMsZUFBZTtBQUd4QixTQUFTLG9CQUFvQjtBQUM3QixTQUFTLGVBQWUsV0FBVztBQVRpSCxJQUFNLDJDQUEyQztBQVlyTSxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTO0FBQUEsSUFDUCxJQUFJO0FBQUEsTUFDRixVQUFVLEVBQUUsbUJBQW1CO0FBQUEsSUFDakMsQ0FBQztBQUFBLElBQ0QsUUFBUTtBQUFBLE1BQ04sY0FBYztBQUFBLE1BQ2QsVUFBVTtBQUFBLE1BQ1YsU0FBUztBQUFBLFFBQ1AsK0JBQStCLElBQUksT0FBTztBQUFBO0FBQUEsTUFDNUM7QUFBQSxJQUNGLENBQUM7QUFBQTtBQUFBLElBRUQsUUFBUTtBQUFBLElBQ1IsV0FBVztBQUFBLElBQ1gsVUFBVTtBQUFBLE1BQ1IsUUFBUTtBQUFBLFFBQ04sVUFBVSxDQUFDO0FBQUEsVUFDVCxNQUFNO0FBQUEsVUFDTixRQUFRO0FBQUEsUUFDVixDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUNBLE1BQUs7QUFBQSxFQUNMLFFBQVEsRUFBRSxlQUFlLENBQUMsRUFBRTtBQUFBLEVBQzVCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssY0FBYyxJQUFJLElBQUksU0FBUyx3Q0FBZSxDQUFDO0FBQUEsSUFDdEQ7QUFBQSxJQUNBLFlBQVk7QUFBQSxNQUNWO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxFQUNSO0FBQUEsRUFDQSxLQUFLO0FBQUEsSUFDSCxxQkFBcUI7QUFBQSxNQUNuQixNQUFNO0FBQUEsUUFDSixLQUFLO0FBQUEsTUFDUDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsRUFDVjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
