import { describe, expect, it } from 'vitest';
import { CLOUD_ENV_KEYS, readCloudConfig } from '../../src/cloud/cloud-config.js';

const VALID_URL = 'https://example.supabase.co';
const VALID_KEY = 'sb_publishable_abc123';

function env(overrides: Partial<Record<string, string>>): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides } as NodeJS.ProcessEnv;
}

describe('readCloudConfig', () => {
  it('returns enabled when both url and key are set', () => {
    const config = readCloudConfig(env({
      [CLOUD_ENV_KEYS.url]: VALID_URL,
      [CLOUD_ENV_KEYS.anonKey]: VALID_KEY,
    }));
    expect(config.enabled).toBe(true);
    if (!config.enabled) return;
    expect(config.url).toBe(VALID_URL);
    expect(config.anonKey).toBe(VALID_KEY);
    expect(config.inviteLandingUrl).toBe('https://invite.example.com');
  });

  it('returns missing_url when url is empty', () => {
    const config = readCloudConfig(env({
      [CLOUD_ENV_KEYS.url]: '',
      [CLOUD_ENV_KEYS.anonKey]: VALID_KEY,
    }));
    expect(config).toEqual({ enabled: false, reason: 'missing_url' });
  });

  it('returns missing_key when key is empty', () => {
    const config = readCloudConfig(env({
      [CLOUD_ENV_KEYS.url]: VALID_URL,
      [CLOUD_ENV_KEYS.anonKey]: '',
    }));
    expect(config).toEqual({ enabled: false, reason: 'missing_key' });
  });

  it('returns invalid_url when url is not a valid URL', () => {
    const config = readCloudConfig(env({
      [CLOUD_ENV_KEYS.url]: 'not a url',
      [CLOUD_ENV_KEYS.anonKey]: VALID_KEY,
    }));
    expect(config).toEqual({ enabled: false, reason: 'invalid_url' });
  });

  it('returns invalid_url for non-http(s) schemes', () => {
    const config = readCloudConfig(env({
      [CLOUD_ENV_KEYS.url]: 'ftp://example.supabase.co',
      [CLOUD_ENV_KEYS.anonKey]: VALID_KEY,
    }));
    expect(config).toEqual({ enabled: false, reason: 'invalid_url' });
  });

  it('uses the configured invite landing URL when set', () => {
    const config = readCloudConfig(env({
      [CLOUD_ENV_KEYS.url]: VALID_URL,
      [CLOUD_ENV_KEYS.anonKey]: VALID_KEY,
      [CLOUD_ENV_KEYS.inviteLandingUrl]: 'https://invite.myapp.com',
    }));
    expect(config.enabled).toBe(true);
    if (!config.enabled) return;
    expect(config.inviteLandingUrl).toBe('https://invite.myapp.com');
  });

  it('trims whitespace from env vars', () => {
    const config = readCloudConfig(env({
      [CLOUD_ENV_KEYS.url]: `  ${VALID_URL}  `,
      [CLOUD_ENV_KEYS.anonKey]: `  ${VALID_KEY}  `,
    }));
    expect(config.enabled).toBe(true);
    if (!config.enabled) return;
    expect(config.url).toBe(VALID_URL);
    expect(config.anonKey).toBe(VALID_KEY);
  });
});
