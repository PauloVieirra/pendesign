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
import { CollectionsSidebar } from './CollectionsSidebar';
import { DesignSystemEmptyState } from './EmptyState';
import { VariablesTable } from './VariablesTable';

interface Props {
  projectId: string;
  designSystemId: string | null;
  projectName: string;
  onAttachDsRequested: (kind: 'create' | 'figma' | 'library') => void;
}

export function DesignSystemManagerView({
  projectId: _projectId,
  designSystemId,
  projectName,
  onAttachDsRequested,
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

  const dsIsMissingOrLocked = !designSystemId
    || (loadError != null && /not editable|DS_NOT_FOUND/i.test(loadError));
  if (dsIsMissingOrLocked) {
    return (
      <DesignSystemEmptyState
        projectName={projectName}
        onCreateNew={() => onAttachDsRequested('create')}
        onImportFromFigma={() => onAttachDsRequested('figma')}
        onPickFromLibrary={() => onAttachDsRequested('library')}
      />
    );
  }
  if (loading && !variables) return <p className="ds-mgr-loading">Loading…</p>;
  if (loadError && !variables) return <p className="ds-mgr-error">{loadError}</p>;
  if (!variables) return null;

  return (
    <div className="ds-mgr">
      <CollectionsSidebar
        collections={variables.collections}
        activeCollectionId={activeCollectionId}
        onSelect={setActiveCollectionId}
        onCreate={async (name) => {
          await createCollection(designSystemId, name);
          await refetch();
        }}
        onDelete={async (collectionId) => {
          await deleteCollection(designSystemId, collectionId);
          await refetch();
        }}
      />
      {activeCollection ? (
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
        <p className="ds-mgr-empty-collection">Select a collection from the left, or create one.</p>
      )}
      {loadError ? <p className="ds-mgr-toast">{loadError}</p> : null}
    </div>
  );
}
