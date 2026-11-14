import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicGallery } from '../src/lib/ui.mjs';

test('public film cards make playback discoverable while preserving credit and publication links', () => {
  const html = publicGallery({ home: true, items: [
    { slug: 'film_one', kind: 'video', title: 'A film', description: 'Artwork credit', poster_asset_id: 'poster' },
    { slug: 'image_one', kind: 'image', title: 'A still' },
  ] });
  assert.match(html, /href="\/p\/film_one"/);
  assert.match(html, /src="\/p\/film_one\/poster"/);
  assert.match(html, /Watch film →/);
  assert.match(html, /Artwork credit/);
  assert.match(html, /href="\/p\/image_one"/);
});
