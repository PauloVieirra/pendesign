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
      className="li-card li-no-pan"
      onClick={() => onClick(card)}
      data-testid={`card-${card.id}`}
    >
      <div className="li-card__row">
        <span
          aria-hidden
          data-testid="confidence-dot"
          className={`li-confidence-dot ${CONFIDENCE_DOT_CLASS[card.confidence]}`}
        />
        <span className="li-card__title">
          {card.title}
        </span>
      </div>
      <div className="li-card__meta">
        {filename}
        {card.source_line != null && (
          <span className="li-card__line"> · L{card.source_line}</span>
        )}
      </div>
    </button>
  );
}
