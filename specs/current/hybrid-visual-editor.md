# Hybrid Visual Editor

**Parent:** [`spec.md`](../../docs/spec.md) · **Related:** [`manual-edit-mode-requirements.md`](manual-edit-mode-requirements.md) · [`architecture-boundaries.md`](architecture-boundaries.md)

## Purpose

Promote Open Design from an HTML/CSS generator with a manual-edit bolt-on into a Figma/Webflow/Framer-class hybrid editor. The user must be able to edit the same artifact from three surfaces that remain in continuous synchronization:

- **Visual** — direct manipulation on the live preview canvas (select, drag, resize, type, change tokens).
- **Code** — read/write the artifact source in a code panel.
- **Prompt** — natural-language instructions to the AI agent.

The product invariant is: a change in any of the three surfaces is observable in the other two within the same frame, without a full file regeneration or a destructive reload.

This document defines the architecture required to hold that invariant. It assumes v1 ships against the existing HTML/CSS artifact pipeline (no new framework or runtime). JSX/React-component scope is deferred — see Non-goals.

## Scope

In scope:

- Single-artifact editing (the active file in the active project).
- HTML/CSS artifacts written by the agent into `.od/projects/<id>/<filename>` (see `apps/daemon/src/projects.ts:10-74`).
- The existing srcDoc preview path in `apps/web/src/components/FileViewer.tsx` (the URL-load path stays unchanged; it remains the read-only fast path).
- The patch types already established in `apps/web/src/edit-mode/types.ts:69-77` (`set-text`, `set-link`, `set-image`, `set-style`, `set-attributes`, `set-outer-html`, `set-full-source`). The hybrid editor extends but does not break those.
- The five existing bridges in `apps/web/src/runtime/srcdoc.ts` (snapshot, deck, selection/comment, inspect, palette, manual-edit). They become consumers of the new AST instead of independent HTML-string mutators.

Out of scope for v1 (see Non-goals for the full list): JSX/React component editing, multi-user collaboration, drag-and-drop layout authoring, auto-layout systems, class-based CSS refactoring, freeform vector editing.

## Current code context

The audit summary that motivates this spec:

- **Source of truth today is the HTML string on disk.** `writeProjectFile` in `apps/daemon/src/projects.ts:10-58` is the only persistence path. There is no structured representation in the daemon, the contracts package, or the web app.
- **Visual edits route through `apps/web/src/edit-mode/sourcePatches.ts:9-53`.** Each patch reparses the entire HTML via `DOMParser`, mutates in-memory, and serializes back. Locating the target uses `data-od-id`/`data-od-runtime-id`/DOM-path heuristics (`apps/web/src/edit-mode/bridge.ts:46-264`). There is no incremental rendering or change-set propagation.
- **No code-editing surface exists.** The closest is the `set-full-source` escape hatch in `manual-edit-mode-requirements.md:278-289`. There is no editor pane, no syntax-aware view, no two-way binding to the canvas.
- **Prompt-driven edits regenerate the whole file.** The agent writes a new artifact via `POST /api/projects/:id/files` (`apps/daemon/src/artifact-create.ts:87-119`); the FileViewer reloads the iframe from the new srcDoc. There is no concept of a scoped patch from the agent.
- **Bridges don't share state.** Palette mutations (`apps/web/src/runtime/srcdoc.ts:209-402`) live in-memory in the iframe; inspect overrides are replayed by `od:inspect-replay` (`apps/web/src/runtime/srcdoc.ts:631-639`) but never persisted. A reload loses the work.
- **Existing patch types are already a usable seed for the AST.** `ManualEditPatch` covers content, links, images, tokens, styles, attributes, outerHTML, and full source. The hybrid editor's diff layer should produce these as its output shape so the daemon write path stays unchanged in v1.

This spec replaces the implicit "HTML string is the model" assumption with an explicit document model that all three modes operate on.

## Conceptual model: the four planes

