import { useState } from 'react';
import type { LeanInceptionDocument } from '@open-design/contracts';
import { useT } from '../../i18n';
import { LeanInceptionDocumentsList } from './LeanInceptionDocumentsList';

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
    <div className="li-toolbar flex items-center gap-2 p-2">
      <button
        type="button"
        onClick={props.onAdd}
        disabled={props.isMutating}
        aria-label={t('lean_inception.toolbar.add_document')}
        className="li-toolbar__add px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50"
      >
        + {t('lean_inception.toolbar.add_document')}
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setPopoverOpen((v) => !v)}
          aria-label={t('lean_inception.toolbar.documents')}
          className="li-toolbar__btn px-3 py-1.5 rounded-md text-sm flex items-center gap-1"
        >
          📄 {t('lean_inception.toolbar.documents')} ({props.documents.length}) ▾
        </button>
        {popoverOpen && (
          <div className="li-popover absolute top-full left-0 mt-1 z-20 rounded-md shadow-md w-72 max-h-64 overflow-auto">
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
        className="li-toolbar__btn px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
      >
        ↻ {t('lean_inception.toolbar.refresh')}
      </button>

      <button
        type="button"
        onClick={props.onReset}
        disabled={props.isMutating}
        aria-label={t('lean_inception.toolbar.reset')}
        className="li-toolbar__reset px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
      >
        ⚠ {t('lean_inception.toolbar.reset')}
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={props.onZoomOut}
          aria-label={t('lean_inception.toolbar.zoom_out')}
          className="li-toolbar__btn px-2 py-1.5 rounded-md text-sm"
        >
          🔍-
        </button>
        <button
          type="button"
          onClick={props.onZoomIn}
          aria-label={t('lean_inception.toolbar.zoom_in')}
          className="li-toolbar__btn px-2 py-1.5 rounded-md text-sm"
        >
          🔍+
        </button>
        <button
          type="button"
          onClick={props.onZoomFit}
          aria-label={t('lean_inception.toolbar.zoom_fit')}
          className="li-toolbar__btn px-2 py-1.5 rounded-md text-sm"
        >
          ⤢ {t('lean_inception.toolbar.zoom_fit')}
        </button>
      </div>
    </div>
  );
}
