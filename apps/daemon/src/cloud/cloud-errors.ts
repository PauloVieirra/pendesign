// Typed errors for the cloud module. The auth routes catch CloudError and map
// `code` → HTTP status via the table below. Non-CloudError exceptions bubble
// up to the daemon's default error handler.

export type CloudErrorCode =
  | 'cloud_not_configured'
  | 'validation_error'
  | 'auth_failed'
  | 'email_already_exists'
  | 'weak_password'
  | 'network_error'
  | 'not_signed_in'
  | 'rate_limited'
  | 'unknown';

const STATUS_BY_CODE: Record<CloudErrorCode, number> = {
  cloud_not_configured: 503,
  validation_error: 422,
  auth_failed: 401,
  email_already_exists: 409,
  weak_password: 422,
  network_error: 502,
  not_signed_in: 401,
  rate_limited: 429,
  unknown: 500,
};

export class CloudError extends Error {
  readonly code: CloudErrorCode;
  readonly details: string | undefined;

  constructor(code: CloudErrorCode, message?: string, details?: string) {
    super(message ?? code);
    this.name = 'CloudError';
    this.code = code;
    this.details = details;
  }

  get httpStatus(): number {
    return STATUS_BY_CODE[this.code];
  }

  toJSON(): { error: string; details?: string } {
    return this.details ? { error: this.code, details: this.details } : { error: this.code };
  }
}

export function cloudErrorStatus(code: CloudErrorCode): number {
  return STATUS_BY_CODE[code];
}