The hybrid editor introduces four planes. Each plane has a well-defined shape and a single authoritative owner.

```
                      ┌──────────────────────────┐
                      │     Source (file)        │  daemon / disk
                      │     <html>…</html>       │
                      └────────────┬─────────────┘
                                   │  parse / serialize
                                   ▼
                      ┌──────────────────────────┐
                      │      Document (AST)      │  web / DocumentStore
                      │      ODNode tree         │
                      └────────────┬─────────────┘
                ┌──────────────────┼──────────────────┐
                │                  │                  │
                ▼                  ▼                  ▼
        ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
        │   View       │   │   Code       │   │   Prompt     │
        │   (canvas)   │   │   (editor)   │   │   (chat)     │
        └──────────────┘   └──────────────┘   └──────────────┘
```

- **Source plane.** The file on disk. Owned by the daemon. Read via `GET /api/projects/:id/raw/:file`, written via `POST /api/projects/:id/files`. Unchanged from today.
- **Document plane (AST).** A structured representation of the source. Owned by the web app, materialized in a `DocumentStore`. The AST is the hub: visual, code, and prompt surfaces read from it and emit operations against it.
- **View plane.** What the user sees in the canvas iframe. A pure projection of the AST — re-rendered from it, never directly mutated.
- **Code plane.** The textual source shown in the code editor. A pure projection of the AST — produced by serializing the AST, with stable source-mapping back into AST node ids.

The four planes give the invariant a concrete meaning: a change anywhere produces an operation on the AST; the AST notifies its subscribers (view, code, persistence); each subscriber re-projects.

## Document model (the AST)

The AST is HTML/CSS-shaped because the artifacts are HTML/CSS. It is not a virtual DOM in the React sense — it is a persistent, identified, normalized tree.

```ts
type ODNode =
  | ODElementNode
  | ODTextNode
  | ODCommentNode
  | ODDoctypeNode;

interface ODElementNode {
  kind: 'element';
  id: string;                  // stable across edits; survives serialize/parse
  tag: string;                 // lowercase tag name
  attributes: Record<string, string>;
  styles: ODInlineStyles;      // parsed `style=""` declarations
  children: ODNode[];
  source: ODSourceLocation;    // byte range in the current serialized output
  componentRef?: string;       // optional: id into ComponentRegistry
}

interface ODTextNode {
  kind: 'text';
  id: string;
  value: string;
  source: ODSourceLocation;
}

interface ODSourceLocation {
  start: number;  // byte offset in serialized source
  end: number;
  line: number;
  column: number;
}

interface ODInlineStyles {
  declarations: ODStyleDeclaration[];  // ordered, preserves shorthand
}

interface ODStyleDeclaration {
  property: string;
  value: string;
  important: boolean;
  source: ODSourceLocation;
}
```

Rules:

- **Stable ids.** Every node gets a deterministic id on parse. For elements with `data-od-id` the attribute wins; otherwise the id is derived from a content-addressed hash of `tag + structural position + initial attributes`, salted with a per-document seed so two visually identical pages do not collide across runtime.
- **Round-tripping.** `serialize(parse(source))` must equal `source` byte-for-byte for any HTML the agent or the user produces. This is a hard requirement — the code-plane projection depends on it. If the parser must normalize (e.g. void-element self-closing), normalization is applied on first parse and the normalized form becomes the new source.
- **Style parsing.** Inline styles are parsed into structured declarations; `<style>` and external CSS are kept as opaque text nodes in v1 (see Phased plan).
- **Source locations are post-serialize.** They refer to the current AST's serialized form, not the on-disk source. The DocumentStore reconciles them on every applied operation.

The AST lives in `packages/contracts` as pure types (the boundary in `architecture-boundaries.md:42-56` forbids browser/Node-specific APIs in contracts, which is fine — these are TypeScript types only). The parser, serializer, and DocumentStore live in `apps/web/src/document/`.

## The three modes

### Visual mode

