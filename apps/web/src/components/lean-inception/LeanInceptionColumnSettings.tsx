import type { LeanInceptionColumnKey } from '@open-design/contracts';
import { COLUMN_LABELS_PT, COLUMN_ORDER } from './constants';

interface Props {
  visible: ReadonlySet<LeanInceptionColumnKey>;
  onToggle: (key: LeanInceptionColumnKey) => void;
}

export function LeanInceptionColumnSettings({ visible, onToggle }: Props) {
  return (
    <div className="li-column-settings">
      <div className="li-column-settings__title">Colunas</div>
      <ul className="li-column-settings__list">
        {COLUMN_ORDER.map((key) => (
          <li key={key} className="li-column-settings__item">
            <label className="li-column-settings__row">
              <input
                type="checkbox"
                checked={visible.has(key)}
                onChange={() => onToggle(key)}
              />
              <span>{COLUMN_LABELS_PT[key]}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
