import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate, useRoute } from '../../router';
import { useT } from '../../i18n';
import { DesignSystemManagerView } from './DesignSystemManagerView';

interface Props {
  open: boolean;
  projectId: string;
  designSystemId: string | null;
  projectName: string;
  onCreateEmpty: () => Promise<void> | void;
  onAttachDsRequested: (kind: 'create' | 'figma' | 'library') => void;
}

const LS_SIDEBAR_KEY = (dsId: string) => `ds-modal:sidebar-collapsed:${dsId}`;
const LS_MAX_KEY = (dsId: string) => `ds-modal:max:${dsId}`;

export function DesignSystemModal({
  open, projectId, designSystemId, projectName, onCreateEmpty, onAttachDsRequested,
}: Props) {
  const t = useT();
  const route = useRoute();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // Hydrate persisted UI state when the DS id is known.
  useEffect(() => {
    if (!designSystemId) return;
    try {
      const sc = localStorage.getItem(LS_SIDEBAR_KEY(designSystemId));
      const mx = localStorage.getItem(LS_MAX_KEY(designSystemId));
      setSidebarCollapsed(sc === '1');
      setMaximized(mx === '1');
    } catch { /* ignore */ }
  }, [designSystemId]);

  const persist = useCallback((key: string, val: boolean) => {
    try { localStorage.setItem(key, val ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  const close = useCallback(() => {
    if (route.kind !== 'project') return;
    navigate({ ...route, ds: undefined });
  }, [route]);

  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== 'Escape') return;
      // The search input handles Esc itself (clears query). If event reached us, close the modal.
      ev.stopPropagation();
      close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className={`ds-modal__backdrop${maximized ? ' is-max' : ''}`}
      ref={backdropRef}
      onMouseDown={(ev) => { if (ev.target === backdropRef.current) close(); }}
      data-testid="ds-modal-backdrop"
    >
      <div
        className={`ds-modal${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${maximized ? ' is-max' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('ds.modal.title')}
        data-testid="ds-modal"
      >
        <DesignSystemManagerView
          projectId={projectId}
          designSystemId={designSystemId}
          projectName={projectName}
          onAttachDsRequested={onAttachDsRequested}
          onCreateEmpty={onCreateEmpty}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => {
            setSidebarCollapsed((v) => { const nv = !v; if (designSystemId) persist(LS_SIDEBAR_KEY(designSystemId), nv); return nv; });
          }}
          maximized={maximized}
          onToggleMaximize={() => {
            setMaximized((v) => { const nv = !v; if (designSystemId) persist(LS_MAX_KEY(designSystemId), nv); return nv; });
          }}
          onClose={close}
        />
      </div>
    </div>
  );
}
