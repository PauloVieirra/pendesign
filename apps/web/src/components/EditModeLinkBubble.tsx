import { useEffect, useRef, useState } from 'react';
import type { ManualEditRect } from '../edit-mode/types';

export interface EditModeLinkBubbleState {
  open: boolean;
  targetId: string;
  rect: ManualEditRect;
  href: string;
}

export function emptyEditModeLinkBubbleState(): EditModeLinkBubbleState {
  return { open: false, targetId: '', rect: { x: 0, y: 0, width: 0, height: 0 }, href: '' };
}

/**
 * Floating href editor anchored beneath a link the user is inline-editing.
 * Lives outside the iframe in the host React tree so it can use full UI
 * affordances. While open, it syncs href changes back to the bridge via
 * `onHrefChange` so an Enter inside the contenteditable commits both the
 * latest text and href together.
 *
 * Important: the parent must NOT pass the iframe's `contentWindow` as a prop.
 * When the iframe is sandboxed without `allow-same-origin`, that Window is
 * cross-origin, and React's dev-mode prop-diff logger throws a SecurityError
 * when it walks the prop values for diffing — which aborts the commit phase
 * and breaks the whole edit-mode page. Route postMessage through callbacks
 * the parent owns instead, so the cross-origin reference never enters the
 * React prop graph.
 */
export function EditModeLinkBubble({
  state,
  iframeRect,
  onHrefChange,
  onCommit,
  onCancel,
}: {
  state: EditModeLinkBubbleState;
  iframeRect: DOMRect | null;
  onHrefChange: (href: string) => void;
  onCommit: (href: string) => void;
  onCancel: () => void;
}) {
  const [href, setHref] = useState(state.href);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!state.open) return;
    setHref(state.href);
  }, [state.open, state.targetId, state.href]);

  useEffect(() => {
    if (!state.open) return;
    onHrefChange(href);
  }, [href, state.open, onHrefChange]);

  if (!state.open) return null;

  const anchor = iframeRect ?? new DOMRect();
  const left = Math.round(anchor.left + state.rect.x);
  const top = Math.round(anchor.top + state.rect.y + state.rect.height + 6);
  const positionStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(left, window.innerWidth - 320),
    top: Math.min(top, window.innerHeight - 80),
    zIndex: 1000,
  };

  const submit = () => onCommit(href.trim());

  return (
    <div ref={ref} className="cc-panel od-edit-link-bubble" style={positionStyle} role="dialog" aria-label="Edit link">
      <span className="od-edit-link-bubble-label">href</span>
      <input
        type="url"
        value={href}
        autoFocus
        onChange={(e) => setHref(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        placeholder="https://…"
      />
      <button type="button" className="od-edit-media-apply" onClick={submit}>Apply</button>
    </div>
  );
}
