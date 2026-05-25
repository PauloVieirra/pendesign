import { useT } from '../../i18n';

interface Props {
  onAdd: () => void;
}

export function LeanInceptionEmptyState({ onAdd }: Props) {
  const t = useT();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 pointer-events-none">
      <div className="bg-white/90 rounded-xl shadow-sm px-8 py-6 max-w-md pointer-events-auto">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">
          {t('lean_inception.empty.title')}
        </h2>
        <p className="text-sm text-neutral-600 mb-4">
          {t('lean_inception.empty.description')}
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="px-4 py-2 rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
        >
          {t('lean_inception.toolbar.add_document')}
        </button>
      </div>
    </div>
  );
}
