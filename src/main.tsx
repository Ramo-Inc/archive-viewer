import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';

console.log('[ComicViewer] main.tsx loaded');

const root = document.getElementById('root');
if (!root) {
  console.error('[ComicViewer] #root element not found!');
} else {
  console.log('[ComicViewer] Mounting React app...');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  console.log('[ComicViewer] React app mounted');
}
