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
  assert.match(html, /View image →/);
  assert.match(publicGallery({items:[{slug:"sound",kind:"audio",title:"A sound"}]}), /Listen →/);
});

test('gallery cards shorten source URLs while the published detail retains the full authored text', async () => {
  const { publicPage } = await import('../src/lib/ui.mjs');
  const description = 'A six-second study. Source: https://woodhouse.example/api/assets/new-074. Original by Woodhouse.';
  const card = publicGallery({items:[{slug:'film_source',kind:'video',title:'LDraw motion',description}]});
  assert.match(card, /Source: see the work page\. Original by Woodhouse\./);
  assert.doesNotMatch(card, /https:\/\/woodhouse\.example\/api\/assets\/new-074/);
  assert.match(card, /href="\/p\/film_source"/);
  const detail = publicPage({origin:'https://studio.example',slug:'film_source',title:'LDraw motion',description,kind:'video',mime:'video/mp4',media:'/film.mp4',download:'/film.mp4'});
  assert.match(detail, /Source: <a href="https:\/\/woodhouse\.example\/api\/assets\/new-074">https:\/\/woodhouse\.example\/api\/assets\/new-074<\/a>\. Original by Woodhouse\./);
});


test('public home offers configured next steps while standalone installations omit them', () => {
  const { buildUrl, storyUrl } = { buildUrl: 'https://composer.example/init', storyUrl: 'https://composer.example/story' };
  const connected = publicGallery({home: true, buildUrl, storyUrl});
  assert.match(connected, /href="https:\/\/composer\.example\/init">Build your own studio/);
  assert.match(connected, /href="https:\/\/composer\.example\/story">Read the story/);
  const standalone = publicGallery({home: true});
  assert.doesNotMatch(standalone, /Build your own studio|Read the story/);
});

test('home highlights an existing published preview without changing the gallery', () => {
  const items = [ { slug: 'still', kind: 'image', title: 'Still' }, { slug: 'film', kind: 'video', title: 'A <film>', poster_asset_id: 'poster' } ];
  const home = publicGallery({home:true, items});
  assert.match(home, /class="gallery-hero-art" href="\/p\/film"/);
  assert.match(home, /A &lt;film&gt;/);
  assert.match(home, /class="gallery-card" href="\/p\/still"/);
  assert.doesNotMatch(publicGallery({items}), /gallery-hero-art/);
  assert.doesNotMatch(publicGallery({home:true,items:[{slug:'audio',kind:'audio',title:'Sound'}]}), /gallery-hero-art/);
});
