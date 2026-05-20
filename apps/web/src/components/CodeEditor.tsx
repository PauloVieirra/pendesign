import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Dict } from '../i18n/types';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

export type CodeEditorStatus = 'committed' | 'pending' | 'error';

interface CodeEditorProps {
  source: string;
  onCommit: (next: string) => void;
  disabled?: boolean;
  t: TranslateFn;
  /** ms to wait after the last keystroke before validating + committing. */
  debounceMs?: number;
  /** Currently selected element in the visual editor; the snippet that
   *  owns this id is scrolled into view and lightly highlighted. */
  selectedTargetId?: string | null;
}

/**
 * Lightweight HTML code editor. Uses a plain <textarea> with a monospaced
 * line-numbered gutter — no syntax highlighting in v1 to keep the bundle and
 * the wiring small. The hybrid-visual-editor spec earmarks CodeMirror 6 for
 * Phase 2; this surface stays small until that lands.
 *
 * Behavior:
 *  - Typing updates a local `draft` immediately so the editor feels snappy.
 *  - After `debounceMs` idle, the draft is parsed with DOMParser. If valid,
 *    `onCommit(draft)` runs — the host applies the change and the design
 *    re-renders. If invalid, the design stays on the last-good source and a
 *    status badge reports the parsing error.
 *  - External source changes (file switch, agent regenerate) replace the
 *    draft only when the user hasn't made local edits, so in-flight work
 *    isn't clobbered.
 *  - When `selectedTargetId` changes, the editor scrolls the matching snippet
 *    into view and renders a subtle background highlight over the line range.
 */
