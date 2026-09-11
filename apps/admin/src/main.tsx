import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initI18n } from './i18n';
import './styles.css';

// Language and direction are settled before the first paint, so the page never flips in front of
// the user (scope NFR-06).
void initI18n().then(() => {
  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
