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
        className="li-drawer-scrim fixed inset-0 bg-black/10 z-40"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="li-drawer fixed top-0 right-0 h-full w-[400px] bg-white z-50 shadow-xl flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between p-4 border-b border-neutral-200">
          <div className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-1.5 inline-block w-2 h-2 rounded-full ${CONFIDENCE_DOT_CLASS[card.confidence]}`}
            />
            <h2 className="text-base font-semibold text-neutral-900">{card.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-500 hover:text-neutral-900"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-auto p-4 space-y-4 text-sm text-neutral-700">
          <p>{card.content}</p>
          <section>
            <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
              {t('lean_inception.detail.source')}
            </h3>
            <blockquote className="border-l-2 border-neutral-300 pl-3 italic text-neutral-700">
              {card.source_anchor}
            </blockquote>
            <div className="mt-2 text-xs text-neutral-500">
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
