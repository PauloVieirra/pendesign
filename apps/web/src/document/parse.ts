/**
 * HTML → ODNode parser for the hybrid visual editor.
 *
 * Design:
 *  - Byte-preserving tokenizer. Each node records a source range into the
 *    input string, so untouched subtrees can be re-serialized verbatim.
 *  - Stable ids: `data-od-id` wins; otherwise a content-addressed FNV-1a
 *    hash of (parentId + tag + sibling-index + ordered attribute keys),
 *    salted with a per-document seed derived from the input length so two
 *    structurally identical documents don't share ids across runtime.
 *  - `<style>`, `<script>`, and `<textarea>` are raw-text containers — their
 *    inner content is kept as a single text node without re-tokenizing.
 *  - Inline `style="..."` is parsed into `ODStyleDeclaration[]`.
 *
 * Non-goals:
 *  - HTML5 spec conformance for malformed input. The agent produces
 *    well-formed HTML; broken markup should surface as an error, not be
 *    silently fixed.
 *  - SGML-era features (CDATA, processing instructions, entity declarations).
 */

import type {
  ODElementNode,
  ODInlineStyles,
  ODNode,
  ODSourceLocation,
  ODStyleDeclaration,
  ODTextNode,
} from '@open-design/contracts';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea']);

export interface ParseResult {
  /** The parsed root nodes in document order. */
  nodes: ODNode[];
  /** The original source. The DocumentStore retains this for round-trip serialization. */
  source: string;
  /** Per-document salt mixed into derived node ids. */
  seed: string;
}

export interface ParseError {
  message: string;
  offset: number;
  line: number;
  column: number;
}

export class HTMLParseError extends Error {
  readonly offset: number;
  readonly line: number;
  readonly column: number;

  constructor(error: ParseError) {
    super(`${error.message} at ${error.line}:${error.column}`);
    this.name = 'HTMLParseError';
    this.offset = error.offset;
    this.line = error.line;
    this.column = error.column;
  }
}

export function parseDocument(source: string): ParseResult {
  const parser = new Parser(source);
  const nodes = parser.parseNodes(null, 0);
  return { nodes, source, seed: parser.seed };
}

