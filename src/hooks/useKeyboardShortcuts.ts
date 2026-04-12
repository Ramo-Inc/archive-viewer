import { useEffect } from 'react';
import { useViewerStore } from '../stores/viewerStore';

// ============================================================
// useKeyboardShortcuts — viewer keyboard navigation.
// RTL binding: ArrowLeft = nextPage, ArrowRight = prevPage.
// ============================================================

interface ShortcutCallbacks {
  onBack: () => void;
  onToggleUI: () => void;
}

export function useKeyboardShortcuts({ onBack, onToggleUI }: ShortcutCallbacks) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if an input element is focused
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const { nextPage, prevPage, goToPage, setViewMode, archive } =
        useViewerStore.getState();

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          // Right-to-left: left arrow advances (next page)
          nextPage();
          break;

        case 'ArrowRight':
          e.preventDefault();
          // Right-to-left: right arrow goes back (previous page)
          prevPage();
          break;

        case 'Home':
          e.preventDefault();
          goToPage(0);
          break;

        case 'End':
          e.preventDefault();
          if (archive) {
            goToPage(archive.pages.length - 1);
          }
          break;

        case 'f':
        case 'F':
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else {
            document.documentElement.requestFullscreen().catch(() => {});
          }
          break;

        case 'Escape':
          e.preventDefault();
          // Await savePosition then navigate back
          onBack();
          break;

        case '1':
          e.preventDefault();
          setViewMode('single');
          break;

        case '2':
          e.preventDefault();
          setViewMode('spread');
          break;

        case ' ':
          e.preventDefault();
          onToggleUI();
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onBack, onToggleUI]);
}
