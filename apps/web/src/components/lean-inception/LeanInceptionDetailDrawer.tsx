import { useEffect } from 'react';
import type { LeanInceptionCard } from '@open-design/contracts';
import { useT } from '../../i18n';
import { CONFIDENCE_DOT_CLASS } from './constants.js';

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
        className="li-drawer-scrim fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="li-drawer fixed top-0 right-0 h-full w-[400px] z-50 shadow-xl flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <header className="li-drawer__header flex items-start justify-between p-4">
          <div className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-1.5 inline-block w-2 h-2 rounded-full ${CONFIDENCE_DOT_CLASS[card.confidence]}`}
            />
            <h2 className="li-drawer__title text-base font-semibold">{card.title}</h2>
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
        <div className="li-drawer__body flex-1 overflow-auto p-4 space-y-4 text-sm">
          <p>{card.content}</p>
          <section>
            <h3 className="li-drawer__section-label text-xs uppercase tracking-wide mb-2">
              {t('lean_inception.detail.source')}
            </h3>
            <blockquote className="li-drawer__blockquote pl-3 italic">
              {card.source_anchor}
            </blockquote>
            <div className="li-drawer__source-meta mt-2 text-xs">
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
