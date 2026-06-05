import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import CharacterSwipeDeck from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CharacterSwipeDeck />
  </StrictMode>,
)
