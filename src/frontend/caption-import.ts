/** Bounded, plain-text SRT/WebVTT import. Times are relative to the chosen song segment. */
export type ImportedCue = { startMs:number;endMs:number;text:string;speaker:string };
const fail = (message:string):never => {throw new Error(message);};
function timestamp(value:string, format:'srt'|'vtt'):number {
  const match = format === 'srt' ? /^(\d{2,}):(\d{2}):(\d{2}),(\d{3})$/.exec(value) : /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
  if (!match) return fail('Use standard SRT or WebVTT timestamps with milliseconds.');
  const hours=Number(match[1] ?? 0),minutes=Number(match[2]),seconds=Number(match[3]),ms=Number(match[4]);
  if (minutes>59 || seconds>59) return fail('A caption timestamp is invalid.');
  const valueMs=((hours*60+minutes)*60+seconds)*1000+ms;
  if (!Number.isSafeInteger(valueMs)) return fail('A caption timestamp is too large.');
  return valueMs;
}
function plainText(value:string, format:'srt'|'vtt'):string {
  let result=value.split('\n').map(line=>line.trim()).join(' ').trim();
  if (format === 'srt') result=result.replace(/&(?:lt|gt);/g,entity=>({'&lt;':'<','&gt;':'>'}[entity]!));
  if (format === 'vtt') {
    if (/&(?!(?:amp|lt|gt);)(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(result)) return fail('This WebVTT uses unsupported character entities.');
    result=result.replace(/&(?:amp|lt|gt);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>'}[entity]!));
  }
  if (!result || result.length>300 || /[\u0000-\u001f\u007f\ufffd]/.test(result)) return fail('Each caption needs plain text of at most 300 characters.');
  return result;
}
export function parseCaptionFile(source:string, segmentStartMs:number, segmentEndMs:number):ImportedCue[] {
  if (typeof source !== 'string' || source.length>65536 || !Number.isSafeInteger(segmentStartMs) || !Number.isSafeInteger(segmentEndMs) || segmentStartMs<0 || segmentEndMs<=segmentStartMs) return fail('The file or selected segment is invalid.');
  let content=source.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n').trim();
  const format = /^WEBVTT(?:\s|$)/.test(content) ? 'vtt' : 'srt';
  if (format === 'vtt') { const first=content.indexOf('\n'); if(first<0 || !/^WEBVTT[ \t]*$/.test(content.slice(0,first))) return fail('Use a plain WebVTT file without header metadata.'); content=content.slice(first+1).trim(); }
  if (!content) return fail('The file has no captions.');
  const blocks=content.split(/\n[ \t]*\n/);if(blocks.length>100)return fail('Import at most 100 captions.');
  let previousEnd=0;const cues:ImportedCue[]=[];
  for(const [index,block] of blocks.entries()) {
    const lines=block.split('\n');let timing=lines.shift()?.trim() ?? '';
    if(!timing.includes('-->')) {if(format==='srt' && !/^\d+$/.test(timing))return fail(`Caption ${index+1} has an invalid identifier.`);if(format==='vtt' && (!timing || timing.length>120))return fail(`Caption ${index+1} has an invalid identifier.`);timing=lines.shift()?.trim() ?? '';}
    const parts=/^(\S+)\s+-->\s+(\S+)$/.exec(timing);if(!parts)return fail(`Caption ${index+1} has unsupported timing or settings.`);
    const from=timestamp(parts[1],format),to=timestamp(parts[2],format);
    if(from<previousEnd || to<=from || to>segmentEndMs-segmentStartMs)return fail(`Caption ${index+1} overlaps another or lies outside the selected segment.`);
    const raw=lines.join('\n');if(/<\/?[a-z][^>]*>/i.test(raw))return fail('Remove caption markup and styling before import.');
    cues.push({startMs:segmentStartMs+from,endMs:segmentStartMs+to,text:plainText(raw,format),speaker:''});previousEnd=to;
  }
  return cues;
}
