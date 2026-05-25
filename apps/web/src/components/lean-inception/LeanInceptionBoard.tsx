import { forwardRef, useImperativeHandle, useRef, useState, type DragEvent } from 'react';
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import type {
  LeanInceptionState,
  LeanInceptionCard as Card,
} from '@open-design/contracts';
import { COLUMN_ORDER } from './constants';
import { LeanInceptionColumn } from './LeanInceptionColumn';
import { LeanInceptionDropOverlay } from './LeanInceptionDropOverlay';

export interface BoardHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

interface Props {
  state: LeanInceptionState;
  onDropFiles: (files: File[]) => void;
  onCardClick: (card: Card) => void;
}

export const LeanInceptionBoard = forwardRef<BoardHandle, Props>(function LeanInceptionBoard(
  { state, onDropFiles, onCardClick },
  ref,
) {
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null);
  const [dropActive, setDropActive] = useState(false);

  useImperativeHandle(ref, () => ({
    zoomIn: () => transformRef.current?.zoomIn(),
    zoomOut: () => transformRef.current?.zoomOut(),
    fit: () => transformRef.current?.resetTransform(),
  }), []);

  const documentNames = new Map(state.documents.map((d) => [d.id, d.filename]));

  const onDragEnter = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setDropActive(true);
    }
  };
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  };
  const onDragLeave = (e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropActive(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onDropFiles(files);
  };

  return (
    <div
      className="li-board relative flex-1 overflow-hidden"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <LeanInceptionDropOverlay active={dropActive} />
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.3}
        maxScale={1.5}
        panning={{ excluded: ['li-no-pan'] }}
        wheel={{ step: 0.1 }}
        doubleClick={{ disabled: true }}
      >
        <TransformComponent wrapperClass="w-full h-full" contentClass="li-board-grid flex flex-row gap-4 p-4 items-start">
          {COLUMN_ORDER.map((key) => {
            const snap = state.columns[key];
            if (!snap) return null;
            return (
              <LeanInceptionColumn
                key={key}
                columnKey={key}
                status={snap.status}
                cards={snap.cards}
                documentNames={documentNames}
                onCardClick={onCardClick}
              />
            );
          })}
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
});
