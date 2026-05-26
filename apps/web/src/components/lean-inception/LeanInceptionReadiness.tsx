import { useState } from 'react';
import type { ReadinessAssessment } from './readiness';

interface Props {
  assessment: ReadinessAssessment;
  onStartCreation: () => Promise<void> | void;
}

const DOT_CLASS: Record<ReadinessAssessment['level'], string> = {
  ready:        'li-readiness__dot--ready',
  partial:      'li-readiness__dot--partial',
  insufficient: 'li-readiness__dot--insufficient',
};

export function LeanInceptionReadiness({ assessment, onStartCreation }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="li-readiness">
      <button
        type="button"
        className="li-readiness__pill li-no-pan"
        onClick={() => setOpen((v) => !v)}
        title={assessment.summary}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span aria-hidden className={`li-readiness__dot ${DOT_CLASS[assessment.level]}`} />
        <span className="li-readiness__label">{assessment.summary}</span>
      </button>
      {open && (
        <div className="li-readiness__popover" role="dialog">
          <div className="li-readiness__popover-title">Prontidão para iniciar telas</div>
          {assessment.missingLabels.length === 0 ? (
            <p className="li-readiness__popover-body">
              As colunas críticas para construção de telas estão preenchidas.
            </p>
          ) : (
            <>
              <p className="li-readiness__popover-body">
                Para iniciar a construção de telas com confiança, ainda faltam dados em:
              </p>
              <ul className="li-readiness__list">
                {assessment.missingLabels.map((label) => (
                  <li key={label} className="li-readiness__list-item">{label}</li>
                ))}
              </ul>
            </>
          )}
          <footer className="li-readiness__footer">
            <button
              type="button"
              className="li-readiness__cta"
              onClick={() => void onStartCreation()}
              disabled={assessment.level === 'insufficient'}
              title={
                assessment.level === 'insufficient'
                  ? 'Adicione documentos antes de criar — dados insuficientes para gerar telas com qualidade.'
                  : 'Sincroniza a Lean Inception ao contexto do projeto e abre o chat com um prompt pronto.'
              }
            >
              Criar agora
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
