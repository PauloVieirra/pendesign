export type ManualEditKind = 'text' | 'link' | 'image' | 'container' | 'token';

export interface ManualEditRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManualEditFields {
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
}

export interface ManualEditStyles {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  color: string;
  textAlign: string;
  lineHeight: string;
  letterSpacing: string;
  width: string;
  height: string;
  minHeight: string;
  gap: string;
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  backgroundColor: string;
  backgroundImage: string;
  opacity: string;
  padding: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  margin: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  border: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderStyle: string;
  borderColor: string;
  borderRadius: string;
}

export interface ManualEditTarget {
  id: string;
  kind: ManualEditKind;
  label: string;
  tagName: string;
  className: string;
  text: string;
  rect: ManualEditRect;
  fields: ManualEditFields;
  attributes: Record<string, string>;
  styles: ManualEditStyles;
  isLayoutContainer: boolean;
  outerHtml: string;
}

export type ManualEditPatch =
  | { id: string; kind: 'set-text'; value: string }
  | { id: string; kind: 'set-link'; text: string; href: string }
  | { id: string; kind: 'set-image'; src: string; alt: string }
  | { kind: 'set-token'; token: string; value: string }
  | { id: string; kind: 'set-style'; styles: Partial<ManualEditStyles> }
  | { id: string; kind: 'set-attributes'; attributes: Record<string, string> }
  | { id: string; kind: 'set-outer-html'; html: string }
  | { id: string; kind: 'delete-element' }
  | { id: string; kind: 'clone-element-after' }
  | { id: string; kind: 'insert-sibling-after'; html: string }
  | { id: string; kind: 'move-element-up' }
  | { id: string; kind: 'move-element-down' }
  | { id: string; kind: 'move-before-ref'; referenceId: string }
  | { id: string; kind: 'append-to-parent'; parentId: string }
  | { id: string; kind: 'insert-html-as-child'; parentId: string; html: string }
  | { id: string; kind: 'insert-html-before-ref'; referenceId: string; html: string }
  | { kind: 'set-full-source'; source: string };

export interface ManualEditHistoryEntry {
  id: string;
  label: string;
  patch: ManualEditPatch;
  beforeSource: string;
  afterSource: string;
  createdAt: number;
}

export interface ManualEditTargetMessage {
  type: 'od-edit-targets';
  targets: ManualEditTarget[];
}

export interface ManualEditSelectMessage {
  type: 'od-edit-select';
  target: ManualEditTarget;
}

export interface ManualEditPreviewAppliedMessage {
  type: 'od-edit-preview-style-applied';
  id: string;
  version: number;
  ok: boolean;
  error?: string;
}

export interface ManualEditInlineTextMessage {
  type: 'od-edit-inline-text';
  id: string;
  value: string;
  kind?: 'text' | 'link';
  href?: string;
  /** When the bridge formatted the text via execCommand, the resulting outerHTML
   * contains nested markup (strong/em/etc.) that set-text cannot persist. In
   * that case `outerHtml` is provided and the host routes through set-outer-html. */
  outerHtml?: string;
}

export type ManualEditMediaRequestKind = 'image' | 'icon';
export type ManualEditMediaTarget = 'src' | 'background';

export interface ManualEditMediaRequestMessage {
  type: 'od-edit-media-request';
  id: string;
  mediaKind: ManualEditMediaRequestKind;
  /** Where the new asset should land. `src` swaps the element's src attribute
   * (img/picture/video/audio) or replaces an SVG outerHtml; `background` writes
   * the URL into the element's backgroundImage style. */
  mediaTarget?: ManualEditMediaTarget;
  rect: ManualEditRect;
  currentSrc: string;
  currentAlt: string;
  /** Element tag in lowercase — lets the host route picture/video/audio
   * sources to a deeper editor without re-running heuristics on the source. */
  tagName?: string;
  /** Full outerHTML so the host can read <source> children and rebuild the
   * markup when the user edits multiple sources at once. Optional because
   * background-image and small img swaps don't need it. */
  outerHtml?: string;
}

export interface ManualEditInlineLinkActiveMessage {
  type: 'od-edit-inline-link-active';
  id: string;
  rect: ManualEditRect;
  href: string;
}

