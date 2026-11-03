import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, IS_PREVIEW } from './ui/App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker: offline read of the app shell (HTTPS or localhost only; never in the chat preview).
if (!IS_PREVIEW && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* app works without it */
    });
  });
}
