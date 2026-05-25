// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeanInceptionEmptyState } from '../../src/components/lean-inception/LeanInceptionEmptyState';

describe('LeanInceptionEmptyState', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders title, description, and CTA', () => {
    render(<LeanInceptionEmptyState onAdd={() => {}} />);
    expect(screen.getByText('No documents yet')).toBeTruthy();
    expect(screen.getByText(/Drag and drop/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add document/i })).toBeTruthy();
  });

  it('calls onAdd when CTA clicked', async () => {
    const onAdd = vi.fn();
    render(<LeanInceptionEmptyState onAdd={onAdd} />);
    const buttons = screen.getAllByRole('button', { name: /Add document/i });
    await userEvent.click(buttons[0]!);
    expect(onAdd).toHaveBeenCalled();
  });
});
