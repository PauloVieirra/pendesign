// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeanInceptionColumn } from '../../src/components/lean-inception/LeanInceptionColumn';

const cardOf = (i: number) => ({
  id: `card_${i}`,
  inception_id: 'li_1',
  document_id: 'doc_1',
  column_key: 'personas' as const,
  title: `Persona ${i}`,
  content: 'c',
  confidence: 'high' as const,
  source_anchor: 'a',
  source_line: i,
  extraction_id: 'ext_1',
  created_at: 't',
});

const docMap = new Map([['doc_1', 'discovery.md']]);

afterEach(() => {
  vi.clearAllMocks();
});

describe('LeanInceptionColumn', () => {
  it('renders header with Portuguese label', () => {
    render(
      <LeanInceptionColumn
        columnKey="personas"
        status="complete"
        cards={[cardOf(1), cardOf(2), cardOf(3)]}
        documentNames={docMap}
        loading={false}
        onCardClick={() => {}}
      />,
    );
    expect(screen.getByText('Persona')).toBeTruthy();
  });

  it('shows empty placeholder when no cards and not loading', () => {
    render(
      <LeanInceptionColumn
        columnKey="vision"
        status="not_identified"
        cards={[]}
        documentNames={docMap}
        loading={false}
        onCardClick={() => {}}
      />,
    );
    expect(screen.getByTestId('column-empty')).toBeTruthy();
  });

  it('shows skeleton placeholders when loading and no cards', () => {
    const { container } = render(
      <LeanInceptionColumn
        columnKey="vision"
        status="not_identified"
        cards={[]}
        documentNames={docMap}
        loading={true}
        onCardClick={() => {}}
      />,
    );
    const skeletons = container.querySelectorAll('.li-skeleton');
    expect(skeletons.length).toBe(3);
    expect(screen.queryByTestId('column-empty')).toBeNull();
  });

  it('shows cards (not skeletons) when loading but cards already present', () => {
    const { container } = render(
      <LeanInceptionColumn
        columnKey="personas"
        status="partial"
        cards={[cardOf(1)]}
        documentNames={docMap}
        loading={true}
        onCardClick={() => {}}
      />,
    );
    expect(container.querySelectorAll('.li-skeleton').length).toBe(0);
    expect(container.querySelector('[data-testid="card-card_1"]')).toBeTruthy();
  });

  it('calls onCardClick when a card is clicked', async () => {
    const onCardClick = vi.fn();
    const u = (await import('@testing-library/user-event')).default;
    const { container } = render(
      <LeanInceptionColumn
        columnKey="personas"
        status="partial"
        cards={[cardOf(1)]}
        documentNames={docMap}
        loading={false}
        onCardClick={onCardClick}
      />,
    );
    const card = container.querySelector('[data-testid="card-card_1"]') as HTMLButtonElement;
    expect(card).toBeTruthy();
    await u.click(card);
    expect(onCardClick).toHaveBeenCalledTimes(1);
  });
});
