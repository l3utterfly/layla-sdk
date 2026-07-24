import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installLaylaMock } from '../../../src/mock'

// Outside the Layla app there is no native host, so install the browser mock
// before anything renders (and therefore before the SDK posts its first
// message). It answers `generate_voice_to_file` — the endpoint the reader uses
// to pre-generate every passage's audio — plus `get_tts_voices`.
if (import.meta.env.DEV) {
  installLaylaMock({
    // Keep synthesis quick but still visibly progressive, one passage at a time.
    latencyMs: 220,
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
