// Discovery selector for the visual editing picker. Casts a wide net so
// every reasonable element on screen is individually targetable: list
// items, table cells, form controls, inline styling tags, SVG primitives,
// figures, blockquotes, code blocks, headings 4-6, etc. The picker still
// honors `meaningful` filtering (visible bounding box) — this selector
// just expands the set of nodes that COULD be picked when they pass that
// gate, so the user gets atomic-level control instead of being stuck on
// the handful of "obvious" containers.
export const MANUAL_EDIT_DISCOVERY_SELECTOR = [
  // Top-level layout
  'main', 'nav', 'section', 'article', 'header', 'footer', 'aside', 'dialog',
  // Generic containers
  'div', 'figure', 'figcaption', 'blockquote',
  // Text blocks
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre',
  // Lists + tables
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  // Interactive
  'a', 'button', 'label', 'input', 'select', 'textarea', 'option',
  // Inline + media
  'span', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'code', 'kbd', 'samp', 'time', 'abbr', 'sub', 'sup',
  'img', 'picture', 'video', 'audio', 'iframe',
  // SVG primitives — lets the picker land on individual icons / paths
  'svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use', 'symbol',
].join(', ');
export const MANUAL_EDIT_SOURCE_PATH_ATTR = 'data-od-source-path';
export const MANUAL_EDIT_HOST_NODE_SELECTOR = [
  '[data-od-sandbox-shim]',
  '[data-od-deck-bridge]',
  '[data-od-comment-bridge]',
  '[data-od-edit-bridge]',
  '[data-od-comment-bridge-style]',
  '[data-od-edit-bridge-style]',
  '[data-od-deck-fix]',
].join(',');

export function manualEditDomPathForElement(el: Element): string {
  const parts: number[] = [];
  let node: Element | null = el;
  while (node && node !== node.ownerDocument.body) {
    const parentEl: Element | null = node.parentElement;
    if (!parentEl) break;
    const children = Array.from(parentEl.children).filter((child) => !isManualEditHostNode(child));
    parts.unshift(children.indexOf(node));
    node = parentEl;
  }
  return parts.length ? `path-${parts.join('-')}` : '';
}

export function isManualEditHostNode(el: Element): boolean {
  return el.matches(MANUAL_EDIT_HOST_NODE_SELECTOR);
}

export function manualEditStableIdForElement(el: Element): string {
  const explicit = el.getAttribute('data-od-id');
  if (explicit) return explicit;
  const generated = el.getAttribute(MANUAL_EDIT_SOURCE_PATH_ATTR) || el.getAttribute('data-od-runtime-id') || manualEditDomPathForElement(el);
  if (generated) el.setAttribute('data-od-runtime-id', generated);
  return generated || 'unknown';
}

export function isMeaningfulManualEditElement(el: Element, rect: Pick<DOMRect, 'width' | 'height'>): boolean {
  return isSourceMappableManualEditElement(el) && el.matches(MANUAL_EDIT_DISCOVERY_SELECTOR) && rect.width >= 4 && rect.height >= 4;
}

export function isSourceMappableManualEditElement(el: Element): boolean {
  return el.hasAttribute('data-od-id') || el.hasAttribute(MANUAL_EDIT_SOURCE_PATH_ATTR);
}

// Tags that the inline editor accepts for direct text editing. The element
// must also have no element children (textContent-only) — that keeps the
// commit safe to send through the `set-text` patch, which rejects nodes with
// nested markup. Containers (section/article/div/...) are intentionally
// excluded: editing a whole section's text inline would collapse its child
// structure.
const MANUAL_EDIT_INLINE_TEXT_TAGS = [
  'a','button','label','span','strong','em','b','i','u','s','small','mark','code','kbd','samp','time','abbr','sub','sup',
  'p','h1','h2','h3','h4','h5','h6','blockquote','figcaption','li','dt','dd','th','td','caption',
].join(',');

