import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalRenderProvenance, publicCaption } from '../public/asset-caption.js';

test('local render provenance stays out of default public descriptions', () => {
  const metadata = `Browser MP4 from storyboard storyboard_abc, saved version 123; owner-confirmed captions from song plan song_abc revision 1; source song SHA256 ${'a'.repeat(64)}; clips clip_abc; soundtrack none.`;
  assert.equal(isLocalRenderProvenance(metadata), true);
  assert.equal(publicCaption(metadata), '');
  assert.equal(publicCaption(metadata.slice(0, 180)), '');
  assert.equal(publicCaption('An authored caption with a long creative note.'), 'An authored caption with a long creative note.');
  assert.equal(publicCaption('Browser MP4 from storyboard ideas for my project'), 'Browser MP4 from storyboard ideas for my project');
});
