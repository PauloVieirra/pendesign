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
    objective:           { status: 'not_identified', cards: [] },
    problem:             { status: 'not_identified', cards: [] },
    personas:            { status: 'not_identified', cards: [] },
    features:            { status: 'not_identified', cards: [] },
    business_rules:      { status: 'not_identified', cards: [] },
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
  it('shows empty state when no documents after load', async () => {
    render(<LeanInceptionCanvas projectId="prj_1" />);
    await waitFor(() => expect(screen.getByText('No documents yet')).toBeInTheDocument());
  });

  it('renders all 7 column headers', async () => {
    render(<LeanInceptionCanvas projectId="prj_1" />);
    await waitFor(() => expect(screen.getAllByText(/Vision|Objective|Problem|Personas|Features|Business rules|Acceptance criteria/).length).toBeGreaterThanOrEqual(7));
  });

  it('shows loading state initially', () => {
    render(<LeanInceptionCanvas projectId="prj_1" />);
    expect(screen.getByTestId('canvas-loading')).toBeInTheDocument();
  });
});
