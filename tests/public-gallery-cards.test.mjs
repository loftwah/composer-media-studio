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

test('gallery cards shorten source URLs while the published detail retains the full authored text', async () => {
  const { publicPage } = await import('../src/lib/ui.mjs');
  const description = 'A six-second study. Source: https://woodhouse.example/api/assets/new-074. Original by Woodhouse.';
  const card = publicGallery({items:[{slug:'film_source',kind:'video',title:'LDraw motion',description}]});
  assert.match(card, /Source: see full description\. Original by Woodhouse\./);
  assert.doesNotMatch(card, /https:\/\/woodhouse\.example\/api\/assets\/new-074/);
  assert.match(card, /href="\/p\/film_source"/);
  const detail = publicPage({origin:'https://studio.example',slug:'film_source',title:'LDraw motion',description,kind:'video',mime:'video/mp4',media:'/film.mp4',download:'/film.mp4'});
  assert.match(detail, /Source: https:\/\/woodhouse\.example\/api\/assets\/new-074\. Original by Woodhouse\./);
});
