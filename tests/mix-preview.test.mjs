import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture(track = { assetId: 'a1', trimEndMs: 1000 }, totalMs = 2000) {
  const js = readFileSync(new URL('../public/studio.js', import.meta.url), 'utf8');
  const clear = js.slice(js.indexOf('function clearMixPreview()'), js.indexOf("window.addEventListener('pagehide', clearMixPreview)"));
  const mix = js.slice(js.indexOf('async function mixSoundtrack('), js.indexOf('/* ---------- deterministic 9:16 slate'));
  let finish;
  const player = { hidden: true, pause() { this.paused = true; }, removeAttribute() { this.src = ''; }, load() {} };
  const revoked = [], uploaded = [], starts = [], automation = [];
  class Offline {
    decodeAudioData() { return Promise.resolve({ duration: 30 }); }
    createBufferSource() { return { connect() { return { connect() {} }; }, start(...args) { starts.push(args); } }; }
    createGain() { return { gain: {
      setValueAtTime(value, time) { automation.push(['setValueAtTime', value, time]); },
      linearRampToValueAtTime(value, time) { automation.push(['linearRampToValueAtTime', value, time]); },
    } }; }
    startRendering() { return new Promise(resolve => { finish = resolve; }); }
  }
  const context = vm.createContext({ document: { querySelector: () => player }, URL: { createObjectURL: () => 'blob:preview', revokeObjectURL: url => revoked.push(url) }, window: { AudioContext: function() {} }, OfflineAudioContext: Offline, structuredClone, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }), encodeWav: () => new Blob(['wave']), Blob, notify() {}, uploadBlob: (...args) => { uploaded.push(args); }, draftDuration: () => totalMs, state: { projectId: 'p1', project: { assets: [{ id: 'a1', kind: 'audio', file: '/private', title: 'tone' }] }, compose: { shotIds: ['v1','v2'], audioTracks: [track], audioAssetId: null } } });
  vm.runInContext(`let mixPreviewUrl=null; let mixPreviewVersion=0; ${clear}\n${mix}\nthis.start=mixSoundtrack; this.clear=clearMixPreview;`, context);
  return { context, player, revoked, uploaded, starts, automation, finish: async () => { while (!finish) await new Promise(resolve => setImmediate(resolve)); finish({}); } };
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
test('the preview applies the track start, trim, gain and fades to the saved WAV', async () => {
  const f = fixture({ assetId: 'a1', role: 'music', startMs: 500, trimStartMs: 1000, trimEndMs: 5000, gainDb: -6, fadeInMs: 1000, fadeOutMs: 500 }, 6000);
  const pending = f.context.start({ preview: true }); await f.finish(); await pending;
  assert.deepEqual(f.starts, [[0.5, 1, 4]], 'source starts at 0.5s, 1s into the track, for 4s');
  const level = 10 ** (-6 / 20);
  assert.deepEqual(f.automation.map(([method]) => method), ['setValueAtTime', 'linearRampToValueAtTime', 'setValueAtTime', 'linearRampToValueAtTime']);
  assert.ok(Math.abs(f.automation[0][1] - 0.0001) < 1e-12); assert.equal(f.automation[0][2], 0.5);
  assert.ok(Math.abs(f.automation[1][1] - level) < 1e-9); assert.equal(f.automation[1][2], 1.5);
  assert.ok(Math.abs(f.automation[2][1] - level) < 1e-9); assert.equal(f.automation[2][2], 4);
  assert.ok(Math.abs(f.automation[3][1] - 0.0001) < 1e-12); assert.equal(f.automation[3][2], 4.5);
  assert.equal(f.uploaded.length, 0);
});
