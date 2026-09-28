import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Dev-only: expose horizontal overflow for headless checks.
if (import.meta.env.DEV) {
  const mark = () => {
    const el = document.documentElement
    el.dataset.overflow = `${el.scrollWidth}/${el.clientWidth}`
  }
  window.addEventListener('load', () => setInterval(mark, 500))
}
