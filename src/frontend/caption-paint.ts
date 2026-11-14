import { captionLines, type CaptionSnapshot } from './local-captions.ts';

// Shared by the pre-render sample and the actual MP4 frame encoder.
export function createCaptionPainter(context: CanvasRenderingContext2D, width: number, height: number, captions?: CaptionSnapshot) {
  const fontSize = Math.max(18, Math.round(Math.min(width, height) * .05));
  const lineHeight = Math.round(fontSize * 1.3);
  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  const prepared = captions?.cues.map(cue => ({ ...cue, lines: captionLines(cue.speaker ? `${cue.speaker}: ${cue.text}` : cue.text, width * .84 - 24, text => context.measureText(text).width) })) ?? [];
  return (timeMs: number) => {
    const cue = prepared.find(item => timeMs >= item.startMs - captions!.sourceStartMs && timeMs < item.endMs - captions!.sourceStartMs);
    if (!cue) return;
    const boxWidth=width*.84, boxHeight=cue.lines.length*lineHeight+20, x=(width-boxWidth)/2, y=height*.9-boxHeight;
    context.save(); context.fillStyle='rgba(0,0,0,.88)'; context.fillRect(x,y,boxWidth,boxHeight);
    context.font=`600 ${fontSize}px system-ui, sans-serif`; context.fillStyle='#fff'; context.textAlign='center'; context.textBaseline='middle';
    cue.lines.forEach((line,index)=>context.fillText(line,width/2,y+10+lineHeight*(index+.5))); context.restore();
  };
}
