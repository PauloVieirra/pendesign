import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import {
  createCollection,
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
  projectId: _projectId,
  designSystemId,
  projectName: _projectName,
  onAttachDsRequested,
  sidebarCollapsed,
  onToggleSidebar,
  maximized,
  onToggleMaximize,
  onClose,
}: Props) {
  const t = useT();
  const [variables, setVariables] = useState<VariablesFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<VariableType>>(new Set());
  const [activeGroupId, setActiveGroupId] = useState<string | 'all'>('all');

  // Reset activeGroupId when the active collection changes
  useEffect(() => {
    setActiveGroupId('all');
  }, [activeCollectionId]);

  // Load variables when DS id changes
  useEffect(() => {
    if (!designSystemId) {
      setVariables(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchVariables(designSystemId).then((result) => {
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
  }, [designSystemId]);

  // Persist / hydrate activeCollectionId per DS id
  useEffect(() => {
    if (!designSystemId) return;
    const stored = localStorage.getItem(LS_ACTIVE_COLLECTION(designSystemId));
    if (stored) setActiveCollectionId(stored);
  }, [designSystemId]);
  useEffect(() => {
    if (!designSystemId || !activeCollectionId) return;
    try { localStorage.setItem(LS_ACTIVE_COLLECTION(designSystemId), activeCollectionId); } catch { /* ignore */ }
  }, [designSystemId, activeCollectionId]);

  const activeCollection = useMemo(
    () => variables?.collections.find((c) => c.id === activeCollectionId) ?? null,
    [variables, activeCollectionId],
  );

  const refetch = useCallback(async () => {
    if (!designSystemId) return;
    const result = await fetchVariables(designSystemId);
    if ('error' in result) {
      setLoadError(result.error.message);
      return;
    }
    setVariables(result.variables);
  }, [designSystemId]);

  // Handler: per-mode value update — optimistic + POST patch
  const handleUpdateValueForMode = useCallback(
    (variableId: string, modeId: string, value: string | number | boolean) => {
      if (!designSystemId) return;
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
      void updateVariable(designSystemId, variableId, { valuesByMode: { [modeId]: value } }).then((r) => {
        if ('error' in r) { setLoadError(r.error.message); void refetch(); }
      });
    },
    [designSystemId, refetch],
  );

  // Handler: rename variable — optimistic + POST patch
  const handleRenameVariable = useCallback(
    (variableId: string, name: string) => {
      if (!designSystemId) return;
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
      void updateVariable(designSystemId, variableId, { name }).then((r) => {
        if ('error' in r) { setLoadError(r.error.message); void refetch(); }
      });
    },
    [designSystemId, refetch],
  );

  // Handler: create variable
  const handleCreateVariable = useCallback(
    async (groupId: string, body: { name: string; type: VariableType }) => {
      if (!designSystemId || !activeCollection) return;
      await createVariable(designSystemId, activeCollection.id, groupId, body);
      await refetch();
    },
    [designSystemId, activeCollection, refetch],
  );

  // Mode handlers
  const handleCreateMode = useCallback(
    async (body: { name: string; width?: number }) => {
      if (!designSystemId || !activeCollection) return;
      await createMode(designSystemId, activeCollection.id, body);
      await refetch();
    },
    [designSystemId, activeCollection, refetch],
  );

  const handleRenameMode = useCallback(
    async (modeId: string, name: string) => {
      if (!designSystemId || !activeCollection) return;
      await updateMode(designSystemId, activeCollection.id, modeId, { name });
      await refetch();
    },
    [designSystemId, activeCollection, refetch],
  );

  const handleSetModeWidth = useCallback(
    async (modeId: string, width: number | null) => {
      if (!designSystemId || !activeCollection) return;
      await updateMode(designSystemId, activeCollection.id, modeId, { width });
      await refetch();
    },
    [designSystemId, activeCollection, refetch],
  );

  const handleDeleteMode = useCallback(
    async (modeId: string) => {
      if (!designSystemId || !activeCollection) return;
      await deleteMode(designSystemId, activeCollection.id, modeId);
      await refetch();
    },
    [designSystemId, activeCollection, refetch],
  );

  // Treat a missing or locked DS as a transient state — the daemon auto-creates
  // a DS on project creation, so we just show a loading indicator.
  const dsMissingOrLocked = !designSystemId || isDsLocked(loadError);
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
            if (!designSystemId || dsMissingOrLocked) return;
            await createCollection(designSystemId, name);
            await refetch();
          }}
          onDeleteCollection={async (collectionId) => {
            if (!designSystemId || dsMissingOrLocked) return;
            await deleteCollection(designSystemId, collectionId);
            await refetch();
          }}
          onCreateGroup={async (name) => {
            if (!designSystemId || dsMissingOrLocked || !activeCollectionId) return;
            await createGroup(designSystemId, activeCollectionId, name);
            await refetch();
          }}
          onDeleteGroup={async (groupId) => {
            if (!designSystemId || dsMissingOrLocked || !activeCollectionId) return;
            await deleteGroup(designSystemId, activeCollectionId, groupId);
            await refetch();
          }}
          collapsed={sidebarCollapsed}
        />
        <main className="ds-modal__main">
          {!showLoadingState && designSystemId && variables && activeCollection ? (
            <VariablesTable
              collection={activeCollection}
              activeGroupId={activeGroupId}
              query={query}
              typeFilter={typeFilter}
              onUpdateVariableValueForMode={handleUpdateValueForMode}
              onRenameVariable={handleRenameVariable}
              onDeleteVariable={async (variableId) => {
                await deleteVariable(designSystemId, variableId);
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
              <p>Loading design system…</p>
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