Visual mode owns the canvas. It extends the existing manual-edit bridge model (`manual-edit-mode-requirements.md:149-188`) with three additions:

- **Targets are AST node ids, not DOM lookups.** The bridge sends `od-edit-select` carrying the `ODNode.id`; the host resolves it against the DocumentStore. The iframe-side `data-od-id` attribute is rendered from the AST id, not the other way around.
- **Inline editing emits operations, not patches.** A typed text edit produces `Op.setText`; a drag-resize produces `Op.setStyle({ width, height })`. Operations are the input to the diff engine, not the output.
- **The property inspector is component-aware.** When the selected node has a `componentRef`, the inspector renders the component's declared property schema instead of the generic Content/Style/Attributes/Html/Source tabs (those remain available as the universal fallback).

The five existing bridges become AST consumers:

- `injectManualEditBridge` consumes node ids from the DocumentStore.
- `injectPaletteBridge` writes through the DocumentStore (the in-memory hue-shift becomes an operation history, not a transient DOM mutation), so palette changes survive reload.
- `injectSelectionBridge` / `injectInspectBridge` read selection state from the store.
- `injectDeckBridge` and `injectSnapshotBridge` are read-only consumers; no change in shape.

### Code mode

Code mode owns a code panel mounted **as a resizable vertical split next to the canvas** — canvas on the left, code on the right, draggable splitter, both always visible. This deliberately departs from the "one rail mode at a time" pattern of `Preview`/`Edit`/`Comment AI`/`Tweaks`/`Draw`: Code is a *companion* surface, not an exclusive mode, because simultaneous visibility is the whole point of the synchronization invariant. The five rail modes still apply to the canvas pane; the code pane is a separate axis controlled by a show/hide toggle.

It is not a textarea over the raw HTML string; it is a code editor view bound to the DocumentStore via the source-mapping in `ODSourceLocation`.

- **Two-way binding.** Typing in the code editor produces operations against the AST. The visual canvas re-projects in the same frame.
- **Selection mirrors.** Selecting a node in the canvas highlights its byte range in the code editor; placing the cursor in the editor selects the surrounding node in the canvas.
- **Validation gates writes.** A typed change that produces an unparseable AST is held in a draft state — the canvas shows the last-good projection with a warning band, not a broken render. The user can commit the draft (forcing a full reparse and source replacement) or revert.
- **Escape hatch survives.** The existing `set-full-source` semantics (`manual-edit-mode-requirements.md:278-289`) map to "edit, commit draft" in this model. Users who want full-string control can still get it.

