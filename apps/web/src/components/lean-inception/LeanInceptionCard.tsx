import type { LeanInceptionCard as Card } from '@open-design/contracts';
import { CONFIDENCE_DOT_CLASS } from './constants.js';

interface Props {
  card: Card;
  filename?: string;
  onClick: (card: Card) => void;
}

export function LeanInceptionCard({ card, filename, onClick }: Props) {
  return (
    <button
      type="button"
      className="li-card li-no-pan w-full text-left p-3 rounded-md bg-white shadow-sm hover:shadow-md border border-neutral-200 flex flex-col gap-1"
      onClick={() => onClick(card)}
      data-testid={`card-${card.id}`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          data-testid="confidence-dot"
          className={`mt-1.5 inline-block w-2 h-2 rounded-full flex-shrink-0 ${CONFIDENCE_DOT_CLASS[card.confidence]}`}
        />
        <span className="text-sm font-medium text-neutral-900 line-clamp-2">
          {card.title}
        </span>
      </div>
      <div className="text-xs text-neutral-500 truncate">
        {filename}
        {card.source_line != null && (
          <span className="ml-1 text-neutral-400">· L{card.source_line}</span>
        )}
      </div>
    </button>
  );
}
