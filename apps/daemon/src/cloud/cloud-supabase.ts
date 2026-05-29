// Returns a Supabase client bound to the daemon's current session.
//
// The cloud module otherwise treats CloudClient as the only Supabase touch
// point (auth only). Phase 1+ adds storage + Postgres calls that need a
// session-aware client; this helper centralizes the dance of:
//   1. Refresh the access token if it's near expiry.
//   2. Persist the (possibly new) session back to SQLite.
//   3. Return a SupabaseClient configured with the fresh JWT.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from 'better-sqlite3';
import type { CloudConfig } from './cloud-config.js';
import type { CloudClient } from './cloud-client.js';
import { CloudError } from './cloud-errors.js';
import {
  getCloudSession,
  saveCloudSession,
  type CloudSessionRow,
} from './cloud-session.js';

export interface AuthenticatedSupabase {
  client: SupabaseClient;
  session: CloudSessionRow;
}

export async function getAuthedSupabase(
  config: Extract<CloudConfig, { enabled: true }>,
  cloudClient: CloudClient,
  db: Database,
): Promise<AuthenticatedSupabase> {
  const current = getCloudSession(db);
  if (!current) throw new CloudError('not_signed_in');
  const fresh = await cloudClient.ensureFreshAccessToken(current);
  if (fresh.accessToken !== current.accessToken) {
    saveCloudSession(db, fresh);
  }
  const client = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${fresh.accessToken}`,
      },
    },
  });
  return { client, session: fresh };
}
