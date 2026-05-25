import type {
  LeanInceptionCard,
  LeanInceptionColumnKey,
  LeanInceptionColumnStatus,
} from '@open-design/contracts';
import { COLUMN_LABELS_PT } from './constants';
import { LeanInceptionCard as CardView } from './LeanInceptionCard';

interface Props {
  columnKey: LeanInceptionColumnKey;
  status: LeanInceptionColumnStatus;
  cards: LeanInceptionCard[];
  documentNames: Map<string, string>;
  loading: boolean;
  onCardClick: (card: LeanInceptionCard) => void;
}

export function LeanInceptionColumn({
  columnKey,
  cards,
  documentNames,
  loading,
  onCardClick,
}: Props) {
  return (
    <div className="li-column">
      <h3 className="li-column__label">{COLUMN_LABELS_PT[columnKey]}</h3>
      <div className="li-column__body">
        {loading && cards.length === 0 ? (
          <>
            <div className="li-skeleton" aria-hidden />
            <div className="li-skeleton li-skeleton--short" aria-hidden />
            <div className="li-skeleton" aria-hidden />
          </>
        ) : cards.length === 0 ? (
          <div data-testid="column-empty" className="li-column__empty" aria-hidden />
        ) : (
          cards.map((card) => (
            <CardView
              key={card.id}
              card={card}
              filename={documentNames.get(card.document_id)}
              onClick={onCardClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
