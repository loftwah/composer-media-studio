export type FrameAspect = 'source' | '16:9' | '9:16' | '1:1';
export type FrameFit = 'contain' | 'cover';
export type FrameQuality = 'standard' | 'hd';
export type Framing = { aspect: FrameAspect; fit: FrameFit; quality?: FrameQuality };
export const defaultFraming: Framing = { aspect: 'source', fit: 'contain' };

/** Fixed bounded output sizes; source means the first shot's orientation. */
export function resolveFrame(framing: Framing, first: { width: number | null; height: number | null }) {
  if (!['source', '16:9', '9:16', '1:1'].includes(framing.aspect) || !['contain', 'cover'].includes(framing.fit) || !['standard','hd'].includes(framing.quality ?? 'standard')) throw new Error('Choose a valid output frame and fit.');
  let aspect=framing.aspect;
  if (aspect === 'source') {
    if (!first.width || !first.height || first.width <= 0 || first.height <= 0) throw new Error('The first clip has no measured frame size.');
    aspect=first.width > first.height ? '16:9' : first.width < first.height ? '9:16' : '1:1';
  }
  const dimensions = framing.quality === 'hd' ? {'16:9':[1280,720],'9:16':[720,1280],'1:1':[720,720]} : {'16:9':[640,360],'9:16':[360,640],'1:1':[480,480]};
  const [width,height] = dimensions[aspect];
  return {width,height,fit:framing.fit};
}

export function framingNote(frame: { width: number; height: number; fit: FrameFit }) {
  return `Media Studio local render; frame ${frame.width}x${frame.height}; fit ${frame.fit === 'cover' ? 'centre-fill (cropped)' : 'contain'}`;
}
