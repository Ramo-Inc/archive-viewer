import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../stores/libraryStore';
import TopBar from '../components/library/TopBar';
import Sidebar from '../components/library/Sidebar';
import ArchiveGrid from '../components/library/ArchiveGrid';
import DetailPanel from '../components/library/DetailPanel';
import DragDropZone from '../components/common/DragDropZone';
import ToastContainer from '../components/common/Toast';
import { useDragDrop } from '../hooks/useDragDrop';

/**
 * LibraryPage -- 3-pane layout: Sidebar | ArchiveGrid | DetailPanel
 * with TopBar across the top. Fetches initial data on mount.
 */
export default function LibraryPage() {
  const fetchArchives = useLibraryStore((s) => s.fetchArchives);
  const fetchFolders = useLibraryStore((s) => s.fetchFolders);
  const fetchTags = useLibraryStore((s) => s.fetchTags);
  const fetchSmartFolders = useLibraryStore((s) => s.fetchSmartFolders);

  const navigate = useNavigate();

  useDragDrop();

  useEffect(() => {
    fetchArchives();
    fetchFolders();
    fetchTags();
    fetchSmartFolders();
  }, [fetchArchives, fetchFolders, fetchTags, fetchSmartFolders]);

  const handleOpenViewer = useCallback(
    (archiveId: string) => {
      navigate(`/viewer/${archiveId}`);
    },
    [navigate],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <DragDropZone />
      <ToastContainer />
      <TopBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <ArchiveGrid onOpenViewer={handleOpenViewer} />
        <DetailPanel onOpenViewer={handleOpenViewer} />
      </div>
    </div>
  );
}
