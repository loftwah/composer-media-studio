import { useEffect, useRef, useState, type RefObject } from "react";
import { clipTimeStamp } from "./clip-captions";
import {
  SILENT_PEAK,
  analyseClipWaveform,
  type ClipWaveformOutcome,
  type ClipWaveformResult,
} from "./clip-waveform-peaks";

type Props = Readonly<{
  file: File;
  startSeconds: number;
  endSeconds: number;
  video: RefObject<HTMLVideoElement | null>;
  onSeek: (sourceSeconds: number) => void;
}>;

type State =
  | { phase: "idle" }
  | { phase: "working"; progress: number }
  | { phase: "ready"; waveform: ClipWaveformResult }
  | { phase: "unavailable"; message: string };

const WIDTH = 600;
const HEIGHT = 96;
const MIDDLE = HEIGHT / 2;
const SILENCE_HEIGHT = 1.5;

function sourceTime(seconds: number): string {
  return clipTimeStamp(Math.round(seconds * 1000));
}

function unavailableMessage(outcome: Exclude<ClipWaveformOutcome, { kind: "ready" }>): string {
  switch (outcome.kind) {
    case "no-audio":
      return "This video has no audio track.";
    case "no-decoder":
      return "This browser couldn’t decode this video’s audio.";
    case "no-samples":
      return "No audio samples were found in this clip window. Try another window or video.";
    case "invalid-window":
      return "Choose a valid clip window before analysing audio.";
    default:
      return "This browser couldn’t read the audio waveform.";
  }
}

