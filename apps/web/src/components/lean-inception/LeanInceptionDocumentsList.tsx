import type { LeanInceptionDocument } from '@open-design/contracts';

interface Props {
  documents: LeanInceptionDocument[];
  onRemove: (documentId: string) => void;
  disabled: boolean;
}

const STATUS_ICON: Record<LeanInceptionDocument['extraction_status'], string> = {
  pending:    '⏳',
  extracting: '⏳',
  extracted:  '✓',
  failed:     '⚠',
};

export function LeanInceptionDocumentsList({ documents, onRemove, disabled }: Props) {
  if (documents.length === 0) {
    return (
      <div className="li-documents-list__empty p-3 text-sm italic">No documents</div>
    );
  }
  return (
    <ul className="li-documents-list py-1">
      {documents.map((doc) => (
        <li
          key={doc.id}
          className="li-documents-list__item flex items-center justify-between gap-2 px-3 py-2"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span aria-hidden className="li-documents-list__icon">{STATUS_ICON[doc.extraction_status]}</span>
            <span className="li-documents-list__filename text-sm truncate">{doc.filename}</span>
            <span className="li-documents-list__count text-xs tabular-nums">{doc.card_count}</span>
          </div>
          <button
            type="button"
            onClick={() => onRemove(doc.id)}
            disabled={disabled}
            aria-label={`Remove ${doc.filename}`}
            className="li-documents-list__remove disabled:opacity-40"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
