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
  /** Opening-tag fragment for the selected element (e.g. `<div class="hero">`).
   *  Used as a fallback when `selectedTargetId` can't be resolved via the
   *  `data-od-*` attribute lookup — common case is clicking an arbitrary
   *  element that the agent hasn't annotated yet (plain text, icon, body).
   *  We search the source for this substring to land the highlight on
   *  the right opening tag. */
  selectedTargetHint?: string | null;
  /** Tick that increments on every selection change in the host (even
   *  when the user re-clicks the same element). The scroll-into-view
   *  effect depends on this so consecutive clicks always re-center,
   *  not just the first one. */
  selectionTick?: number;
}

/**
 * HTML/CSS/JS code editor with IDE-style syntax highlighting.
 *
 * The textarea stays the canonical source of truth — selection, undo, IME
 * composition, and accessibility all keep their native behavior. Highlighting
 * is layered behind the textarea via a transparent-text trick: the textarea
 * renders its own text in `color: transparent`, and a `<pre>` overlay below
 * it renders the same text wrapped in token spans. Both share font/size/
 * padding/line-height pixel-for-pixel; both scroll together. The user sees
 * the colored overlay; the textarea provides the caret + selection.
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
  selectedTargetHint = null,
  selectionTick = 0,
}: CodeEditorProps) {
  const [draft, setDraft] = useState(source);
  const [status, setStatus] = useState<CodeEditorStatus>('committed');
  const [scrollTop, setScrollTop] = useState(0);
  const lastExternalRef = useRef(source);
  const lastCommittedRef = useRef(source);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (source === lastExternalRef.current) return;
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

  const tokens = useMemo(() => tokenizeHtmlSource(draft), [draft]);

  const highlightLines = useMemo(() => {
    if (!selectedTargetId && !selectedTargetHint) return null;
    let range = selectedTargetId ? findElementSourceRange(draft, selectedTargetId) : null;
    if (!range && selectedTargetHint) {
      // Fallback when the element has no data-od-* annotation: find the
      // opening tag's substring in the source. We balance close-tags
      // starting from the hit so the highlight covers the full element,
      // not just the opening line.
      range = findRangeByOpeningTagHint(draft, selectedTargetHint);
    }
    if (!range) return null;
    return offsetsToLines(draft, range.start, range.end);
  }, [draft, selectedTargetId, selectedTargetHint]);

  useLayoutEffect(() => {
    if (!highlightLines) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const lineHeight = measureLineHeight(textarea);
    const paddingTop = measurePaddingTop(textarea);
    const rangeTop = paddingTop + (highlightLines.startLine - 1) * lineHeight;
    const viewportHeight = textarea.clientHeight;
    // Center the START of the snippet vertically. Scroll is INSTANT
    // (not smooth) so a fast click stream — the user pinging different
    // elements in quick succession — keeps up with the input. Smooth
    // animation queued the requests behind a ~300ms transition each;
    // instant respects every click in the same frame.
    const target = Math.max(0, rangeTop - viewportHeight / 2 + lineHeight);
    textarea.scrollTop = target;
    setScrollTop(target);
  }, [highlightLines?.startLine, highlightLines?.endLine, selectionTick]);

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
          <pre
            ref={overlayRef}
            className="code-editor-overlay"
            aria-hidden
          >
            {tokens.map((tok, idx) => (
              <span key={idx} className={`tok-${tok.type}`}>{tok.value}</span>
            ))}
            {/* Trailing newline so the last line's height matches the textarea
                when content ends without a newline character. */}
            {'\n'}
          </pre>
          <textarea
            ref={textareaRef}
            className="code-editor-area code-editor-area-overlaid"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onScroll={(event) => {
              const top = event.currentTarget.scrollTop;
              const left = event.currentTarget.scrollLeft;
              setScrollTop(top);
              const overlay = overlayRef.current;
              if (overlay) {
                overlay.scrollTop = top;
                overlay.scrollLeft = left;
              }
            }}
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

