import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';

console.log('[ArchiveViewer] main.tsx loaded');

const root = document.getElementById('root');
if (!root) {
  console.error('[ArchiveViewer] #root element not found!');
} else {
  console.log('[ArchiveViewer] Mounting React app...');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  console.log('[ArchiveViewer] React app mounted');
}
