import type {
  LeanInceptionCard,
  LeanInceptionColumnKey,
  LeanInceptionColumnStatus,
} from '@open-design/contracts';
import { useT } from '../../i18n';
import { STATUS_COLOR_CLASS } from './constants.js';
import { LeanInceptionCard as CardView } from './LeanInceptionCard.js';

interface Props {
  columnKey: LeanInceptionColumnKey;
  status: LeanInceptionColumnStatus;
  cards: LeanInceptionCard[];
  documentNames: Map<string, string>;
  onCardClick: (card: LeanInceptionCard) => void;
}

export function LeanInceptionColumn({
  columnKey,
  status,
  cards,
  documentNames,
  onCardClick,
}: Props) {
  const t = useT();
  return (
    <div className="li-column w-[280px] flex-shrink-0 flex flex-col bg-neutral-50 rounded-lg p-3 gap-3">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">
          {t(`lean_inception.column.${columnKey}` as const)}
        </h3>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${STATUS_COLOR_CLASS[status]}`}>
            {t(`lean_inception.status.${status}` as const)}
          </span>
          <span className="text-xs text-neutral-500 tabular-nums">{cards.length}</span>
        </div>
      </header>
      <div className="flex flex-col gap-2 min-h-[120px]">
        {cards.length === 0 ? (
          <div data-testid="column-empty" className="text-xs text-neutral-400 italic px-1">
            —
          </div>
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
