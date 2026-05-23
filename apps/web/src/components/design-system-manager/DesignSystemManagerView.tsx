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
  type VariablesFile,
} from '../../providers/design-system-variables';
import { navigate } from '../../router';
import { CollectionsSidebar } from './CollectionsSidebar';
import { VariablesTable } from './VariablesTable';
import { Icon } from '../Icon';

interface Props {
  projectId: string;
  designSystemId: string | null;
  projectName: string;
  onAttachDsRequested: (kind: 'create' | 'figma' | 'library') => void;
  onCreateEmpty: () => Promise<void> | void;
}

function isDsLocked(error: string | null): boolean {
  return error != null && /not editable|DS_NOT_FOUND/i.test(error);
}

export function DesignSystemManagerView({
  projectId,
  designSystemId,
  projectName,
  onAttachDsRequested,
  onCreateEmpty,
}: Props) {
  const [variables, setVariables] = useState<VariablesFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);

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
      setActiveCollectionId(result.variables.collections[0]?.id ?? null);
    });
    return () => { cancelled = true; };
  }, [designSystemId]);

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

  const handleUpdateVariable = useCallback(
    (variableId: string, patch: Partial<Pick<Variable, 'name' | 'type' | 'value'>>) => {
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

  const handleClose = useCallback(() => {
    navigate({ kind: 'project', projectId, conversationId: null, fileName: null });
  }, [projectId]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  // Treat a missing or locked DS as "no DS attached" — show the empty
  // banner inside the table area instead of the raw error string.
  const dsMissingOrLocked = !designSystemId || isDsLocked(loadError);
  const showBanner = dsMissingOrLocked || !variables || !activeCollection;
  const bannerErrorMessage = loadError && !isDsLocked(loadError) ? loadError : null;

  return (
    <div className="ds-mgr-wrapper">
      <header className="ds-mgr-topbar">
        <h2 className="ds-mgr-topbar__title">Design system — {projectName}</h2>
        <button
          type="button"
          className="ds-mgr-topbar__close"
          aria-label="Close design system manager"
          onClick={handleClose}
          data-testid="ds-mgr-close"
        >
          <Icon name="close" size={14} />
        </button>
      </header>
      <div className="ds-mgr">
        <CollectionsSidebar
          collections={dsMissingOrLocked ? [] : variables?.collections ?? []}
          activeCollectionId={activeCollectionId}
          onSelect={setActiveCollectionId}
          onCreate={async (name) => {
            if (!designSystemId || dsMissingOrLocked) return;
            await createCollection(designSystemId, name);
            await refetch();
          }}
          onDelete={async (collectionId) => {
            if (!designSystemId || dsMissingOrLocked) return;
            await deleteCollection(designSystemId, collectionId);
            await refetch();
          }}
        />
        {!showBanner && designSystemId && variables && activeCollection ? (
          <VariablesTable
            collection={activeCollection}
            onUpdateVariable={handleUpdateVariable}
            onDeleteVariable={async (variableId) => {
              await deleteVariable(designSystemId, variableId);
              await refetch();
            }}
            onCreateVariable={async (groupId, body) => {
              await createVariable(designSystemId, activeCollection.id, groupId, body);
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
