import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: true,
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      // Use injectManifest so we can write a fully custom service worker with
      // our own install/activate/fetch handlers (required for re-caching
      // index.html on activate and for the strict navigation network-first logic).
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw-custom.ts",
      includeAssets: ["favicon.ico", "logo.png", "pwa-192x192.png", "pwa-512x512.png"],
      manifest: {
        name: "Check-In Tracker",
        short_name: "Check-In",
        description: "Sales Rep Check-In & Visit Tracker",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#1a9e3c",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: {
        // Only precache the actual build output files (JS/CSS/HTML/assets).
        // SPA route paths (/schedule, /log-visit, etc.) are NOT real files and
        // must NOT be added here — they are handled by the navigation fallback
        // in the SW fetch handler instead.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,eot,webmanifest}"],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // ExcelJS ships a browser-safe bundle; alias to it so Vite never
      // tries to resolve Node.js built-ins (fs, stream, zlib, etc.).
      "exceljs": path.resolve(__dirname, "node_modules/exceljs/dist/exceljs.min.js"),
    },
  },
}));
