export type FrameAspect = 'source' | '16:9' | '9:16' | '1:1';
export type FrameFit = 'contain' | 'cover';
export type Framing = { aspect: FrameAspect; fit: FrameFit };
export const defaultFraming: Framing = { aspect: 'source', fit: 'contain' };

/** Fixed bounded output sizes; source means the first shot's orientation. */
export function resolveFrame(framing: Framing, first: { width: number | null; height: number | null }) {
  if (!['source', '16:9', '9:16', '1:1'].includes(framing.aspect) || !['contain', 'cover'].includes(framing.fit)) throw new Error('Choose a valid output frame and fit.');
  if (framing.aspect === '16:9') return { width: 640, height: 360, fit: framing.fit };
  if (framing.aspect === '9:16') return { width: 360, height: 640, fit: framing.fit };
  if (framing.aspect === '1:1') return { width: 480, height: 480, fit: framing.fit };
  if (!first.width || !first.height || first.width <= 0 || first.height <= 0) throw new Error('The first clip has no measured frame size.');
  return first.width > first.height ? { width: 640, height: 360, fit: framing.fit } : first.width < first.height ? { width: 360, height: 640, fit: framing.fit } : { width: 480, height: 480, fit: framing.fit };
}

export function framingNote(frame: { width: number; height: number; fit: FrameFit }) {
  return `Media Studio local render; frame ${frame.width}x${frame.height}; fit ${frame.fit === 'cover' ? 'centre-fill (cropped)' : 'contain'}`;
}
