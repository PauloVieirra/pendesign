/**
 * Pixabay free-tier search client. Returns up to N normalized image results
 * for an agent or CLI to pick from. Used by `od images search`.
 *
 * Free tier: 5000 requests / hour per API key (after signup at pixabay.com/api).
 */

export interface PixabaySearchInput {
  query: string;
  apiKey: string;
  count?: number;                                       // default 5, max 20
  orientation?: 'horizontal' | 'vertical' | 'all';      // default 'all'
  minWidth?: number;                                    // px
  category?: PixabayCategory;
  signal?: AbortSignal;
}

export type PixabayCategory =
  | 'backgrounds' | 'fashion' | 'nature' | 'science' | 'education'
  | 'feelings' | 'health' | 'people' | 'religion' | 'places' | 'animals'
  | 'industry' | 'computer' | 'food' | 'sports' | 'transportation'
  | 'travel' | 'buildings' | 'business' | 'music';

export interface PixabayImage {
  id: number;
  url: string;
  width: number;
  height: number;
  tags: string;
  user: string;
  pageURL: string;
  previewURL: string;
}

export class MissingApiKeyError extends Error {
  constructor() { super('PIXABAY_API_KEY not configured'); this.name = 'MissingApiKeyError'; }
}

export class RateLimitedError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Pixabay rate-limited; retry after ${retryAfterSec}s`);
    this.name = 'RateLimitedError';
  }
}

export class InvalidResponseError extends Error {
  constructor(detail: string) { super(`Pixabay returned an invalid response: ${detail}`); this.name = 'InvalidResponseError'; }
}

interface PixabayHit {
  id: number;
  pageURL?: string;
  previewURL?: string;
  webformatURL?: string;
  largeImageURL?: string;
  imageURL?: string;
  imageWidth?: number;
  imageHeight?: number;
  tags?: string;
  user?: string;
}

const ENDPOINT = 'https://pixabay.com/api/';
const DEFAULT_COUNT = 5;
const MAX_COUNT = 20;
const TIMEOUT_MS = 15000;

export async function searchPixabay(input: PixabaySearchInput): Promise<PixabayImage[]> {
  if (!input.apiKey) throw new MissingApiKeyError();
  const count = Math.min(Math.max(input.count ?? DEFAULT_COUNT, 3), MAX_COUNT);

  const params = new URLSearchParams({
    key: input.apiKey,
    q: input.query,
    image_type: 'photo',
    safesearch: 'true',
    per_page: String(count),
  });
  if (input.orientation && input.orientation !== 'all') params.set('orientation', input.orientation);
  if (input.minWidth) params.set('min_width', String(input.minWidth));
  if (input.category) params.set('category', input.category);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const signal = input.signal
    ? linkSignals(input.signal, controller.signal)
    : controller.signal;

  let resp: Response;
  try {
    resp = await fetch(`${ENDPOINT}?${params.toString()}`, { signal });
  } finally {
    clearTimeout(timer);
  }

  if (resp.status === 429) {
    const retryAfter = Number(resp.headers.get('retry-after') ?? '60');
    throw new RateLimitedError(Number.isFinite(retryAfter) ? retryAfter : 60);
  }
  if (!resp.ok) {
    throw new InvalidResponseError(`HTTP ${resp.status}`);
  }

  let body: { hits?: PixabayHit[] };
  try {
    body = await resp.json() as { hits?: PixabayHit[] };
  } catch {
    throw new InvalidResponseError('non-JSON body');
  }

  const hits = Array.isArray(body.hits) ? body.hits : [];
  return hits.map((h): PixabayImage => ({
    id: Number(h.id),
    url: h.largeImageURL ?? h.webformatURL ?? h.imageURL ?? '',
    width: Number(h.imageWidth ?? 0),
    height: Number(h.imageHeight ?? 0),
    tags: String(h.tags ?? ''),
    user: String(h.user ?? ''),
    pageURL: String(h.pageURL ?? ''),
    previewURL: String(h.previewURL ?? ''),
  })).filter((img) => img.url.length > 0);
}

function linkSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const c = new AbortController();
  const fwd = (signal: AbortSignal) => () => c.abort(signal.reason);
  a.addEventListener('abort', fwd(a));
  b.addEventListener('abort', fwd(b));
  if (a.aborted) c.abort(a.reason);
  if (b.aborted) c.abort(b.reason);
  return c.signal;
}
