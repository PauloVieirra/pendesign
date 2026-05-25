import type { LeanInceptionCard as Card } from '@open-design/contracts';
import { CONFIDENCE_DOT_CLASS } from './constants';

interface Props {
  card: Card;
  filename?: string;
  onClick: (card: Card) => void;
}

export function LeanInceptionCard({ card, filename, onClick }: Props) {
  return (
    <button
      type="button"
      className="li-card li-no-pan w-full text-left p-3 rounded-md shadow-sm flex flex-col gap-1"
      onClick={() => onClick(card)}
      data-testid={`card-${card.id}`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          data-testid="confidence-dot"
          className={`mt-1.5 inline-block w-2 h-2 rounded-full flex-shrink-0 ${CONFIDENCE_DOT_CLASS[card.confidence]}`}
        />
        <span className="li-card__title text-sm font-medium line-clamp-2">
          {card.title}
        </span>
      </div>
      <div className="li-card__meta text-xs truncate">
        {filename}
        {card.source_line != null && (
          <span className="li-card__line ml-1">· L{card.source_line}</span>
        )}
      </div>
    </button>
  );
}
