// MIT. Typed video and audio metadata read from the bytes themselves, with no
// storage, network or DOM access. util.mjs re-exports these same names.

export interface VideoMetadata {
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

export type AudioFormat = "mp3" | "wav" | "m4a" | null;

export interface AudioMetadata {
  durationMs: number | null;
  sampleRate: number | null;
  channels: number | null;
  format: AudioFormat;
}

/** Best-effort MP4 duration and display dimensions from mvhd/tkhd boxes. */
export function videoInfo(bytes: Uint8Array): VideoMetadata {
  let durationMs: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

  const readBoxes = (start: number, end: number, depth = 0) => {
    if (depth > 3) return;
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      const type = ascii(offset + 4);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) return;
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) return;

      if (type === "moov" || type === "trak" || type === "mdia") {
        readBoxes(offset + header, offset + size, depth + 1);
      }
      if (type === "mvhd" && durationMs === null) {
        const version = bytes[offset + header];
        const base = offset + header + 4;
        if (base + (version === 1 ? 32 : 20) <= end) {
          const timescale = version === 1 ? view.getUint32(base + 16) : view.getUint32(base + 8);
          const duration = version === 1 ? Number(view.getBigUint64(base + 20)) : view.getUint32(base + 12);
          if (timescale > 0 && Number.isFinite(duration))
            durationMs = Math.round((duration / timescale) * 1000);
        }
      }
      if (type === "tkhd" && width === null) {
        const version = bytes[offset + header];
        const payload = offset + header;
        const widthOffset = version === 1 ? 88 : 76;
        const heightOffset = widthOffset + 4;
        if (payload + heightOffset + 4 <= end) {
          const w = view.getUint32(payload + widthOffset) / 65536;
          const h = view.getUint32(payload + heightOffset) / 65536;
          if (w >= 16 && h >= 16) {
            width = Math.round(w);
            height = Math.round(h);
          }
        }
      }
      offset += size;
    }
  };

  readBoxes(0, bytes.length);
  return { durationMs, width, height };
}

/** WAV, MP3 and MP4-family audio, read from the bytes rather than the label. */
export function audioInfo(bytes: Uint8Array): AudioMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length = 4) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));

  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") {
    let offset = 12;
    let channels: number | null = null;
    let sampleRate: number | null = null;
    let byteRate: number | null = null;
    let durationMs: number | null = null;
    while (offset + 8 <= bytes.length) {
      const chunk = ascii(offset, 4);
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (chunk === "fmt " && start + 16 <= bytes.length) {
        channels = view.getUint16(start + 2, true) || null;
        sampleRate = view.getUint32(start + 4, true) || null;
        byteRate = view.getUint32(start + 8, true) || null;
      }
      if (chunk === "data") {
        const dataSize = Math.min(size, bytes.length - start);
        if (byteRate) durationMs = Math.round((dataSize / byteRate) * 1000);
      }
      offset = start + size + (size % 2);
    }
    return { durationMs, sampleRate, channels, format: "wav" };
  }

  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size =
      ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    return readMp3(bytes, view, Math.min(10 + size, bytes.length));
  }

  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return readMp3(bytes, view, 0);

  if (ascii(4, 4) === "ftyp") {
    const duration = videoInfo(bytes).durationMs;
    return { durationMs: duration, sampleRate: null, channels: null, format: "m4a" };
  }

  return { durationMs: null, sampleRate: null, channels: null, format: null };
}

function readMp3(bytes: Uint8Array, view: DataView, start: number): AudioMetadata {
  let offset = start;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const versionBits = (bytes[offset + 1] >> 3) & 0x03;
    const layerBits = (bytes[offset + 1] >> 1) & 0x03;
    const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
    const rateIndex = (bytes[offset + 2] >> 2) & 0x03;
    const padding = (bytes[offset + 2] >> 1) & 0x01;
    const mode = (bytes[offset + 3] >> 6) & 0x03;
    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
      offset += 1;
      continue;
    }
    const mpeg1 = versionBits === 3;
    const bitrates = mpeg1
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const rates = mpeg1
      ? [44100, 48000, 32000]
      : versionBits === 2
        ? [22050, 24000, 16000]
        : [11025, 12000, 8000];
    const bitrateKbps = bitrates[bitrateIndex];
    const sampleRate = rates[rateIndex];
    const samplesPerFrame = mpeg1 ? 1152 : 576;
    const frameLength = Math.floor((samplesPerFrame / 8) * ((bitrateKbps * 1000) / sampleRate)) + padding;

    // A Xing/Info header carries the real frame count, so a VBR file is not
    // misreported as its first frame's bitrate.
    const xingOffset = offset + 4 + (mpeg1 ? (mode === 3 ? 17 : 32) : mode === 3 ? 9 : 17);
    const tag = String.fromCharCode(...bytes.slice(xingOffset, xingOffset + 4));
    if (tag === "Xing" || tag === "Info") {
      const flags = view.getUint32(xingOffset + 4);
      if (flags & 0x0001) {
        const frames = view.getUint32(xingOffset + 8);
        return {
          durationMs: Math.round((frames * samplesPerFrame * 1000) / sampleRate),
          sampleRate,
          channels: mode === 3 ? 1 : 2,
          format: "mp3",
        };
      }
    }
    const audioBytes = Math.max(0, bytes.length - offset);
    return {
      durationMs: Math.round((audioBytes * 8 * 1000) / (bitrateKbps * 1000)),
      sampleRate,
      channels: mode === 3 ? 1 : 2,
      format: "mp3",
    };
  }
  return { durationMs: null, sampleRate: null, channels: null, format: null };
}
