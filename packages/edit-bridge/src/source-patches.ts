import { emptyManualEditStyles, MANUAL_EDIT_STYLE_PROPS, type ManualEditFields, type ManualEditPatch, type ManualEditStyles } from './types.js';

export interface ManualEditPatchResult {
  ok: boolean;
  source: string;
  error?: string;
}

export function applyManualEditPatch(source: string, patch: ManualEditPatch): ManualEditPatchResult {
  if (patch.kind === 'set-full-source') return { ok: true, source: patch.source };

  const doc = parseSource(source);
  if (!doc) return { ok: false, source, error: 'Could not parse source.' };

  if (patch.kind === 'set-token') {
    const changed = setCssToken(doc, patch.token, patch.value);
    return changed
      ? { ok: true, source: serializeSource(doc, source) }
      : { ok: false, source, error: `Token not found: ${patch.token}` };
  }

  if (patch.kind === 'insert-html-as-child') {
    const parent = patch.parentId === '__body__'
      ? doc.body
      : findEditableElement(doc, patch.parentId);
    if (!parent) return { ok: false, source, error: `Parent target not found: ${patch.parentId}` };
    const inserted = parseSingleRoot(doc, patch.html);
    if (!inserted.ok) return { ok: false, source, error: inserted.error };
    parent.appendChild(inserted.el);
    return { ok: true, source: serializeSource(doc, source) };
  }

  if (patch.kind === 'insert-html-before-ref') {
    const ref = findEditableElement(doc, patch.referenceId);
    if (!ref) return { ok: false, source, error: `Reference target not found: ${patch.referenceId}` };
    const inserted = parseSingleRoot(doc, patch.html);
    if (!inserted.ok) return { ok: false, source, error: inserted.error };
    ref.parentElement?.insertBefore(inserted.el, ref);
    return { ok: true, source: serializeSource(doc, source) };
  }

  const el = findEditableElement(doc, patch.id);
  if (!el) return { ok: false, source, error: `Target not found: ${patch.id}` };

  if (patch.kind === 'set-text') {
    if (hasElementChildren(el)) {
      return { ok: false, source, error: 'This element contains nested markup. Use the HTML tab instead.' };
    }
    el.textContent = patch.value;
  } else if (patch.kind === 'set-link') {
    if (hasElementChildren(el)) {
      const currentText = el.textContent?.trim() ?? '';
      if (patch.text.trim() !== currentText) {
        return { ok: false, source, error: 'This link contains nested markup. Use the HTML tab to change its label.' };
      }
    } else {
      el.textContent = patch.text;
    }
    el.setAttribute('href', patch.href);
  } else if (patch.kind === 'set-image') {
    el.setAttribute('src', patch.src);
    el.setAttribute('alt', patch.alt);
  } else if (patch.kind === 'set-style') {
    setInlineStyles(el as HTMLElement, patch.styles);
  } else if (patch.kind === 'set-attributes') {
    setAttributes(el, patch.attributes);
  } else if (patch.kind === 'set-outer-html') {
    const replaced = replaceOuterHtml(doc, el, patch.html);
    if (!replaced.ok) return { ok: false, source, error: replaced.error };
  } else if (patch.kind === 'delete-element') {
    if (el === doc.body) return { ok: false, source, error: 'Cannot delete the document body.' };
    el.remove();
  } else if (patch.kind === 'clone-element-after') {
    if (el === doc.body) return { ok: false, source, error: 'Cannot clone the document body.' };
    const clone = el.cloneNode(true) as Element;
    // Strip runtime-only attributes so the clone gets fresh stable ids when
    // the bridge re-scans. Without this, two elements would share the same
    // data-od-runtime-id and findEditableElement would resolve to whichever
    // came first in the DOM.
    stripRuntimeMarkers(clone);
    el.after(clone);
  } else if (patch.kind === 'insert-sibling-after') {
    if (el === doc.body) return { ok: false, source, error: 'Cannot insert next to the document body.' };
    const template = doc.createElement('template');
    template.innerHTML = patch.html.trim();
    const inserted = Array.from(template.content.children);
    if (inserted.length !== 1) return { ok: false, source, error: 'Insertion HTML must contain exactly one root element.' };
    el.after(inserted[0]!);
  } else if (patch.kind === 'move-element-up') {
    if (el === doc.body) return { ok: false, source, error: 'Cannot move the document body.' };
    const prev = el.previousElementSibling;
    if (!prev) return { ok: false, source, error: 'No previous sibling to swap with.' };
    el.parentElement?.insertBefore(el, prev);
  } else if (patch.kind === 'move-element-down') {
    if (el === doc.body) return { ok: false, source, error: 'Cannot move the document body.' };
    const next = el.nextElementSibling;
    if (!next) return { ok: false, source, error: 'No next sibling to swap with.' };
    // insertBefore inserts BEFORE the reference node; using nextElementSibling
    // of next (i.e. the node two positions ahead) keeps `el` after `next`.
    el.parentElement?.insertBefore(el, next.nextElementSibling);
  } else if (patch.kind === 'move-before-ref') {
    if (el === doc.body) return { ok: false, source, error: 'Cannot move the document body.' };
    const ref = findEditableElement(doc, patch.referenceId);
    if (!ref) return { ok: false, source, error: `Reference target not found: ${patch.referenceId}` };
    if (el === ref) return { ok: false, source, error: 'Cannot move an element relative to itself.' };
    if (el.contains(ref)) return { ok: false, source, error: 'Cannot move an element into its own descendant.' };
    ref.parentElement?.insertBefore(el, ref);
  } else if (patch.kind === 'append-to-parent') {
    if (el === doc.body) return { ok: false, source, error: 'Cannot move the document body.' };
    const parent = findEditableElement(doc, patch.parentId);
    if (!parent) return { ok: false, source, error: `Parent target not found: ${patch.parentId}` };
    if (el === parent) return { ok: false, source, error: 'Cannot move an element into itself.' };
    if (el.contains(parent)) return { ok: false, source, error: 'Cannot move an element into its own descendant.' };
    parent.appendChild(el);
  }

  return { ok: true, source: serializeSource(doc, source) };
}

