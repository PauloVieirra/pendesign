// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LeanInceptionToolbar } from '../../src/components/lean-inception/LeanInceptionToolbar';

const doc = (id: string, status: 'extracted' | 'failed' | 'extracting' | 'pending' = 'extracted') => ({
  id, inception_id: 'li_1', filename: `${id}.md`, mime_type: 'text/markdown',
  byte_size: 1, content_hash: 'h', ingested_at: 't', last_extracted_at: 't',
  extraction_status: status, extraction_error: null, card_count: 0,
});

describe('LeanInceptionToolbar', () => {
  it('disables action buttons when isMutating', () => {
    render(
      <LeanInceptionToolbar
        documents={[doc('a')]}
        isMutating={true}
        onAdd={() => {}} onRefresh={() => {}} onReset={() => {}}
        onRemoveDoc={() => {}}
        onZoomIn={() => {}} onZoomOut={() => {}} onZoomFit={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Add document/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Reset/i })).toBeDisabled();
  });

  it('opens documents popover on click', async () => {
    render(
      <LeanInceptionToolbar
        documents={[doc('a'), doc('b')]}
        isMutating={false}
        onAdd={() => {}} onRefresh={() => {}} onReset={() => {}}
        onRemoveDoc={() => {}}
        onZoomIn={() => {}} onZoomOut={() => {}} onZoomFit={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Documents/i }));
    expect(screen.getByText('a.md')).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();
  });

  it('fires onAdd when Add clicked', async () => {
    const onAdd = vi.fn();
    render(
      <LeanInceptionToolbar
        documents={[]} isMutating={false}
        onAdd={onAdd} onRefresh={() => {}} onReset={() => {}}
        onRemoveDoc={() => {}}
        onZoomIn={() => {}} onZoomOut={() => {}} onZoomFit={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Add document/i }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('fires onRemoveDoc with id when X clicked in popover', async () => {
    const onRemoveDoc = vi.fn();
    render(
      <LeanInceptionToolbar
        documents={[doc('xyz')]}
        isMutating={false}
        onAdd={() => {}} onRefresh={() => {}} onReset={() => {}}
        onRemoveDoc={onRemoveDoc}
        onZoomIn={() => {}} onZoomOut={() => {}} onZoomFit={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Documents/i }));
    await userEvent.click(screen.getByRole('button', { name: /Remove xyz\.md/i }));
    expect(onRemoveDoc).toHaveBeenCalledWith('xyz');
  });

  it('fires zoom callbacks', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomFit = vi.fn();
    render(
      <LeanInceptionToolbar
        documents={[]} isMutating={false}
        onAdd={() => {}} onRefresh={() => {}} onReset={() => {}}
        onRemoveDoc={() => {}}
        onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomFit={onZoomFit}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Zoom in/i }));
    await userEvent.click(screen.getByRole('button', { name: /Zoom out/i }));
    await userEvent.click(screen.getByRole('button', { name: /Fit/i }));
    expect(onZoomIn).toHaveBeenCalled();
    expect(onZoomOut).toHaveBeenCalled();
    expect(onZoomFit).toHaveBeenCalled();
  });
});
