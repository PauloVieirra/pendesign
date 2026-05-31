// Public surface of the @open-design/edit-bridge package. Hosts (the web
// app and the daemon) import the same primitives; the daemon additionally
// writes the standalone JS bundle into projects' public/ folder so an
// iframe loaded directly from the Vite dev server still gets the bridge
// first-party.

export * from './bridge.js';
export * from './source-patches.js';
export * from './types.js';
