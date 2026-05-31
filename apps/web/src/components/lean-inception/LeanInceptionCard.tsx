import type { LeanInceptionCard as Card } from '@open-design/contracts';

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
      <h4 className="li-card__title">{card.title}</h4>
      <p className="li-card__content">{card.content}</p>
      {(filename || card.source_line != null) && (
        <div className="li-card__meta">
          {filename}
          {card.source_line != null && (
            <span className="li-card__line"> · L{card.source_line}</span>
          )}
        </div>
      )}
    </button>
  );
}
