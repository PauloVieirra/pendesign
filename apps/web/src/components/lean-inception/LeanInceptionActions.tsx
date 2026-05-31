import { useState } from 'react';
import type { LeanInceptionColumnKey, LeanInceptionDocument } from '@open-design/contracts';
import { LeanInceptionDocumentsList } from './LeanInceptionDocumentsList';
import { LeanInceptionColumnSettings } from './LeanInceptionColumnSettings';

interface Props {
  documents: LeanInceptionDocument[];
  visible: ReadonlySet<LeanInceptionColumnKey>;
  isMutating: boolean;
  onRefresh: () => void;
  onReset: () => void;
  onRemoveDoc: (id: string) => void;
  onToggleColumn: (key: LeanInceptionColumnKey) => void;
}

type OpenPopover = null | 'columns' | 'documents';

export function LeanInceptionActions(props: Props) {
  const [open, setOpen] = useState<OpenPopover>(null);

  return (
    <div className="li-actions">
      <button
        type="button"
        className="li-actions__btn"
        onClick={() => setOpen(open === 'columns' ? null : 'columns')}
        title="Colunas"
        aria-label="Colunas"
      >
        ⚙
      </button>
      <button
        type="button"
        className="li-actions__btn"
        onClick={() => setOpen(open === 'documents' ? null : 'documents')}
        title="Documentos"
        aria-label="Documentos"
      >
        📄 ({props.documents.length})
      </button>
      <button
        type="button"
        className="li-actions__btn"
        onClick={props.onRefresh}
        disabled={props.isMutating}
        title="Atualizar"
        aria-label="Atualizar"
      >
        ↻
      </button>
      <button
        type="button"
        className="li-actions__btn li-actions__btn--danger"
        onClick={props.onReset}
        disabled={props.isMutating}
        title="Resetar"
        aria-label="Resetar"
      >
        ⚠
      </button>

      {open === 'columns' && (
        <div className="li-actions__popover">
          <LeanInceptionColumnSettings visible={props.visible} onToggle={props.onToggleColumn} />
        </div>
      )}
      {open === 'documents' && (
        <div className="li-actions__popover">
          <LeanInceptionDocumentsList
            documents={props.documents}
            onRemove={props.onRemoveDoc}
            disabled={props.isMutating}
          />
        </div>
      )}
    </div>
  );
}
