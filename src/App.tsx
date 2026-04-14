import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { tauriInvoke } from './hooks/useTauriCommand';
import SetupWizard from './pages/SetupWizard';
import LibraryPage from './pages/LibraryPage';
import ViewerPage from './pages/ViewerPage';

/**
 * Root application component.
 *
 * On startup it calls `get_library_path` — if null the user has not
 * configured a library yet, so we show the SetupWizard instead of
 * the main routes (Errata E1-2).
 */
export default function App() {
  const [checking, setChecking] = useState(true);
  const [libraryReady, setLibraryReady] = useState(false);

  useEffect(() => {
    const checkLibrary = async () => {
      console.log('[App] Checking library path...');
      try {
        const path = await tauriInvoke<string | null>('get_library_path');
        console.log('[App] Library path:', path);
        setLibraryReady(path !== null);
      } catch (e) {
        console.warn('[App] get_library_path failed:', e);
        setLibraryReady(false);
      } finally {
        setChecking(false);
      }
    };
    checkLibrary();
  }, []);

  if (checking) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-primary)',
          color: 'var(--text-muted)',
        }}
      >
        起動中...
      </div>
    );
  }

  if (!libraryReady) {
    return (
      <SetupWizard
        onComplete={() => {
          setLibraryReady(true);
        }}
      />
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/viewer/:archiveId" element={<ViewerPage />} />
      </Routes>
    </BrowserRouter>
  );
}
