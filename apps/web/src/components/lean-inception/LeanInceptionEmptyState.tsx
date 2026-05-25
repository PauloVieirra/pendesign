import { useT } from '../../i18n';

interface Props {
  onAdd: () => void;
}

export function LeanInceptionEmptyState({ onAdd }: Props) {
  const t = useT();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 pointer-events-none">
      <div className="li-empty-state rounded-xl shadow-sm px-8 py-6 max-w-md pointer-events-auto">
        <h2 className="li-empty-state__title text-lg font-semibold mb-1">
          {t('lean_inception.empty.title')}
        </h2>
        <p className="li-empty-state__desc text-sm mb-4">
          {t('lean_inception.empty.description')}
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="li-empty-state__btn px-4 py-2 rounded-md text-sm font-medium"
        >
          {t('lean_inception.toolbar.add_document')}
        </button>
      </div>
    </div>
  );
}