Editor library: **CodeMirror 6**. Rationale: bundle weight (~150KB gz vs Monaco's ~3MB) matters for local-first boot and packaged builds; CM6's `EditorState`/`Transaction` model maps cleanly onto `ODDocumentOp` so the DocumentStore stays the source of truth without fighting an editor-owned model; we don't need LSP/IntelliSense for HTML/CSS (the Component Registry covers that surface). The `CodeViewAdapter` interface still exists as a seam — if a later phase needs LSP-grade tooling for JSX, swapping it is a localized refactor.

### Prompt mode

Prompt mode is the AI-assisted edit path. It extends `Comment AI` (`manual-edit-mode-requirements.md:35-45`) with structured operations:

- **The agent emits operations, not full files.** A new contract type `ODDocumentOp` (the same shape the visual and code modes produce) flows from the agent to the daemon to the web app. The DocumentStore applies the operation locally; the daemon serializes the resulting AST and persists.
- **Scoped prompts produce scoped ops.** A `Comment AI` instruction attached to a specific node (`od-comment-target`, today carrying selection metadata) becomes an operation request with `targetId: ODNode.id`. The agent can no longer reply by rewriting unrelated regions.
- **Full regeneration remains a legal op.** `Op.replaceDocument(source)` exists and maps to today's whole-file rewrite. This is the v1 compatibility path for agents that don't yet emit structured ops.

The agent-side contract (`packages/contracts/src/api/document-ops.ts`) declares the operation schema; runtimes that don't speak it fall back to `replaceDocument`.

## Operations and the diff engine

The single shared vocabulary across the three modes is `ODDocumentOp`:

```ts
type ODDocumentOp =
  | { kind: 'set-text'; nodeId: string; value: string }
  | { kind: 'set-attribute'; nodeId: string; name: string; value: string | null }
  | { kind: 'set-style'; nodeId: string; declarations: ODStyleDeclaration[] }
  | { kind: 'insert-node'; parentId: string; index: number; node: ODNode }
  | { kind: 'remove-node'; nodeId: string }
  | { kind: 'move-node'; nodeId: string; newParentId: string; newIndex: number }
  | { kind: 'replace-outer'; nodeId: string; html: string }     // parses to one node
  | { kind: 'replace-document'; source: string };               // escape hatch
```

These map cleanly onto the existing `ManualEditPatch` types in `apps/web/src/edit-mode/types.ts:69-77`. The diff engine's job is the reverse direction:

- **AST-to-AST diff.** Given an old and new AST (e.g. when the daemon broadcasts an out-of-band file change, or the user pastes new source), compute the minimum sequence of ops that transforms one into the other. This is what lets the canvas update without a full re-render and lets the code editor highlight only the changed region.
- **Op composition.** Coalescing a stream of `set-style` ops on the same node in the same frame into one op, so the rendered serialization is computed once.
- **Inverse ops.** Every op carries enough metadata to produce its inverse — undo/redo becomes "apply inverse" instead of full-source snapshots.

Algorithm: a keyed tree diff (Myers-like, but tree-aware) keyed on node ids, with a fallback to structural matching when ids are absent. The implementation lives in `apps/web/src/document/diff.ts`. It must be O(n) in the size of the changed subtree, not O(n) in the size of the document.

## Reactive rendering

The DocumentStore is a typed observable store (Zustand-style subscription with selector + equality function, or signals — implementation choice). Two read patterns:

- **Subtree subscription.** A consumer subscribes to the operations affecting a node id and its descendants. The visual canvas subscribes to the root; smaller widgets (the layer list, the property inspector) subscribe to narrower scopes.
- **Selector subscription.** A consumer subscribes to a derived value (e.g. "all elements where `componentRef === 'button'`"). The store memoizes by op-version, so re-derivation only runs when an op invalidates the selector's read set.

The canvas projection is incremental: applying `Op.setStyle` patches only the affected element's `style` attribute in the iframe, without rebuilding the srcDoc or reloading the iframe. This requires extending the existing manual-edit bridge with an `od-document-op` message channel — the bridge becomes the wire between the DocumentStore and the iframe.

Full srcDoc rebuilds remain the path for `replace-document` and for the initial mount. Targeted ops never trigger a rebuild.

### Op coalescing

Ops are coalesced per animation frame via `requestAnimationFrame`. All ops emitted in the same frame are flushed together: merged into the store, projected to the iframe via one `od-document-op` batch, and serialized once for persistence. The flush boundary is the frame, not an idle debounce — typing produces one op per frame at ~60Hz, which is fine for both render latency and undo granularity.

Rules:

- Multiple ops in the same frame targeting the same node and same op kind collapse into one (e.g. three `set-style` ops on the same node merge their declarations; three `set-text` ops on the same node keep only the latest value).
- Ops targeting different nodes are preserved as a sequence; their order in the frame is the order they're applied.
- Persistence to disk piggybacks on the frame flush: one `POST /api/projects/:id/document/ops` per frame, carrying the coalesced batch.
- Undo history records one entry per frame batch, not per raw op. A user typing "abc" in a text field produces three frames, three batches, three undo steps — acceptable granularity for v1; semantic grouping (one undo per word) is a follow-up if measured friction justifies it.

## Component registry

A `ComponentRegistry` lets the editor recognize meaningful units larger than raw elements. In v1 the registry is small and HTML-flavored: button, link, image, heading, paragraph, list, container, hero, card.

```ts
interface ODComponentDef {
  id: string;                       // 'button', 'hero', …
  match: ODComponentMatch;          // declarative — no executable code
  label: ODLabelExpression;         // template like 'Button: {text}' or '{tag}'
  inspector: ODComponentInspector;  // schema-driven property panel
  produce?: ODNodeTemplate;         // static template for insert-from-palette flows
}

interface ODComponentMatch {
  selector: string;                 // CSS selector (e.g. 'button', 'section.hero')
  requires?: ODChildPredicate[];    // structural requirements ('has child h1', etc.)
  attributes?: Record<string, string | RegExp>;  // attribute predicates
}

interface ODComponentInspector {
  groups: ODInspectorGroup[];
}

interface ODInspectorGroup {
  title: string;
  fields: ODInspectorField[];
}

type ODInspectorField =
  | { kind: 'text'; label: string; bind: NodeBinding }
  | { kind: 'color'; label: string; bind: StyleBinding; var?: string }
  | { kind: 'select'; label: string; bind: AttributeBinding; options: string[] }
  | { kind: 'slider'; label: string; bind: StyleBinding; min: number; max: number; unit: string }
  | ...;
```

Registration:

- **Declarative-only across the board.** Built-in defs and plugin defs use the same `ODComponentMatch` shape; neither can ship executable matchers. This removes the need for a plugin sandbox and keeps inspector resolution deterministic and serializable.
- **Built-in defs.** Ship with the web app in `apps/web/src/document/components/` as `*.def.json` (loaded at build time).
- **Extension point.** Third-party defs are loaded from the existing plugin surface (`apps/web/src/state/projects.ts:installPluginSource`). Plugins declare a `components.json` carrying one or more `ODComponentDef` objects.
- **Match resolution.** Definitions are ordered; the first match wins. The fallback is a synthetic "element" def that renders the generic Content/Style/Attributes/Html/Source tabs from `manual-edit-mode-requirements.md:189-289`.
- **Limitation accepted.** Patterns that can't be expressed by selector + structural + attribute predicates (e.g. "is a card only if children sum to N visible nodes") are deferred. If a real need surfaces, the path is to extend `ODComponentMatch` with new declarative predicates, not to open an executable escape hatch.

A node's resolved `componentRef` is recomputed on parse and on every op that changes its tag/attributes. The result is cached on the node.

The property inspector is rendered from the matched def's `inspector` schema. It is not a hand-written React tree per component — it is a generic renderer driven by `ODInspectorField` discriminated unions. New components add a schema, not a UI.

## Boundary placement

The hybrid editor introduces three new modules. Their placement follows `architecture-boundaries.md`:

- `packages/contracts/src/document/`
  - `ODNode`, `ODDocumentOp`, `ODSourceLocation`, `ODComponentDef` types (pure TS).
  - DTOs for `POST /api/projects/:id/document/ops` (the structured-edit endpoint).
- `apps/web/src/document/`
  - `parse.ts`, `serialize.ts`, `diff.ts` (HTML parser/serializer/diff).
  - `store.ts` (DocumentStore + subscriptions).
  - `registry.ts` (ComponentRegistry).
  - `components/` (built-in definitions).
  - `views/code/` (code editor adapter).
- `apps/daemon/src/document/`
  - `apply-ops.ts` (server-side op application for the prompt path — the agent emits ops, the daemon applies and writes the file).
  - Routes added to an existing `apps/daemon/src/project-routes.ts` (no new top-level route file unless surface area exceeds two endpoints).

The daemon never holds the AST as long-lived state. It parses on op application, applies, serializes, writes. The web app's DocumentStore is the only authoritative AST.

## CLI surface

Per the dual-track rule in `AGENTS.md` ("Capability exposure (UI/CLI dual-track)"), the structured-edit endpoint needs a CLI peer:

- `od document parse --file <path> --json` — parse and emit the AST.
- `od document apply --file <path> --op <op.json>` — apply a single op, write back.
- `od document diff --from <path> --to <path>` — emit the op sequence.

These ship in the same PR as the daemon endpoints; the issue-first rule applies because the feature is non-trivial.

## Migration from current state

The existing manual-edit pipeline (`manual-edit-mode-requirements.md`) is the foundation. Migration is additive:

1. Introduce the parser/serializer/AST under `apps/web/src/document/` alongside the existing edit-mode helpers. The current `applyManualEditPatch` (`apps/web/src/edit-mode/sourcePatches.ts:9-53`) is reimplemented as a thin adapter that converts `ManualEditPatch` to `ODDocumentOp` and routes through the new store. No behavior change for users.
2. Replace the iframe srcDoc rebuild path with incremental op-driven updates. The bridge gains an `od-document-op` message; the host stops calling `buildSrcdoc` for content/style/attribute changes.
3. Add the code-editor panel as an opt-in mode in `FileViewer` alongside the existing `Preview`/`Edit`/`Comment AI`/`Tweaks`/`Draw` rail (`manual-edit-mode-requirements.md:74-80`).
4. Extend `Comment AI` to accept structured ops from the agent. The full-source fallback remains.
5. Open the `ComponentRegistry` to plugins.

Each step keeps the previous behaviors working, so the spec ships in slices.

## Phased plan

### Phase 1: Document plane and visual-mode parity

Deliver:

- HTML parser and serializer with round-trip guarantee.
- DocumentStore with subtree subscriptions.
- AST-to-op diff engine.
- `ManualEditPatch` → `ODDocumentOp` adapter; existing manual-edit UI unchanged.
- Iframe bridge extension for `od-document-op` (incremental updates, no srcDoc rebuild for in-tree edits).

Exit criteria:

- Every existing manual-edit interaction continues to work, with no visible iframe reloads on content/style/attribute changes.
- Palette changes survive a project reopen (because the ops are persisted to source via the store, not just to in-memory DOM).
- Undo/redo runs against op history instead of full-source snapshots.

### Phase 2: Code mode

Deliver:

- Code editor adapter and `CodeViewAdapter` interface.
- Two-way binding: cursor ↔ selection, keystroke → op, op → highlight.
- Draft state for unparseable in-progress edits.
- Layout integration in `FileViewer` (split, tabbed, or behind-the-canvas — TBD in a design pass before this phase starts).

Exit criteria:

- A user can type in the code editor and watch the canvas update without iframe reload.
- A user can click in the canvas and the code editor scrolls to and highlights the node.
- A typed syntax error does not break the canvas projection.

### Phase 3: Component registry and inspector framework

Deliver:

- `ODComponentDef` types in `packages/contracts/src/document/`.
- Built-in component set (button, link, image, heading, paragraph, list, container, hero, card).
- Schema-driven property inspector renderer.
- Replace the static `Content/Style/Attributes/Html/Source` tabs with the registry-driven inspector for matched components; keep them as the fallback for unmatched elements.

Exit criteria:

- Selecting a button in the canvas opens a button-shaped inspector (label, variant, link, icon, color, size — not a generic Style tab).
- A plugin can register a new component def and its inspector schema, and the new component appears in the inspector without web app code changes.

### Phase 4: Prompt mode as structured ops

Deliver:

- `ODDocumentOp` contract on `POST /api/projects/:id/document/ops`.
- `Comment AI` flow emits target-scoped operation requests; agent runtimes that understand the contract apply scoped changes.
- Full-document regeneration remains as `Op.replaceDocument` (compatibility path).

Exit criteria:

- A scoped `Comment AI` instruction to a button produces a `set-text` or `set-style` op against that button only — unrelated regions of the file are not touched.
- An agent that emits `replace-document` still works (no regression for runtimes that haven't upgraded).

### Phase 5: Robustness and CLI

Deliver:

- `od document parse|apply|diff` CLI subcommands.
- Op stream observability (a developer-facing "ops timeline" panel, useful for debugging).
- Validation rules for ops at the daemon boundary (reject ops with unknown node ids, reject malformed `set-attribute` names, etc.).
- Op-stream tests in `apps/web/tests/` and `apps/daemon/tests/`.

Exit criteria:

- All three modes round-trip a 500-element artifact through 200 ops without drift between AST and serialized source.
- The CLI peer is callable from an external agent and produces the same result as the UI.

## Non-goals for v1

- JSX/React component editing. The AST is HTML/CSS-shaped; component editing means recognizing patterns in HTML, not parsing JSX.
- A separate framework-neutral document model (e.g. a JSON schema that renders to HTML or React or native). Defer until a second renderer target genuinely exists.
- Drag-and-drop layout authoring beyond resize/reposition of already-placed elements.
- Auto-layout (Figma-style constraints) and freeform vector tools.
- Multi-user real-time collaboration. The DocumentStore is single-client; the daemon does not broadcast op streams between clients.
- Class-based CSS refactoring (extracting inline styles into classes). The escape hatch (`set-full-source`) is the only way to do this in v1.
- A bespoke code editor. Use an existing library (CodeMirror or Monaco).
- AI agent calls from visual mode. Visual mode does not invoke the agent; `Comment AI` remains the only AI-assisted edit path, per `manual-edit-mode-requirements.md:33`.

## Resolved decisions

These were open at first draft and have been resolved:

- **Code-pane layout — split vertical, 50/50, draggable splitter.** Canvas and code are both always visible; the code pane is a companion surface, not a rail mode. Captured in the Code mode section above.
- **CSS-in-`<style>` handling — opaque in v1.** `<style>` blocks stay as opaque text nodes. Visual edits route through inline styles. Trade-off accepted: edits to class-defined styles require the source escape hatch. The AST reserves `kind: 'style-rule'` in the schema so a future parse-and-edit phase doesn't break existing documents.
- **Op coalescing — per animation frame.** Specified in the Op coalescing subsection above. Semantic (word-level) grouping deferred until measured friction justifies it.
- **Plugin component defs — declarative only.** No executable `match`/`produce` functions in plugin defs; same constraint applies to built-in defs for consistency. Removes the need for a plugin sandbox and keeps inspector resolution serializable. Captured in the Component registry section above.
- **Editor library — CodeMirror 6.** Bundle weight (~150KB gz vs Monaco's ~3MB) matters for local-first boot; CM6's `EditorState`/`Transaction` model maps onto `ODDocumentOp` cleanly; we don't need LSP/IntelliSense. The `CodeViewAdapter` interface keeps the choice reversible if a later phase needs LSP-grade tooling.

## Open questions

(None at the time of writing — all initial design questions are resolved above. Implementation questions specific to each phase belong in that phase's tracking issue.)

## Acceptance checklist

- [ ] HTML parse/serialize round-trips byte-for-byte for all existing artifacts in `e2e/fixtures/`.
- [ ] DocumentStore subscriptions notify only the subtree affected by an op.
- [ ] Existing manual-edit interactions go through the new store without UI regressions.
- [ ] Palette changes persist across project reload.
- [ ] Code mode and visual mode mirror selection in both directions.
- [ ] A syntax error in code mode does not break the canvas.
- [ ] Component registry exposes a schema-driven inspector for the built-in set.
- [ ] A plugin can register a new component def and inspector schema.
- [ ] `Comment AI` produces a scoped op when given a node-targeted instruction.
- [ ] `od document parse|apply|diff` CLI subcommands exist and match the UI behavior.
- [ ] The dual-track rule passes: every new capability has a web surface and a CLI surface.
- [ ] No new direct HTML-string mutation paths in `apps/web` outside the document module.
