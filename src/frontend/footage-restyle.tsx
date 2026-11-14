import { useEffect, useRef, useState } from 'react';
import './footage-plans.css';

type Measurement = { source: { assetId: string; sha256: string }; video: { width: number; height: number; codedWidth: number; codedHeight: number; durationSeconds: number; averageFps: number; minimumPacketFps: number; maximumPacketFps: number } };

/** Uses the same saved-source preflight and generation endpoint as scene exports. */
export function FootageRestyle({ projectId, assetId }: { projectId: string; assetId: string }) {
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [measurementStatus, setMeasurementStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [rights, setRights] = useState(false);
  const [consent, setConsent] = useState(false);
  const [keepAudio, setKeepAudio] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [done, setDone] = useState(false);
  const task = useRef<AbortController | null>(null);
  const request = useRef<Record<string, unknown> | null>(null);
  useEffect(() => () => { task.current?.abort(); }, []);

  const measure = async () => {
    if (busy || attempted || task.current) return;
    const controller = new AbortController(); task.current = controller; setBusy(true); setMeasurement(null); setMeasurementStatus('Measuring the saved clip…');
    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}/footage-preflight`, { credentials: 'same-origin', signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not measure this clip.');
      if (data.measurement?.source?.assetId !== assetId) throw new Error('The measurement did not match this clip.');
      setMeasurement(data.measurement); setMeasurementStatus('Measurement complete.');
    } catch (error) { setMeasurementStatus(error instanceof Error ? error.message : 'Could not measure this clip.'); }
    finally { if (task.current === controller) { task.current = null; setBusy(false); } }
  };
  const withinLimits = measurement && [measurement.video.width, measurement.video.height, measurement.video.codedWidth, measurement.video.codedHeight].every(n => n >= 720 && n <= 2160) && measurement.video.minimumPacketFps >= 24 && measurement.video.maximumPacketFps <= 60;
  const estimateMicro = measurement ? Math.ceil(measurement.video.durationSeconds) * 168000 : 0;
  const submit = async () => {
    if (!measurement || !withinLimits || busy || task.current || done) return;
    if (!request.current) {
      if (!direction.trim() || !rights || !consent || measurement.source.assetId !== assetId) { setStatus('Add a direction and confirm both permissions.'); return; }
      request.current = { kind: 'video', model: 'kling-o1-restyle', clientRequestId: `restyle_${crypto.randomUUID().replaceAll('-', '')}`, prompt: direction.trim(), sourceAssetId: assetId, sourceSha256: measurement.source.sha256, durationSeconds: measurement.video.durationSeconds, maxCostMicro: estimateMicro, keepAudio, rightsConfirmed: true, providerConsent: true };
    }
    setAttempted(true); const controller = new AbortController(); task.current = controller; setBusy(true); setStatus('Submitting the reviewed request…');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/generations`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request.current), signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || 'Request could not be submitted.');
      window.dispatchEvent(new CustomEvent('studio:restyle-submitted', { detail: { projectId, result: data } }));
      setDone(true); setStatus(`Job ${data.generation.status}. Follow its progress in History.`);
    } catch (error) { setStatus(`${error instanceof Error ? error.message : 'Request result unavailable.'} Retry uses the same request ID; check History before starting another.`); }
    finally { if (task.current === controller) { task.current = null; setBusy(false); } }
  };
  return <div className="footage-restyle stack">
    <p>Check this saved MP4 before editing it with Kling O1. Your original stays in the library.</p>
    <button type="button" className="secondary" disabled={busy || attempted} onClick={() => void measure()}>Measure clip for restyling</button>
    <p className="small">Measurement stays in Studio; no provider request is made. MP4 files up to 16 MiB and clips 3–10.05 seconds can be measured.</p>
    <p className="small" role="status">{measurementStatus}</p>
    {measurement && <p className="small">{measurement.video.width} × {measurement.video.height} display ({measurement.video.codedWidth} × {measurement.video.codedHeight} encoded) · {measurement.video.durationSeconds.toFixed(2)} seconds · {measurement.video.averageFps.toFixed(2)} average fps (frame intervals {measurement.video.minimumPacketFps.toFixed(2)}–{measurement.video.maximumPacketFps.toFixed(2)} fps). {withinLimits ? 'These measurements fit fal Kling O1 edit’s listed dimensions and frame-rate range.' : 'These measurements fall outside fal Kling O1 edit’s listed 720–2160 px dimensions or 24–60 fps range.'} Account availability, provider acceptance and the resulting motion are not verified.</p>}
    {measurement && withinLimits && <div className="stack">
      <h3>Restyle this clip</h3>
      <p className="small">Kling O1 edit runs through fal.ai. If you submit, fal and Kling receive the full clip, including any original audio, and your direction. Anyone with the one-clip link can read it until it expires after 30 minutes. Provider retention and terms apply. The result may change motion; review it before use.</p>
      <p>Estimated allowance reservation: <strong>${(Math.ceil(estimateMicro / 10000) / 100).toFixed(2)} USD</strong>. Provider billing may differ.</p>
      <label>Direction<textarea value={direction} maxLength={1800} disabled={busy || attempted} onChange={e => setDirection(e.target.value)} placeholder="Describe the change you want" /></label>
      <label className="footage-restyle-consent"><input type="checkbox" checked={keepAudio} disabled={busy || attempted} onChange={e => setKeepAudio(e.target.checked)} /> Ask the provider to keep the original audio</label>
      <label className="footage-restyle-consent"><input type="checkbox" checked={rights} disabled={busy || attempted} onChange={e => setRights(e.target.checked)} /> I own this footage or have permission to use it.</label>
      <label className="footage-restyle-consent"><input type="checkbox" checked={consent} disabled={busy || attempted} onChange={e => setConsent(e.target.checked)} /> I agree to send this clip and direction to fal and Kling for this paid request.</label>
      <button type="button" disabled={busy || done || (!attempted && (!direction.trim() || !rights || !consent))} onClick={() => void submit()}>{attempted && !done ? 'Retry same request' : 'Submit paid restyle'}</button>
      <p role="status" className="small">{status}</p>{attempted && <a href={`#/p/${encodeURIComponent(projectId)}/history`}>Open History</a>}
    </div>}
  </div>;
}
