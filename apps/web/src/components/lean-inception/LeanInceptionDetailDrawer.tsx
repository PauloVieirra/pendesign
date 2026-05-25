import { useEffect } from 'react';
import type { LeanInceptionCard } from '@open-design/contracts';
import { useT } from '../../i18n';
import { CONFIDENCE_DOT_CLASS } from './constants';

interface Props {
  card: LeanInceptionCard | null;
  filename: string | null;
  onClose: () => void;
}

export function LeanInceptionDetailDrawer({ card, filename, onClose }: Props) {
  const t = useT();

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, onClose]);

  if (!card) return null;

  return (
    <>
      <div
        className="li-drawer-scrim"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="li-drawer"
        role="dialog"
        aria-modal="true"
      >
        <header className="li-drawer__header">
          <div className="li-card__row">
            <span
              aria-hidden
              className={`li-confidence-dot ${CONFIDENCE_DOT_CLASS[card.confidence]}`}
            />
            <h2 className="li-drawer__title">{card.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="li-drawer__close"
          >
            ✕
          </button>
        </header>
        <div className="li-drawer__body">
          <p>{card.content}</p>
          <section className="li-drawer__section">
            <h3 className="li-drawer__section-title">
              {t('lean_inception.detail.source')}
            </h3>
            <blockquote className="li-drawer__quote">
              {card.source_anchor}
            </blockquote>
            <div className="li-drawer__meta">
              {filename && <span>{filename}</span>}
              {card.source_line != null && (
                <span className="ml-2">
                  {t('lean_inception.detail.line').replace('{line}', String(card.source_line))}
                </span>
              )}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
