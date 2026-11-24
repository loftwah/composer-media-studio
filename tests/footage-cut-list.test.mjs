import test from 'node:test';
import assert from 'node:assert/strict';
import { savedCutListText } from '../src/frontend/footage-cut-list.ts';

test('saved cut list keeps scene order and exact original-source milliseconds', () => {
  const plan = {
    title: 'Original footage edit',
    revision: 7,
    scenes: [
      { sourceStartMs: 0, sourceEndMs: 1 },
      { sourceStartMs: 1001, sourceEndMs: 61005 },
      { sourceStartMs: 3600000, sourceEndMs: 3600123 },
    ],
  };

  assert.equal(savedCutListText(plan, { title: 'Camera A' }), [
    'Title: Original footage edit',
    'Revision: 7',
    'Source: Camera A',
    'Timing: original source, milliseconds',
    'Scene 1 · 0–1 ms',
    'Scene 2 · 1001–61005 ms',
    'Scene 3 · 3600000–3600123 ms',
  ].join('\n'));
});

test('saved cut list excludes storage, credentials, identifiers, directions and takes', () => {
  const privateUrl = 'https://private-storage.example/video.mp4?token=credential';
  const fingerprint = 'private-source-fingerprint';
  const plan = {
    id: 'plan_private',
    sourceAssetId: 'asset_private',
    sourceSha256: fingerprint,
    title: 'Shareable edit',
    revision: 2,
    treatment: 'Private treatment',
    scenes: [{
      id: 'scene_private',
      sourceStartMs: 1234,
      sourceEndMs: 5678,
      direction: 'Private user direction',
      referenceAssetId: 'asset_reference_private',
      selectedTakeId: 'asset_take_private',
    }],
  };
  const source = {
    title: 'Source display name',
    id: 'asset_private',
    sha256: fingerprint,
    source: 'provider-private-source',
    file: privateUrl,
    download: privateUrl,
  };

  const text = savedCutListText(plan, source);
  assert.equal(text, [
    'Title: Shareable edit',
    'Revision: 2',
    'Source: Source display name',
    'Timing: original source, milliseconds',
    'Scene 1 · 1234–5678 ms',
  ].join('\n'));
  for (const privateValue of [privateUrl, 'credential', fingerprint, 'plan_private', 'asset_private', 'Private treatment', 'Private user direction', 'asset_reference_private', 'asset_take_private']) {
    assert.equal(text.includes(privateValue), false, privateValue);
  }
});
