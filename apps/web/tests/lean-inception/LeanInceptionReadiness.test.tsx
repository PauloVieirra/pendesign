// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LeanInceptionReadiness } from '../../src/components/lean-inception/LeanInceptionReadiness';

describe('LeanInceptionReadiness', () => {
  it('renders summary and opens popover with CTA when ready', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    render(
      <LeanInceptionReadiness
        assessment={{
          level: 'ready',
          missingCritical: [],
          missingImportant: [],
          missingLabels: [],
          summary: 'Pronto para iniciar telas',
        }}
        onStartCreation={onStart}
      />,
    );
    expect(screen.getByText('Pronto para iniciar telas')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Pronto para iniciar telas/i }));
    await userEvent.click(screen.getByRole('button', { name: /Criar agora/i }));
    expect(onStart).toHaveBeenCalled();
  });

  it('disables the CTA when insufficient', async () => {
    render(
      <LeanInceptionReadiness
        assessment={{
          level: 'insufficient',
          missingCritical: [],
          missingImportant: [],
          missingLabels: [],
          summary: 'Dados insuficientes',
        }}
        onStartCreation={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Dados insuficientes/i }));
    const cta = screen.getByRole('button', { name: /Criar agora/i }) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });
});
