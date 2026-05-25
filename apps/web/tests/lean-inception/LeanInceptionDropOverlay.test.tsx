// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LeanInceptionDropOverlay } from '../../src/components/lean-inception/LeanInceptionDropOverlay';

describe('LeanInceptionDropOverlay', () => {
  it('renders message when active', () => {
    const { container } = render(<LeanInceptionDropOverlay active={true} />);
    const text = container.textContent;
    expect(text).toMatch(/Drop .md or .txt/i);
  });

  it('returns null when inactive', () => {
    const { container } = render(<LeanInceptionDropOverlay active={false} />);
    expect(container.firstChild).toBeNull();
  });
});
