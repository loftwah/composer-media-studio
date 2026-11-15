import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftMatchesSaved } from '../src/frontend/compose-state.ts';

const saved = {
  id: 'cmp_4', title: 'After Hours', shots: [
    { assetId: 'a1' }, { assetId: 'a2', trimStartMs: 500, trimEndMs: 1500, durationMs: 1000 },
  ], totalMs: 2000, audioAssetId: 'mix', audioTracks: [], createdAt: 1, updatedAt: 2,
};
const compose = {
  shotIds: ['a1', 'a2'], shotTrims: { a2: { trimStartMs: 500, trimEndMs: 1500 } },
  audioAssetId: 'mix', audioTracks: [], title: 'After Hours', editingId: 'cmp_4',
};

test('the saved status distinguishes an unchanged draft from a changed take, trim or mix', () => {
  assert.equal(draftMatchesSaved(compose, saved), true);
  assert.equal(draftMatchesSaved({ ...compose, shotIds: ['a1', 'a3'] }, saved), false);
  assert.equal(draftMatchesSaved({ ...compose, shotTrims: { a2: { trimStartMs: 0, trimEndMs: 1000 } } }, saved), false);
  assert.equal(draftMatchesSaved({ ...compose, audioAssetId: null }, saved), false);
  assert.equal(draftMatchesSaved({ ...compose, audioTracks: [{ assetId: 'a1', role: 'music', startMs: 0, trimStartMs: 0, trimEndMs: 2000, gainDb: 0, fadeInMs: 0, fadeOutMs: 0 }] }, saved), false);
  assert.equal(draftMatchesSaved(compose, undefined), false);
});
