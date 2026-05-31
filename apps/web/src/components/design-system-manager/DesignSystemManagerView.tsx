import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n';
import {
  createCollection,
  createEmptyDesignSystemForProject,
  createGroup,
  createMode,
  createVariable,
  deleteCollection,
  deleteGroup,
  deleteMode,
  deleteVariable,
  fetchVariables,
  updateMode,
  updateVariable,
  type Variable,
  type VariableType,
  type VariablesFile,
} from '../../providers/design-system-variables';
import { CollectionsSidebar } from './CollectionsSidebar';
import { VariablesTable } from './VariablesTable';
import { SearchAndFilter } from './SearchAndFilter';
import { Icon } from '../Icon';

interface Props {
  projectId: string;
  designSystemId: string | null;
  projectName: string;
  onAttachDsRequested: (kind: 'create' | 'figma' | 'library') => void;
  // Modal chrome props (Phase 6)
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
}

const LS_ACTIVE_COLLECTION = (id: string) => `ds-modal:active-collection:${id}`;

function isDsLocked(error: string | null): boolean {
  return error != null && /not editable|DS_NOT_FOUND/i.test(error);
}

export function DesignSystemManagerView({
  projectId,
  designSystemId,
  projectName: _projectName,
  onAttachDsRequested: _onAttachDsRequested,
  sidebarCollapsed,
  onToggleSidebar,
  maximized,
  onToggleMaximize,
  onClose,
}: Props) {
  const t = useT();
  // Local mirror of the DS id. Initially comes from the prop, but if the
  // project arrives without a DS (e.g., legacy project created before
  // auto-attach landed), we self-heal by calling create-empty here and
  // tracking the new id locally. Parent state catches up on the next
  // navigation; the modal does not need to wait for it.
  const [localDsId, setLocalDsId] = useState<string | null>(designSystemId);
  const [attaching, setAttaching] = useState(false);
  const [variables, setVariables] = useState<VariablesFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<VariableType>>(new Set());
  const [activeGroupId, setActiveGroupId] = useState<string | 'all'>('all');

  useEffect(() => {
    setLocalDsId(designSystemId);
  }, [designSystemId]);

  // Self-heal: project has no DS attached OR the attached DS is a read-only
  // brand (e.g. `cisco`, `vercel`) that can't be edited → swap to a fresh
  // user-editable DS via create-empty. The brand association is intentionally
  // dropped — the variables panel is for project-specific tokens, not for
  // editing shared brand systems.
  //
  // The in-flight guard uses a ref (not state) because React 18 StrictMode
  // mounts effects twice in dev; a state-based guard re-fires before the
  // first setState batches in, causing the request to be sent to the daemon
  // twice (and TWO new DSes created on disk). A ref persists across the
  // intentional remount and reliably prevents the second call.
  const needsAttach = !localDsId || isDsLocked(loadError);
  const attachInFlight = useRef(false);
  useEffect(() => {
    if (!needsAttach) return;
    if (attachInFlight.current) return;
    attachInFlight.current = true;
    setAttaching(true);
    let cancelled = false;
    void createEmptyDesignSystemForProject(projectId).then((result) => {
      attachInFlight.current = false;
      if (cancelled) return;
      setAttaching(false);
      if ('error' in result) {
        setLoadError(result.error.message);
        return;
      }
      setLoadError(null);
      setLocalDsId(result.designSystemId);
    });
    return () => { cancelled = true; };
  }, [needsAttach, projectId]);

  // Reset activeGroupId when the active collection changes
  useEffect(() => {
    setActiveGroupId('all');
  }, [activeCollectionId]);

  // Load variables when DS id changes
  useEffect(() => {
    if (!localDsId) {
      setVariables(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchVariables(localDsId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if ('error' in result) {
        setLoadError(result.error.message);
        return;
      }
      setVariables(result.variables);
      setActiveCollectionId((prev) => prev ?? result.variables.collections[0]?.id ?? null);
    });
    return () => { cancelled = true; };
  }, [localDsId]);

  // Persist / hydrate activeCollectionId per DS id
  useEffect(() => {
    if (!localDsId) return;
    const stored = localStorage.getItem(LS_ACTIVE_COLLECTION(localDsId));
    if (stored) setActiveCollectionId(stored);
  }, [localDsId]);
  useEffect(() => {
    if (!localDsId || !activeCollectionId) return;
    try { localStorage.setItem(LS_ACTIVE_COLLECTION(localDsId), activeCollectionId); } catch { /* ignore */ }
  }, [localDsId, activeCollectionId]);

  const activeCollection = useMemo(
    () => variables?.collections.find((c) => c.id === activeCollectionId) ?? null,
    [variables, activeCollectionId],
  );

  const refetch = useCallback(async () => {
    if (!localDsId) return;
    const result = await fetchVariables(localDsId);
    if ('error' in result) {
      setLoadError(result.error.message);
      return;
    }
    setVariables(result.variables);
  }, [localDsId]);

  // Handler: per-mode value update — optimistic + POST patch
  const handleUpdateValueForMode = useCallback(
    (variableId: string, modeId: string, value: string | number | boolean) => {
      if (!localDsId) return;
      setVariables((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          collections: prev.collections.map((c) => ({
            ...c,
            groups: c.groups.map((g) => ({
              ...g,
              variables: g.variables.map((v) =>
                v.id === variableId ? { ...v, valuesByMode: { ...v.valuesByMode, [modeId]: value } } : v,
              ),
            })),
          })),
        };
      });
      void updateVariable(localDsId, variableId, { valuesByMode: { [modeId]: value } }).then((r) => {
        if ('error' in r) { setLoadError(r.error.message); void refetch(); }
      });
    },
    [localDsId, refetch],
  );

  // Handler: rename variable — optimistic + POST patch
  const handleRenameVariable = useCallback(
    (variableId: string, name: string) => {
      if (!localDsId) return;
      setVariables((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          collections: prev.collections.map((c) => ({
            ...c,
            groups: c.groups.map((g) => ({
              ...g,
              variables: g.variables.map((v) =>
                v.id === variableId ? { ...v, name } as Variable : v,
              ),
            })),
          })),
        };
      });
      void updateVariable(localDsId, variableId, { name }).then((r) => {
        if ('error' in r) { setLoadError(r.error.message); void refetch(); }
      });
    },
    [localDsId, refetch],
  );

  // Handler: create variable
  const handleCreateVariable = useCallback(
    async (groupId: string, body: { name: string; type: VariableType }) => {
      if (!localDsId || !activeCollection) return;
      await createVariable(localDsId, activeCollection.id, groupId, body);
      await refetch();
    },
    [localDsId, activeCollection, refetch],
  );

  // Mode handlers
  const handleCreateMode = useCallback(
    async (body: { name: string; width?: number }) => {
      if (!localDsId || !activeCollection) return;
      await createMode(localDsId, activeCollection.id, body);
      await refetch();
    },
    [localDsId, activeCollection, refetch],
  );

  const handleRenameMode = useCallback(
    async (modeId: string, name: string) => {
      if (!localDsId || !activeCollection) return;
      await updateMode(localDsId, activeCollection.id, modeId, { name });
      await refetch();
    },
    [localDsId, activeCollection, refetch],
  );

  const handleSetModeWidth = useCallback(
    async (modeId: string, width: number | null) => {
      if (!localDsId || !activeCollection) return;
      await updateMode(localDsId, activeCollection.id, modeId, { width });
      await refetch();
    },
    [localDsId, activeCollection, refetch],
  );

  const handleDeleteMode = useCallback(
    async (modeId: string) => {
      if (!localDsId || !activeCollection) return;
      await deleteMode(localDsId, activeCollection.id, modeId);
      await refetch();
    },
    [localDsId, activeCollection, refetch],
  );

  // Treat a missing or locked DS as a transient state — the daemon auto-creates
  // a DS on project creation, so we just show a loading indicator.
  const dsMissingOrLocked = !localDsId || isDsLocked(loadError);
  const showLoadingState = dsMissingOrLocked || !variables || !activeCollection;

  return (
    <div className="ds-modal-body">
      <header className="ds-modal__header">
        <div className="ds-modal__title">
          <h2>{t('ds.modal.title')}</h2>
          <button type="button" className="ds-modal__icon-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            <Icon name="sidebar" size={14} />
          </button>
        </div>
        <SearchAndFilter
          query={query}
          onQueryChange={setQuery}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
        />
        <div className="ds-modal__actions">
          <button type="button" className="ds-modal__icon-btn" onClick={onToggleMaximize} aria-label={maximized ? 'Restore' : 'Maximize'}>
            <Icon name={maximized ? 'minimize' : 'maximize'} size={14} />
          </button>
          <button type="button" className="ds-modal__icon-btn" onClick={onClose} aria-label="Close" data-testid="ds-mgr-close">
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>
      <div className={`ds-modal__body${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
        <CollectionsSidebar
          collections={dsMissingOrLocked ? [] : variables?.collections ?? []}
          activeCollectionId={activeCollectionId}
          activeGroupId={activeGroupId}
          onSelectCollection={setActiveCollectionId}
          onSelectGroup={setActiveGroupId}
          onCreateCollection={async (name) => {
            if (!localDsId || dsMissingOrLocked) return;
            await createCollection(localDsId, name);
            await refetch();
          }}
          onDeleteCollection={async (collectionId) => {
            if (!localDsId || dsMissingOrLocked) return;
            await deleteCollection(localDsId, collectionId);
            await refetch();
          }}
          onCreateGroup={async (name) => {
            if (!localDsId || dsMissingOrLocked || !activeCollectionId) return;
            await createGroup(localDsId, activeCollectionId, name);
            await refetch();
          }}
          onDeleteGroup={async (groupId) => {
            if (!localDsId || dsMissingOrLocked || !activeCollectionId) return;
            await deleteGroup(localDsId, activeCollectionId, groupId);
            await refetch();
          }}
          collapsed={sidebarCollapsed}
        />
        <main className="ds-modal__main">
          {!showLoadingState && localDsId && variables && activeCollection ? (
            <VariablesTable
              collection={activeCollection}
              activeGroupId={activeGroupId}
              query={query}
              typeFilter={typeFilter}
              onUpdateVariableValueForMode={handleUpdateValueForMode}
              onRenameVariable={handleRenameVariable}
              onDeleteVariable={async (variableId) => {
                await deleteVariable(localDsId, variableId);
                await refetch();
              }}
              onCreateVariable={handleCreateVariable}
              onCreateMode={handleCreateMode}
              onRenameMode={handleRenameMode}
              onSetModeWidth={handleSetModeWidth}
              onDeleteMode={handleDeleteMode}
            />
          ) : (
            <div className="ds-modal__loading">
              <p>{attaching ? 'Setting up design system…' : 'Loading design system…'}</p>
            </div>
          )}
          {loadError && !dsMissingOrLocked && variables ? (
            <p className="ds-mgr-toast">{loadError}</p>
          ) : null}
        </main>
      </div>
    </div>
  );
}

