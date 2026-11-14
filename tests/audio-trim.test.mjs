import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../public/wav.js';

test('shared WAV encoder writes playable interleaved signed 16-bit PCM', async () => {
  const channels = [Float32Array.from([-1, 0.5]), Float32Array.from([1, -0.5])];
  const blob = encodeWav({ numberOfChannels: 2, length: 2, sampleRate: 48000, getChannelData: n => channels[n] });
  const bytes = await blob.arrayBuffer();
  const v = new DataView(bytes);
  assert.equal(blob.type, 'audio/wav');
  assert.equal(Buffer.from(bytes).toString('ascii', 0, 4), 'RIFF');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(40, true), 8);
  assert.deepEqual([44, 46, 48, 50].map(n => v.getInt16(n, true)), [-32768, 32767, 16383, -16384]);
});
