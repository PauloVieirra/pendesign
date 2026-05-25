import { useRef, useState, type ChangeEvent } from 'react';
import type { LeanInceptionCard } from '@open-design/contracts';
import { useT } from '../../i18n';
import { useLeanInception } from './useLeanInception';
import { LeanInceptionToolbar } from './LeanInceptionToolbar';
import { LeanInceptionBoard, type BoardHandle } from './LeanInceptionBoard';
import { LeanInceptionDetailDrawer } from './LeanInceptionDetailDrawer';
import { LeanInceptionEmptyState } from './LeanInceptionEmptyState';

interface Props {
  projectId: string;
}

export function LeanInceptionCanvas({ projectId }: Props) {
  const t = useT();
  const { state, isLoading, isMutating, error, refresh, extract, removeDocument, reset } =
    useLeanInception(projectId);

  const [detailCard, setDetailCard] = useState<LeanInceptionCard | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<BoardHandle>(null);

  const onAdd = () => fileInputRef.current?.click();
  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void extract(Array.from(e.target.files));
      e.target.value = '';
    }
  };
  const onConfirmReset = async () => {
    setConfirmingReset(false);
    await reset();
  };

  if (isLoading) {
    return <div data-testid="canvas-loading" className="li-canvas__loading flex items-center justify-center h-full">Loading…</div>;
  }

  if (!state) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="li-canvas__error">{error ?? 'Failed to load Lean Inception.'}</p>
        <button type="button" onClick={() => void refresh()} className="li-canvas__retry px-3 py-1.5 rounded-md text-sm">Retry</button>
      </div>
    );
  }

  const filename = detailCard
    ? state.documents.find((d) => d.id === detailCard.document_id)?.filename ?? null
    : null;

  return (
    <div className="li-canvas flex flex-col h-full">
      <LeanInceptionToolbar
        documents={state.documents}
        isMutating={isMutating}
        onAdd={onAdd}
        onRefresh={() => void refresh()}
        onReset={() => setConfirmingReset(true)}
        onRemoveDoc={(id) => void removeDocument(id)}
        onZoomIn={() => boardRef.current?.zoomIn()}
        onZoomOut={() => boardRef.current?.zoomOut()}
        onZoomFit={() => boardRef.current?.fit()}
      />

      <div className="relative flex-1 overflow-hidden">
        <LeanInceptionBoard
          ref={boardRef}
          state={state}
          onDropFiles={(files) => void extract(files)}
          onCardClick={setDetailCard}
        />
        {state.documents.length === 0 && <LeanInceptionEmptyState onAdd={onAdd} />}
      </div>

      <LeanInceptionDetailDrawer card={detailCard} filename={filename} onClose={() => setDetailCard(null)} />

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt"
        multiple
        className="hidden"
        onChange={onFileInputChange}
      />

      {confirmingReset && (
        <div className="li-modal-scrim fixed inset-0 z-[60] flex items-center justify-center">
          <div className="li-modal rounded-lg shadow-xl p-6 max-w-sm">
            <h3 className="li-modal__title text-lg font-semibold mb-2">{t('lean_inception.confirm.reset.title')}</h3>
            <p className="li-modal__desc text-sm mb-4">{t('lean_inception.confirm.reset.description')}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmingReset(false)} className="li-modal__cancel px-3 py-1.5 rounded-md text-sm">
                {t('lean_inception.confirm.reset.cancel')}
              </button>
              <button type="button" onClick={() => void onConfirmReset()} className="li-modal__confirm px-3 py-1.5 rounded-md text-sm">
                {t('lean_inception.confirm.reset.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && !isLoading && (
        <div className="li-toast absolute bottom-4 right-4 max-w-sm rounded-md px-3 py-2 text-sm shadow">
          {error}
        </div>
      )}
    </div>
  );
}