export function CodeEditor({
  source,
  onCommit,
  disabled,
  t,
  debounceMs = 1500,
  selectedTargetId = null,
}: CodeEditorProps) {
  const [draft, setDraft] = useState(source);
  const [status, setStatus] = useState<CodeEditorStatus>('committed');
  const [scrollTop, setScrollTop] = useState(0);
  const lastExternalRef = useRef(source);
  const lastCommittedRef = useRef(source);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (source === lastExternalRef.current) return;
    // External source changed. Only adopt the new value if the user hasn't
    // diverged locally — otherwise their typing would be wiped out.
    if (draft === lastExternalRef.current || draft === lastCommittedRef.current) {
      setDraft(source);
      setStatus('committed');
      lastCommittedRef.current = source;
    }
    lastExternalRef.current = source;
  }, [source, draft]);

  useEffect(() => {
    if (draft === source) {
      setStatus('committed');
      return;
    }
    setStatus('pending');
    const handle = window.setTimeout(() => {
      if (!isParseableHtml(draft)) {
        setStatus('error');
        return;
      }
      lastCommittedRef.current = draft;
      onCommit(draft);
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [draft, source, debounceMs, onCommit]);

  const lineCount = useMemo(() => Math.max(draft.split('\n').length, 1), [draft]);
  const lineNumbers = useMemo(() => {
    const lines: string[] = [];
    for (let i = 1; i <= lineCount; i += 1) lines.push(String(i));
    return lines.join('\n');
  }, [lineCount]);

  const highlightLines = useMemo(() => {
    if (!selectedTargetId) return null;
    const range = findElementSourceRange(draft, selectedTargetId);
    if (!range) return null;
    return offsetsToLines(draft, range.start, range.end);
  }, [draft, selectedTargetId]);

  // Auto-scroll the textarea so the highlighted snippet is visible. Only fires
  // when the *selection* (or computed line range) changes — not on every
  // keystroke — so the user's caret isn't dragged around while they edit.
  useLayoutEffect(() => {
    if (!highlightLines) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const lineHeight = measureLineHeight(textarea);
    const paddingTop = measurePaddingTop(textarea);
    const rangeTop = paddingTop + (highlightLines.startLine - 1) * lineHeight;
    const rangeHeight = (highlightLines.endLine - highlightLines.startLine + 1) * lineHeight;
    const viewportHeight = textarea.clientHeight;
    const currentTop = textarea.scrollTop;
    const visibleTop = currentTop;
    const visibleBottom = currentTop + viewportHeight;
    // If already in view, leave the scroll alone — sudden jumps are annoying.
    if (rangeTop >= visibleTop && rangeTop + rangeHeight <= visibleBottom) return;
    const target = Math.max(0, rangeTop - Math.max(viewportHeight / 2 - rangeHeight / 2, lineHeight));
    if (typeof textarea.scrollTo === 'function') {
      textarea.scrollTo({ top: target, behavior: 'smooth' });
    } else {
      textarea.scrollTop = target;
    }
    setScrollTop(target);
  }, [highlightLines?.startLine, highlightLines?.endLine]);

  const statusLabel = status === 'committed'
    ? t('fileViewer.codeEditor.statusSaved')
    : status === 'pending'
      ? t('fileViewer.codeEditor.statusPending')
      : t('fileViewer.codeEditor.statusError');

  const highlightStyle = useMemo(() => {
    if (!highlightLines || !textareaRef.current) return null;
    const textarea = textareaRef.current;
    const lineHeight = measureLineHeight(textarea);
    const paddingTop = measurePaddingTop(textarea);
    const top = paddingTop + (highlightLines.startLine - 1) * lineHeight - scrollTop;
    const height = (highlightLines.endLine - highlightLines.startLine + 1) * lineHeight;
    return { top, height };
  }, [highlightLines?.startLine, highlightLines?.endLine, scrollTop]);

  return (
    <div className={`code-editor code-editor-status-${status}`}>
      <div className="code-editor-header">
        <span className="code-editor-title">{t('fileViewer.codeEditor.title')}</span>
        <span className={`code-editor-status code-editor-status-${status}`} aria-live="polite">
          {statusLabel}
        </span>
      </div>
      <div className="code-editor-pane">
        <pre className="code-editor-gutter" aria-hidden>{lineNumbers}</pre>
        <div className="code-editor-area-wrap">
          {highlightStyle ? (
            <div
              className="code-editor-highlight"
              style={{ top: `${highlightStyle.top}px`, height: `${highlightStyle.height}px` }}
              aria-hidden
            />
          ) : null}
          <textarea
            ref={textareaRef}
            className="code-editor-area"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            spellCheck={false}
            disabled={disabled}
            wrap="off"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label={t('fileViewer.codeEditor.area')}
          />
        </div>
      </div>
    </div>
  );
}

function isParseableHtml(html: string): boolean {
  if (typeof DOMParser === 'undefined') return true; // SSR fallback — trust it.
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.querySelector('parsererror') === null;
  } catch {
    return false;
  }
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Find the [start, end) char offsets in `source` that span the element
 *  identified by `id` (data-od-id, data-od-runtime-id, data-od-source-path,
 *  or the special `__body__` token). Returns null if the snippet isn't found
 *  or if the id is a path-based fallback that text search can't resolve. */
export function findElementSourceRange(source: string, id: string): { start: number; end: number } | null {
  if (!id) return null;
  if (id === '__body__') {
    const bodyOpen = /<body\b[^>]*>/i.exec(source);
    if (!bodyOpen) return null;
    const bodyClose = source.lastIndexOf('</body');
    const end = bodyClose === -1
      ? source.length
      : source.indexOf('>', bodyClose) + 1 || source.length;
    return { start: bodyOpen.index, end };
  }
  const escaped = id.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
  const attrRegex = new RegExp(
    `\\sdata-od-(?:id|runtime-id|source-path)=["']${escaped}["']`,
  );
  const attrMatch = attrRegex.exec(source);
  if (!attrMatch) return null;
  const attrIndex = attrMatch.index;
  const openTagStart = source.lastIndexOf('<', attrIndex);
  if (openTagStart === -1) return null;
  const openTagEnd = source.indexOf('>', attrIndex);
  if (openTagEnd === -1) return null;
  const openTag = source.slice(openTagStart, openTagEnd + 1);
  if (openTag.endsWith('/>')) {
    return { start: openTagStart, end: openTagEnd + 1 };
  }
  const tagNameMatch = /^<\s*([\w:-]+)/.exec(openTag);
  const rawTagName = tagNameMatch?.[1];
  if (!rawTagName) return null;
  const tagName = rawTagName.toLowerCase();
  if (VOID_ELEMENTS.has(tagName)) {
    return { start: openTagStart, end: openTagEnd + 1 };
  }
  const tagRegex = new RegExp(`<\\s*(/)?\\s*${tagName}\\b`, 'gi');
  tagRegex.lastIndex = openTagEnd + 1;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(source)) !== null) {
    if (match[1] === '/') {
      depth -= 1;
      if (depth === 0) {
        const closeEnd = source.indexOf('>', match.index);
        return { start: openTagStart, end: closeEnd === -1 ? source.length : closeEnd + 1 };
      }
    } else {
      depth += 1;
    }
  }
  return { start: openTagStart, end: source.length };
}

export function offsetsToLines(source: string, start: number, end: number): { startLine: number; endLine: number } {
  let startLine = 1;
  for (let i = 0; i < start && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) startLine += 1;
  }
  let endLine = startLine;
  for (let i = start; i < end && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) endLine += 1;
  }
  return { startLine, endLine };
}

function measureLineHeight(el: HTMLElement): number {
  const computed = window.getComputedStyle(el);
  const parsed = parseFloat(computed.lineHeight);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const fontSize = parseFloat(computed.fontSize) || 12.5;
  return fontSize * 1.55;
}

function measurePaddingTop(el: HTMLElement): number {
  const parsed = parseFloat(window.getComputedStyle(el).paddingTop);
  return Number.isFinite(parsed) ? parsed : 0;
}
