// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeanInceptionCard } from '../../src/components/lean-inception/LeanInceptionCard';

afterEach(() => cleanup());

const baseCard = {
  id: 'card_1',
  inception_id: 'li_1',
  document_id: 'doc_1',
  column_key: 'vision' as const,
  title: 'Build the best product',
  content: 'Macro vision statement that drives the team forward.',
  confidence: 'high' as const,
  source_anchor: 'we build the best product',
  source_line: 12,
  extraction_id: 'ext_1',
  created_at: '2026-05-25',
};

describe('LeanInceptionCard', () => {
  it('renders title and content', () => {
    render(<LeanInceptionCard card={baseCard} onClick={() => {}} />);
    expect(screen.getByText('Build the best product')).toBeTruthy();
    expect(screen.getByText(/Macro vision statement/)).toBeTruthy();
  });

  it('shows filename and source line when present', () => {
    render(<LeanInceptionCard card={baseCard} filename="discovery.md" onClick={() => {}} />);
    expect(screen.getByText(/discovery\.md/)).toBeTruthy();
    expect(screen.getByText(/L12/)).toBeTruthy();
  });

  it('omits source line indicator when null', () => {
    render(<LeanInceptionCard card={{ ...baseCard, source_line: null }} onClick={() => {}} />);
    expect(screen.queryByText(/L12/)).toBeNull();
  });

  it('omits meta section when no filename and no source line', () => {
    render(
      <LeanInceptionCard card={{ ...baseCard, source_line: null }} onClick={() => {}} />,
    );
    // no filename, no source line → meta div should not be present
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it('calls onClick when activated', async () => {
    const onClick = vi.fn();
    render(<LeanInceptionCard card={baseCard} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith(baseCard);
  });
});
