import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const js = readFileSync(new URL('../public/studio.js', import.meta.url), 'utf8');
  const clear = js.slice(js.indexOf('function clearMixPreview()'), js.indexOf("window.addEventListener('pagehide', clearMixPreview)"));
  const mix = js.slice(js.indexOf('async function mixSoundtrack('), js.indexOf('/* ---------- deterministic 9:16 slate'));
  let finish;
  const player = { hidden: true, pause() { this.paused = true; }, removeAttribute() { this.src = ''; }, load() {} };
  const revoked = [], uploaded = [];
  class Offline {
    decodeAudioData() { return Promise.resolve({ duration: 1 }); }
    createBufferSource() { return { connect() { return { connect() {} }; }, start() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} } }; }
    startRendering() { return new Promise(resolve => { finish = resolve; }); }
  }
  const context = vm.createContext({ document: { querySelector: () => player }, URL: { createObjectURL: () => 'blob:preview', revokeObjectURL: url => revoked.push(url) }, window: { AudioContext: function() {} }, OfflineAudioContext: Offline, structuredClone, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }), encodeWav: () => new Blob(['wave']), Blob, notify() {}, uploadBlob: (...args) => { uploaded.push(args); }, draftDuration: () => 2000, state: { projectId: 'p1', project: { assets: [{ id: 'a1', kind: 'audio', file: '/private', title: 'tone' }] }, compose: { shotIds: ['v1','v2'], audioTracks: [{ assetId: 'a1', trimEndMs: 1000 }], audioAssetId: null } } });
  vm.runInContext(`let mixPreviewUrl=null; let mixPreviewVersion=0; ${clear}\n${mix}\nthis.start=mixSoundtrack; this.clear=clearMixPreview;`, context);
  return { context, player, revoked, uploaded, finish: async () => { while (!finish) await new Promise(resolve => setImmediate(resolve)); finish({}); } };
}
test('preview never uploads, and clearing stops and revokes the local player', async () => {
  const f = fixture(); const pending = f.context.start({ preview: true }); await f.finish(); await pending;
  assert.equal(f.player.src, 'blob:preview'); assert.equal(f.player.hidden, false); assert.equal(f.uploaded.length, 0); assert.equal(f.context.state.compose.audioAssetId, null);
  f.context.clear(); assert.equal(f.player.paused, true); assert.equal(f.player.hidden, true); assert.deepEqual(f.revoked, ['blob:preview']);
});
test('a changed storyboard cancels an in-flight preview', async () => {
  const f = fixture(); const pending = f.context.start({ preview: true }); await f.finish(); f.context.clear();
  await assert.rejects(pending, /storyboard changed/); assert.equal(f.uploaded.length, 0); assert.notEqual(f.player.src, 'blob:preview');
});