/** Fuzzy fallback: locate an element in `source` from the opening-tag
 *  fragment + a slice of its text content the bridge captured at click
 *  time. Hint shape: either `<div class="hero">` (text-less) or
 *  `<button class="cta"> Click me here` (joined with a space). The
 *  matcher walks the source looking for opening tags that LOOK LIKE the
 *  hint AND whose first text-content slice matches the text suffix.
 *  This disambiguates sibling elements whose opening tags are identical
 *  (e.g. five `<span class="dot">` — the text snippet picks the right
 *  one). When the hint has no text portion, we fall back to "first
 *  occurrence of the opening tag" — fine for unique elements. */
export function findRangeByOpeningTagHint(
  source: string,
  hint: string,
): { start: number; end: number } | null {
  const trimmed = hint.trim();
  if (!trimmed) return null;
  // Split the joined "open tag SPACE text" hint. Everything up to the
  // first `>` is the opening tag; everything after is the text content.
  const tagCloseIdx = trimmed.indexOf('>');
  const openTagPart = tagCloseIdx === -1 ? trimmed : trimmed.slice(0, tagCloseIdx + 1);
  const textHint = tagCloseIdx === -1 ? '' : trimmed.slice(tagCloseIdx + 1).trim();

  const needle = openTagPart.endsWith('>') ? openTagPart.slice(0, -1) : openTagPart;
  const tagNameMatch = /^<\s*([\w:-]+)/.exec(needle);
  if (!tagNameMatch) return null;
  const tagName = tagNameMatch[1]!.toLowerCase();

  // Collect candidate occurrences of the opening tag. We progressively
  // relax the prefix (chop 4 chars at a time off the end) so a truncated
  // hint (the bridge caps at 180 chars) still matches when the original
  // opening tag is longer.
  const candidates: number[] = [];
  for (let len = needle.length; len >= tagNameMatch[0].length; len -= 4) {
    const sub = needle.slice(0, len);
    let from = 0;
    while (from < source.length) {
      const idx = source.indexOf(sub, from);
      if (idx === -1) break;
      if (!candidates.includes(idx)) candidates.push(idx);
      from = idx + 1;
    }
    if (candidates.length > 0) break;
  }
  if (candidates.length === 0) {
    // Last resort: regex match on bare `<tagname`.
    const tagRe = new RegExp(`<\\s*${tagName}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(source)) !== null) candidates.push(m.index);
    if (candidates.length === 0) return null;
  }

  // Pick the candidate whose text content best matches `textHint`.
  let hitStart = candidates[0]!;
  if (textHint) {
    const textKey = textHint.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 24);
    let best = -1;
    for (const cand of candidates) {
      const tagEnd = source.indexOf('>', cand);
      if (tagEnd === -1) continue;
      // Grab the next ~80 chars of source after the opening tag, strip
      // whitespace + tags, compare to the text hint.
      const slice = source.slice(tagEnd + 1, tagEnd + 1 + 120)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .trim();
      if (slice.startsWith(textKey)) { best = cand; break; }
      if (best === -1 && slice.includes(textKey)) best = cand;
    }
    if (best !== -1) hitStart = best;
  }
  const openTagEnd = source.indexOf('>', hitStart);
  if (openTagEnd === -1) return { start: hitStart, end: source.length };
  if (source[openTagEnd - 1] === '/' || VOID_ELEMENTS.has(tagName)) {
    return { start: hitStart, end: openTagEnd + 1 };
  }
  // Walk matching open/close pairs to find the closing tag.
  const tagRegex = new RegExp(`<\\s*(/)?\\s*${tagName}\\b`, 'gi');
  tagRegex.lastIndex = openTagEnd + 1;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(source)) !== null) {
    if (match[1] === '/') {
      depth -= 1;
      if (depth === 0) {
        const closeEnd = source.indexOf('>', match.index);
        return { start: hitStart, end: closeEnd === -1 ? source.length : closeEnd + 1 };
      }
    } else {
      depth += 1;
    }
  }
  return { start: hitStart, end: source.length };
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

// ─────────────────────────────────────────────────────────────────────
// Syntax highlighting tokenizer.
//
// Hand-rolled state-machine tokenizer for HTML with embedded CSS/JS.
// Deliberately small + dependency-free: a "looks like VS Code" first pass
// without taking on Prism/Shiki/CodeMirror. Tokens carry semantic types so
// the CSS can theme them per light/dark mode and the user can extend the
// palette without re-running a lexer.
//
// Token taxonomy:
//   - HTML: comment, doctype, tag-bracket, tag-name, attr-name, attr-eq,
//     attr-string, attr-value, attr-class-value, text
//   - JS:   js-comment, js-string, js-number, js-keyword, js-ident, js-punct
//   - CSS:  css-comment, css-selector, css-punct, css-property, css-value
//   - Generic: ws (whitespace), unknown (anything the lexer gives up on)
// ─────────────────────────────────────────────────────────────────────

export type CodeTokenType =
  | 'comment'
  | 'doctype'
  | 'tag-bracket'
  | 'tag-name'
  | 'attr-name'
  | 'attr-eq'
  | 'attr-string'
  | 'attr-value'
  | 'attr-class-value'
  | 'text'
  | 'js-comment'
  | 'js-string'
  | 'js-number'
  | 'js-keyword'
  | 'js-ident'
  | 'js-punct'
  | 'css-comment'
  | 'css-selector'
  | 'css-punct'
  | 'css-property'
  | 'css-value'
  | 'ws'
  | 'unknown';

export interface CodeToken {
  type: CodeTokenType;
  value: string;
}

const JS_KEYWORDS = new Set([
  'await', 'async', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
  'false', 'finally', 'for', 'from', 'function', 'if', 'implements', 'import',
  'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of', 'package',
  'private', 'protected', 'public', 'return', 'static', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void',
  'while', 'with', 'yield', 'as', 'is',
]);

export function tokenizeHtmlSource(src: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let i = 0;
  const N = src.length;

  while (i < N) {
    // HTML comment
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const stop = end === -1 ? N : end + 3;
      tokens.push({ type: 'comment', value: src.slice(i, stop) });
      i = stop;
      continue;
    }

    // Doctype / processing instruction
    if (src.startsWith('<!', i)) {
      const end = src.indexOf('>', i);
      const stop = end === -1 ? N : end + 1;
      tokens.push({ type: 'doctype', value: src.slice(i, stop) });
      i = stop;
      continue;
    }

    // <script ...>...</script>
    if (matchesTagStart(src, i, 'script')) {
      const tagEnd = src.indexOf('>', i);
      const tagStop = tagEnd === -1 ? N : tagEnd + 1;
      tokenizeTagInto(src.slice(i, tagStop), tokens);
      i = tagStop;
      const closeRe = /<\/script\s*>/i;
      closeRe.lastIndex = i;
      const remainder = src.slice(i);
      const closeMatch = closeRe.exec(remainder);
      const contentEnd = closeMatch ? i + closeMatch.index : N;
      tokenizeJsInto(src.slice(i, contentEnd), tokens);
      i = contentEnd;
      continue;
    }

    // <style ...>...</style>
    if (matchesTagStart(src, i, 'style')) {
      const tagEnd = src.indexOf('>', i);
      const tagStop = tagEnd === -1 ? N : tagEnd + 1;
      tokenizeTagInto(src.slice(i, tagStop), tokens);
      i = tagStop;
      const closeRe = /<\/style\s*>/i;
      const remainder = src.slice(i);
      const closeMatch = closeRe.exec(remainder);
      const contentEnd = closeMatch ? i + closeMatch.index : N;
      tokenizeCssInto(src.slice(i, contentEnd), tokens);
      i = contentEnd;
      continue;
    }

    // Generic tag
    if (src[i] === '<') {
      const end = src.indexOf('>', i);
      if (end === -1) {
        tokens.push({ type: 'text', value: src.slice(i) });
        i = N;
        continue;
      }
      tokenizeTagInto(src.slice(i, end + 1), tokens);
      i = end + 1;
      continue;
    }

    // Plain text content until next '<'
    let j = i;
    while (j < N && src[j] !== '<') j++;
    tokens.push({ type: 'text', value: src.slice(i, j) });
    i = j;
  }

  return tokens;
}

function matchesTagStart(src: string, i: number, name: string): boolean {
  if (src[i] !== '<') return false;
  const tail = src.slice(i + 1, i + 1 + name.length).toLowerCase();
  if (tail !== name) return false;
  const after = src[i + 1 + name.length];
  return after === undefined || after === ' ' || after === '\t' || after === '\n' || after === '\r' || after === '>' || after === '/';
}

function tokenizeTagInto(tag: string, out: CodeToken[]): void {
  let i = 0;
  const N = tag.length;
  if (tag.startsWith('</')) {
    out.push({ type: 'tag-bracket', value: '</' });
    i = 2;
  } else if (tag.startsWith('<')) {
    out.push({ type: 'tag-bracket', value: '<' });
    i = 1;
  }

  // Tag name
  let nameStart = i;
  while (i < N && /[A-Za-z0-9_:-]/.test(tag[i]!)) i++;
  if (i > nameStart) {
    out.push({ type: 'tag-name', value: tag.slice(nameStart, i) });
  }

  // Attributes
  while (i < N) {
    const ch = tag[i]!;
    if (ch === '>' || (ch === '/' && tag[i + 1] === '>')) break;
    if (/\s/.test(ch)) {
      const ws = i;
      while (i < N && /\s/.test(tag[i]!)) i++;
      out.push({ type: 'ws', value: tag.slice(ws, i) });
      continue;
    }
    // Attribute name
    const an = i;
    while (i < N && /[A-Za-z0-9_:.@-]/.test(tag[i]!)) i++;
    const attrName = tag.slice(an, i);
    if (attrName) out.push({ type: 'attr-name', value: attrName });

    if (tag[i] === '=') {
      out.push({ type: 'attr-eq', value: '=' });
      i++;
      const isClassAttr = attrName.toLowerCase() === 'class' || attrName.toLowerCase() === 'classname';
      if (tag[i] === '"' || tag[i] === "'") {
        const quote = tag[i]!;
        const s = i;
        i++;
        while (i < N && tag[i] !== quote) i++;
        if (i < N) i++; // include closing quote
        out.push({
          type: isClassAttr ? 'attr-class-value' : 'attr-string',
          value: tag.slice(s, i),
        });
      } else {
        const s = i;
        while (i < N && !/[\s>]/.test(tag[i]!)) i++;
        out.push({ type: 'attr-value', value: tag.slice(s, i) });
      }
    }

    if (i < N && !/\s/.test(tag[i]!) && tag[i] !== '>' && !(tag[i] === '/' && tag[i + 1] === '>') && tag[i] !== '=' && i === an) {
      // Safety: prevent zero-width infinite loop on unexpected character.
      out.push({ type: 'unknown', value: tag[i]! });
      i++;
    }
  }

  // Trailing brackets
  if (tag[i] === '/' && tag[i + 1] === '>') {
    out.push({ type: 'tag-bracket', value: '/>' });
    i += 2;
  } else if (tag[i] === '>') {
    out.push({ type: 'tag-bracket', value: '>' });
    i++;
  }

  // Anything left over (malformed input) — preserve as text so the
  // overlay's text content stays byte-identical to the textarea.
  if (i < N) out.push({ type: 'text', value: tag.slice(i) });
}

function tokenizeJsInto(src: string, out: CodeToken[]): void {
  let i = 0;
  const N = src.length;
  while (i < N) {
    const ch = src[i]!;

    if (ch === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < N && src[j] !== '\n') j++;
      out.push({ type: 'js-comment', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? N : end + 2;
      out.push({ type: 'js-comment', value: src.slice(i, stop) });
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < N) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        j++;
      }
      out.push({ type: 'js-string', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < N && /[\w.]/.test(src[j]!)) j++;
      out.push({ type: 'js-number', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < N && /[\w$]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      out.push({ type: JS_KEYWORDS.has(word) ? 'js-keyword' : 'js-ident', value: word });
      i = j;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < N && /\s/.test(src[j]!)) j++;
      out.push({ type: 'ws', value: src.slice(i, j) });
      i = j;
      continue;
    }
    out.push({ type: 'js-punct', value: ch });
    i++;
  }
}

function tokenizeCssInto(src: string, out: CodeToken[]): void {
  let i = 0;
  const N = src.length;
  let state: 'selector' | 'decl' = 'selector';
  let depth = 0;

  while (i < N) {
    const ch = src[i]!;

    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? N : end + 2;
      out.push({ type: 'css-comment', value: src.slice(i, stop) });
      i = stop;
      continue;
    }
    if (ch === '{') {
      out.push({ type: 'css-punct', value: '{' });
      depth++;
      state = 'decl';
      i++;
      continue;
    }
    if (ch === '}') {
      out.push({ type: 'css-punct', value: '}' });
      depth = Math.max(0, depth - 1);
      state = depth === 0 ? 'selector' : 'decl';
      i++;
      continue;
    }

    if (state === 'selector') {
      let j = i;
      while (j < N && src[j] !== '{' && src[j] !== '}' && !(src[j] === '/' && src[j + 1] === '*')) j++;
      const chunk = src.slice(i, j);
      // Split off leading whitespace so it stays neutral
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(chunk);
      if (m) {
        if (m[1]) out.push({ type: 'ws', value: m[1] });
        if (m[2]) out.push({ type: 'css-selector', value: m[2] });
        if (m[3]) out.push({ type: 'ws', value: m[3] });
      } else {
        out.push({ type: 'css-selector', value: chunk });
      }
      i = j;
      continue;
    }

    // state === 'decl'
    if (ch === ':') {
      out.push({ type: 'css-punct', value: ':' });
      i++;
      // Read value until ; or } (respecting parens & strings minimally).
      let j = i;
      let parens = 0;
      while (j < N) {
        const c = src[j]!;
        if (c === '(') parens++;
        else if (c === ')') parens = Math.max(0, parens - 1);
        else if ((c === ';' || c === '}') && parens === 0) break;
        else if (c === '/' && src[j + 1] === '*') break;
        j++;
      }
      const valueChunk = src.slice(i, j);
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(valueChunk);
      if (m) {
        if (m[1]) out.push({ type: 'ws', value: m[1] });
        if (m[2]) out.push({ type: 'css-value', value: m[2] });
        if (m[3]) out.push({ type: 'ws', value: m[3] });
      } else {
        out.push({ type: 'css-value', value: valueChunk });
      }
      i = j;
      continue;
    }
    if (ch === ';') {
      out.push({ type: 'css-punct', value: ';' });
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < N && /\s/.test(src[j]!)) j++;
      out.push({ type: 'ws', value: src.slice(i, j) });
      i = j;
      continue;
    }
    // Property name
    let j = i;
    while (j < N && src[j] !== ':' && src[j] !== ';' && src[j] !== '}' && !/\s/.test(src[j]!) && !(src[j] === '/' && src[j + 1] === '*')) j++;
    if (j === i) j = i + 1;
    out.push({ type: 'css-property', value: src.slice(i, j) });
    i = j;
  }
}