class Parser {
  readonly seed: string;
  private pos = 0;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
    this.seed = fnv1a(`od-doc::${src.length}::${src.slice(0, 64)}`).toString(36);
  }

  parseNodes(parentId: string | null, parentSiblingStart: number): ODNode[] {
    const out: ODNode[] = [];
    let siblingIndex = parentSiblingStart;
    while (this.pos < this.src.length) {
      if (this.startsWith('</')) break;
      const node = this.parseNode(parentId, siblingIndex);
      if (node === null) break;
      out.push(node);
      siblingIndex += 1;
    }
    return out;
  }

  private parseNode(parentId: string | null, siblingIndex: number): ODNode | null {
    if (this.startsWith('<!--')) return this.parseComment(parentId, siblingIndex);
    if (this.startsWithIgnoreCase('<!doctype')) return this.parseDoctype(parentId, siblingIndex);
    if (this.src[this.pos] === '<' && isTagStartChar(this.src[this.pos + 1])) {
      return this.parseElement(parentId, siblingIndex);
    }
    return this.parseText(parentId, siblingIndex);
  }

  private parseDoctype(parentId: string | null, siblingIndex: number): ODNode {
    const start = this.pos;
    const end = this.src.indexOf('>', this.pos);
    if (end === -1) throw this.error('Unterminated doctype', start);
    const inner = this.src.slice(start + '<!doctype'.length, end).trim();
    this.pos = end + 1;
    return {
      kind: 'doctype',
      id: this.deriveId(parentId, '!doctype', siblingIndex, []),
      value: inner,
      source: this.locate(start, this.pos),
    };
  }

  private parseComment(parentId: string | null, siblingIndex: number): ODNode {
    const start = this.pos;
    const close = this.src.indexOf('-->', this.pos + 4);
    if (close === -1) throw this.error('Unterminated comment', start);
    const inner = this.src.slice(start + 4, close);
    this.pos = close + 3;
    return {
      kind: 'comment',
      id: this.deriveId(parentId, '!comment', siblingIndex, []),
      value: inner,
      source: this.locate(start, this.pos),
    };
  }

  private parseText(parentId: string | null, siblingIndex: number): ODTextNode | null {
    const start = this.pos;
    while (this.pos < this.src.length && this.src[this.pos] !== '<') {
      this.pos += 1;
    }
    if (this.pos === start) return null;
    return {
      kind: 'text',
      id: this.deriveId(parentId, '#text', siblingIndex, []),
      value: this.src.slice(start, this.pos),
      source: this.locate(start, this.pos),
    };
  }

  private parseElement(parentId: string | null, siblingIndex: number): ODElementNode {
    const tagStart = this.pos;
    this.pos += 1; // consume '<'
    const tag = this.readTagName().toLowerCase();
    if (!tag) throw this.error('Expected tag name', tagStart);

    const attrs: Record<string, string> = {};
    let selfClosing = false;
    while (this.pos < this.src.length) {
      this.skipWhitespace();
      if (this.src[this.pos] === '>') {
        this.pos += 1;
        break;
      }
      if (this.startsWith('/>')) {
        selfClosing = true;
        this.pos += 2;
        break;
      }
      if (this.pos >= this.src.length) throw this.error('Unterminated tag', tagStart);
      const [name, value] = this.readAttribute();
      if (name) attrs[name.toLowerCase()] = value;
    }

    const explicitId = attrs['data-od-id'];
    const orderedKeys = Object.keys(attrs).sort();
    const id = explicitId && explicitId.length > 0
      ? explicitId
      : this.deriveId(parentId, tag, siblingIndex, orderedKeys);

    const styles = parseInlineStyles(attrs.style ?? '');

    if (selfClosing || VOID_ELEMENTS.has(tag)) {
      return {
        kind: 'element',
        id,
        tag,
        attributes: attrs,
        styles,
        children: [],
        source: this.locate(tagStart, this.pos),
      };
    }

    let children: ODNode[];
    if (RAW_TEXT_ELEMENTS.has(tag)) {
      children = this.consumeRawText(tag, id);
    } else {
      children = this.parseNodes(id, 0);
    }

    if (!this.consumeClosingTag(tag)) {
      throw this.error(`Unclosed <${tag}>`, tagStart);
    }
    return {
      kind: 'element',
      id,
      tag,
      attributes: attrs,
      styles,
      children,
      source: this.locate(tagStart, this.pos),
    };
  }

  private consumeRawText(tag: string, parentId: string): ODNode[] {
    const start = this.pos;
    const closeMarker = `</${tag}`;
    const closeAt = indexOfIgnoreCase(this.src, closeMarker, this.pos);
    const end = closeAt === -1 ? this.src.length : closeAt;
    const value = this.src.slice(start, end);
    this.pos = end;
    if (value.length === 0) return [];
    return [
      {
        kind: 'text',
        id: this.deriveId(parentId, '#text', 0, []),
        value,
        source: this.locate(start, end),
      },
    ];
  }

  private consumeClosingTag(tag: string): boolean {
    this.skipWhitespace();
    if (!this.startsWithIgnoreCase(`</${tag}`)) return false;
    this.pos += 2 + tag.length;
    this.skipWhitespace();
    if (this.src[this.pos] !== '>') return false;
    this.pos += 1;
    return true;
  }

  private readTagName(): string {
    const start = this.pos;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === undefined) break;
      if (!isTagNameChar(ch)) break;
      this.pos += 1;
    }
    return this.src.slice(start, this.pos);
  }

  private readAttribute(): [string, string] {
    const nameStart = this.pos;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === undefined || ch === '=' || ch === '>' || ch === '/' || isWhitespace(ch)) break;
      this.pos += 1;
    }
    const name = this.src.slice(nameStart, this.pos);
    if (!name) {
      // Defensive: skip a stray byte to avoid infinite loop on malformed input.
      this.pos += 1;
      return ['', ''];
    }
    this.skipWhitespace();
    if (this.src[this.pos] !== '=') return [name, ''];
    this.pos += 1;
    this.skipWhitespace();
    const quote = this.src[this.pos];
    if (quote === '"' || quote === "'") {
      this.pos += 1;
      const valueStart = this.pos;
      while (this.pos < this.src.length && this.src[this.pos] !== quote) {
        this.pos += 1;
      }
      const value = this.src.slice(valueStart, this.pos);
      if (this.src[this.pos] === quote) this.pos += 1;
      return [name, value];
    }
    const valueStart = this.pos;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === undefined || ch === '>' || ch === '/' || isWhitespace(ch)) break;
      this.pos += 1;
    }
    return [name, this.src.slice(valueStart, this.pos)];
  }

  private skipWhitespace(): void {
    while (this.pos < this.src.length && isWhitespace(this.src[this.pos]!)) this.pos += 1;
  }

  private startsWith(token: string): boolean {
    return this.src.startsWith(token, this.pos);
  }

  private startsWithIgnoreCase(token: string): boolean {
    return this.src.substr(this.pos, token.length).toLowerCase() === token.toLowerCase();
  }

  private locate(start: number, end: number): ODSourceLocation {
    const before = this.src.slice(0, start);
    const lastNewline = before.lastIndexOf('\n');
    const line = (before.match(/\n/g)?.length ?? 0) + 1;
    const column = lastNewline === -1 ? start : start - lastNewline - 1;
    return { start, end, line, column };
  }

  private error(message: string, offset: number): HTMLParseError {
    const loc = this.locate(offset, offset);
    return new HTMLParseError({ message, offset, line: loc.line, column: loc.column });
  }

  private deriveId(
    parentId: string | null,
    tag: string,
    siblingIndex: number,
    orderedAttrKeys: string[],
  ): string {
    const base = `${parentId ?? '~root'}::${tag}::${siblingIndex}::${orderedAttrKeys.join(',')}`;
    const hash = fnv1a(`${this.seed}::${base}`);
    return `od-${hash.toString(36)}`;
  }
}

