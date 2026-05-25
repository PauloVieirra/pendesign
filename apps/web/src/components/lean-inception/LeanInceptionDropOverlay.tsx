import { useT } from '../../i18n';

interface Props {
  active: boolean;
}

export function LeanInceptionDropOverlay({ active }: Props) {
  const t = useT();
  if (!active) return null;
  return (
    <div className="li-drop-overlay absolute inset-0 z-30 flex items-center justify-center rounded-xl pointer-events-none">
      <p className="li-drop-overlay__label text-lg font-medium">{t('lean_inception.drop.title')}</p>
    </div>
  );
}
