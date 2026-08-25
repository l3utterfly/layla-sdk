import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Builds a single self-contained index.html, so the whole diagnostics mini-app
// can be copied to the host and loaded in the Layla WebView as one file.
export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
  ],
})
