/**
 * Forwards `console.*`, `window.onerror`, and unhandled promise
 * rejections from a sandboxed iframe to its host via postMessage. The
 * host (`useConsoleLog`) keeps a ring buffer that backs the in-app
 * "Console" drawer in the file viewer.
 *
 * Injected EARLY in the iframe `<head>` so the overrides are in place
 * before any user script runs — late injection misses every error
 * thrown by inline `<script>` blocks at parse time.
 */
export function buildConsoleBridge(): string {
  return `<script data-od-console-bridge>(function(){
  // The lazy srcdoc transport re-runs document.write whenever the host
  // posts a new payload, which re-executes every <script> in the new
  // document including this one. Without a guard the console overrides
  // stack on top of the previous install -- a single console.warn from
  // the page then cascades through every accumulated wrapper, inflating
  // the host-side log and masking the true call frequency. Mark the
  // window once and bail on later boots; the latest document still
  // sends its own warnings through the original wrapper chain.
  if (window.__odConsoleBridgeInstalled) return;
  window.__odConsoleBridgeInstalled = true;
  function serialize(args){
    var out = [];
    for (var i = 0; i < args.length; i++) {
      var v = args[i];
      try {
        if (v instanceof Error) {
          out.push({ __error: true, name: v.name, message: v.message, stack: v.stack || null });
        } else if (typeof v === 'object' && v !== null) {
          var seen = new WeakSet();
          out.push(JSON.stringify(v, function(_k, val){
            if (typeof val === 'object' && val !== null) {
              if (seen.has(val)) return '[Circular]';
              seen.add(val);
            }
            if (typeof val === 'function') return '[Function ' + (val.name || 'anonymous') + ']';
            return val;
          }).slice(0, 4000));
        } else {
          out.push(String(v));
        }
      } catch (_) {
        try { out.push(String(v)); } catch (__) { out.push('[unserialisable]'); }
      }
    }
    return out;
  }
  function send(level, args, stack){
    try {
      window.parent.postMessage({
        type: 'od:console-log',
        level: level,
        args: serialize(args),
        stack: stack || null,
        ts: Date.now()
      }, '*');
    } catch (_) {}
  }
  var levels = ['log','info','warn','error','debug'];
  for (var i = 0; i < levels.length; i++) {
    (function(level){
      var orig = console[level];
      console[level] = function(){
        try { if (typeof orig === 'function') orig.apply(console, arguments); } catch(_) {}
        send(level, arguments, null);
      };
    })(levels[i]);
  }
  window.addEventListener('error', function(ev){
    var stack = ev.error && ev.error.stack ? String(ev.error.stack) : null;
    var loc = (ev.filename || '') + ':' + (ev.lineno || 0) + ':' + (ev.colno || 0);
    send('error', [String(ev.message || ev.type) + ' (' + loc + ')'], stack);
  });
  window.addEventListener('unhandledrejection', function(ev){
    var reason = ev.reason;
    var msg = reason && reason.message ? reason.message : String(reason);
    var stack = reason && reason.stack ? String(reason.stack) : null;
    send('error', ['Unhandled rejection: ' + msg], stack);
  });
})();</script>`;
}
