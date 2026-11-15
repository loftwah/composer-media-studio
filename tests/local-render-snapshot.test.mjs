import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocalRenderSnapshot, savedRevisionLabel } from '../src/frontend/local-render-snapshot.ts';

const take = (id, extra = {}) => ({
  id,
  kind: 'video',
  title: `Take ${id}`,
  file: `/api/assets/${id}/file`,
  durationMs: 5500,
  bytes: 1000,
  ...extra,
});

const composition = (revision, fourthTake) => ({
  id: `cmp_song_plan_after_hours_${revision}`,
  projectId: 'prj_after_hours',
  title: 'After Hours',
  shots: [
    { assetId: 'asset_take_1' },
    { assetId: 'asset_take_2' },
    { assetId: 'asset_take_3' },
    { assetId: fourthTake },
    { assetId: 'asset_take_5' },
    { assetId: 'asset_take_6' },
  ],
  totalMs: 33000,
  audioAssetId: 'asset_mix_4',
  audioTracks: [],
  createdAt: 1000,
  updatedAt: 1000 + revision,
  originSongPlan: { id: 'plan_after_hours', revision, songSha256: 'a'.repeat(64), sourceStartMs: 0, sourceEndMs: 33000, scenes: [] },
});

test('a local render uses the saved take even when the card still holds an older save of the same storyboard', () => {
  const clicked = composition(4, 'asset_cbb55ec2');
  const saved = composition(4, 'asset_ad1a6388');
  const result = resolveLocalRenderSnapshot(clicked, {
    compositions: [saved, composition(3, 'asset_cbb55ec2')],
    assets: [take('asset_take_1'), take('asset_take_2'), take('asset_take_3'), take('asset_cbb55ec2'), take('asset_ad1a6388'), take('asset_take_5'), take('asset_take_6')],
  });
  assert.equal(result.changed, true);
  assert.equal(result.composition.shots[3].assetId, 'asset_ad1a6388');
  assert.equal(result.composition.updatedAt, 1004);
  assert.ok(result.assets.some((asset) => asset.id === 'asset_ad1a6388'));
});

test('a current card renders unchanged and an earlier revision still renders its own exact cut', () => {
  const clicked = composition(4, 'asset_ad1a6388');
  const project = {
    compositions: [clicked, composition(3, 'asset_cbb55ec2')],
    assets: [take('asset_ad1a6388'), take('asset_cbb55ec2')],
  };
  const current = resolveLocalRenderSnapshot(clicked, project);
  assert.equal(current.changed, false);
  assert.equal(current.composition.shots[3].assetId, 'asset_ad1a6388');

  const earlier = resolveLocalRenderSnapshot(composition(3, 'asset_cbb55ec2'), project);
  assert.equal(earlier.changed, false);
  assert.equal(earlier.composition.shots[3].assetId, 'asset_cbb55ec2');
});

test('a missing saved storyboard asks for a reload instead of silently rendering another cut', () => {
  assert.throws(
    () => resolveLocalRenderSnapshot(composition(4, 'asset_ad1a6388'), { compositions: [], assets: [] }),
    /no longer in the studio/,
  );
  assert.throws(
    () => resolveLocalRenderSnapshot(composition(4, 'asset_ad1a6388'), {}),
    /Could not check the saved storyboard/,
  );
});

test('the visible label names the exact saved revision', () => {
  assert.equal(savedRevisionLabel(composition(4, 'asset_ad1a6388')), 'plan revision 4');
});
