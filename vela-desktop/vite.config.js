import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    host: "localhost",
  },

  // Env variables starting with VITE_ are exposed to the client
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari14",
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    // Output directory
    outDir: "dist",
  },

  define: {
    // Make Vela local mode flags available
    VELA_LOCAL_MODE: JSON.stringify(true),
    VELA_CHANNEL_PORT: JSON.stringify(0),
    VELA_DESKTOP_MODE: JSON.stringify(true),
  },

  resolve: {
    alias: {
      // Allow importing the monolith vela.jsx from the skills directory
      "@vela": path.resolve(__dirname, "../skills/vela-slides/app"),
    },
  },
});