export function parseInlineStyles(value: string): ODInlineStyles {
  const declarations: ODStyleDeclaration[] = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && isWhitespace(value[i]!)) i += 1;
    if (i >= value.length) break;
    const propStart = i;
    while (i < value.length && value[i] !== ':' && value[i] !== ';') i += 1;
    const property = value.slice(propStart, i).trim();
    if (value[i] !== ':') {
      while (i < value.length && value[i] !== ';') i += 1;
      if (value[i] === ';') i += 1;
      continue;
    }
    i += 1; // skip ':'
    const valStart = i;
    while (i < value.length && value[i] !== ';') i += 1;
    let rawValue = value.slice(valStart, i).trim();
    if (value[i] === ';') i += 1;
    if (!property) continue;
    let important = false;
    if (/!\s*important\s*$/i.test(rawValue)) {
      important = true;
      rawValue = rawValue.replace(/!\s*important\s*$/i, '').trim();
    }
    declarations.push({ property: property.toLowerCase(), value: rawValue, important });
  }
  return { declarations };
}

function isTagStartChar(ch: string | undefined): boolean {
  return ch !== undefined && (/[a-zA-Z!/]/.test(ch));
}

function isTagNameChar(ch: string): boolean {
  return /[a-zA-Z0-9:-]/.test(ch);
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

function indexOfIgnoreCase(haystack: string, needle: string, from: number): number {
  const lower = haystack.toLowerCase();
  return lower.indexOf(needle.toLowerCase(), from);
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