export function buildManualEditBridge(enabled: boolean): string {
  return `<script data-od-edit-bridge>(function(){
  function odbg(){ try { console.log.apply(console, ['[od-edit]'].concat([].slice.call(arguments))); } catch(e){} }
  var enabled = ${JSON.stringify(enabled)};
  var discoverySelector = ${JSON.stringify(MANUAL_EDIT_DISCOVERY_SELECTOR)};
  var inlineTextSelector = ${JSON.stringify(MANUAL_EDIT_INLINE_TEXT_TAGS)};
  var hostNodeSelector = ${JSON.stringify(MANUAL_EDIT_HOST_NODE_SELECTOR)};
  var sourcePathAttr = ${JSON.stringify(MANUAL_EDIT_SOURCE_PATH_ATTR)};
  var styleProps = ['fontFamily','fontSize','fontWeight','color','textAlign','lineHeight','letterSpacing','width','height','minHeight','gap','flexDirection','justifyContent','alignItems','backgroundColor','backgroundImage','opacity','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','border','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle','borderColor','borderRadius'];
  var BACKGROUND_HOST_TAGS = 'section,main,nav,article,header,footer,aside,div,figure,a,button';
  function isHostNode(el){
    return !!(el && el.matches && el.matches(hostNodeSelector));
  }
  function domPath(el){
    var parts = [];
    var node = el;
    while (node && node !== document.body) {
      var parent = node.parentElement;
      if (!parent) break;
      var children = Array.prototype.slice.call(parent.children).filter(function(child){ return !isHostNode(child); });
      parts.unshift(children.indexOf(node));
      node = parent;
    }
    return parts.length ? 'path-' + parts.join('-') : '';
  }
  function stableId(el){
    var explicit = el.getAttribute('data-od-id');
    if (explicit) return explicit;
    var generated = el.getAttribute(sourcePathAttr) || el.getAttribute('data-od-runtime-id') || domPath(el);
    if (generated) el.setAttribute('data-od-runtime-id', generated);
    return generated || 'unknown';
  }
  function isSourceMappable(el){
    // Every visible element can be mapped back to the source: explicit
    // annotations (data-od-id, data-od-source-path) win; otherwise the
    // bridge generates and pins a data-od-runtime-id based on the DOM
    // path. Without this, unannotated artifacts collapsed the picker to
    // nothing — atomic-level editing requires the gate to admit anything
    // with an element shape.
    if (!el || !el.hasAttribute) return false;
    return el.hasAttribute('data-od-id')
        || el.hasAttribute(sourcePathAttr)
        || el.hasAttribute('data-od-runtime-id')
        || !!domPath(el);
  }
  function isDiscoveryTarget(el){
    return !!(el && el.matches && el.matches(discoverySelector));
  }
  function isPrimaryTarget(el){
    if (!el || !el.hasAttribute) return false;
    if (el.hasAttribute('data-od-id') || el.hasAttribute('data-od-edit')) return true;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    return tag === 'a' || tag === 'button';
  }
  function inferKind(el){
    var explicit = el.getAttribute('data-od-edit');
    if (explicit) return explicit;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'a') return 'link';
    if (tag === 'img') return 'image';
    if (['section','main','nav','div','article','header','footer'].indexOf(tag) >= 0) return 'container';
    return 'text';
  }
  function labelFor(el, id, kind){
    var explicit = el.getAttribute('data-od-label');
    if (explicit) return explicit;
    var tag = el.tagName ? el.tagName.toLowerCase() : 'element';
    var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) return text.slice(0, 42);
    if (kind === 'image') return el.getAttribute('alt') || id;
    return tag + ' #' + id;
  }
  function attrsFor(el){
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      if (!attr || attr.name.indexOf('data-od-runtime') === 0 || attr.name === 'data-od-edit-selected') continue;
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }
  function stylesFor(el){
    var computed = window.getComputedStyle(el);
    var styles = {};
    styleProps.forEach(function(prop){ styles[prop] = el.style[prop] || computed[prop] || ''; });
    return styles;
  }
  function isLayoutContainer(el){
    var display = window.getComputedStyle(el).display || '';
    return display.indexOf('flex') >= 0 || display.indexOf('grid') >= 0;
  }
  function targetFrom(el, includeOuterHtml){
    var rect = el.getBoundingClientRect();
    var kind = inferKind(el);
    var id = stableId(el);
    var fields = {};
    if (kind === 'link') {
      fields.text = (el.textContent || '').trim();
      fields.href = el.getAttribute('href') || '';
    } else if (kind === 'image') {
      fields.src = el.getAttribute('src') || '';
      fields.alt = el.getAttribute('alt') || '';
    } else {
      fields.text = (el.textContent || '').trim();
    }
    return {
      id: id,
      kind: kind,
      label: labelFor(el, id, kind),
      tagName: el.tagName ? el.tagName.toLowerCase() : 'element',
      className: typeof el.className === 'string' ? el.className : '',
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 180),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      fields: fields,
      attributes: attrsFor(el),
      styles: stylesFor(el),
      isLayoutContainer: isLayoutContainer(el),
      outerHtml: includeOuterHtml ? (el.outerHTML || '').replace(/\\sdata-od-runtime-id="[^"]*"/g, '').replace(/\\sdata-od-source-path="[^"]*"/g, '').replace(/\\sdata-od-edit-selected="[^"]*"/g, '') : ''
    };
  }
  function allTargets(){
    var nodes = document.body ? document.body.querySelectorAll(discoverySelector) : [];
    var targets = [];
    for (var i = 0; i < nodes.length; i++) {
      var rect = nodes[i].getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      if (!isSourceMappable(nodes[i])) continue;
      targets.push(targetFrom(nodes[i], false));
    }
    return targets;
  }
  function postTargets(){
    if (!enabled) return;
    window.parent.postMessage({ type: 'od-edit-targets', targets: allTargets() }, '*');
  }
  // CSS-only neutralising is not enough: pages using the Web Animations
  // API directly (Framer Motion, GSAP, anime.js) or rAF-driven keyframe
  // updates do not honour our animation-duration override. Walking
  // document.getAnimations() and calling .finish() on each is the safe
  // cross-library kill switch. We run it on a short interval while
  // static-preview is on so animations spawned after the initial pass
  // (interaction-triggered, scroll-triggered, mutation-spawned) also
  // get caught.
  var staticPreviewHalterTimer = null;
  function finishAllAnimations(){
    try {
      if (typeof document.getAnimations !== 'function') return;
      var list = document.getAnimations();
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        var infinite = false;
        try {
          if (a.effect && typeof a.effect.getComputedTiming === 'function') {
            var t = a.effect.getComputedTiming();
            if (t && t.iterations === Infinity) infinite = true;
          }
        } catch(_) {}
        try {
          // finish() snaps finite animations to their end frame.
          // For Infinity iterations finish() throws InvalidStateError,
          // so cancel() instead (drops the animation, element returns
          // to its base CSS which the static-preview rule then
          // overrides to keep visible / static).
          if (infinite) a.cancel();
          else a.finish();
        } catch(_) {
          try { a.cancel(); } catch(__) {}
        }
      }
    } catch(_) {}
  }
  function startStaticPreviewAnimationHalter(){
    if (staticPreviewHalterTimer != null) return;
    finishAllAnimations();
    staticPreviewHalterTimer = window.setInterval(finishAllAnimations, 500);
  }
  function stopStaticPreviewAnimationHalter(){
    if (staticPreviewHalterTimer == null) return;
    window.clearInterval(staticPreviewHalterTimer);
    staticPreviewHalterTimer = null;
  }
  function clearSelectedTarget(){
    var selected = document.querySelectorAll('[data-od-edit-selected]');
    for (var i = 0; i < selected.length; i++) selected[i].removeAttribute('data-od-edit-selected');
  }
  var lastSelectedId = null;
  // Figma-style focus: just the outline + inspector. No floating handles, no
  // padding strips, no drag-to-reparent — those features ate the second click
  // of the dblclick (since they overlay the element edges) and made inline
  // text edit impossible to reach. We keep the data-od-edit-selected attribute
  // and the CSS outline; visual handles are deliberately not rendered here.
  function setSelectedTarget(id){
    if (id && id === lastSelectedId) {
      var existing = findById(id);
      if (existing && existing.getAttribute('data-od-edit-selected') === 'true') return;
    }
    lastSelectedId = id || null;
    clearSelectedTarget();
    if (!id) return;
    var el = findById(id);
    if (el) el.setAttribute('data-od-edit-selected', 'true');
  }
  // Resize handles — floating squares pinned to the right, bottom, and
  // bottom-right corner of the currently selected element. Live in the iframe
  // <body> (host shim attribute keeps them out of source serialization) so
  // they share the same scroll/transform context as the target.
  var resizeHandles = [];
  var RESIZE_HANDLE_SIZE = 10;
  var RESIZE_INELIGIBLE_DISPLAYS = { 'inline': 1, 'contents': 1 };
  function teardownResizeHandles(){
    for (var i = 0; i < resizeHandles.length; i++) {
      var h = resizeHandles[i];
      if (h && h.parentNode) h.parentNode.removeChild(h);
    }
    resizeHandles = [];
  }
  function positionResizeHandle(h, side, rect){
    var s = RESIZE_HANDLE_SIZE;
    var x = window.scrollX, y = window.scrollY;
    // Handles sit fully INSIDE the element's box. If we straddled the edge
    // (right - s/2), elements at the body's right/bottom edge would push the
    // body's scroll area outward, spawn a scrollbar, fire window.resize,
    // trigger postTargets → host re-syncs selection → handles rebuild → and
    // the scrollbar toggles in a feedback loop. Keeping the handles inside
    // the rect avoids that without changing the user's perceived hit target.
    if (side === 'right') {
      h.style.left = (x + rect.right - s) + 'px';
      h.style.top = (y + rect.top + rect.height/2 - s/2) + 'px';
    } else if (side === 'bottom') {
      h.style.left = (x + rect.left + rect.width/2 - s/2) + 'px';
      h.style.top = (y + rect.bottom - s) + 'px';
    } else if (side === 'corner') {
      h.style.left = (x + rect.right - s) + 'px';
      h.style.top = (y + rect.bottom - s) + 'px';
    } else if (side === 'radius') {
      // Position the radius knob inside the top-left corner, offset by the
      // current border-radius so the knob visually sits ON the rounded arc
      // (Figma-style). Clamped to half the smaller side so it stays inside.
      var selEl = document.querySelector('[data-od-edit-selected]');
      var r = selEl ? (parseFloat(window.getComputedStyle(selEl).borderRadius || '0') || 0) : 0;
      var maxOffset = Math.min(rect.width, rect.height) / 2;
      var offset = Math.max(8, Math.min(r || 12, maxOffset));
      h.style.left = (x + rect.left + offset - s/2) + 'px';
      h.style.top = (y + rect.top + offset - s/2) + 'px';
    }
    h.style.width = s + 'px';
    h.style.height = s + 'px';
  }
  function buildResizeHandles(el){
    teardownResizeHandles();
    if (!el || el === document.body || el === document.documentElement) return;
    var display = window.getComputedStyle(el).display || '';
    if (RESIZE_INELIGIBLE_DISPLAYS[display]) return;
    // SVG roots have their own coordinate model — skip rather than fight it.
    if (el.tagName && el.tagName.toLowerCase() === 'svg') return;
    var rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    var sides = [
      { name: 'right', cursor: 'ew-resize', round: false, color: '#2563eb' },
      { name: 'bottom', cursor: 'ns-resize', round: false, color: '#2563eb' },
      { name: 'corner', cursor: 'nwse-resize', round: false, color: '#2563eb' },
      { name: 'radius', cursor: 'nwse-resize', round: true, color: '#f59e0b' },
    ];
    for (var i = 0; i < sides.length; i++) {
      (function(spec){
        var h = document.createElement('div');
        h.setAttribute('data-od-edit-bridge', 'resize-handle');
        h.setAttribute('data-side', spec.name);
        h.style.position = 'absolute';
        h.style.zIndex = '2147483646';
        h.style.background = spec.color;
        h.style.border = '1px solid #fff';
        h.style.borderRadius = spec.round ? '50%' : '2px';
        h.style.boxShadow = '0 1px 3px rgba(0,0,0,0.25)';
        h.style.cursor = spec.cursor;
        h.style.pointerEvents = 'auto';
        h.style.userSelect = 'none';
        positionResizeHandle(h, spec.name, rect);
        h.addEventListener('mousedown', function(downEv){
          downEv.preventDefault();
          downEv.stopPropagation();
          startResizeDrag(el, spec.name, downEv);
        });
        document.body.appendChild(h);
        resizeHandles.push(h);
      })(sides[i]);
    }
  }
  function refreshResizeHandles(){
    if (!resizeHandles.length) return;
    var el = document.querySelector('[data-od-edit-selected]');
    if (!el) { teardownResizeHandles(); return; }
    var rect = el.getBoundingClientRect();
    for (var i = 0; i < resizeHandles.length; i++) {
      var h = resizeHandles[i];
      positionResizeHandle(h, h.getAttribute('data-side'), rect);
    }
    refreshPaddingHandles();
  }
  // Padding overlay — 4 strips sitting along the inner edges of the selected
  // element, showing where the content box starts. Drag a strip in/out to
  // change that side's padding. Strips coexist with resize handles because
  // they're positioned along the edges (not at the midpoint dots).
  var paddingHandles = [];
  function teardownPaddingHandles(){
    for (var i = 0; i < paddingHandles.length; i++) {
      var h = paddingHandles[i];
      if (h && h.parentNode) h.parentNode.removeChild(h);
    }
    paddingHandles = [];
  }
  function readPadding(el){
    var cs = window.getComputedStyle(el);
    return {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
  }
  function positionPaddingHandle(h, side, rect, pad){
    var x = window.scrollX, y = window.scrollY;
    var thickness = 4;
    // Each strip is clamped to live FULLY INSIDE the element's box so it can
    // never push the body's scroll area outward (which would cause the same
    // scrollbar-flicker feedback loop as the resize handles).
    if (side === 'top') {
      h.style.left = (x + rect.left + Math.max(0, pad.left)) + 'px';
      h.style.top = (y + rect.top + Math.max(0, pad.top - thickness/2)) + 'px';
      h.style.width = Math.max(0, rect.width - pad.left - pad.right) + 'px';
      h.style.height = thickness + 'px';
    } else if (side === 'bottom') {
      h.style.left = (x + rect.left + Math.max(0, pad.left)) + 'px';
      h.style.top = (y + rect.bottom - Math.max(thickness, pad.bottom + thickness/2)) + 'px';
      h.style.width = Math.max(0, rect.width - pad.left - pad.right) + 'px';
      h.style.height = thickness + 'px';
    } else if (side === 'left') {
      h.style.left = (x + rect.left + Math.max(0, pad.left - thickness/2)) + 'px';
      h.style.top = (y + rect.top + Math.max(0, pad.top)) + 'px';
      h.style.width = thickness + 'px';
      h.style.height = Math.max(0, rect.height - pad.top - pad.bottom) + 'px';
    } else if (side === 'right') {
      h.style.left = (x + rect.right - Math.max(thickness, pad.right + thickness/2)) + 'px';
      h.style.top = (y + rect.top + Math.max(0, pad.top)) + 'px';
      h.style.width = thickness + 'px';
      h.style.height = Math.max(0, rect.height - pad.top - pad.bottom) + 'px';
    }
  }
  function refreshPaddingHandles(){
    if (!paddingHandles.length) return;
    var el = document.querySelector('[data-od-edit-selected]');
    if (!el) { teardownPaddingHandles(); return; }
    var rect = el.getBoundingClientRect();
    var pad = readPadding(el);
    for (var i = 0; i < paddingHandles.length; i++) {
      var h = paddingHandles[i];
      positionPaddingHandle(h, h.getAttribute('data-side'), rect, pad);
    }
  }
  function buildPaddingHandles(el){
    teardownPaddingHandles();
    if (!el || el === document.body || el === document.documentElement) return;
    var display = window.getComputedStyle(el).display || '';
    if (RESIZE_INELIGIBLE_DISPLAYS[display]) return;
    if (el.tagName && el.tagName.toLowerCase() === 'svg') return;
    var rect = el.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 16) return;
    var pad = readPadding(el);
    var sides = [
      { name: 'top', cursor: 'ns-resize' },
      { name: 'right', cursor: 'ew-resize' },
      { name: 'bottom', cursor: 'ns-resize' },
      { name: 'left', cursor: 'ew-resize' },
    ];
    for (var i = 0; i < sides.length; i++) {
      (function(spec){
        var h = document.createElement('div');
        h.setAttribute('data-od-edit-bridge', 'padding-handle');
        h.setAttribute('data-side', spec.name);
        h.style.position = 'absolute';
        h.style.zIndex = '2147483645';
        h.style.background = 'rgba(34, 197, 94, 0.75)';
        h.style.cursor = spec.cursor;
        h.style.pointerEvents = 'auto';
        h.style.userSelect = 'none';
        positionPaddingHandle(h, spec.name, rect, pad);
        h.addEventListener('mousedown', function(downEv){
          downEv.preventDefault();
          downEv.stopPropagation();
          startPaddingDrag(el, spec.name, downEv);
        });
        document.body.appendChild(h);
        paddingHandles.push(h);
      })(sides[i]);
    }
  }
  function startPaddingDrag(el, side, downEv){
    var startX = downEv.clientX;
    var startY = downEv.clientY;
    var startPad = readPadding(el);
    function onMove(moveEv){
      var dx = moveEv.clientX - startX;
      var dy = moveEv.clientY - startY;
      var next;
      // Pulling the top edge DOWN increases paddingTop (delta = dy). Pulling
      // the bottom edge UP increases paddingBottom (delta = -dy). Symmetric
      // for left/right.
      if (side === 'top') next = Math.max(0, snapResize(startPad.top + dy, moveEv));
      else if (side === 'bottom') next = Math.max(0, snapResize(startPad.bottom - dy, moveEv));
      else if (side === 'left') next = Math.max(0, snapResize(startPad.left + dx, moveEv));
      else next = Math.max(0, snapResize(startPad.right - dx, moveEv));
      var cssName = 'padding' + side.charAt(0).toUpperCase() + side.slice(1);
      el.style[cssName] = next + 'px';
      showResizeMeasure('P-' + side[0].toUpperCase() + ': ' + next + ' px', moveEv.clientX, moveEv.clientY);
      refreshResizeHandles();
    }
    function onUp(){
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      hideResizeMeasure();
      var cssName = 'padding' + side.charAt(0).toUpperCase() + side.slice(1);
      var styles = {};
      styles[cssName] = el.style[cssName];
      window.parent.postMessage({ type: 'od-edit-resize-commit', id: stableId(el), styles: styles }, '*');
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }
  // Floating numeric label that follows the cursor while a resize/radius
  // drag is active. Mounted lazily and torn down on mouseup so it doesn't
  // linger after the gesture ends.
  var resizeMeasureLabel = null;
  function showResizeMeasure(text, clientX, clientY){
    if (!resizeMeasureLabel) {
      resizeMeasureLabel = document.createElement('div');
      resizeMeasureLabel.setAttribute('data-od-edit-bridge', 'resize-measure');
      resizeMeasureLabel.style.position = 'absolute';
      resizeMeasureLabel.style.zIndex = '2147483647';
      resizeMeasureLabel.style.padding = '3px 8px';
      resizeMeasureLabel.style.background = '#1f2937';
      resizeMeasureLabel.style.color = '#fff';
      resizeMeasureLabel.style.borderRadius = '4px';
      resizeMeasureLabel.style.font = '500 11px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif';
      resizeMeasureLabel.style.pointerEvents = 'none';
      resizeMeasureLabel.style.whiteSpace = 'nowrap';
      document.body.appendChild(resizeMeasureLabel);
    }
    resizeMeasureLabel.textContent = text;
    resizeMeasureLabel.style.left = (window.scrollX + clientX + 12) + 'px';
    resizeMeasureLabel.style.top = (window.scrollY + clientY + 12) + 'px';
  }
  function hideResizeMeasure(){
    if (resizeMeasureLabel && resizeMeasureLabel.parentNode) resizeMeasureLabel.parentNode.removeChild(resizeMeasureLabel);
    resizeMeasureLabel = null;
  }
  function snapResize(value, ev){
    // Shift snaps to an 8-px grid (the most common design-system step).
    // No modifier → 1 px precision, matching typical Figma defaults.
    if (ev.shiftKey) return Math.round(value / 8) * 8;
    return Math.round(value);
  }
  // ──────────────────────────────────────────────────────────────────
  // Cross-parent drag-and-drop. mousedown on a selected, source-mappable
  // element starts a custom drag. The bridge computes a "drop plan" each
  // mousemove by hit-testing under the cursor, walking up to find a
  // candidate container, and picking either drop-inside (centre of an
  // empty/eligible container) or sibling-insert (a gap between two
  // children, or before-first / after-last). The indicator is rendered
  // AT THE GAP CENTRE — not on the border of a hit child — so the user
  // sees exactly where the element will land. body is a valid container,
  // so dragging an item out of all wrappers and dropping it between two
  // top-level siblings reparents it to the body root. The dragged
  // element does not actually move in the iframe DOM during the drag;
  // the host applies the patch and re-renders, so the visual move only
  // becomes permanent after the source file is saved.
  // ──────────────────────────────────────────────────────────────────
  var dragState = null;
  var dropIndicator = null;
  var dragJustHappened = false;
  // Containers that visually accept children for drop-inside. Restricting
  // to layout/box-level boxes keeps the centre zone from kicking in on
  // text-only nodes like <p> or <h2> where dropping a card inside makes
  // no sense even though the element technically can have children. body
  // is always allowed as a top-level drop target.
  var DROP_INSIDE_TAGS = { section:1, main:1, nav:1, article:1, header:1, footer:1, aside:1, div:1, figure:1, ul:1, ol:1, dl:1, body:1 };
  function acceptsDropInside(el){
    if (!el || !el.tagName) return false;
    if (el === document.body) return true;
    var tag = el.tagName.toLowerCase();
    if (!DROP_INSIDE_TAGS[tag]) return false;
    var display = window.getComputedStyle(el).display || '';
    if (display === 'inline' || display === 'contents') return false;
    return true;
  }
  function containerFlexAxis(container){
    if (!container) return 'y';
    var cs = window.getComputedStyle(container);
    if ((cs.display || '').indexOf('flex') < 0) return 'y';
    var dir = cs.flexDirection || 'row';
    return (dir === 'row' || dir === 'row-reverse') ? 'x' : 'y';
  }
  function draggableChildrenOf(container, draggedEl){
    var out = [];
    if (!container || !container.children) return out;
    var kids = container.children;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c === draggedEl) continue;
      if (draggedEl && draggedEl.contains && draggedEl.contains(c)) continue;
      if (isHostNode(c)) continue;
      if (!isSourceMappable(c)) continue;
      // Skip elements with zero box (display:none / collapsed) — they would
      // poison the gap math with degenerate rects at (0,0).
      var r = c.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      out.push(c);
    }
    return out;
  }
  function ensureDropIndicator(){
    if (dropIndicator) return dropIndicator;
    var d = document.createElement('div');
    d.setAttribute('data-od-edit-bridge', 'drop-indicator');
    d.style.position = 'absolute';
    d.style.zIndex = '2147483647';
    d.style.pointerEvents = 'none';
    d.style.borderRadius = '2px';
    document.body.appendChild(d);
    dropIndicator = d;
    return d;
  }
  function paintInsidePlan(plan){
    var d = ensureDropIndicator();
    var x = window.scrollX, y = window.scrollY;
    var rect = plan.container.getBoundingClientRect();
    // Outline only — the live-moved element already occupies the slot
    // inside, so we don't need to fill the container.
    d.style.background = 'transparent';
    d.style.border = '2px solid #2563eb';
    d.style.boxShadow = '0 0 0 1px rgba(37, 99, 235, 0.25), inset 0 0 0 1px rgba(255, 255, 255, 0.6)';
    d.style.left = (x + rect.left - 2) + 'px';
    d.style.top = (y + rect.top - 2) + 'px';
    d.style.width = (rect.width + 4) + 'px';
    d.style.height = (rect.height + 4) + 'px';
  }
  function paintSiblingPlan(plan){
    var d = ensureDropIndicator();
    var x = window.scrollX, y = window.scrollY;
    d.style.background = '#2563eb';
    d.style.border = 'none';
    d.style.boxShadow = '0 0 8px rgba(37, 99, 235, 0.75)';
    var thickness = 3;
    // gap.pos = main-axis coordinate of the gap line.
    // gap.crossStart/crossEnd = cross-axis span of the line.
    if (plan.axis === 'x') {
      d.style.top = (y + plan.crossStart) + 'px';
      d.style.height = Math.max(8, plan.crossEnd - plan.crossStart) + 'px';
      d.style.width = thickness + 'px';
      d.style.left = (x + plan.pos - thickness / 2) + 'px';
    } else {
      d.style.left = (x + plan.crossStart) + 'px';
      d.style.width = Math.max(8, plan.crossEnd - plan.crossStart) + 'px';
      d.style.height = thickness + 'px';
      d.style.top = (y + plan.pos - thickness / 2) + 'px';
    }
  }
  function hideDropIndicator(){
    if (dropIndicator && dropIndicator.parentNode) dropIndicator.parentNode.removeChild(dropIndicator);
    dropIndicator = null;
  }
  function elementUnderCursor(clientX, clientY){
    // Hide bridge overlays during hit-testing so the drop indicator /
    // resize handles never absorb the cursor.
    var overlays = document.querySelectorAll('[data-od-edit-bridge]');
    var saved = [];
    for (var i = 0; i < overlays.length; i++) {
      saved.push(overlays[i].style.pointerEvents);
      overlays[i].style.pointerEvents = 'none';
    }
    var hit = document.elementFromPoint(clientX, clientY);
    for (var j = 0; j < overlays.length; j++) overlays[j].style.pointerEvents = saved[j] || 'auto';
    return hit;
  }
  function findDropAnchor(clientX, clientY, draggedEl){
    // Returns the deepest source-mappable element under the cursor
    // (excluding the dragged element and its subtree). If nothing
    // qualifies, falls back to body so dropping in empty space at the
    // top level still works.
    var hit = elementUnderCursor(clientX, clientY);
    while (hit && hit !== document.documentElement) {
      if (hit === document.body) return document.body;
      if (hit !== draggedEl && !(draggedEl.contains && draggedEl.contains(hit)) && isSourceMappable(hit)) return hit;
      hit = hit.parentElement;
    }
    return document.body;
  }
  function gapMetrics(container, children, idx, axis){
    // Builds the rect/coordinates for the gap that sits at insertion
    // index idx (0 = before-first, children.length = after-last).
    var cRect = container.getBoundingClientRect();
    var crossStart = axis === 'x' ? cRect.top : cRect.left;
    var crossEnd = axis === 'x' ? cRect.bottom : cRect.right;
    var pos;
    if (children.length === 0) {
      // empty container: paint a line in the middle on the main axis.
      pos = axis === 'x' ? (cRect.left + cRect.width / 2) : (cRect.top + cRect.height / 2);
    } else if (idx === 0) {
      var r0 = children[0].getBoundingClientRect();
      // Halfway between container edge and first child edge.
      var contEdge = axis === 'x' ? cRect.left : cRect.top;
      var childEdge = axis === 'x' ? r0.left : r0.top;
      pos = (contEdge + childEdge) / 2;
      crossStart = axis === 'x' ? r0.top : r0.left;
      crossEnd = axis === 'x' ? r0.bottom : r0.right;
    } else if (idx === children.length) {
      var rN = children[children.length - 1].getBoundingClientRect();
      var contEdge2 = axis === 'x' ? cRect.right : cRect.bottom;
      var childEdge2 = axis === 'x' ? rN.right : rN.bottom;
      pos = (contEdge2 + childEdge2) / 2;
      crossStart = axis === 'x' ? rN.top : rN.left;
      crossEnd = axis === 'x' ? rN.bottom : rN.right;
    } else {
      var prev = children[idx - 1].getBoundingClientRect();
      var next = children[idx].getBoundingClientRect();
      var prevEdge = axis === 'x' ? prev.right : prev.bottom;
      var nextEdge = axis === 'x' ? next.left : next.top;
      pos = (prevEdge + nextEdge) / 2;
      crossStart = Math.min(axis === 'x' ? prev.top : prev.left, axis === 'x' ? next.top : next.left);
      crossEnd = Math.max(axis === 'x' ? prev.bottom : prev.right, axis === 'x' ? next.bottom : next.right);
    }
    return { pos: pos, crossStart: crossStart, crossEnd: crossEnd };
  }
  function pickClosestGap(clientX, clientY, container, children, axis){
    var cursorMain = axis === 'x' ? clientX : clientY;
    var bestIdx = 0;
    var bestDist = Infinity;
    var bestMetrics = null;
    var limit = children.length;
    for (var i = 0; i <= limit; i++) {
      var m = gapMetrics(container, children, i, axis);
      var dist = Math.abs(cursorMain - m.pos);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
        bestMetrics = m;
      }
    }
    return { idx: bestIdx, metrics: bestMetrics };
  }
  function planForContainer(container, clientX, clientY, draggedEl){
    var children = draggableChildrenOf(container, draggedEl);
    var axis = containerFlexAxis(container);
    // For non-flex containers we default to vertical gap detection (block
    // flow), which lines up with how the user reads the document.
    if (children.length === 0) {
      var cRect = container.getBoundingClientRect();
      return {
        kind: 'inside',
        container: container,
        containerRect: cRect
      };
    }
    var pick = pickClosestGap(clientX, clientY, container, children, axis);
    var insertBefore = pick.idx < children.length ? children[pick.idx] : null;
    return {
      kind: 'sibling',
      container: container,
      insertBefore: insertBefore,
      axis: axis,
      pos: pick.metrics.pos,
      crossStart: pick.metrics.crossStart,
      crossEnd: pick.metrics.crossEnd
    };
  }
  function computeDropPlan(clientX, clientY, draggedEl){
    var anchor = findDropAnchor(clientX, clientY, draggedEl);
    if (!anchor) return null;
    // Decide whether the cursor wants to operate INSIDE anchor or as a
    // sibling AROUND anchor. The rule: if anchor accepts children, treat
    // it as the container. Otherwise back up to anchor.parentElement and
    // use that as the container — the cursor is on a leaf, so the user is
    // asking to slot a sibling near that leaf.
    var container = acceptsDropInside(anchor) ? anchor : (anchor.parentElement || document.body);
    if (!container) return null;
    // Cursor coordinate inside the container's box — if we are outside,
    // clamp so the closest-gap math still resolves to a real edge instead
    // of always picking before-first.
    var plan = planForContainer(container, clientX, clientY, draggedEl);
    if (!plan) return null;
    // Disallow moving an element to a position that is functionally
    // identical to where it already lives (e.g. dragging a card 4px and
    // dropping it back on its own gap). We compute this conservatively by
    // checking against the dragged element's current position.
    if (plan.kind === 'sibling' && plan.insertBefore === draggedEl) plan = null;
    return plan;
  }
  function startDrag(el, downEv){
    var rect = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    dragState = {
      el: el,
      startX: downEv.clientX,
      startY: downEv.clientY,
      cursorOffsetX: downEv.clientX - rect.left,
      cursorOffsetY: downEv.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      borderRadius: cs.borderRadius || '0',
      // The flex shorthand value (e.g. "1 1 0%") drives how the placeholder
      // grows inside a flex container. Without it, an empty <div> falls back
      // to its intrinsic 0×0 box and the surrounding siblings collapse onto
      // it — the drop slot would visibly vanish mid-drag.
      flex: cs.flex || '',
      flexBasis: cs.flexBasis || '',
      flexGrow: cs.flexGrow || '',
      flexShrink: cs.flexShrink || '',
      alignSelf: cs.alignSelf || '',
      margin: cs.margin || '',
      originalParent: el.parentNode,
      originalNextSibling: el.nextSibling,
      moved: false,
      plan: null,
      ghost: null,
      placeholder: null,
      lastMoveSig: null
    };
    document.addEventListener('mousemove', onDragMove, true);
    document.addEventListener('mouseup', onDragUp, true);
    document.addEventListener('keydown', onDragKey, true);
  }
  function installDragVisuals(){
    // Ghost: a clone of the dragged element pinned to the cursor. We use
    // position:fixed + clientX/Y so the ghost never lags behind on scrolled
    // pages, and pointer-events:none so it cannot absorb the hit-test the
    // bridge runs on every mousemove.
    var clone = dragState.el.cloneNode(true);
    if (clone.setAttribute) {
      clone.setAttribute('data-od-edit-bridge', 'drag-ghost');
      clone.removeAttribute('data-od-edit-selected');
      clone.removeAttribute('data-od-runtime-id');
    }
    clone.style.position = 'fixed';
    clone.style.left = (dragState.startX - dragState.cursorOffsetX) + 'px';
    clone.style.top = (dragState.startY - dragState.cursorOffsetY) + 'px';
    clone.style.width = dragState.width + 'px';
    clone.style.height = dragState.height + 'px';
    clone.style.margin = '0';
    clone.style.pointerEvents = 'none';
    clone.style.opacity = '1';
    clone.style.zIndex = '2147483645';
    clone.style.transform = 'rotate(1.2deg)';
    clone.style.transformOrigin = 'top left';
    clone.style.transition = 'transform 120ms ease-out';
    clone.style.boxShadow = '0 20px 50px rgba(15, 23, 42, 0.32), 0 4px 12px rgba(15, 23, 42, 0.22)';
    clone.style.borderRadius = dragState.borderRadius;
    document.body.appendChild(clone);
    dragState.ghost = clone;
    // Placeholder: a hollow drop slot that takes the dragged element's
    // place in the layout. We replace the real element with the placeholder
    // so the user only sees the ghost (under the cursor) plus an empty
    // dashed-blue slot where the drop will land. The placeholder inherits
    // the source element's flex/margin metrics so the surrounding siblings
    // do not visibly reflow when the real element is detached.
    var placeholder = document.createElement('div');
    placeholder.setAttribute('data-od-edit-bridge', 'drag-placeholder');
    placeholder.style.boxSizing = 'border-box';
    placeholder.style.width = dragState.width + 'px';
    placeholder.style.height = dragState.height + 'px';
    placeholder.style.background = 'rgba(37, 99, 235, 0.08)';
    placeholder.style.border = '2px dashed rgba(37, 99, 235, 0.7)';
    placeholder.style.borderRadius = dragState.borderRadius;
    placeholder.style.margin = dragState.margin;
    placeholder.style.transition = 'width 180ms cubic-bezier(0.23, 1, 0.32, 1), height 180ms cubic-bezier(0.23, 1, 0.32, 1)';
    if (dragState.flex) placeholder.style.flex = dragState.flex;
    if (dragState.flexBasis) placeholder.style.flexBasis = dragState.flexBasis;
    if (dragState.flexGrow) placeholder.style.flexGrow = dragState.flexGrow;
    if (dragState.flexShrink) placeholder.style.flexShrink = dragState.flexShrink;
    if (dragState.alignSelf) placeholder.style.alignSelf = dragState.alignSelf;
    // Swap the real element out of the layout — kept aside in JS for Esc
    // cancel restoration, but detached from the document.
    var parent = dragState.originalParent;
    var next = dragState.originalNextSibling;
    if (parent) {
      parent.insertBefore(placeholder, dragState.el);
      parent.removeChild(dragState.el);
    }
    dragState.placeholder = placeholder;
    // Remember whose nextSibling the placeholder lives "before" so cancel
    // can put the original element back in the exact slot.
    dragState.cancelAnchor = next;
    document.documentElement.setAttribute('data-od-dragging', 'true');
  }
  function uninstallDragVisuals(state){
    if (!state) return;
    if (state.ghost && state.ghost.parentNode) state.ghost.parentNode.removeChild(state.ghost);
    state.ghost = null;
    if (state.placeholder && state.placeholder.parentNode) {
      state.placeholder.parentNode.removeChild(state.placeholder);
    }
    state.placeholder = null;
    document.documentElement.removeAttribute('data-od-dragging');
  }
  function applyFlipAnimation(container, oldRects){
    if (!container || !oldRects) return;
    var kids = container.children;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      // Skip overlays. We DO want to animate the placeholder so the user
      // sees the empty drop slot slide into place along with the siblings.
      if (isHostNode(c) && c !== dragState.placeholder) continue;
      var oldRect = oldRects.get(c);
      if (!oldRect) continue;
      var newRect = c.getBoundingClientRect();
      var dx = oldRect.left - newRect.left;
      var dy = oldRect.top - newRect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      c.style.transition = 'none';
      c.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
      void c.offsetWidth;
      c.style.transition = 'transform 220ms cubic-bezier(0.23, 1, 0.32, 1)';
      c.style.transform = '';
    }
  }
  function snapshotContainerRects(container){
    var map = new Map();
    if (!container || !container.children) return map;
    var kids = container.children;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (isHostNode(c) && c !== dragState.placeholder) continue;
      map.set(c, c.getBoundingClientRect());
    }
    return map;
  }
  function applyLivePlan(plan){
    if (!plan || !dragState.placeholder) return;
    var placeholder = dragState.placeholder;
    var currentContainer = placeholder.parentNode;
    var currentNext = placeholder.nextElementSibling;
    var sig;
    if (plan.kind === 'inside' || !plan.insertBefore) {
      sig = 'append:' + (plan.container === document.body ? '__body__' : stableId(plan.container));
      if (currentContainer === plan.container && currentNext === null) return;
    } else {
      sig = 'before:' + stableId(plan.insertBefore);
      if (currentContainer === plan.container && currentNext === plan.insertBefore) return;
    }
    if (dragState.lastMoveSig === sig) return;
    dragState.lastMoveSig = sig;
    var destSnapshot = snapshotContainerRects(plan.container);
    var originSnapshot = currentContainer !== plan.container
      ? snapshotContainerRects(currentContainer)
      : null;
    if (plan.kind === 'inside' || !plan.insertBefore) {
      plan.container.appendChild(placeholder);
    } else {
      plan.container.insertBefore(placeholder, plan.insertBefore);
    }
    applyFlipAnimation(plan.container, destSnapshot);
    if (originSnapshot) applyFlipAnimation(currentContainer, originSnapshot);
  }
  function onDragMove(ev){
    if (!dragState) return;
    var dx = ev.clientX - dragState.startX;
    var dy = ev.clientY - dragState.startY;
    if (!dragState.moved && (Math.abs(dx) + Math.abs(dy)) < 6) return;
    if (!dragState.moved) {
      dragState.moved = true;
      try { window.getSelection && window.getSelection().removeAllRanges(); } catch(_){}
      installDragVisuals();
    }
    document.body.style.cursor = 'grabbing';
    ev.preventDefault();
    if (dragState.ghost) {
      dragState.ghost.style.left = (ev.clientX - dragState.cursorOffsetX) + 'px';
      dragState.ghost.style.top = (ev.clientY - dragState.cursorOffsetY) + 'px';
    }
    var plan = computeDropPlan(ev.clientX, ev.clientY, dragState.el);
    dragState.plan = plan;
    if (!plan) {
      hideDropIndicator();
      return;
    }
    applyLivePlan(plan);
    // The element is now physically at the planned position, so the line
    // indicator would be redundant for sibling drops. We only paint a soft
    // container highlight for drop-inside (otherwise the user has no signal
    // that the parent will be the new container).
    if (plan.kind === 'inside') paintInsidePlan(plan);
    else hideDropIndicator();
  }
  function flashDropIndicator(){
    if (!dropIndicator) return;
    var d = dropIndicator;
    dropIndicator = null;
    d.style.transition = 'opacity 220ms ease-out, transform 220ms ease-out';
    d.style.opacity = '0';
    d.style.transform = 'scale(1.06)';
    setTimeout(function(){
      if (d && d.parentNode) d.parentNode.removeChild(d);
    }, 230);
  }
  function endDrag(commit){
    document.removeEventListener('mousemove', onDragMove, true);
    document.removeEventListener('mouseup', onDragUp, true);
    document.removeEventListener('keydown', onDragKey, true);
    document.body.style.cursor = '';
    var state = dragState;
    dragState = null;
    if (!state) { hideDropIndicator(); return; }
    if (!commit) {
      // Esc cancel — put the real element back where it started (the
      // placeholder is removed by uninstallDragVisuals so we have to slot
      // the element in front of the original next sibling).
      if (state.originalParent) {
        try { state.originalParent.insertBefore(state.el, state.cancelAnchor || state.originalNextSibling); } catch(_){}
      }
      uninstallDragVisuals(state);
      hideDropIndicator();
      return;
    }
    if (!state.moved || !state.plan) {
      // Click-without-drag, or a drag that never resolved a plan: put the
      // element back at its origin so the user does not lose it.
      if (state.originalParent) {
        try { state.originalParent.insertBefore(state.el, state.cancelAnchor || state.originalNextSibling); } catch(_){}
      }
      uninstallDragVisuals(state);
      hideDropIndicator();
      return;
    }
    // Materialise the drop locally: replace the placeholder with the real
    // element so the page paints with the new layout right away. The host
    // patches the source file and the iframe will re-render afterwards;
    // until that arrives, this avoids a one-frame layout flash where the
    // element disappears.
    var placeholderRect = state.placeholder ? state.placeholder.getBoundingClientRect() : null;
    if (state.placeholder && state.placeholder.parentNode) {
      state.placeholder.parentNode.insertBefore(state.el, state.placeholder);
      state.placeholder.parentNode.removeChild(state.placeholder);
      state.placeholder = null;
    }
    if (state.ghost && placeholderRect) {
      state.ghost.style.transition = 'left 180ms cubic-bezier(0.23, 1, 0.32, 1), top 180ms cubic-bezier(0.23, 1, 0.32, 1), transform 180ms ease-out, opacity 180ms ease-out';
      state.ghost.style.left = placeholderRect.left + 'px';
      state.ghost.style.top = placeholderRect.top + 'px';
      state.ghost.style.transform = 'rotate(0deg)';
      state.ghost.style.opacity = '0';
    }
    setTimeout(function(){ uninstallDragVisuals(state); }, 200);
    flashDropIndicator();
    dragJustHappened = true;
    setTimeout(function(){ dragJustHappened = false; }, 200);
    var sourceId = stableId(state.el);
    var plan = state.plan;
    var containerId = plan.container === document.body ? '__body__' : stableId(plan.container);
    if (plan.kind === 'inside' || !plan.insertBefore) {
      window.parent.postMessage({
        type: 'od-edit-structural-action',
        id: sourceId,
        action: 'append-to-parent',
        parentId: containerId,
      }, '*');
      return;
    }
    window.parent.postMessage({
      type: 'od-edit-structural-action',
      id: sourceId,
      action: 'move-before-ref',
      referenceId: stableId(plan.insertBefore),
    }, '*');
  }
  function onDragUp(){ endDrag(true); }
  function onDragKey(ev){
    if (!dragState) return;
    if (ev.key === 'Escape' || ev.keyCode === 27) {
      ev.preventDefault();
      ev.stopPropagation();
      endDrag(false);
    }
  }
  function isBridgeManagedNode(el){
    while (el && el !== document.body) {
      if (el.hasAttribute && el.hasAttribute('data-od-edit-bridge')) return true;
      el = el.parentElement;
    }
    return false;
  }
  function findSelectedDragRoot(target){
    // Walks up from the mousedown target looking for the currently selected
    // element. Drag only starts when the user clicks WITHIN the selection —
    // this keeps the click→select gesture unchanged (clicking an unselected
    // element selects it; the drag affordance is opt-in via a second hold).
    var node = target;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.nodeType === 1 && node.getAttribute && node.getAttribute('data-od-edit-selected') === 'true') {
        return isSourceMappable(node) ? node : null;
      }
      node = node.parentElement;
    }
    return null;
  }
  document.addEventListener('mousedown', function(ev){
    if (!enabled) return;
    if (ev.button !== 0) return;
    if (inlineEditEl) return; // do not interfere with caret positioning
    if (ev.target && isBridgeManagedNode(ev.target)) return; // resize/padding/etc handles own their gestures
    var root = findSelectedDragRoot(ev.target);
    if (!root) return;
    startDrag(root, ev);
  }, true);
  function startResizeDrag(el, side, downEv){
    var startX = downEv.clientX;
    var startY = downEv.clientY;
    var startRect = el.getBoundingClientRect();
    var startW = startRect.width;
    var startH = startRect.height;
    var startRadius = parseFloat(window.getComputedStyle(el).borderRadius || '0') || 0;
    function onMove(moveEv){
      var dx = moveEv.clientX - startX;
      var dy = moveEv.clientY - startY;
      if (side === 'radius') {
        // Diagonal drag (averaged) feels natural for a corner control:
        // outward grows, inward shrinks. Clamped to half the smaller side
        // so the radius never overruns the box and disappears.
        var diag = (dx + dy) / 2;
        var maxR = Math.min(startW, startH) / 2;
        var next = Math.max(0, Math.min(maxR, snapResize(startRadius + diag, moveEv)));
        el.style.borderRadius = next + 'px';
        showResizeMeasure(next + ' px', moveEv.clientX, moveEv.clientY);
      } else {
        if (side === 'right' || side === 'corner') {
          el.style.width = Math.max(8, snapResize(startW + dx, moveEv)) + 'px';
        }
        if (side === 'bottom' || side === 'corner') {
          el.style.height = Math.max(8, snapResize(startH + dy, moveEv)) + 'px';
        }
        var liveRect = el.getBoundingClientRect();
        showResizeMeasure(Math.round(liveRect.width) + ' × ' + Math.round(liveRect.height) + ' px', moveEv.clientX, moveEv.clientY);
      }
      refreshResizeHandles();
    }
    function onUp(){
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      hideResizeMeasure();
      var styles = {};
      if (side === 'radius') styles.borderRadius = el.style.borderRadius;
      else {
        if (side === 'right' || side === 'corner') styles.width = el.style.width;
        if (side === 'bottom' || side === 'corner') styles.height = el.style.height;
      }
      window.parent.postMessage({ type: 'od-edit-resize-commit', id: stableId(el), styles: styles }, '*');
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }
  // Atomic-first picker: prefer the deepest source-mappable element under
  // the cursor, even when an "anchor"-style ancestor (a, button, or any
  // data-od-id node) sits above. The user wants fine-grained control —
  // e.g. clicking a <span class="badge"> inside a <button> should land on
  // the span, not the button. We still walk up if the click landed on a
  // node that isn't source-mappable (raw text, host bridge nodes).
  function closestTarget(event){
    var el = event.target;
    var deepest = null;
    while (el && el.nodeType !== 1) el = el.parentNode;
    while (el && el !== document.documentElement) {
      if (el !== document.body && el !== document.documentElement && isSourceMappable(el) && isDiscoveryTarget(el)) {
        if (!deepest) deepest = el;
      }
      el = el.parentElement;
    }
    return deepest;
  }
  function camelToKebab(name){ return String(name).replace(/[A-Z]/g, function(m){ return '-' + m.toLowerCase(); }); }
  function cssEscapeId(value){ if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value); return String(value).replace(/"/g, '\\\\"'); }
  function findById(id){
    if (!id) return null;
    if (id === '__body__') return document.body;
    var el = document.querySelector('[data-od-id="' + cssEscapeId(id) + '"]')
          || document.querySelector('[data-od-runtime-id="' + cssEscapeId(id) + '"]')
          || document.querySelector('[' + sourcePathAttr + '="' + cssEscapeId(id) + '"]');
    if (el) return el;
    if (typeof id === 'string' && id.indexOf('path-') === 0) {
      var parts = id.slice('path-'.length).split('-').map(function(s){ return Number(s); });
      var node = document.body;
      for (var i = 0; i < parts.length; i++) {
        if (!node) return null;
        var idx = parts[i];
        if (!Number.isInteger(idx) || idx < 0) return null;
        var children = Array.prototype.slice.call(node.children).filter(function(c){ return !isHostNode(c); });
        node = children[idx] || null;
      }
      return node;
    }
    return null;
  }
  function applyPreviewStyles(id, styles, version){
    var el = findById(id);
    if (!el) {
      window.parent.postMessage({ type: 'od-edit-preview-style-applied', id: id || '', version: Number(version) || 0, ok: false, error: 'Target not found' }, '*');
      return;
    }
    var keys = Object.keys(styles || {});
    try {
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = styles[key];
        var cssName = camelToKebab(key);
        if (typeof value !== 'string' || value.trim() === '') el.style.removeProperty(cssName);
        else el.style.setProperty(cssName, value.trim());
      }
      window.parent.postMessage({ type: 'od-edit-preview-style-applied', id: id, version: Number(version) || 0, ok: true }, '*');
    } catch (e) {
      window.parent.postMessage({ type: 'od-edit-preview-style-applied', id: id, version: Number(version) || 0, ok: false, error: e && e.message ? String(e.message) : 'Could not apply preview styles' }, '*');
    }
  }
  // Inline editing — bridge state for the element currently in dblclick
  // contenteditable mode. We snapshot the original textContent so Escape can
  // restore it without round-tripping through the host. While editing is
  // active, the bridge's own click handler suppresses its preventDefault path
  // for clicks INSIDE the editable element, so the user can position the
  // caret normally.
  var inlineEditEl = null;
  var inlineEditOriginal = '';
  var inlineEditOriginalHtml = '';
  var inlineEditId = '';
  var inlineEditKind = 'text';
  var inlineEditHref = '';
  var inlineFormatToolbar = null;
  function isInlineTextCandidate(el){
    if (!el || !el.matches) return false;
    // Reject any element that has element-children (textContent-only is the
    // contract enforced by the set-text patch). A target with nested markup
    // should still be picker-selectable for styles, just not inline-edited.
    var children = el.children;
    for (var i = 0; i < children.length; i++) {
      if (children[i].nodeType === 1) return false;
    }
    // Accept the explicit text tags (the conservative shape that's safe to
    // round-trip through set-text) OR any other discovery target that has
    // text content but no element children. The wider net catches users who
    // use <div>/<section>/etc. as text containers, which the original
    // allow-list rejected and left them unable to enter inline edit at all.
    if (el.matches(inlineTextSelector)) return true;
    if (el.matches(discoverySelector) && (el.textContent || '').trim() !== '') return true;
    return false;
  }
  function closestSvgRoot(el){
    var node = el;
    while (node && node.nodeType === 1) {
      var tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (tag === 'svg') return node;
      node = node.parentElement;
    }
    return null;
  }
  // Color helpers — the picker routes through here when the text-leaf's
  // textContent IS a color literal (hex/rgb/named) and when a container has a
  // visible backgroundColor but no backgroundImage to swap.
  var COLOR_NAME_HEX = {
    black:'#000000', white:'#ffffff', red:'#ff0000', green:'#008000', blue:'#0000ff',
    yellow:'#ffff00', orange:'#ffa500', purple:'#800080', pink:'#ffc0cb', gray:'#808080',
    grey:'#808080', silver:'#c0c0c0', maroon:'#800000', olive:'#808000', lime:'#00ff00',
    aqua:'#00ffff', cyan:'#00ffff', teal:'#008080', navy:'#000080', fuchsia:'#ff00ff', magenta:'#ff00ff'
  };
  function rgbStringToHex(value){
    var m = value.match(/^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
    if (!m) return null;
    function pad(n){ return Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0'); }
    return '#' + pad(m[1]) + pad(m[2]) + pad(m[3]);
  }
  function normalizeColorString(value){
    if (!value) return null;
    var trimmed = String(value).trim().toLowerCase();
    if (/^#([0-9a-f]{6})$/.test(trimmed)) return trimmed;
    if (/^#([0-9a-f]{3})$/.test(trimmed)) {
      var r = trimmed[1], g = trimmed[2], b = trimmed[3];
      return '#' + r + r + g + g + b + b;
    }
    var rgb = rgbStringToHex(trimmed);
    if (rgb) return rgb;
    if (COLOR_NAME_HEX[trimmed]) return COLOR_NAME_HEX[trimmed];
    return null;
  }
  function hasVisibleBackgroundColor(el){
    var color = window.getComputedStyle(el).backgroundColor || '';
    if (!color) return false;
    if (color === 'transparent') return false;
    // rgba with zero alpha reads as fully transparent — skip the picker so the
    // user doesn't get a swatch they can't see while editing.
    var m = color.match(/^rgba\\(\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*([0-9.]+)\\s*\\)$/i);
    if (m && parseFloat(m[1]) === 0) return false;
    return true;
  }
  function teardownFormatToolbar(){
    if (inlineFormatToolbar && inlineFormatToolbar.parentNode) {
      inlineFormatToolbar.parentNode.removeChild(inlineFormatToolbar);
    }
    inlineFormatToolbar = null;
  }
  function elementContainsInlineMarkup(el){
    // True when the contenteditable contains element children (e.g. <strong>,
    // <em>, <u>) — that means execCommand promoted it past plain text and we
    // must commit via set-outer-html to keep the markup.
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 1) return true;
    }
    return false;
  }
  function finishInlineEdit(commit){
    if (!inlineEditEl) return;
    var el = inlineEditEl;
    var id = inlineEditId;
    var original = inlineEditOriginal;
    var originalHtml = inlineEditOriginalHtml;
    var kind = inlineEditKind;
    var href = inlineEditHref;
    inlineEditEl = null;
    inlineEditId = '';
    inlineEditOriginal = '';
    inlineEditOriginalHtml = '';
    inlineEditKind = 'text';
    inlineEditHref = '';
    el.removeEventListener('keydown', onInlineKey, true);
    el.removeEventListener('paste', onInlinePaste, true);
    document.removeEventListener('mousedown', onInlineDocMouseDown, true);
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-od-inline-editing');
    window.parent.postMessage({ type: 'od-edit-inline-end' }, '*');
    var next = (el.textContent || '');
    var nextHtml = el.innerHTML || '';
    if (!commit || (next === original && nextHtml === originalHtml)) {
      el.innerHTML = originalHtml;
      return;
    }
    var payload = { type: 'od-edit-inline-text', id: id, value: next, kind: kind };
    if (kind === 'link') payload.href = href;
    if (elementContainsInlineMarkup(el)) payload.outerHtml = el.outerHTML;
    window.parent.postMessage(payload, '*');
  }
  function onInlineDocMouseDown(ev){
    if (!inlineEditEl) return;
    var target = ev.target;
    if (inlineEditEl.contains && inlineEditEl.contains(target)) return;
    if (inlineFormatToolbar && inlineFormatToolbar.contains && inlineFormatToolbar.contains(target)) return;
    odbg('inline-doc-mousedown commit-fire', { targetTag: target && target.tagName });
    finishInlineEdit(true);
  }
  function onInlineKey(ev){
    if (ev.key === 'Escape') { ev.preventDefault(); finishInlineEdit(false); return; }
    var tagName = inlineEditEl && inlineEditEl.tagName ? inlineEditEl.tagName.toLowerCase() : '';
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      // Enter inside a <li> commits the current text AND asks the host to
      // append an empty sibling <li> so chains-of-list-items feel like a
      // normal editor (Enter → new line item).
      if (tagName === 'li') {
        var liId = inlineEditId;
        finishInlineEdit(true);
        window.parent.postMessage({ type: 'od-edit-structural-action', id: liId, action: 'add-sibling-li' }, '*');
        return;
      }
      finishInlineEdit(true);
      return;
    }
    if (ev.key === 'Backspace' && tagName === 'li') {
      var text = (inlineEditEl && inlineEditEl.textContent || '').trim();
      if (text === '') {
        ev.preventDefault();
        var liId2 = inlineEditId;
        finishInlineEdit(false);
        window.parent.postMessage({ type: 'od-edit-structural-action', id: liId2, action: 'delete' }, '*');
        return;
      }
    }
  }
  function onInlinePaste(ev){
    // Force plaintext paste so the contenteditable element doesn't inherit
    // foreign markup. plaintext-only is widely supported but Firefox treats
    // it the same as true, so we sanitize defensively.
    var text = ev.clipboardData && ev.clipboardData.getData ? ev.clipboardData.getData('text/plain') : '';
    if (!text) return;
    ev.preventDefault();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    sel.deleteFromDocument();
    sel.getRangeAt(0).insertNode(document.createTextNode(text));
    sel.collapseToEnd();
  }
  // Saved selection range — set when the user clicks the format-color
  // button (which would otherwise blur the contenteditable and collapse
  // the selection). Restored when the host posts back the chosen hex.
  var savedFormatRange = null;
  function buildFormatToolbar(el){
    teardownFormatToolbar();
    // The toolbar lives in the iframe document so it can survive scroll and
    // re-anchor itself with absolute positioning relative to <body>. The host
    // shim node attribute keeps it out of source serialization.
    var bar = document.createElement('div');
    bar.setAttribute('data-od-edit-bridge', 'format-toolbar');
    bar.style.position = 'absolute';
    bar.style.zIndex = '2147483647';
    bar.style.display = 'flex';
    bar.style.gap = '2px';
    bar.style.padding = '4px';
    bar.style.background = '#1f2937';
    bar.style.color = '#fff';
    bar.style.borderRadius = '6px';
    bar.style.boxShadow = '0 6px 16px rgba(0,0,0,0.25)';
    bar.style.font = '500 11px/1 system-ui, -apple-system, "Segoe UI", sans-serif';
    bar.style.userSelect = 'none';
    var commands = [
      { cmd: 'bold', label: 'B', style: 'font-weight:700' },
      { cmd: 'italic', label: 'I', style: 'font-style:italic' },
      { cmd: 'underline', label: 'U', style: 'text-decoration:underline' },
      { cmd: 'strikeThrough', label: 'S', style: 'text-decoration:line-through' },
      { cmd: 'color', label: 'A', style: 'border-bottom:2px solid #f59e0b' },
      { cmd: 'removeFormat', label: '×', style: '' },
    ];
    for (var i = 0; i < commands.length; i++) {
      (function(spec){
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = spec.label;
        btn.setAttribute('style', 'min-width:22px;height:22px;padding:0 6px;border:0;border-radius:4px;background:transparent;color:#fff;cursor:pointer;' + spec.style);
        // Prevent the contenteditable from losing focus when clicking the
        // toolbar — mousedown.preventDefault() keeps the caret + selection
        // intact so execCommand applies to the current range.
        btn.addEventListener('mousedown', function(ev){ ev.preventDefault(); });
        btn.addEventListener('click', function(ev){
          ev.preventDefault();
          if (spec.cmd === 'color') {
            var sel = window.getSelection();
            savedFormatRange = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).cloneRange() : null;
            var rect = inlineEditEl ? inlineEditEl.getBoundingClientRect() : bar.getBoundingClientRect();
            window.parent.postMessage({
              type: 'od-edit-format-color-request',
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
              currentColor: '#000000',
            }, '*');
            return;
          }
          try { document.execCommand(spec.cmd, false); } catch(e){}
        });
        bar.appendChild(btn);
      })(commands[i]);
    }
    document.body.appendChild(bar);
    var rect = el.getBoundingClientRect();
    var top = window.scrollY + rect.top - 32;
    if (top < 4) top = window.scrollY + rect.bottom + 6;
    bar.style.top = top + 'px';
    bar.style.left = (window.scrollX + Math.max(rect.left, 4)) + 'px';
    inlineFormatToolbar = bar;
  }
  function startInlineEdit(el){
    odbg('startInlineEdit', { tag: el && el.tagName, id: el && stableId(el) });
    finishInlineEdit(false);
    inlineEditEl = el;
    inlineEditId = stableId(el);
    inlineEditOriginal = el.textContent || '';
    inlineEditOriginalHtml = el.innerHTML || '';
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    inlineEditKind = tag === 'a' ? 'link' : 'text';
    inlineEditHref = tag === 'a' ? (el.getAttribute('href') || '') : '';
    // plaintext-only keeps the contract simple: commit always routes via the
    // set-text patch (no nested markup to round-trip). Selection starts with
    // a caret at the click position — DON'T pre-select the whole text the way
    // a designer-tool would force, since the user explicitly asked for
    // Figma-like behaviour where dblclick puts the caret where you clicked.
    el.setAttribute('contenteditable', 'plaintext-only');
    el.setAttribute('data-od-inline-editing', 'true');
    el.focus();
    el.addEventListener('keydown', onInlineKey, true);
    el.addEventListener('paste', onInlinePaste, true);
    document.addEventListener('mousedown', onInlineDocMouseDown, true);
    if (inlineEditKind === 'link') {
      var rect = el.getBoundingClientRect();
      window.parent.postMessage({
        type: 'od-edit-inline-link-active',
        id: inlineEditId,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        href: inlineEditHref,
      }, '*');
    }
  }
  window.addEventListener('message', function(ev){
    if (!ev.data) return;
    if (ev.data.type === 'od-edit-mode') {
      enabled = !!ev.data.enabled;
      document.documentElement.toggleAttribute('data-od-edit-mode', enabled);
      if (!enabled) { finishInlineEdit(false); clearSelectedTarget(); teardownResizeHandles(); teardownPaddingHandles(); }
      if (enabled) setTimeout(postTargets, 0);
      return;
    }
    // Static-preview signal: host sets this in any side-by-side or
    // inspect-focused view (Edit, Dual code+design) where the user is
    // looking AT the design rather than letting it animate. Drives the
    // CSS that completes finite reveals (opacity 0 to 1 transitions
    // pending IntersectionObserver) so content does not stay hidden when
    // the iframe viewport is constrained and IO never fires.
    if (ev.data.type === 'od-static-preview') {
      // Skip when the state would not change. The bridge in srcdoc.ts
      // observes ALL document mutations to drive od:comment-targets posts,
      // and a redundant toggle on documentElement re-fires that observer
      // even when nothing visible changes. Combined with the host effect
      // that re-posts this message on every srcDoc rebuild, that fed a
      // setLiveCommentTargets -> re-render -> attribute toggle loop and
      // tripped React's "Maximum update depth exceeded" guard.
      var staticWant = !!ev.data.enabled;
      var staticHave = document.documentElement.hasAttribute('data-od-static-preview');
      if (staticWant !== staticHave) {
        document.documentElement.toggleAttribute('data-od-static-preview', staticWant);
      }
      if (staticWant) startStaticPreviewAnimationHalter();
      else stopStaticPreviewAnimationHalter();
      return;
    }
    if (ev.data.type === 'od-edit-selected-target') {
      setSelectedTarget(ev.data.id || null);
      return;
    }
    if (ev.data.type === 'od-edit-preview-style') {
      applyPreviewStyles(ev.data.id, ev.data.styles || {}, ev.data.version);
      return;
    }
    // Project-scoped DS tokens: host posts the project's tokens.css
    // content so any var(--token) references the user just bound via
    // the property panel actually resolve at runtime. Without this, a
    // freshly generated project (no :root block in source yet) accepts
    // the binding but the colour stays unresolved because the variable
    // is undefined. We inject the CSS as a singleton style element
    // tagged data-od-ds-runtime-tokens so repeated posts overwrite
    // cleanly and source code is untouched.
    if (ev.data.type === 'od:ds-tokens') {
      var css = typeof ev.data.css === 'string' ? ev.data.css : '';
      var slot = document.querySelector('style[data-od-ds-runtime-tokens]');
      if (!css) {
        if (slot && slot.parentNode) slot.parentNode.removeChild(slot);
        return;
      }
      if (!slot) {
        slot = document.createElement('style');
        slot.setAttribute('data-od-ds-runtime-tokens', '');
        // Append to <head> so cascade order is consistent.
        (document.head || document.documentElement).appendChild(slot);
      }
      // Only update when content actually changes so a no-op post does
      // not invalidate the cascade for elements computed against the
      // current rules.
      if (slot.textContent !== css) slot.textContent = css;
      return;
    }
    // Content live-preview: the host inspector echoes every keystroke in the
    // text / link / image fields straight to the iframe so the user sees the
    // change without waiting for the debounced disk save to reload the
    // preview. The patch flow still owns persistence; this only mutates the
    // displayed DOM so the canvas stays in sync with the side panel.
    if (ev.data.type === 'od-edit-preview-text') {
      var textEl = findById(ev.data.id);
      if (textEl) textEl.textContent = String(ev.data.value || '');
      return;
    }
    if (ev.data.type === 'od-edit-preview-link') {
      var linkEl = findById(ev.data.id);
      if (linkEl) {
        if (typeof ev.data.text === 'string') linkEl.textContent = ev.data.text;
        if (typeof ev.data.href === 'string') linkEl.setAttribute('href', ev.data.href);
      }
      return;
    }
    if (ev.data.type === 'od-edit-preview-image') {
      var imgEl = findById(ev.data.id);
      if (imgEl) {
        if (typeof ev.data.src === 'string') imgEl.setAttribute('src', ev.data.src);
        if (typeof ev.data.alt === 'string') imgEl.setAttribute('alt', ev.data.alt);
      }
      return;
    }
    if (ev.data.type === 'od-edit-inline-set-href') {
      if (inlineEditEl && inlineEditKind === 'link') {
        inlineEditHref = String(ev.data.href || '');
      }
      return;
    }
    if (ev.data.type === 'od-edit-inline-commit') {
      if (inlineEditEl && typeof ev.data.href === 'string') inlineEditHref = ev.data.href;
      finishInlineEdit(true);
      return;
    }
    if (ev.data.type === 'od-edit-inline-cancel') {
      finishInlineEdit(false);
      return;
    }
    if (ev.data.type === 'od-edit-format-apply-color') {
      if (!inlineEditEl) return;
      var hex = typeof ev.data.hex === 'string' ? ev.data.hex : '';
      // Restore the range we saved when the color button was clicked so
      // execCommand applies to the original selection (which would otherwise
      // have collapsed when focus moved to the host popover).
      if (savedFormatRange) {
        var sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(savedFormatRange);
        }
      }
      try { document.execCommand('foreColor', false, hex); } catch(e){}
      savedFormatRange = null;
      // Force re-focus on the editable so subsequent typing continues there
      // rather than landing back on the host.
      if (inlineEditEl && inlineEditEl.focus) inlineEditEl.focus();
      return;
    }
  });
  document.addEventListener('click', function(ev){
    if (!enabled) return;
    // A drag gesture that just released still fires a click event on the
    // press origin; suppressing it keeps the selection on the dragged
    // element instead of bouncing focus to whatever sat under the cursor.
    if (dragJustHappened) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    // While the user is inline-editing, let clicks land normally on the
    // editable element (caret positioning, text selection); only intercept
    // clicks that escape outside it.
    if (inlineEditEl && (ev.target === inlineEditEl || (inlineEditEl.contains && inlineEditEl.contains(ev.target)))) {
      return;
    }
    var el = closestTarget(ev);
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    window.parent.postMessage({ type: 'od-edit-select', target: targetFrom(el, true) }, '*');
  }, true);
  // Dblclick handler intentionally removed per product decision: clicking an
  // element does ONE thing — select. All editing (text content, href, src,
  // styles) happens in the side panel inspector. This keeps the canvas
  // gesture surface minimal and avoids the situation where dblclick competed
  // with native browser selection / focus behavior and made text impossible
  // to edit on the canvas itself.
  // Figma-style scope: NO global keyboard shortcuts (no Cmd+D / Backspace /
  // Alt+arrows / Tab) and NO visual handles to refresh on scroll. The two
  // gestures the user explicitly asked for are click→select and
  // dblclick→inline-edit; everything else was disabled to keep the canvas
  // focused on those interactions.
  var postTargetsResizeTimer = null;
  window.addEventListener('resize', function(){
    if (postTargetsResizeTimer) clearTimeout(postTargetsResizeTimer);
    postTargetsResizeTimer = setTimeout(function(){ postTargetsResizeTimer = null; postTargets(); }, 200);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', postTargets);
  else setTimeout(postTargets, 0);
  document.documentElement.toggleAttribute('data-od-edit-mode', enabled);
  // Initialise static-preview on by default: the bridge is only injected
  // when the host wants Edit or Dual rendering, both of which need the
  // IntersectionObserver-reveal neutralising CSS to run BEFORE we wait
  // for the host's od-static-preview postMessage. Without this, reveals
  // that mount during the brief window before the host's effect fires
  // (and crucially, in Dual mode where they would otherwise never fire
  // at all) stay invisible. The host can still toggle it off later via
  // od-static-preview { enabled: false } when entering a mode that
  // wants the artifact's reveal animations live.
  document.documentElement.toggleAttribute('data-od-static-preview', true);
  startStaticPreviewAnimationHalter();
})();</script>`;
}

