import { useState } from 'react';
import type { LeanInceptionDocument } from '@open-design/contracts';
import { useT } from '../../i18n';
import { LeanInceptionDocumentsList } from './LeanInceptionDocumentsList.js';

interface Props {
  documents: LeanInceptionDocument[];
  isMutating: boolean;
  onAdd: () => void;
  onRefresh: () => void;
  onReset: () => void;
  onRemoveDoc: (documentId: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
}

export function LeanInceptionToolbar(props: Props) {
  const t = useT();
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <div className="li-toolbar flex items-center gap-2 p-2 border-b border-neutral-200 bg-white">
      <button
        type="button"
        onClick={props.onAdd}
        disabled={props.isMutating}
        aria-label={t('lean_inception.toolbar.add_document')}
        className="px-3 py-1.5 rounded-md bg-neutral-900 text-white text-sm font-medium disabled:opacity-50"
      >
        + {t('lean_inception.toolbar.add_document')}
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setPopoverOpen((v) => !v)}
          aria-label={t('lean_inception.toolbar.documents')}
          className="px-3 py-1.5 rounded-md text-sm border border-neutral-200 flex items-center gap-1"
        >
          📄 {t('lean_inception.toolbar.documents')} ({props.documents.length}) ▾
        </button>
        {popoverOpen && (
          <div className="li-popover absolute top-full left-0 mt-1 z-20 bg-white border border-neutral-200 rounded-md shadow-md w-72 max-h-64 overflow-auto">
            <LeanInceptionDocumentsList
              documents={props.documents}
              onRemove={props.onRemoveDoc}
              disabled={props.isMutating}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={props.onRefresh}
        disabled={props.isMutating}
        aria-label={t('lean_inception.toolbar.refresh')}
        className="px-3 py-1.5 rounded-md text-sm border border-neutral-200 disabled:opacity-50"
      >
        ↻ {t('lean_inception.toolbar.refresh')}
      </button>

      <button
        type="button"
        onClick={props.onReset}
        disabled={props.isMutating}
        aria-label={t('lean_inception.toolbar.reset')}
        className="px-3 py-1.5 rounded-md text-sm border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        ⚠ {t('lean_inception.toolbar.reset')}
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={props.onZoomOut}
          aria-label={t('lean_inception.toolbar.zoom_out')}
          className="px-2 py-1.5 rounded-md text-sm border border-neutral-200"
        >
          🔍-
        </button>
        <button
          type="button"
          onClick={props.onZoomIn}
          aria-label={t('lean_inception.toolbar.zoom_in')}
          className="px-2 py-1.5 rounded-md text-sm border border-neutral-200"
        >
          🔍+
        </button>
        <button
          type="button"
          onClick={props.onZoomFit}
          aria-label={t('lean_inception.toolbar.zoom_fit')}
          className="px-2 py-1.5 rounded-md text-sm border border-neutral-200"
        >
          ⤢ {t('lean_inception.toolbar.zoom_fit')}
        </button>
      </div>
    </div>
  );
}
