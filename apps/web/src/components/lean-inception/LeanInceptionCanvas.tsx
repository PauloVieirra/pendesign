import { useRef, useState, type ChangeEvent } from 'react';
import type { LeanInceptionCard } from '@open-design/contracts';
import { useT } from '../../i18n';
import { useLeanInception } from './useLeanInception.js';
import { LeanInceptionToolbar } from './LeanInceptionToolbar.js';
import { LeanInceptionBoard, type BoardHandle } from './LeanInceptionBoard.js';
import { LeanInceptionDetailDrawer } from './LeanInceptionDetailDrawer.js';
import { LeanInceptionEmptyState } from './LeanInceptionEmptyState.js';

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
    return <div data-testid="canvas-loading" className="flex items-center justify-center h-full text-neutral-500">Loading…</div>;
  }

  if (!state) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-red-600">{error ?? 'Failed to load Lean Inception.'}</p>
        <button type="button" onClick={() => void refresh()} className="px-3 py-1.5 rounded-md bg-neutral-900 text-white text-sm">Retry</button>
      </div>
    );
  }

  const filename = detailCard
    ? state.documents.find((d) => d.id === detailCard.document_id)?.filename ?? null
    : null;

  return (
    <div className="li-canvas flex flex-col h-full bg-white">
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm">
            <h3 className="text-lg font-semibold mb-2">{t('lean_inception.confirm.reset.title')}</h3>
            <p className="text-sm text-neutral-600 mb-4">{t('lean_inception.confirm.reset.description')}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmingReset(false)} className="px-3 py-1.5 rounded-md border border-neutral-200 text-sm">
                {t('lean_inception.confirm.reset.cancel')}
              </button>
              <button type="button" onClick={() => void onConfirmReset()} className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm">
                {t('lean_inception.confirm.reset.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && !isLoading && (
        <div className="absolute bottom-4 right-4 max-w-sm bg-red-50 border border-red-200 text-red-800 rounded-md px-3 py-2 text-sm shadow">
          {error}
        </div>
      )}
    </div>
  );
}