export function buildManualEditBridgeStyle(): string {
  return `<style data-od-edit-bridge-style>
html[data-od-edit-mode] body * { cursor: pointer !important; }
html[data-od-edit-mode] [data-od-id],
html[data-od-edit-mode] [data-od-runtime-id] { outline: 1px dashed rgba(37, 99, 235, 0.35); outline-offset: 3px; }
html[data-od-edit-mode] [data-od-id]:hover,
html[data-od-edit-mode] [data-od-runtime-id]:hover { outline: 2px solid #2563eb; }
html[data-od-edit-mode] [data-od-edit-selected] {
  outline: 2px solid #2563eb !important;
  outline-offset: 4px;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.16);
  cursor: grab !important;
}
html[data-od-edit-mode] [data-od-edit-selected] * { cursor: grab !important; }
/* Inline editing affordances — set by dblclick handlers in the bridge. The
   contenteditable element gets a stronger outline so the user sees the edit
   surface; media targets (img/svg) hint that dblclick swaps the asset via a
   different cursor. */
html[data-od-edit-mode] [data-od-inline-editing] {
  outline: 2px solid #2563eb !important;
  outline-offset: 2px;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.22);
  cursor: text !important;
  caret-color: #2563eb;
  background: rgba(255, 255, 255, 0.6);
}
html[data-od-edit-mode] img:hover,
html[data-od-edit-mode] picture:hover,
html[data-od-edit-mode] svg:hover { cursor: zoom-in !important; }
html[data-od-edit-mode] img:hover::after { content: ''; }
/* Static preview mode neutralises generated animations, transitions,
   and IntersectionObserver-driven reveals. Triggered by both Edit and
   Dual (code+design) views via the od-static-preview postMessage.

   We cannot just set animation:none -- landings routinely keep elements
   at opacity 0 / translateY(20px) and reveal them through a finite
   animation:fadeIn forwards, so zeroing the animation traps them in
   the pre-animation state. Instead we keep the animation-name
   reference and force every keyframe to run for 1ms exactly once,
   fill-mode both, so finite reveals snap to their end state and
   infinite loops (spin/shimmer/pulse) settle on a single resolved
   frame.

   The opacity override covers the JS-driven reveal pattern:
   .reveal { opacity: 0 } + IntersectionObserver adding .is-visible.
   When the iframe is shorter than the page (Dual / Edit side-panel),
   IO never fires for elements below the iframe viewport and the page
   stays mostly blank. Forcing opacity:1 makes everything inspectable;
   genuinely hidden surfaces (display:none, visibility:hidden, [hidden],
   aria-hidden=true) stay hidden. !important + ::before/::after are
   required because reveals frequently target pseudo-elements. */
html[data-od-static-preview] *,
html[data-od-static-preview] *::before,
html[data-od-static-preview] *::after {
  animation-duration: 0.001s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  animation-fill-mode: both !important;
  animation-play-state: running !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
html[data-od-static-preview] *:not([hidden]):not([aria-hidden="true"]) {
  opacity: 1 !important;
}
</style>`;
}

// Variants for hosts that need the bridge as plain assets (a project's
// public/ folder served by Vite, for example) rather than HTML strings
// injected into a srcdoc. We strip the wrapping <script>/<style> tags so
// the output goes straight into a .js / .css file the iframe can load
// first-party — this is how the daemon makes the bridge work inside the
// React dev server without a cross-origin shim.
export function buildStandaloneBridgeJs(): string {
  const html = buildManualEditBridge(true);
  return html
    .replace(/^<script[^>]*>/, '')
    .replace(/<\/script>\s*$/, '');
}

export function buildStandaloneBridgeCss(): string {
  const html = buildManualEditBridgeStyle();
  return html
    .replace(/^<style[^>]*>/, '')
    .replace(/<\/style>\s*$/, '');
}
