// Barrel exports for the cloud module.
//
// Importers should reach for these named exports rather than deep imports into
// cloud-*.ts files. Keeps the module's public surface visible in one place.

export { CloudClient } from './cloud-client.js';
export type { CloudClientConfig, CloudUserPayload } from './cloud-client.js';
export { readCloudConfig, CLOUD_ENV_KEYS } from './cloud-config.js';
export type { CloudConfig } from './cloud-config.js';
export { CloudError, cloudErrorStatus } from './cloud-errors.js';
export type { CloudErrorCode } from './cloud-errors.js';
export {
  ensureCloudSessionSchema,
  getCloudSession,
  saveCloudSession,
  clearCloudSession,
} from './cloud-session.js';
export type { CloudSessionRow } from './cloud-session.js';
export { registerCloudAuthRoutes } from './cloud-auth-routes.js';
export type { CloudAuthRouteDeps } from './cloud-auth-routes.js';
