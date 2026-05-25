import { useT } from '../../i18n';

interface Props {
  active: boolean;
}

export function LeanInceptionDropOverlay({ active }: Props) {
  const t = useT();
  if (!active) return null;
  return (
    <div className="li-drop-overlay absolute inset-0 z-30 flex items-center justify-center bg-blue-50/80 border-4 border-dashed border-blue-400 rounded-xl pointer-events-none">
      <p className="text-blue-900 text-lg font-medium">{t('lean_inception.drop.title')}</p>
    </div>
  );
}
