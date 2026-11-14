// Local-only, bounded H.264/AAC MP4. No provider, uploads or background jobs.
import { ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { CompositionV1, MediaAssetV1 } from './contracts';
import type { CaptionSnapshot } from './local-captions.ts';
import { createCaptionPainter } from './caption-paint';
import { shotRange } from '../../public/shot-trims.js';
import { defaultFraming, framingNote, resolveFrame, type Framing } from './local-framing.ts';

const MAX_INPUT = 128 * 1024 * 1024;
const MAX_OUTPUT = 64 * 1024 * 1024;
const FPS = 30;
function checkAbort(signal: AbortSignal) { if (signal.aborted) throw new DOMException('Rendering cancelled', 'AbortError'); }
async function readAsset(asset: MediaAssetV1, signal: AbortSignal): Promise<Blob> {
  const url = new URL(asset.file, location.origin);
  if (url.origin !== location.origin || !/^\/api\/assets\/[a-z0-9_]+\/file$/.test(url.pathname)) throw new Error('An input does not belong to this Studio.');
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal });
  if (!response.ok) throw new Error(`Could not read ${asset.title}.`);
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_INPUT) throw new Error(`${asset.title} is too large for local rendering.`);
  if (!response.body) throw new Error(`Could not read ${asset.title}.`);
  const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let total = 0;
  try {
    while (true) {
      checkAbort(signal); const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > MAX_INPUT || total > asset.bytes) throw new Error(`${asset.title} exceeded its recorded size.`);
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  if (total !== asset.bytes) throw new Error(`${asset.title} did not match its recorded size.`);
  return new Blob(chunks, { type: asset.mime });
}
export function validateLocalInputs(composition: CompositionV1, assets: MediaAssetV1[]) {
  const shots = composition.shots.map(shot => assets.find(asset => asset.id === shot.assetId && asset.kind === 'video'));
  if (shots.length < 2 || shots.length > 6 || shots.some(shot => !shot || !shot.durationMs || shot.durationMs <= 0 || shot.durationMs > 16000)) throw new Error('Choose two to six available video clips, each no longer than 16 seconds.');
  const clips = shots as MediaAssetV1[];
  const ranges = composition.shots.map((shot, index) => shotRange(shot, clips[index]));
  if (ranges.some(range => !range)) throw new Error('A saved shot has an invalid trim range. Open the storyboard and review it.');
  const selected = ranges as { start: number; end: number; durationMs: number }[];
  const totalMs = selected.reduce((sum, range) => sum + range.durationMs, 0);
  if (composition.totalMs !== undefined && composition.totalMs !== totalMs) throw new Error('The saved storyboard duration does not match its shots. Open it and save again.');
  if (totalMs > 60000 || totalMs <= 0) throw new Error('Keep the storyboard within 60 seconds.');
  const sound = composition.audioAssetId ? assets.find(asset => asset.id === composition.audioAssetId && asset.kind === 'audio') : undefined;
  if (composition.audioAssetId && !sound) throw new Error('The mixed soundtrack is no longer available.');
  if ((composition.audioTracks?.length ?? 0) > 0 && !sound) throw new Error('Open this storyboard and use Mix soundtrack first, then save it.');
  if (sound && (!sound.durationMs || Math.abs(sound.durationMs - totalMs) > 100)) throw new Error('The saved mixed soundtrack must match the storyboard duration. Mix and save it again.');
  if (sound && (sound.mime !== 'audio/wav' || sound.bytes > 16 * 1024 * 1024)) throw new Error('Use Mix soundtrack to save a WAV mix under 16 MiB before local rendering.');
  if ([...clips, ...(sound ? [sound] : [])].some(asset => !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) || clips.reduce((sum, asset) => sum + asset.bytes, sound?.bytes ?? 0) > MAX_INPUT) throw new Error('The selected media exceeds the 128 MiB local input limit or has an unknown size.');
  return { clips, ranges: selected, totalMs, sound };
}
export async function renderLocalMp4(composition: CompositionV1, assets: MediaAssetV1[], signal: AbortSignal, progress: (message: string) => void, captions?: CaptionSnapshot, framing: Framing = defaultFraming): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser does not support the required video encoder.');
  const { clips, ranges, totalMs, sound } = validateLocalInputs(composition, assets);
  if (sound && typeof AudioEncoder === 'undefined') throw new Error('This browser does not support the required audio encoder.');
  const first = clips[0];
  const outputFrame = resolveFrame(framing, first);
  const { width, height } = outputFrame;
  if (!await canEncodeVideo('avc', { width, height, bitrate: 1200000 }) || (sound && !await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 44100, bitrate: 128000 }))) throw new Error('This browser cannot encode the required H.264/AAC MP4. Try a current supported browser.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false }); if (!context) throw new Error('This browser cannot create a video canvas.');
  const paintCaption = createCaptionPainter(context, width, height, captions);
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  output.setMetadataTags({ comment: framingNote(outputFrame) });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 1200000 }); output.addVideoTrack(video, { frameRate: FPS });
  let audio: AudioBufferSource | undefined;
  let mixed: AudioBuffer | undefined;
  if (sound) {
    progress('Reading the mixed soundtrack…');
    const bytes = await (await readAsset(sound, signal)).arrayBuffer(); checkAbort(signal);
    const offline = new OfflineAudioContext(2, Math.ceil(totalMs * 44.1), 44100);
    const decoded = await offline.decodeAudioData(bytes);
    if (Math.abs(decoded.duration * 1000 - totalMs) > 100) throw new Error('The decoded soundtrack does not match the storyboard duration. Mix and save it again.');
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start(0);
    mixed = await offline.startRendering(); checkAbort(signal);
    audio = new AudioBufferSource({ codec: 'aac', bitrate: 128000 }); output.addAudioTrack(audio);
  }
  try {
    await output.start();
    const writeAudio = async () => { if (audio && mixed) { await audio.add(mixed); audio.close(); } };
    const writeVideo = async () => {
      let cursor = 0;
      for (const [index, clip] of clips.entries()) {
        checkAbort(signal); progress(`Rendering clip ${index + 1} of ${clips.length}…`);
        const blob = await readAsset(clip, signal); checkAbort(signal);
        const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
        try {
          const track = await input.getPrimaryVideoTrack();
          if (!track || !await track.canDecode()) throw new Error(`${clip.title} cannot be decoded by this browser.`);
          const codedWidth = await track.getCodedWidth(), codedHeight = await track.getCodedHeight();
          if (codedWidth <= 0 || codedHeight <= 0 || codedWidth > 4096 || codedHeight > 4096 || codedWidth * codedHeight > 8294400) throw new Error(`${clip.title} exceeds the local 4K input limit.`);
          const firstTime = await track.getFirstTimestamp();
          const endTime = await track.computeDuration();
          const actualDuration = endTime - firstTime;
          if (!Number.isFinite(firstTime) || !Number.isFinite(endTime) || Math.abs(actualDuration * 1000 - clip.durationMs!) > 100) throw new Error(`${clip.title} has a different decoded duration. Re-upload or choose another clip.`);
          const range = ranges[index];
          const duration = range.durationMs / 1000;
          const frames = Math.ceil(duration * FPS);
          const times = Array.from({ length: frames }, (_, frame) => firstTime + range.start / 1000 + frame / FPS);
          if (times.at(-1)! >= endTime) throw new Error(`${clip.title} ends before the selected trim. Review this shot.`);
          const sink = new CanvasSink(track, { width, height, fit: outputFrame.fit, poolSize: 2 });
          let frame = 0;
          for await (const sample of sink.canvasesAtTimestamps(times)) {
            checkAbort(signal);
            if (!sample) throw new Error(`${clip.title} has a missing video frame.`);
            context.drawImage(sample.canvas, 0, 0, width, height);
            paintCaption((cursor + frame / FPS) * 1000);
            await video.add(cursor + frame / FPS, Math.min(1 / FPS, duration - frame / FPS), { keyFrame: frame === 0 });
            frame++;
          }
          if (frame !== frames) throw new Error(`${clip.title} ended before all frames were read.`);
          cursor += duration;
        } finally { input.dispose(); }
      }
      video.close();
    };
    await Promise.all([writeAudio(), writeVideo()]); checkAbort(signal); progress('Finishing the MP4…');
    await output.finalize(); checkAbort(signal);
    if (!target.buffer || target.buffer.byteLength === 0 || target.buffer.byteLength > MAX_OUTPUT) throw new Error('The local MP4 is empty or exceeds the 64 MiB Studio limit.');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (error) { await output.cancel().catch(() => {}); throw error; }
}
