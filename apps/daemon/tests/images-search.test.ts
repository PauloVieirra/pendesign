import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  searchPixabay,
  MissingApiKeyError,
  RateLimitedError,
  InvalidResponseError,
  type PixabayImage,
} from '../src/images-search.js';

function withFetch(stub: (url: string, init?: RequestInit) => Promise<Response>, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof globalThis.fetch;
  return fn().finally(() => { globalThis.fetch = original; });
}

test('searchPixabay builds correct URL and maps response', async () => {
  let capturedUrl = '';
  await withFetch(async (url) => {
    capturedUrl = url;
    return new Response(JSON.stringify({
      total: 1,
      totalHits: 1,
      hits: [{
        id: 100, pageURL: 'https://pixabay.com/photos/x/100/',
        previewURL: 'https://cdn.pixabay.com/preview/x.jpg',
        webformatURL: 'https://cdn.pixabay.com/get/web.jpg',
        largeImageURL: 'https://cdn.pixabay.com/get/large.jpg',
        imageWidth: 1920, imageHeight: 1280,
        tags: 'sunset, sky', user: 'photog',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    const out = await searchPixabay({ query: 'sunset', count: 3, apiKey: 'k1' });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 100);
    assert.equal(out[0].url, 'https://cdn.pixabay.com/get/large.jpg');
    assert.equal(out[0].width, 1920);
    assert.equal(out[0].height, 1280);
    assert.equal(out[0].user, 'photog');
    assert.ok(capturedUrl.includes('q=sunset'));
    assert.ok(capturedUrl.includes('per_page=3'));
    assert.ok(capturedUrl.includes('image_type=photo'));
    assert.ok(capturedUrl.includes('safesearch=true'));
    assert.ok(capturedUrl.includes('key=k1'));
  });
});

test('searchPixabay throws MissingApiKeyError when apiKey is empty', async () => {
  await assert.rejects(
    () => searchPixabay({ query: 'x', apiKey: '' }),
    (err) => err instanceof MissingApiKeyError,
  );
});

test('searchPixabay returns [] when Pixabay reports zero hits', async () => {
  await withFetch(async () => new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }), async () => {
    const out = await searchPixabay({ query: 'nothing', apiKey: 'k1' });
    assert.deepEqual(out, []);
  });
});

test('searchPixabay throws RateLimitedError on 429', async () => {
  await withFetch(async () => new Response('rate limited', { status: 429, headers: { 'retry-after': '60' } }), async () => {
    await assert.rejects(
      () => searchPixabay({ query: 'x', apiKey: 'k1' }),
      (err) => err instanceof RateLimitedError && (err as RateLimitedError).retryAfterSec === 60,
    );
  });
});

test('searchPixabay throws InvalidResponseError on malformed JSON', async () => {
  await withFetch(async () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    await assert.rejects(
      () => searchPixabay({ query: 'x', apiKey: 'k1' }),
      (err) => err instanceof InvalidResponseError,
    );
  });
});

test('searchPixabay forwards orientation, minWidth, category filters', async () => {
  let capturedUrl = '';
  await withFetch(async (url) => {
    capturedUrl = url;
    return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    await searchPixabay({
      query: 'cats', apiKey: 'k1',
      orientation: 'horizontal', minWidth: 1200, category: 'animals',
    });
    assert.ok(capturedUrl.includes('orientation=horizontal'));
    assert.ok(capturedUrl.includes('min_width=1200'));
    assert.ok(capturedUrl.includes('category=animals'));
  });
});

test('searchPixabay falls back from largeImageURL → webformatURL → imageURL when missing', async () => {
  await withFetch(async () => new Response(JSON.stringify({
    hits: [
      { id: 1, webformatURL: 'https://cdn.pixabay.com/get/web1.jpg', imageWidth: 100, imageHeight: 100, tags: '', user: 'a', pageURL: 'p', previewURL: 'pv' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    const out = await searchPixabay({ query: 'x', apiKey: 'k1' });
    assert.equal(out[0].url, 'https://cdn.pixabay.com/get/web1.jpg');
  });
});
