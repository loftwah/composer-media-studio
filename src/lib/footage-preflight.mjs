// Read-only source measurements; this does not submit media to a provider.
import { BufferSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';
import { HttpError, sha256Hex } from './util.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_PACKETS = 700;
export async function measureFootageSource(env, asset) {
  if (asset.deleted_at || asset.kind !== 'video' || asset.mime !== 'video/mp4') throw new HttpError(400, 'Choose a saved MP4 video.', 'invalid_source');
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_BYTES) throw new HttpError(400, 'This local preflight supports files up to 16 MiB.', 'source_too_large');
  const object = await env.MEDIA.get(asset.r2_key);
  if (!object) throw new HttpError(410, 'The source bytes are unavailable.', 'source_unavailable');
  if (Number.isSafeInteger(object.size) && object.size !== asset.bytes) throw new HttpError(409, 'The source bytes do not match their saved size.', 'source_changed');
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== asset.bytes || await sha256Hex(bytes) !== asset.sha256) throw new HttpError(409, 'The source bytes do not match their saved fingerprint.', 'source_changed');
  const input = new Input({formats:[MP4],source:new BufferSource(bytes)});
  try {
    const tracks = await input.getVideoTracks();
    if (tracks.length !== 1) throw new HttpError(400, 'This preflight needs exactly one video track.', 'unsupported_source');
    const video = tracks[0], width = await video.getDisplayWidth(), height = await video.getDisplayHeight(), codedWidth = await video.getCodedWidth(), codedHeight = await video.getCodedHeight();
    const duration = await video.computeDuration(), first = await video.getFirstTimestamp();
    if (!Number.isFinite(duration) || !Number.isFinite(first) || Math.abs(first) > .001 || duration < 3 || duration > 10.05) throw new HttpError(400, 'This preflight needs a 3–10.05 second clip starting at zero.', 'unsupported_duration');
    let count = 0, minInterval = Infinity, maxInterval = 0;
    for await (const packet of new EncodedPacketSink(video).packets(undefined,undefined,{metadataOnly:true})) {
      if (++count > MAX_PACKETS || !Number.isFinite(packet.duration) || packet.duration <= 0) throw new HttpError(400, 'The video frame timing cannot be measured within local limits.', 'unsupported_timing');
      minInterval = Math.min(minInterval,packet.duration); maxInterval = Math.max(maxInterval,packet.duration);
    }
    if (!count || ![width,height,codedWidth,codedHeight].every(value => Number.isFinite(value) && value > 0)) throw new HttpError(400, 'The video frame information is unavailable.', 'unsupported_source');
    return { source: { assetId:asset.id, sha256:asset.sha256, bytes:asset.bytes }, video: { width,height,codedWidth,codedHeight,durationSeconds:duration,frames:count,averageFps:count/duration,minimumPacketFps:1/maxInterval,maximumPacketFps:1/minInterval }, note:'Measured from the stored file; provider availability, acceptance and resulting motion are not verified.' };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'The MP4 could not be inspected safely.', 'unsupported_source');
  } finally { input.dispose(); }
}