export interface ManualEditInlineEndMessage {
  type: 'od-edit-inline-end';
}

export type ManualEditColorTarget = 'text' | 'background' | 'color';

export interface ManualEditColorRequestMessage {
  type: 'od-edit-color-request';
  id: string;
  rect: ManualEditRect;
  colorTarget: ManualEditColorTarget;
  /** Initial color the host should preselect — six-digit lowercase hex. */
  currentColor: string;
}

export interface ManualEditSourceRequestMessage {
  type: 'od-edit-source-request';
  id: string;
  rect: ManualEditRect;
  currentSrc: string;
  currentSrcset: string;
  currentType: string;
}

export interface ManualEditStructuralActionMessage {
  type: 'od-edit-structural-action';
  id: string;
  action: 'clone' | 'delete' | 'add-sibling-li' | 'move-up' | 'move-down' | 'move-before-ref' | 'append-to-parent';
  /** Required for move-before-ref. The element being moved (`id`) lands
   * immediately before this sibling in the reference's current parent. */
  referenceId?: string;
  /** Required for append-to-parent. The element being moved (`id`) becomes
   * the last child of this parent. */
  parentId?: string;
}

export interface ManualEditResizeCommitMessage {
  type: 'od-edit-resize-commit';
  id: string;
  styles: Partial<ManualEditStyles>;
}

export interface ManualEditFormatColorRequestMessage {
  type: 'od-edit-format-color-request';
  rect: ManualEditRect;
  currentColor: string;
}

// Bridge → host. The host posts 'od-edit-request-snapshot' { requestId }
// when a structural patch couldn't find its target in the source HTML
// (typical for single-file SPAs). The bridge replies with this message
// carrying a cleaned-up clone of the body so the host can do a
// snapshot-replace on disk.
export interface ManualEditSnapshotResponseMessage {
  type: 'od-edit-snapshot-response';
  requestId: string;
  bodyHtml: string;
}

export type InsertToolKind = 'text' | 'shape';

export interface ManualEditInsertArmMessage {
  type: 'od-edit-insert-arm';
  tool: InsertToolKind;
}

export interface ManualEditInsertDisarmMessage {
  type: 'od-edit-insert-disarm';
}

export interface ManualEditInsertCommitMessage {
  type: 'od-edit-insert-commit';
  tool: InsertToolKind;
  /** `data-od-id` of the container, or `'__body__'` for the document body
   * (matches the drag-and-drop containerId convention in the bridge). */
  containerId: string;
  /** `data-od-id` of the sibling to insert before; `null` means append as
   * the last child of `containerId`. */
  insertBefore: string | null;
}

export interface ManualEditInsertDisarmedMessage {
  type: 'od-edit-insert-disarmed';
  /** Why the bridge auto-disarmed: `'commit'` after a successful insert,
   * `'escape'` after the user pressed Esc inside the iframe. */
  reason: 'commit' | 'escape';
}

export type ManualEditBridgeMessage =
  | ManualEditTargetMessage
  | ManualEditSelectMessage
  | ManualEditPreviewAppliedMessage
  | ManualEditInlineTextMessage
  | ManualEditMediaRequestMessage
  | ManualEditInlineLinkActiveMessage
  | ManualEditInlineEndMessage
  | ManualEditColorRequestMessage
  | ManualEditSourceRequestMessage
  | ManualEditStructuralActionMessage
  | ManualEditFormatColorRequestMessage
  | ManualEditResizeCommitMessage
  | ManualEditSnapshotResponseMessage
  | ManualEditInsertCommitMessage
  | ManualEditInsertDisarmedMessage;

export const MANUAL_EDIT_STYLE_PROPS: readonly (keyof ManualEditStyles)[] = [
  'fontFamily', 'fontSize', 'fontWeight', 'color', 'textAlign', 'lineHeight', 'letterSpacing',
  'width', 'height', 'minHeight',
  'gap', 'flexDirection', 'justifyContent', 'alignItems',
  'backgroundColor', 'backgroundImage', 'opacity',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle', 'borderColor', 'borderRadius',
];

export function emptyManualEditStyles(): ManualEditStyles {
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    acc[key] = '';
    return acc;
  }, {} as ManualEditStyles);
}