export function ClipWaveform({ file, startSeconds, endSeconds, video, onSeek }: Props) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [note, setNote] = useState("");
  const [seekSeconds, setSeekSeconds] = useState(startSeconds);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const range = useRef<HTMLInputElement>(null);

  // A replacement source or a different trim window invalidates the old peaks
  // immediately. Any decode still running is cancelled and cannot apply later.
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    request.current++;
    setState({ phase: "idle" });
    setNote("");
    setSeekSeconds(Math.min(Math.max(video.current?.currentTime ?? startSeconds, startSeconds), endSeconds));
  }, [file, startSeconds, endSeconds, video]);

  useEffect(() => () => {
    request.current++;
    controller.current?.abort();
  }, []);

  // Keep the one seek control on the original video's own clock without
  // fighting the creator while the range itself has keyboard focus.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => {
      if (range.current && document.activeElement === range.current) return;
      if (!Number.isFinite(element.currentTime)) return;
      setSeekSeconds(Math.min(Math.max(element.currentTime, startSeconds), endSeconds));
    };
    sync();
    element.addEventListener("timeupdate", sync);
    element.addEventListener("seeked", sync);
    return () => {
      element.removeEventListener("timeupdate", sync);
      element.removeEventListener("seeked", sync);
    };
  }, [video, startSeconds, endSeconds]);

  async function analyse() {
    if (state.phase === "working") return;
    const next = new AbortController();
    controller.current?.abort();
    controller.current = next;
    const id = ++request.current;
    let lastProgress = -1;
    setState({ phase: "working", progress: 0 });
    setNote("");
    try {
      const outcome = await analyseClipWaveform(file, startSeconds, endSeconds, {
        signal: next.signal,
        onProgress: (fraction) => {
          if (id !== request.current) return;
          if (fraction < 1 && fraction - lastProgress < 0.02) return;
          lastProgress = fraction;
          setState({ phase: "working", progress: fraction });
        },
      });
      if (id !== request.current || next.signal.aborted) return;
      if (outcome.kind === "ready") setState({ phase: "ready", waveform: outcome.waveform });
      else setState({ phase: "unavailable", message: unavailableMessage(outcome) });
    } catch (error) {
      if (id !== request.current || next.signal.aborted) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState({
        phase: "unavailable",
        message: "This browser couldn’t read the audio waveform.",
      });
    } finally {
      if (controller.current === next) controller.current = null;
    }
  }

  function cancel() {
    request.current++;
    controller.current?.abort();
    controller.current = null;
    setState({ phase: "idle" });
    setNote("Waveform analysis cancelled.");
  }

  const waveform = state.phase === "ready" ? state.waveform : null;
  const windowLabel = `${sourceTime(startSeconds)}–${sourceTime(endSeconds)}`;
  const hasSignal = waveform !== null && waveform.peak >= SILENT_PEAK;
  const seekLabel = sourceTime(seekSeconds);
  const marker = waveform
    ? (Math.min(Math.max(seekSeconds, startSeconds), endSeconds) - startSeconds) /
      (endSeconds - startSeconds) * WIDTH
    : 0;
  return <section className="clip-waveform" aria-labelledby="clip-waveform-title" aria-busy={state.phase === "working" || undefined}>
    <div className="clip-waveform-head">
      <h3 id="clip-waveform-title">Source audio waveform</h3>
      <span className="clip-waveform-window">Source {windowLabel}</span>
    </div>
    <p id="clip-waveform-help" className="trim-note">Measure audio peaks in the selected clip on this device. The waveform uses the original video’s clock.</p>

    {state.phase === "idle" && <>
      <div className="video-tool-actions">
        <button type="button" className="secondary" aria-describedby="clip-waveform-help" onClick={() => void analyse()}>Analyse audio in this clip</button>
      </div>
      {note && <p role="status" aria-live="polite" className="trim-note">{note}</p>}
    </>}

    {state.phase === "working" && <>
      <div className="clip-waveform-progress">
        <progress max={1} value={state.progress} aria-label="Audio analysis progress"/>
        <span>{Math.round(state.progress * 100)}%</span>
      </div>
      <p role="status" className="trim-note">Reading audio peaks on this device…</p>
      <div className="video-tool-actions">
        <button type="button" className="secondary" onClick={cancel}>Cancel waveform</button>
      </div>
    </>}

    {state.phase === "unavailable" && <>
      <p role="status" className="trim-note">{state.message}</p>
      <div className="video-tool-actions">
        <button type="button" className="secondary" onClick={() => void analyse()}>Analyse again</button>
      </div>
    </>}

    {waveform && <>
      <div className="clip-waveform-plot-wrap">
        <svg className="clip-waveform-plot" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none"
          role="img" aria-label={`Audio peaks for source ${windowLabel}. ${hasSignal ? `Loudest peak ${Math.round(waveform.peak * 100)} percent of full scale.` : "This window is silent."}`}>
          <line className="clip-waveform-baseline" x1="0" y1={MIDDLE} x2={WIDTH} y2={MIDDLE}/>
          {waveform.buckets.map((bucket, index) => {
            const width = WIDTH / waveform.buckets.length;
            const silent = bucket.peak < SILENT_PEAK;
            const height = silent ? SILENCE_HEIGHT : Math.max(2, Math.min(1, bucket.peak) * (HEIGHT - 8));
            const x = index * width;
            return <rect key={index} className="clip-waveform-bar" data-silent={silent || undefined}
              x={x + Math.min(0.5, width * 0.08)} y={MIDDLE - height / 2}
              width={Math.max(0.5, width - Math.min(1, width * 0.16))} height={height}/>;
          })}
          <line className="clip-waveform-marker" x1={marker} y1="0" x2={marker} y2={HEIGHT}/>
        </svg>
        <div className="clip-waveform-axis" aria-hidden="true">
          <span>{sourceTime(startSeconds)}</span>
          <span>Original video time</span>
          <span>{sourceTime(endSeconds)}</span>
        </div>
      </div>
      <p className="trim-note">
        {hasSignal
          ? `Loudest peak ${Math.round(waveform.peak * 100)}% of full scale. ${waveform.silentBuckets} of ${waveform.buckets.length} columns are silent and drawn as a flat line.`
          : "This clip window is silent: every column is at or below 0.5% of full scale and drawn as a flat line."}
      </p>
      <div className="clip-waveform-keys" aria-hidden="true">
        <span className="clip-waveform-key clip-waveform-key-peak">Measured peak</span>
        <span className="clip-waveform-key clip-waveform-key-silence">Silence</span>
      </div>
      <div className="clip-waveform-seek">
        <label htmlFor="clip-waveform-range">Seek original video</label>
        <input ref={range} id="clip-waveform-range" type="range" min={startSeconds} max={endSeconds} step="0.001"
          value={seekSeconds} aria-describedby="clip-waveform-seek-help"
          onChange={event => {
            const seconds = Number(event.currentTarget.value);
            if (!Number.isFinite(seconds)) return;
            const bounded = Math.min(Math.max(seconds, startSeconds), endSeconds);
            setSeekSeconds(bounded);
            onSeek(bounded);
          }}/>
        <output htmlFor="clip-waveform-range" aria-live="off">{seekLabel}</output>
      </div>
      <p id="clip-waveform-seek-help" className="trim-note">Arrow keys seek this slider in original-video seconds and pause on the same preview player above.</p>
      <div className="video-tool-actions">
        <button type="button" className="secondary" onClick={() => void analyse()}>Analyse again</button>
      </div>
    </>}
  </section>;
}
