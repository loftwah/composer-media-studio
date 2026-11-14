import { useEffect, useRef, useState } from 'react';
import type { MediaAssetV1 } from './contracts';
import './footage-plans.css';
import { validateExportSnapshot, type ExportPlan as Plan, type ExportScene as Scene } from './footage-scene-validation';

type Frame = '16:9' | '9:16' | '1:1';
type Fit = 'contain' | 'cover';
const MAX_INPUT = 128 * 1024 * 1024, MAX_OUTPUT = 64 * 1024 * 1024;
const sizes: Record<Frame, [number, number]> = { '16:9': [640, 360], '9:16': [360, 640], '1:1': [480, 480] };
const cancelled = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };

async function readBounded(asset: MediaAssetV1, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_INPUT) throw new Error('The source must be under 128 MiB.');
  const url = new URL(asset.file, location.origin);
  if (url.origin !== location.origin || url.pathname !== `/api/assets/${asset.id}/file` || url.search || url.hash) throw new Error('The source file address is invalid.');
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal });
  if (!response.ok || !response.body) throw new Error('Could not read the source video.');
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try { while (true) { cancelled(signal); const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if (size > asset.bytes || size > MAX_INPUT) throw new Error('The source exceeded its recorded size.'); chunks.push(value); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  if (size !== asset.bytes) throw new Error('The source did not match its recorded size.');
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2,'0')).join('');
  cancelled(signal); if (hash !== asset.sha256) throw new Error('The source fingerprint changed; reload the cut map.');
  return bytes;
}

async function loadSaved(projectId: string, plan: Plan, scene: Scene, signal: AbortSignal): Promise<MediaAssetV1> {
  const base = `/api/projects/${encodeURIComponent(projectId)}`;
  const [projectResponse, plansResponse] = await Promise.all([fetch(base, {credentials:'same-origin',signal}), fetch(`${base}/footage-plans`, {credentials:'same-origin',signal})]);
  if (!projectResponse.ok || !plansResponse.ok) throw new Error('Could not check the saved cut map and source. Sign in and try again.');
  const project = await projectResponse.json(), plans = await plansResponse.json();
  const current: Plan | undefined = Array.isArray(plans.plans) ? plans.plans.find((item: Plan) => item.id === plan.id) : undefined;
  return validateExportSnapshot(plan, scene, current, Array.isArray(project.assets) ? project.assets : []);
}