function parseSingleRoot(
  doc: Document,
  html: string,
): { ok: true; el: Element } | { ok: false; error: string } {
  const template = doc.createElement('template');
  template.innerHTML = html.trim();
  const roots = Array.from(template.content.children);
  if (roots.length !== 1) {
    return { ok: false, error: 'Insertion HTML must contain exactly one root element.' };
  }
  return { ok: true, el: roots[0]! };
}

function stripRuntimeMarkers(el: Element): void {
  el.removeAttribute('data-od-runtime-id');
  el.removeAttribute('data-od-edit-selected');
  el.removeAttribute('data-od-inline-editing');
  Array.from(el.querySelectorAll('[data-od-runtime-id], [data-od-edit-selected], [data-od-inline-editing]')).forEach((child) => {
    child.removeAttribute('data-od-runtime-id');
    child.removeAttribute('data-od-edit-selected');
    child.removeAttribute('data-od-inline-editing');
  });
}

export function readManualEditFields(source: string, id: string): ManualEditFields {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return {};
  const kind = inferKind(el);
  if (kind === 'link') {
    return {
      text: el.textContent?.trim() ?? '',
      href: el.getAttribute('href') ?? '',
    };
  }
  if (kind === 'image') {
    return {
      src: el.getAttribute('src') ?? '',
      alt: el.getAttribute('alt') ?? '',
    };
  }
  return { text: el.textContent?.trim() ?? '' };
}

export function readManualEditStyles(source: string, id: string): ManualEditStyles {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return emptyManualEditStyles();
  const style = (el as HTMLElement).style;
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    acc[key] = (style[key as unknown as keyof CSSStyleDeclaration] as string | undefined) ?? '';
    return acc;
  }, {} as ManualEditStyles);
}

export function readManualEditAttributes(source: string, id: string): Record<string, string> {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return {};
  const attrs: Record<string, string> = {};
  Array.from(el.attributes).forEach((attr) => {
    if (attr.name === 'data-od-runtime-id') return;
    attrs[attr.name] = attr.value;
  });
  return attrs;
}

export function readManualEditOuterHtml(source: string, id: string): string {
  const doc = parseSource(source);
  return (doc ? findEditableElement(doc, id)?.outerHTML : '') ?? '';
}

