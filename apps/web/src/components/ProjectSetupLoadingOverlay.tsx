import { useEffect, useRef, useState } from 'react';
import { fetchProjectSetupStatus } from '../providers/registry';
import type { ProjectSetupPhase, ProjectSetupStatusResponse } from '../types';

interface Props {
  projectId: string;
  /** Called once the daemon reports phase: 'ready'. The host typically
   * dismisses the overlay and navigates into the project. */
  onReady: () => void;
  /** Called if the daemon reports phase: 'error'. The host shows a toast
   * and can either dismiss or offer a retry button (not implemented here
   * — we just close on click). */
  onError?: (message: string) => void;
}

// Friendly copy that rotates every ~2.4s while the install runs. Each
// phase has its own pool so the visible message stays vaguely correlated
// with what the daemon is doing — e.g. "Definindo arquitetura" disappears
// once we leave 'extracting'.
const COPY_BY_PHASE: Record<ProjectSetupPhase, string[]> = {
  extracting: [
    'Aguarde, estamos preparando tudo para você',
    'Organizando pastas',
    'Criando arquivos iniciais',
    'Definindo a arquitetura',
  ],
  installing: [
    'Instalando bibliotecas',
    'Resolvendo dependências',
    'Conectando React, Vite e TypeScript',
    'Quase lá — finalizando os pacotes',
  ],
  ready: ['Tudo pronto!'],
  error: ['Algo deu errado durante a preparação'],
};

export function ProjectSetupLoadingOverlay({ projectId, onReady, onError }: Props) {
  const [status, setStatus] = useState<ProjectSetupStatusResponse | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  const finishedRef = useRef(false);

  // Poll the daemon every 1.2s. We use a ref to avoid scheduling further
  // polls once the setup has finished (ready or error). The first request
  // fires immediately so the overlay shows the right phase from frame 1.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      const next = await fetchProjectSetupStatus(projectId);
      if (cancelled) return;
      if (next) setStatus(next);
      if (next?.phase === 'ready' && !finishedRef.current) {
        finishedRef.current = true;
        onReady();
        return;
      }
      if (next?.phase === 'error' && !finishedRef.current) {
        finishedRef.current = true;
        onError?.(next.error ?? 'Setup failed');
        return;
      }
      timer = window.setTimeout(() => void tick(), 1200);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [projectId, onReady, onError]);

  // Rotate the message every 2.4s. We mod into the current phase's pool
  // so a longer install cycles back through the copy.
  useEffect(() => {
    const id = window.setInterval(() => setMessageIndex((n) => n + 1), 2400);
    return () => window.clearInterval(id);
  }, []);

  const phase: ProjectSetupPhase = status?.phase ?? 'extracting';
  const pool = COPY_BY_PHASE[phase];
  const message = pool[messageIndex % pool.length] ?? pool[0];
  const showError = phase === 'error';

  return (
    <div className="project-setup-overlay" role="status" aria-live="polite">
      <div className="project-setup-overlay__card">
        {!showError ? (
          <div className="project-setup-overlay__spinner" aria-hidden="true" />
        ) : (
          <div className="project-setup-overlay__error-mark" aria-hidden="true">!</div>
        )}
        <h2 className="project-setup-overlay__title">
          {showError ? 'Não conseguimos preparar o projeto' : 'Preparando seu projeto'}
        </h2>
        <p className="project-setup-overlay__message" key={message}>
          {showError ? (status?.error ?? message) : message}
        </p>
        <p className="project-setup-overlay__phase">
          {showError ? null : (
            phase === 'extracting'
              ? 'Etapa 1 de 2 — organizando arquivos'
              : phase === 'installing'
                ? `Etapa 2 de 2 — instalando dependências${status?.packageManager ? ` (${status.packageManager})` : ''}`
                : null
          )}
        </p>
      </div>
    </div>
  );
}