export function FootageSceneExport({ projectId, plan, scene, index, disabled }: { projectId: string; plan: Plan; scene: Scene; index: number; disabled: boolean }) {
  const [frame, setFrame] = useState<Frame>('16:9'); const [fit, setFit] = useState<Fit>('contain');
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState(''); const [result, setResult] = useState(''); const [resultSettings, setResultSettings] = useState('');
  const task = useRef<AbortController | null>(null); const resultUrl = useRef('');
  useEffect(() => () => { task.current?.abort(); if (resultUrl.current) URL.revokeObjectURL(resultUrl.current); }, []);
  const exportScene = async () => {
    if (task.current || disabled) return;
    const controller = new AbortController(); task.current = controller; setBusy(true); setStatus('Checking the saved scene and source…');
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current); resultUrl.current = ''; setResult('');
    try {
      const asset = await loadSaved(projectId, plan, scene, controller.signal);
      const bytes = await readBounded(asset, controller.signal);
      const {ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output} = await import('mediabunny'); cancelled(controller.signal);
      const input = new Input({formats: ALL_FORMATS, source: new BlobSource(new Blob([bytes], {type:asset.mime}))});
      try {
        const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
        if (!video || !await video.canDecode() || (audio && !await audio.canDecode())) throw new Error('This browser cannot decode the source video and audio.');
        const w = await video.getCodedWidth(), h = await video.getCodedHeight(), first = await video.getFirstTimestamp(), last = await video.computeDuration();
        if (!w || !h || w > 4096 || h > 4096 || w*h > 8294400) throw new Error('The source frame exceeds the local 4K limit.');
        if (!Number.isFinite(first) || Math.abs(first) > 0.001 || !Number.isFinite(last) || Math.abs((last-first)*1000-asset.durationMs!) > 100 || scene.sourceEndMs/1000 > last) throw new Error('The decoded source timing differs from the saved source. This clip cannot be exported safely.');
        const [width,height] = sizes[frame]; const target = new BufferTarget(); const output = new Output({format:new Mp4OutputFormat({fastStart:'in-memory'}),target});
        const conversion = await Conversion.init({input,output,tracks:'primary',trim:{start:scene.sourceStartMs/1000,end:scene.sourceEndMs/1000},tags:{},showWarnings:false,video:{width,height,fit,codec:'avc',bitrate:1200000,forceTranscode:true},audio:{codec:'aac',bitrate:128000,forceTranscode:true}});
        const cancel = () => { void conversion.cancel().catch(() => {}); }; controller.signal.addEventListener('abort',cancel,{once:true});
        try {
          cancelled(controller.signal);
          if (!conversion.isValid || !conversion.utilizedTracks.includes(video) || (audio && !conversion.utilizedTracks.includes(audio))) throw new Error('This browser cannot encode the selected video and original audio as MP4.');
          conversion.onProgress = value => { if (!controller.signal.aborted) setStatus(`Exporting on this device: ${Math.round(value*100)}%`); };
          await conversion.execute(); cancelled(controller.signal);
        } finally { controller.signal.removeEventListener('abort',cancel); }
        if (!target.buffer?.byteLength || target.buffer.byteLength > MAX_OUTPUT) throw new Error('The output is empty or exceeds 64 MiB.');
        const blob = new Blob([target.buffer],{type:'video/mp4'}); const check = new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
        try { const outVideo = await check.getPrimaryVideoTrack(), outAudio = await check.getPrimaryAudioTrack(); if (!outVideo || (audio && !outAudio) || Math.abs((await outVideo.computeDuration()) - (scene.sourceEndMs-scene.sourceStartMs)/1000) > .15) throw new Error('The finished clip did not match the selected duration or audio.'); } finally { check.dispose(); }
        cancelled(controller.signal); const verified = await loadSaved(projectId, plan, scene, controller.signal);
        if (verified.sha256 !== asset.sha256 || verified.bytes !== asset.bytes) throw new Error('The source changed during export. Reload the cut map.');
        cancelled(controller.signal); resultUrl.current = URL.createObjectURL(blob); setResult(resultUrl.current); setResultSettings(`${frame}, ${fit === 'cover' ? 'centre crop' : 'whole frame'}`); setStatus(audio ? 'Clip ready with the primary original audio track. Check playback before downloading.' : 'Clip ready. This source has no primary audio track.');
      } finally { input.dispose(); }
    } catch (error) { setStatus(controller.signal.aborted ? 'Export cancelled. The source is unchanged.' : error instanceof Error ? error.message : 'The clip could not be exported.'); }
    finally { if (task.current === controller) {task.current = null; setBusy(false);} }
  };
  return <details><summary>Export original scene {index + 1}</summary><p className="small">Exports this saved source range on this device, with the primary original audio track if present; other tracks are not included. It does not restyle or publish. Source: up to 3 minutes and 128 MiB; scene: up to 60 seconds. Compatible browser codecs required.</p><label>Output frame<select value={frame} disabled={busy} onChange={e => setFrame(e.target.value as Frame)}><option value="16:9">Landscape 16:9</option><option value="9:16">Portrait 9:16</option><option value="1:1">Square 1:1</option></select></label><label>Fit<select value={fit} disabled={busy} onChange={e => setFit(e.target.value as Fit)}><option value="contain">Show whole frame (may add bars)</option><option value="cover">Fill frame (centre crops edges)</option></select></label><p className="small">{fit === 'cover' ? 'Fill removes edges; check the finished clip before downloading.' : 'Show whole frame preserves the picture; bars may appear.'} The browser re-encodes video and audio; timing follows available frames and AAC can add a short tail.</p>{disabled && <p className="small">Save or discard cut-map changes before exporting the saved scene.</p>}<button type="button" disabled={disabled || busy} onClick={() => void exportScene()}>Make original clip</button>{busy && <button type="button" className="secondary" onClick={() => task.current?.abort()}>Cancel export</button>}<p className="small" role="status">{status}</p>{result && <><p className="small">Exported {resultSettings}. Changing options applies to the next export.</p><video className="footage-export-preview" controls playsInline preload="metadata" src={result} aria-label={`Preview exported original scene ${index + 1}`} /><a className="button secondary" href={result} download={`studio-original-scene-${index+1}.mp4`}>Download MP4</a></>}</details>;
}