const PRESTAMP_TAGS = new Set([
  'main', 'nav', 'section', 'article', 'header', 'footer', 'aside', 'dialog',
  'div', 'figure', 'figcaption', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'a', 'button', 'label', 'input', 'select', 'textarea', 'option',
  'span', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'code', 'kbd', 'samp', 'time', 'abbr', 'sub', 'sup',
  'img', 'picture', 'video', 'audio', 'iframe',
  'svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use', 'symbol',
]);

// Walks the parsed source and stamps a stable `data-od-id="od-<tag>-<seq>"`
// on every editable element that lacks any source-side identifier. The walk
// is deterministic (document order) and idempotent (existing `od-<tag>-N`
// ids seed the counter, so a re-run only fills in new elements). This breaks
// the path-vs-runtime divergence that caused "Target not found" errors when
// the bridge resolved an element by path and the source-side patcher couldn't
// reproduce the same walk.
export function prestampHtmlForManualEdit(source: string): { html: string; changed: boolean } {
  const doc = parseSource(source);
  if (!doc) return { html: source, changed: false };

  const counters = new Map<string, number>();
  for (const el of Array.from(doc.querySelectorAll('[data-od-id]'))) {
    const id = el.getAttribute('data-od-id') ?? '';
    const match = /^od-([a-z]+)-(\d+)$/.exec(id);
    if (!match) continue;
    const tag = match[1]!;
    const seq = Number(match[2]);
    if (Number.isInteger(seq) && seq > (counters.get(tag) ?? 0)) {
      counters.set(tag, seq);
    }
  }

  let changed = false;
  const body = doc.body;
  if (!body) return { html: source, changed: false };
  for (const el of Array.from(body.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (!PRESTAMP_TAGS.has(tag)) continue;
    if (el.hasAttribute('data-od-id')) continue;
    if (el.hasAttribute('data-od-source-path')) continue;
    const seq = (counters.get(tag) ?? 0) + 1;
    counters.set(tag, seq);
    el.setAttribute('data-od-id', `od-${tag}-${seq}`);
    changed = true;
  }

  if (!changed) return { html: source, changed: false };
  return { html: serializeSource(doc, source), changed: true };
}

function parseSource(source: string): Document | null {
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(source, 'text/html');
  }
  if (typeof document !== 'undefined') {
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = source;
    return doc;
  }
  return null;
}

function serializeSource(doc: Document, originalSource: string): string {
  if (!isManualEditFullHtmlDocument(originalSource)) return doc.body.innerHTML;
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

// Snapshot-replace: substitute the body content of `source` with the
// runtime DOM the bridge captured. Used when a structural patch fails to
// find its target node in the source HTML — typically because the source
// is a single-file SPA (e.g. `<div id="root">` + inline React/Babel) and
// the elements only exist at runtime.
//
// After this rewrite the source becomes a static snapshot of what the
// SPA was rendering, so subsequent edits round-trip through the normal
// patch path. We deliberately strip inline scripts that would re-render
// over the snapshot (react CDN, babel transformer, type="text/babel"
// blocks) — otherwise loading the file again would wipe the snapshot
// the moment React mounts.
export function replaceBodyWithSnapshot(source: string, bodyHtml: string): string {
  const doc = parseSource(source);
  if (!doc || !doc.body) return source;
  doc.body.innerHTML = bodyHtml;
  // Drop scripts that would re-execute and overwrite the snapshot on next
  // load. We are intentionally aggressive: any inline script (even outside
  // the typical react/babel CDNs) gets removed because we cannot tell
  // whether it mutates the DOM the user just edited.
  const scripts = Array.from(doc.querySelectorAll('script'));
  for (const s of scripts) {
    const src = s.getAttribute('src') ?? '';
    const type = s.getAttribute('type') ?? '';
    const isInline = src === '';
    const isReactBabelCdn = /\b(react|react-dom|@babel\/standalone|babel\.min)\b/i.test(src);
    const isBabelType = /text\/babel|application\/babel/i.test(type);
    if (isInline || isReactBabelCdn || isBabelType) {
      s.parentElement?.removeChild(s);
    }
  }
  return serializeSource(doc, source);
}

export function isManualEditFullHtmlDocument(source: string): boolean {
  const normalized = firstSourceToken(source).slice(0, 32).toLowerCase();
  return normalized.startsWith('<!doctype') || normalized.startsWith('<html');
}

function firstSourceToken(source: string): string {
  let rest = source.trimStart();
  while (rest.startsWith('<!--') || rest.startsWith('<?')) {
    const close = rest.startsWith('<!--') ? '-->' : '?>';
    const end = rest.indexOf(close);
    if (end === -1) return rest;
    rest = rest.slice(end + close.length).trimStart();
  }
  return rest;
}

function inferKind(el: Element): 'text' | 'link' | 'image' | 'container' {
  const explicit = el.getAttribute('data-od-edit');
  if (explicit === 'text' || explicit === 'link' || explicit === 'image' || explicit === 'container') return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'img') return 'image';
  if (['section', 'main', 'nav', 'div', 'article', 'header', 'footer'].includes(tag)) return 'container';
  return 'text';
}

