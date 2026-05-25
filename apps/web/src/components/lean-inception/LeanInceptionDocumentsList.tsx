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
      <div className="p-3 text-sm text-neutral-500 italic">No documents</div>
    );
  }
  return (
    <ul className="li-documents-list py-1">
      {documents.map((doc) => (
        <li
          key={doc.id}
          className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-neutral-50"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span aria-hidden className="text-neutral-500">{STATUS_ICON[doc.extraction_status]}</span>
            <span className="text-sm text-neutral-800 truncate">{doc.filename}</span>
            <span className="text-xs text-neutral-500 tabular-nums">{doc.card_count}</span>
          </div>
          <button
            type="button"
            onClick={() => onRemove(doc.id)}
            disabled={disabled}
            aria-label={`Remove ${doc.filename}`}
            className="text-neutral-400 hover:text-red-500 disabled:opacity-40"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
