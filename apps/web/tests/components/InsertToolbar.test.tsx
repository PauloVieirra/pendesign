// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { InsertToolbar, buildInsertedElement } from '../../src/components/InsertToolbar';

afterEach(() => {
  cleanup();
});

describe('InsertToolbar', () => {
  it('renders exactly the Text and Shape tools', () => {
    render(<InsertToolbar active={null} onSelectTool={() => {}} />);
    expect(screen.getByLabelText('Text')).toBeInTheDocument();
    expect(screen.getByLabelText('Shape')).toBeInTheDocument();
    expect(screen.queryByLabelText('Frame')).toBeNull();
    expect(screen.queryByLabelText('Rectangle')).toBeNull();
    expect(screen.queryByLabelText('Ellipse')).toBeNull();
    expect(screen.queryByLabelText('Image')).toBeNull();
  });

  it('toggles the active state when a tool is clicked', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<InsertToolbar active={null} onSelectTool={onSelect} />);
    fireEvent.click(screen.getByLabelText('Shape'));
    expect(onSelect).toHaveBeenCalledWith('shape');
    rerender(<InsertToolbar active="shape" onSelectTool={onSelect} />);
    fireEvent.click(screen.getByLabelText('Shape'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('disables both buttons when disabled prop is true', () => {
    render(<InsertToolbar active={null} onSelectTool={() => {}} disabled />);
    expect(screen.getByLabelText('Text')).toBeDisabled();
    expect(screen.getByLabelText('Shape')).toBeDisabled();
  });

  it('buildInsertedElement returns 120x120 grey div for shape', () => {
    const out = buildInsertedElement('shape');
    expect(out.html).toContain('width: 120px');
    expect(out.html).toContain('height: 120px');
    expect(out.html).toContain('background-color: #e5e7eb');
    expect(out.html).toContain(`data-od-id="${out.id}"`);
  });

  it('buildInsertedElement returns a paragraph for text', () => {
    const out = buildInsertedElement('text');
    expect(out.html).toMatch(/^<p /);
    expect(out.html).toContain(`data-od-id="${out.id}"`);
  });
});
