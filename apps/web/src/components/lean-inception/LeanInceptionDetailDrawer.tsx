import { useEffect, useState } from 'react';
import type { LeanInceptionCard } from '@open-design/contracts';
import { useT } from '../../i18n';
import { CONFIDENCE_DOT_CLASS } from './constants';

interface Props {
  card: LeanInceptionCard | null;
  filename: string | null;
  onClose: () => void;
  onDelete: (cardId: string) => Promise<void> | void;
}

export function LeanInceptionDetailDrawer({ card, filename, onClose, onDelete }: Props) {
  const t = useT();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!card) {
      setConfirmingDelete(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, onClose]);

  if (!card) return null;

  const onConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(card.id);
    } finally {
      setIsDeleting(false);
      setConfirmingDelete(false);
    }
  };

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
        <footer className="li-drawer__footer">
          {!confirmingDelete ? (
            <button
              type="button"
              className="li-drawer__delete"
              onClick={() => setConfirmingDelete(true)}
              aria-label="Excluir card"
            >
              Excluir card
            </button>
          ) : (
            <div className="li-drawer__confirm">
              <p className="li-drawer__confirm-msg">
                A informação será removida permanentemente do sistema. Esta ação não pode ser desfeita.
              </p>
              <div className="li-drawer__confirm-actions">
                <button
                  type="button"
                  className="li-drawer__confirm-cancel"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={isDeleting}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="li-drawer__confirm-delete"
                  onClick={() => void onConfirmDelete()}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Excluindo…' : 'Excluir definitivamente'}
                </button>
              </div>
            </div>
          )}
        </footer>
      </aside>
    </>
  );
}
