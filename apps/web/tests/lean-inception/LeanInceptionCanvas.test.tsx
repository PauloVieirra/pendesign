// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeanInceptionCanvas } from '../../src/components/lean-inception/LeanInceptionCanvas';

const emptyState = () => ({
  inception_id: 'li_1',
  project_id: 'prj_1',
  documents: [],
  columns: {
    vision:              { status: 'not_identified', cards: [] },
    problem:             { status: 'not_identified', cards: [] },
    objective:           { status: 'not_identified', cards: [] },
    features:            { status: 'not_identified', cards: [] },
    business_rules:      { status: 'not_identified', cards: [] },
    personas:            { status: 'not_identified', cards: [] },
    user_journey:        { status: 'not_identified', cards: [] },
    ideation:            { status: 'not_identified', cards: [] },
    acceptance_criteria: { status: 'not_identified', cards: [] },
  },
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ state: emptyState() }),
  }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('LeanInceptionCanvas', () => {
  it('shows the drop bar after load', async () => {
    render(<LeanInceptionCanvas projectId="prj_1" />);
    await waitFor(() => expect(screen.getByText(/DROP FILES HERE/)).toBeInTheDocument());
  });

  it('renders the 8 default Portuguese column labels', async () => {
    render(<LeanInceptionCanvas projectId="prj_1" />);
    await waitFor(() => {
      expect(screen.getByText('Visão')).toBeInTheDocument();
      expect(screen.getByText('Problema')).toBeInTheDocument();
      expect(screen.getByText('Objetivo')).toBeInTheDocument();
      expect(screen.getByText('Features')).toBeInTheDocument();
      expect(screen.getByText('Regra de negócio')).toBeInTheDocument();
      expect(screen.getByText('Persona')).toBeInTheDocument();
      expect(screen.getByText('Jornada do usuário')).toBeInTheDocument();
      expect(screen.getByText('Ideação')).toBeInTheDocument();
    });
  });

  it('shows loading state initially', () => {
    render(<LeanInceptionCanvas projectId="prj_1" />);
    expect(screen.getByTestId('canvas-loading')).toBeInTheDocument();
  });
});
