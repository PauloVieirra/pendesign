import { useRef, type ChangeEvent, type DragEvent } from 'react';

interface Props {
  onFiles: (files: File[]) => void;
  isMutating: boolean;
}

export function LeanInceptionDropBar({ onFiles, isMutating }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onClick = () => inputRef.current?.click();
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };
  const stop = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  };
  return (
    <button
      type="button"
      className="li-dropbar"
      onClick={onClick}
      onDragEnter={stop}
      onDragOver={stop}
      onDrop={onDrop}
      disabled={isMutating}
    >
      <div className="li-dropbar__title">↓ DROP FILES HERE</div>
      <div className="li-dropbar__sub">Images, docs, references, or folders — the agent will use them as context.</div>
      <input
        ref={inputRef}
        type="file"
        accept=".md,.txt,.png,.jpg,.jpeg"
        multiple
        className="li-dropbar__input"
        onChange={onChange}
      />
    </button>
  );
}
