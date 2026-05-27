import { useEffect } from 'react';

export interface DeleteConfirmModalLabels {
  title: string;
  body: string;
  cancel: string;
  confirm: string;
}

interface DeleteConfirmModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  labels?: Partial<DeleteConfirmModalLabels>;
}

const DEFAULT_LABELS: DeleteConfirmModalLabels = {
  title: 'Delete this element?',
  body: 'This removes the element from the design. You can undo it from the history panel.',
  cancel: 'Cancel',
  confirm: 'Delete',
};

export function DeleteConfirmModal({ open, onCancel, onConfirm, labels }: DeleteConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const text = { ...DEFAULT_LABELS, ...(labels ?? {}) };

  return (
    <div className="delete-confirm-modal-backdrop" role="dialog" aria-modal="true">
      <div className="delete-confirm-modal">
        <h2 className="delete-confirm-modal-title">{text.title}</h2>
        <p className="delete-confirm-modal-body">{text.body}</p>
        <div className="delete-confirm-modal-actions">
          <button type="button" onClick={onCancel} className="delete-confirm-cancel">{text.cancel}</button>
          <button type="button" onClick={onConfirm} className="delete-confirm-confirm">{text.confirm}</button>
        </div>
      </div>
    </div>
  );
}
