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
  content: 'desc',
  confidence: 'high' as const,
  source_anchor: 'we build the best product',
  source_line: 12,
  extraction_id: 'ext_1',
  created_at: '2026-05-25',
};

describe('LeanInceptionCard', () => {
  it('renders title and confidence dot for high', () => {
    render(<LeanInceptionCard card={baseCard} onClick={() => {}} />);
    expect(screen.getByText('Build the best product')).toBeDefined();
    const dot = screen.getByTestId('confidence-dot');
    expect(dot.className).toContain('li-confidence-dot--high');
  });

  it('uses amber dot for medium confidence', () => {
    render(<LeanInceptionCard card={{ ...baseCard, confidence: 'medium' }} onClick={() => {}} />);
    const dot = screen.getByTestId('confidence-dot');
    expect(dot.className).toContain('li-confidence-dot--medium');
  });

  it('uses neutral dot for low confidence', () => {
    render(<LeanInceptionCard card={{ ...baseCard, confidence: 'low' }} onClick={() => {}} />);
    const dot = screen.getByTestId('confidence-dot');
    expect(dot.className).toContain('li-confidence-dot--low');
  });

  it('shows source line when present', () => {
    render(<LeanInceptionCard card={baseCard} onClick={() => {}} />);
    expect(screen.getByText(/L12/)).toBeDefined();
  });

  it('omits source line indicator when null', () => {
    render(<LeanInceptionCard card={{ ...baseCard, source_line: null }} onClick={() => {}} />);
    expect(screen.queryByText(/L12|line 12/i)).toBeNull();
  });

  it('calls onClick when activated', async () => {
    const onClick = vi.fn();
    render(<LeanInceptionCard card={baseCard} onClick={onClick} filename="discovery.md" />);
    await userEvent.click(screen.getByTestId(`card-${baseCard.id}`));
    expect(onClick).toHaveBeenCalledWith(baseCard);
  });
});
