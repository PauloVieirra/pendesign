import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type SplitPaneProps = {
  children: [ReactNode, ReactNode];
  defaultRatio?: number;
  minSize?: number;
  onRatioChange?: (ratio: number) => void;
  className?: string;
};

const DEFAULT_RATIO = 0.5;
const DEFAULT_MIN_SIZE = 240;

export function SplitPane({
  children,
  defaultRatio = DEFAULT_RATIO,
  minSize = DEFAULT_MIN_SIZE,
  onRatioChange,
  className,
}: SplitPaneProps) {
  const [ratio, setRatio] = useState(defaultRatio);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  const clamp = useCallback(
    (next: number) => {
      const width = containerRef.current?.clientWidth ?? 0;
      if (width <= 0) return next;
      const minRatio = minSize / width;
      const maxRatio = 1 - minSize / width;
      if (minRatio >= maxRatio) return 0.5;
      return Math.min(maxRatio, Math.max(minRatio, next));
    },
    [minSize],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const raw = (e.clientX - rect.left) / rect.width;
      const next = clamp(raw);
      setRatio(next);
    };
    const onUp = () => {
      setDragging(false);
      document.body.style.cursor = '';
      onRatioChange?.(ratioRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, clamp, onRatioChange]);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    document.body.style.cursor = 'col-resize';
  };

  const onDividerDoubleClick = () => {
    setRatio(DEFAULT_RATIO);
    onRatioChange?.(DEFAULT_RATIO);
  };

  const leftPct = `${(ratio * 100).toFixed(2)}%`;
  const rightPct = `${((1 - ratio) * 100).toFixed(2)}%`;

  return (
    <div
      ref={containerRef}
      className={`split-pane${dragging ? ' split-pane-dragging' : ''}${className ? ' ' + className : ''}`}
      style={{ display: 'flex', width: '100%', height: '100%' }}
    >
      <div
        data-split-side="left"
        style={{ flexBasis: leftPct, flexGrow: 0, flexShrink: 0, overflow: 'hidden' }}
      >
        {children[0]}
      </div>
      <div
        data-split-divider="true"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onDividerMouseDown}
        onDoubleClick={onDividerDoubleClick}
        style={{
          flexBasis: '6px',
          flexGrow: 0,
          flexShrink: 0,
          cursor: 'col-resize',
          background: 'var(--split-divider-color, rgba(0,0,0,0.08))',
          position: 'relative',
        }}
      />
      <div
        data-split-side="right"
        style={{ flexBasis: rightPct, flexGrow: 1, flexShrink: 1, overflow: 'hidden', position: 'relative' }}
      >
        {children[1]}
        {dragging ? (
          <div
            data-split-overlay="true"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'all', cursor: 'col-resize' }}
          />
        ) : null}
      </div>
    </div>
  );
}
