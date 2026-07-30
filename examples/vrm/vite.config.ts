import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile({
      // Only pull JS and CSS into the HTML; leave images/fonts/models external.
      inlinePattern: ['**/*.js', '**/*.css'],
      // Don't apply the recommended config, which forces assetsInlineLimit sky-high
      // and base64s every asset into the bundle.
      useRecommendedBuildConfig: false,
      removeViteModuleLoader: true,
    }),
  ],
  build: {
    // Emit images/fonts/etc. as separate files instead of data: URIs.
    assetsInlineLimit: 0,
    cssCodeSplit: false,
  },
})