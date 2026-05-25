import { forwardRef, useImperativeHandle, useRef, useState, type DragEvent } from 'react';
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import type {
  LeanInceptionState,
  LeanInceptionCard as Card,
  LeanInceptionColumnKey,
} from '@open-design/contracts';
import { LeanInceptionColumn } from './LeanInceptionColumn';

export interface BoardHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

interface Props {
  state: LeanInceptionState;
  visibleColumns: readonly LeanInceptionColumnKey[];
  loading: boolean;
  onDropFiles: (files: File[]) => void;
  onCardClick: (card: Card) => void;
  onDropActiveChange?: (active: boolean) => void;
}

export const LeanInceptionBoard = forwardRef<BoardHandle, Props>(function LeanInceptionBoard(
  { state, visibleColumns, loading, onDropFiles, onCardClick, onDropActiveChange },
  ref,
) {
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null);
  const [, setDropActive] = useState(false);

  useImperativeHandle(ref, () => ({
    zoomIn: () => transformRef.current?.zoomIn(),
    zoomOut: () => transformRef.current?.zoomOut(),
    fit: () => transformRef.current?.resetTransform(),
  }), []);

  const documentNames = new Map(state.documents.map((d) => [d.id, d.filename]));

  const setActive = (active: boolean) => {
    setDropActive(active);
    onDropActiveChange?.(active);
  };

  const onDragEnter = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setActive(true);
    }
  };
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  };
  const onDragLeave = (e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setActive(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onDropFiles(files);
  };

  return (
    <div
      className="li-board"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.3}
        maxScale={1.5}
        panning={{ excluded: ['li-no-pan'] }}
        wheel={{ step: 0.1 }}
        doubleClick={{ disabled: true }}
      >
        <TransformComponent wrapperClass="li-board__wrapper" contentClass="li-board__grid">
          {visibleColumns.map((key) => {
            const snap = state.columns[key];
            if (!snap) return null;
            return (
              <LeanInceptionColumn
                key={key}
                columnKey={key}
                status={snap.status}
                cards={snap.cards}
                documentNames={documentNames}
                loading={loading}
                onCardClick={onCardClick}
              />
            );
          })}
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
});
