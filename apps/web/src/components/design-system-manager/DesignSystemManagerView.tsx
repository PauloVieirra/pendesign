import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createCollection,
  createGroup,
  createVariable,
  deleteCollection,
  deleteGroup,
  deleteVariable,
  fetchVariables,
  updateVariable,
  type Variable,
  type VariableType,
  type VariablesFile,
} from '../../providers/design-system-variables';
import { CollectionsSidebar } from './CollectionsSidebar';
import { VariablesTable } from './VariablesTable';
import { Icon } from '../Icon';

interface Props {
  projectId: string;
  designSystemId: string | null;
  projectName: string;
  onAttachDsRequested: (kind: 'create' | 'figma' | 'library') => void;
  onCreateEmpty: () => Promise<void> | void;
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
  projectName,
  onAttachDsRequested,
  onCreateEmpty,
  sidebarCollapsed,
  onToggleSidebar,
  maximized,
  onToggleMaximize,
  onClose,
}: Props) {
  const [variables, setVariables] = useState<VariablesFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  // New state for Phase 8 (placeholders for now)
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<VariableType>>(new Set());
  const [activeGroupId, setActiveGroupId] = useState<string | 'all'>('all');

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUpdateVariable = useCallback(
    (variableId: string, patch: Partial<Pick<Variable, 'name' | 'type'>>) => {
      if (!designSystemId || !variables) return;
      setVariables((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          collections: prev.collections.map((c) => ({
            ...c,
            groups: c.groups.map((g) => ({
              ...g,
              variables: g.variables.map((v) =>
                v.id === variableId ? { ...v, ...patch } as Variable : v,
              ),
            })),
          })),
        };
      });
      void updateVariable(designSystemId, variableId, patch).then((result) => {
        if ('error' in result) {
          setLoadError(result.error.message);
          void refetch();
        }
      });
    },
    [designSystemId, variables, refetch],
  );

  // Treat a missing or locked DS as "no DS attached" — show the empty
  // banner inside the table area instead of the raw error string.
  const dsMissingOrLocked = !designSystemId || isDsLocked(loadError);
  const showBanner = dsMissingOrLocked || !variables || !activeCollection;
  const bannerErrorMessage = loadError && !isDsLocked(loadError) ? loadError : null;

  return (
    <div className="ds-modal-body">
      <header className="ds-modal__header">
        <div className="ds-modal__title">
          <h2>Variables</h2>
          <button type="button" className="ds-modal__icon-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            <Icon name="sidebar" size={14} />
          </button>
        </div>
        {/* SearchAndFilter placeholder — Phase 8 replaces this */}
        <div className="ds-modal__placeholder-search" />
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
          {!showBanner && designSystemId && variables && activeCollection ? (
            <VariablesTable
              collection={activeCollection}
              onUpdateVariable={handleUpdateVariable as any} // TODO: Phase 8 widens to valuesByMode
              onDeleteVariable={async (variableId) => {
                await deleteVariable(designSystemId, variableId);
                await refetch();
              }}
              onCreateVariable={async (groupId, body) => {
                await createVariable(designSystemId, activeCollection.id, groupId, body as any); // TODO: Phase 8
                await refetch();
              }}
              onCreateGroup={async (name) => {
                await createGroup(designSystemId, activeCollection.id, name);
                await refetch();
              }}
              onDeleteGroup={async (groupId) => {
                await deleteGroup(designSystemId, activeCollection.id, groupId);
                await refetch();
              }}
            />
          ) : (
            <DesignSystemEmptyBanner
              onCreate={onCreateEmpty}
              onImport={() => onAttachDsRequested('figma')}
              isLoading={loading}
              errorMessage={bannerErrorMessage}
            />
          )}
          {loadError && !dsMissingOrLocked && variables ? (
            <p className="ds-mgr-toast">{loadError}</p>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function DesignSystemEmptyBanner({
  onCreate,
  onImport,
  isLoading,
  errorMessage,
}: {
  onCreate: () => Promise<void> | void;
  onImport: () => void;
  isLoading: boolean;
  errorMessage: string | null;
}) {
  return (
    <section className="ds-mgr-empty-banner">
      <div className="ds-mgr-empty-banner__inner">
        <h3>Start your design system</h3>
        <p>Create an empty system and add tokens manually, or import from an existing source.</p>
        <div className="ds-mgr-empty-banner__actions">
          <button
            type="button"
            className="primary"
            onClick={() => { void onCreate(); }}
            data-testid="ds-mgr-empty-create"
          >
            Create empty
          </button>
          <button
            type="button"
            onClick={onImport}
            data-testid="ds-mgr-empty-import"
          >
            Import from Figma / repo / disk
          </button>
        </div>
        {isLoading ? <p className="ds-mgr-empty-banner__hint">Loading…</p> : null}
        {errorMessage ? <p className="ds-mgr-empty-banner__error">{errorMessage}</p> : null}
      </div>
    </section>
  );
}
