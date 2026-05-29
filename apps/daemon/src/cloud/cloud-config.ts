// Read cloud (Supabase) configuration from process.env at module call time.
//
// The daemon stays fully functional with cloud unset — readCloudConfig returns
// `{ enabled: false, reason: ... }` and the cloud routes / UI gate themselves
// off that. Callers must never assume cloud is enabled.

export type CloudConfig =
  | {
      enabled: true;
      url: string;
      anonKey: string;
      // Where the public invitation landing page lives. Used to construct
      // accept links in transactional emails. Defaults to a placeholder host
      // so we surface misconfiguration early instead of pretending invites
      // work.
      inviteLandingUrl: string;
    }
  | {
      enabled: false;
      reason: 'missing_url' | 'missing_key' | 'invalid_url';
    };

export const CLOUD_ENV_KEYS = {
  url: 'OD_CLOUD_URL',
  anonKey: 'OD_CLOUD_ANON_KEY',
  inviteLandingUrl: 'OD_CLOUD_INVITE_LANDING_URL',
} as const;

const DEFAULT_INVITE_LANDING_URL = 'https://invite.example.com';

export function readCloudConfig(
  env: NodeJS.ProcessEnv = process.env,
): CloudConfig {
  const rawUrl = (env[CLOUD_ENV_KEYS.url] ?? '').trim();
  const rawKey = (env[CLOUD_ENV_KEYS.anonKey] ?? '').trim();
  if (!rawUrl) return { enabled: false, reason: 'missing_url' };
  if (!rawKey) return { enabled: false, reason: 'missing_key' };
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { enabled: false, reason: 'invalid_url' };
    }
  } catch {
    return { enabled: false, reason: 'invalid_url' };
  }
  const rawLanding = (env[CLOUD_ENV_KEYS.inviteLandingUrl] ?? '').trim();
  return {
    enabled: true,
    url: rawUrl,
    anonKey: rawKey,
    inviteLandingUrl: rawLanding || DEFAULT_INVITE_LANDING_URL,
  };
}
