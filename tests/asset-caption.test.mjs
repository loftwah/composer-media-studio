import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalRenderProvenance, publicCaption } from '../public/asset-caption.js';

test('local render provenance stays out of default public descriptions', () => {
  const metadata = `Browser MP4 from storyboard storyboard_abc, saved version 123; owner-confirmed captions from song plan song_abc revision 1; source song SHA256 ${'a'.repeat(64)}; clips clip_abc; soundtrack none.`;
  assert.equal(isLocalRenderProvenance(metadata), true);
  assert.equal(publicCaption(metadata), '');
  assert.equal(publicCaption('Browser MP4 from saved storyboard; Media Studio local render; frame 640x360; fit contain.'), '');
  assert.equal(publicCaption(metadata.slice(0, 180)), '');
  assert.equal(publicCaption('An authored caption with a long creative note.'), 'An authored caption with a long creative note.');
  assert.equal(publicCaption('Browser MP4 from storyboard ideas for my project'), 'Browser MP4 from storyboard ideas for my project');
});

test('Share provenance is narrowly recognised with safe source links', async () => {
  const { shareImportProvenance } = await import('../public/asset-caption.js');
  const caption = 'https://woodhouse.loftwah.com/api/v1/assets/crown-jelly\nhttps://woodhouse.loftwah.com/source/notes\nWoodhouse · model';
  assert.deepEqual(shareImportProvenance(caption), { catalogue: 'https://woodhouse.loftwah.com/api/v1/assets/crown-jelly', source: 'https://woodhouse.loftwah.com/source/notes', credit: 'Woodhouse · model' });
  assert.equal(publicCaption(caption), caption);
  for (const value of ['A descriptive caption with https://example.com', 'https://woodhouse.loftwah.com/api/v1/assets/crown-jelly\nhttps://evil.example/notes\nCredit', 'https://woodhouse.loftwah.com.evil.example/api/v1/assets/crown-jelly\nCredit', caption + '\nMy own description']) assert.equal(shareImportProvenance(value), null);
});
