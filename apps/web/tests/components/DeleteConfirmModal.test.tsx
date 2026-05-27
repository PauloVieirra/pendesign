// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { DeleteConfirmModal } from '../../src/components/DeleteConfirmModal';

afterEach(() => {
  cleanup();
});

describe('DeleteConfirmModal', () => {
  it('does not render when closed', () => {
    render(<DeleteConfirmModal open={false} onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmModal open onCancel={() => {}} onConfirm={onConfirm} />);
    const confirmButton = document.querySelector('.delete-confirm-confirm') as HTMLButtonElement | null;
    expect(confirmButton).not.toBeNull();
    fireEvent.click(confirmButton!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel on cancel button and on Escape key', () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmModal open onCancel={onCancel} onConfirm={() => {}} />);
    const cancelButton = document.querySelector('.delete-confirm-cancel') as HTMLButtonElement | null;
    expect(cancelButton).not.toBeNull();
    fireEvent.click(cancelButton!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
