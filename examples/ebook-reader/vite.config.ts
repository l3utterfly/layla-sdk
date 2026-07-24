import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vite.dev/config/
export default defineConfig({
  // viteSingleFile inlines all JS/CSS into a single index.html so the built app
  // can be distributed as one file (the public/ assets — app.json, icon.jpg,
  // bg.jpg — are copied alongside it as the mini-app package).
  plugins: [react(), viteSingleFile()],
  server: {
    port: Number(process.env.PORT) || 5173,
  },
})