function findEditableElement(doc: Document, id: string): Element | null {
  if (id === '__body__') return doc.body;
  return (
    doc.querySelector(`[data-od-id="${cssEscape(id)}"]`) ??
    doc.querySelector(`[data-od-runtime-id="${cssEscape(id)}"]`) ??
    doc.querySelector(`[data-od-source-path="${cssEscape(id)}"]`) ??
    findElementByPath(doc, id)
  );
}

function findElementByPath(doc: Document, id: string): Element | null {
  if (!id.startsWith('path-')) return null;
  const indexes = id
    .slice('path-'.length)
    .split('-')
    .map((part) => Number(part));
  if (indexes.some((index) => !Number.isInteger(index) || index < 0)) return null;
  let current: Element | null = doc.body;
  for (const index of indexes) {
    current = current?.children.item(index) ?? null;
    if (!current) return null;
  }
  return current;
}

function hasElementChildren(el: Element): boolean {
  return Array.from(el.children).some((child) => child.nodeType === 1);
}

function setInlineStyles(el: HTMLElement, styles: Partial<ManualEditStyles>): void {
  for (const [name, value] of Object.entries(styles)) {
    const cssName = camelToKebab(name);
    if (typeof value !== 'string' || value.trim() === '') el.style.removeProperty(cssName);
    else el.style.setProperty(cssName, value.trim());
  }
}

function setAttributes(el: Element, attributes: Record<string, string>): void {
  const protectedAttrs = new Set(['data-od-id', 'data-od-edit', 'data-od-label', 'data-od-runtime-id']);
  for (const [name, value] of Object.entries(attributes)) {
    if (!isSafeAttributeName(name) || protectedAttrs.has(name)) continue;
    if (value.trim() === '') el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
}

function replaceOuterHtml(doc: Document, el: Element, html: string): { ok: true } | { ok: false; error: string } {
  const template = doc.createElement('template');
  template.innerHTML = html.trim();
  const elements = Array.from(template.content.children);
  if (elements.length !== 1) return { ok: false, error: 'Replacement HTML must contain exactly one root element.' };
  const next = elements[0]!;
  if (el.getAttribute('data-od-id') && !next.getAttribute('data-od-id')) {
    next.setAttribute('data-od-id', el.getAttribute('data-od-id') ?? '');
  }
  if (el.getAttribute('data-od-edit') && !next.getAttribute('data-od-edit')) {
    next.setAttribute('data-od-edit', el.getAttribute('data-od-edit') ?? '');
  }
  el.replaceWith(next);
  return { ok: true };
}

function setCssToken(doc: Document, token: string, value: string): boolean {
  const styles = Array.from(doc.querySelectorAll('style'));
  const pattern = new RegExp(`(${escapeRegExp(token)}\\s*:\\s*)([^;]+)(;)`);
  for (const style of styles) {
    const text = style.textContent ?? '';
    if (!pattern.test(text)) continue;
    style.textContent = text.replace(pattern, `$1${value}$3`);
    return true;
  }
  return false;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function isSafeAttributeName(value: string): boolean {
  return /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/.test(value);
}
