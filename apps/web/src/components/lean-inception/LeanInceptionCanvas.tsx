import { useRef, useState } from 'react';
import type { LeanInceptionCard } from '@open-design/contracts';
import { useLeanInception } from './useLeanInception';
import { useColumnVisibility } from './useColumnVisibility';
import { LeanInceptionBoard, type BoardHandle } from './LeanInceptionBoard';
import { LeanInceptionDetailDrawer } from './LeanInceptionDetailDrawer';
import { LeanInceptionDropBar } from './LeanInceptionDropBar';
import { LeanInceptionActions } from './LeanInceptionActions';

interface Props {
  projectId: string;
}

export function LeanInceptionCanvas({ projectId }: Props) {
  const { state, isLoading, isMutating, error, refresh, extract, removeDocument, reset } =
    useLeanInception(projectId);
  const columns = useColumnVisibility(projectId);

  const [detailCard, setDetailCard] = useState<LeanInceptionCard | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const boardRef = useRef<BoardHandle>(null);

  const onConfirmReset = async () => {
    setConfirmingReset(false);
    await reset();
  };

  if (isLoading) {
    return <div data-testid="canvas-loading" className="li-loading">Loading…</div>;
  }
  if (!state) {
    return (
      <div className="li-error">
        <p className="li-error__msg">{error ?? 'Failed to load Lean Inception.'}</p>
        <button type="button" onClick={() => void refresh()} className="li-error__retry">Retry</button>
      </div>
    );
  }

  const filename = detailCard
    ? state.documents.find((d) => d.id === detailCard.document_id)?.filename ?? null
    : null;

  return (
    <div className="li-canvas">
      <LeanInceptionActions
        documents={state.documents}
        visible={columns.visible}
        isMutating={isMutating}
        onRefresh={() => void refresh()}
        onReset={() => setConfirmingReset(true)}
        onRemoveDoc={(id) => void removeDocument(id)}
        onToggleColumn={columns.toggle}
      />

      <LeanInceptionBoard
        ref={boardRef}
        state={state}
        visibleColumns={columns.orderedVisible}
        onDropFiles={(files) => void extract(files)}
        onCardClick={setDetailCard}
      />

      <LeanInceptionDropBar onFiles={(files) => void extract(files)} isMutating={isMutating} />

      <LeanInceptionDetailDrawer card={detailCard} filename={filename} onClose={() => setDetailCard(null)} />

      {confirmingReset && (
        <div className="li-modal-scrim">
          <div className="li-modal">
            <h3 className="li-modal__title">Resetar Lean Inception?</h3>
            <p className="li-modal__desc">Isso apaga todos os documentos e cards. Não pode ser desfeito.</p>
            <div className="li-modal__actions">
              <button type="button" onClick={() => setConfirmingReset(false)} className="li-modal__cancel">Cancelar</button>
              <button type="button" onClick={() => void onConfirmReset()} className="li-modal__confirm">Resetar</button>
            </div>
          </div>
        </div>
      )}

      {error && !isLoading && (
        <div className="li-toast">{error}</div>
      )}
    </div>
  );
}
