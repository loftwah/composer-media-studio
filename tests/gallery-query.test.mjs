import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  galleryPageHref,
  galleryHasFilters,
  galleryIsFiltered,
  galleryResultCount,
  galleryAudioEmpty,
} from '../src/lib/gallery-query.ts';
import { publicGallery } from '../src/lib/ui.mjs';

const state = (overrides = {}) => ({ search: '', kind: '', project: '', capability: '', order: 'newest', page: 1, ...overrides });

test('gallery page links keep the public query labels and their order', () => {
  assert.equal(
    galleryPageHref(state({ search: 'Night Signal', project: 'alpha', kind: 'video', capability: 'assembled', order: 'oldest' }), 2),
    '/gallery?q=Night+Signal&project=alpha&kind=video&capability=assembled&order=oldest&page=2',
  );
  assert.equal(galleryPageHref(state(), 3), '/gallery?page=3');
  assert.equal(galleryPageHref(state({ order: 'newest' }), 1), '/gallery?page=1');
});

test('an explicit filter differs from a filtered browsing context', () => {
  assert.equal(galleryHasFilters(state()), false);
  assert.equal(galleryIsFiltered(state()), false);
  assert.equal(galleryHasFilters(state({ search: 'signal' })), true);
  assert.equal(galleryIsFiltered(state({ search: 'signal' })), true);
  assert.equal(galleryHasFilters(state({ order: 'oldest', page: 3 })), false);
  assert.equal(galleryIsFiltered(state({ order: 'oldest', page: 3 })), true);
  assert.equal(galleryIsFiltered(state({ page: 2 })), true);
});

test('the result count uses the exact singular and plural labels', () => {
  assert.equal(galleryResultCount(0), '0 works');
  assert.equal(galleryResultCount(1), '1 work');
  assert.equal(galleryResultCount(2), '2 works');
  assert.equal(galleryResultCount(25), '25 works');
});

test('only the unfiltered audio first page with no results uses the audio notice', () => {
  assert.equal(galleryAudioEmpty(state({ kind: 'audio' }), 0, false), true);
  assert.equal(galleryAudioEmpty(state({ kind: 'audio', search: 'song' }), 0, false), false);
  assert.equal(galleryAudioEmpty(state({ kind: 'audio', project: 'alpha' }), 0, false), false);
  assert.equal(galleryAudioEmpty(state({ kind: 'audio', capability: 'original' }), 0, false), false);
  assert.equal(galleryAudioEmpty(state({ kind: 'audio', page: 2 }), 0, false), false);
  assert.equal(galleryAudioEmpty(state({ kind: 'audio' }), 1, false), false);
  assert.equal(galleryAudioEmpty(state({ kind: 'audio' }), 0, true), false);
});

test('the renderer uses the typed helpers for the count, pagination and card back link', () => {
  const html = publicGallery({
    items: [{ slug: 'a_film', kind: 'video', title: 'A film', poster_width: 1280, poster_height: 720 }],
    total: 25,
    page: 2,
    hasMore: true,
    query: 'night signal',
    kind: 'video',
    project: 'alpha',
    capability: 'assembled',
    order: 'oldest',
  });
  assert.match(html, /data-total="25">25 works</);
  assert.match(html, /href="\/gallery\?q=night\+signal&amp;project=alpha&amp;kind=video&amp;capability=assembled&amp;order=oldest&amp;page=1">← Previous</);
  assert.match(html, /href="\/gallery\?q=night\+signal&amp;project=alpha&amp;kind=video&amp;capability=assembled&amp;order=oldest&amp;page=3">Next →</);
  assert.match(html, /href="\/p\/a_film\?back=%2Fgallery%3Fq%3Dnight%2Bsignal%26project%3Dalpha%26kind%3Dvideo%26capability%3Dassembled%26order%3Doldest%26page%3D2"/);
});

test('the renderer keeps the audio notice and the clear-filters link decisions', () => {
  assert.match(publicGallery({ items: [], total: 0, kind: 'audio', page: 1 }), /No audio work has been published to the gallery yet\./);
  assert.match(publicGallery({ items: [], total: 0, kind: 'audio', query: 'song', page: 1 }), /No published work matches these filters\./);
  assert.match(publicGallery({ items: [{ slug: 'still', kind: 'image', title: 'Still' }], total: 1 }), /data-total="1">1 work</);
});
