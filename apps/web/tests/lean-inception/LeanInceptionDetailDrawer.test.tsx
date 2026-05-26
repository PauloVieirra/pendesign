// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeanInceptionDetailDrawer } from '../../src/components/lean-inception/LeanInceptionDetailDrawer';

afterEach(() => {
  cleanup();
});

const card = {
  id: 'card_1',
  inception_id: 'li_1',
  document_id: 'doc_1',
  column_key: 'features' as const,
  title: 'Sync stock counts',
  content: 'Push stock to Shopify and Mercado Livre.',
  confidence: 'high' as const,
  source_anchor: 'Push catalogue changes to Shopify and Mercado Livre simultaneously.',
  source_line: 17,
  extraction_id: 'ext_1',
  created_at: 't',
};

describe('LeanInceptionDetailDrawer', () => {
  it('renders nothing when card is null', () => {
    const { container } = render(
      <LeanInceptionDetailDrawer card={null} filename={null} onClose={() => {}} onDelete={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title, content, source_anchor, line, filename', () => {
    render(
      <LeanInceptionDetailDrawer card={card} filename="discovery.md" onClose={() => {}} onDelete={() => {}} />,
    );
    expect(screen.getByText('Sync stock counts')).toBeTruthy();
    expect(screen.getByText('Push stock to Shopify and Mercado Livre.')).toBeTruthy();
    expect(screen.getByText(card.source_anchor)).toBeTruthy();
    expect(screen.getByText(/Line 17/)).toBeTruthy();
    expect(screen.getByText('discovery.md')).toBeTruthy();
  });

  it('calls onClose on X button click', async () => {
    const onClose = vi.fn();
    render(<LeanInceptionDetailDrawer card={card} filename="x.md" onClose={onClose} onDelete={() => {}} />);
    const button = screen.getByRole('button', { name: /close/i });
    fireEvent.click(button);
    expect(onClose).toBeCalled();
  });

  it('calls onClose on ESC key', async () => {
    const onClose = vi.fn();
    render(<LeanInceptionDetailDrawer card={card} filename="x.md" onClose={onClose} onDelete={() => {}} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toBeCalled();
  });

  it('shows confirmation before deleting and never calls onDelete without confirmation', async () => {
    const onDelete = vi.fn();
    render(<LeanInceptionDetailDrawer card={card} filename="x.md" onClose={() => {}} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: /Excluir card/i }));
    expect(screen.getByText(/permanentemente do sistema/i)).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('calls onDelete with the card id after confirmation', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<LeanInceptionDetailDrawer card={card} filename="x.md" onClose={() => {}} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: /Excluir card/i }));
    await userEvent.click(screen.getByRole('button', { name: /Excluir definitivamente/i }));
    expect(onDelete).toHaveBeenCalledWith(card.id);
  });

  it('cancel returns to the normal footer without calling onDelete', async () => {
    const onDelete = vi.fn();
    render(<LeanInceptionDetailDrawer card={card} filename="x.md" onClose={() => {}} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: /Excluir card/i }));
    await userEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(screen.queryByText(/permanentemente do sistema/i)).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
