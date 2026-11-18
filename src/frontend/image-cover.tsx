import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { coverRegion, type CoverFields, type CoverRegion } from "./image-cover-region.ts";

type CoverSource = { blob: Blob; url: string; width: number; height: number };
type Props = {
  source: CoverSource;
  encodePng: (canvas: HTMLCanvasElement) => Promise<Blob>;
};

const fields = [
  { key: "left", label: "Left (px)", min: 0 },
  { key: "top", label: "Top (px)", min: 0 },
  { key: "width", label: "Width (px)", min: 1 },
  { key: "height", label: "Height (px)", min: 1 },
] as const;

type Point = { x: number; y: number };

function rectangleBetween(a: Point, b: Point): CoverRegion | null {
  if (a.x === b.x || a.y === b.y) return null;
  const left = Math.floor(Math.min(a.x, b.x));
  const top = Math.floor(Math.min(a.y, b.y));
  const right = Math.ceil(Math.max(a.x, b.x));
  const bottom = Math.ceil(Math.max(a.y, b.y));
  return { left, top, width: right - left, height: bottom - top };
}

export function ImageCover({ source, encodePng }: Props) {
  const [coordinates, setCoordinates] = useState<CoverFields>({ left: "0", top: "0", width: "", height: "" });
  const [output, setOutput] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<CoverRegion | null>(null);
  const resultUrl = useRef("");
  const generation = useRef(0);
  const drag = useRef<{ pointerId: number; start: Point } | null>(null);
  const region = coverRegion(coordinates, source.width, source.height);

  useEffect(() => () => {
    generation.current += 1;
    drag.current = null;
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
  }, []);

  function invalidate() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = "";
    setOutput("");
    setMessage("");
  }

  function edit(key: keyof CoverFields, value: string) {
    invalidate();
    setCoordinates(previous => ({ ...previous, [key]: value }));
  }

  function pointFromEvent(event: ReactPointerEvent<HTMLImageElement>): Point {
    const box = event.currentTarget.getBoundingClientRect();
    const x = box.width > 0 ? (event.clientX - box.left) / box.width * source.width : 0;
    const y = box.height > 0 ? (event.clientY - box.top) / box.height * source.height : 0;
    return {
      x: Math.max(0, Math.min(source.width, x)),
      y: Math.max(0, Math.min(source.height, y)),
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLImageElement>) {
    if (!drawing || busy || drag.current || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const start = pointFromEvent(event);
    drag.current = { pointerId: event.pointerId, start };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLImageElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    setDraft(rectangleBetween(active.start, pointFromEvent(event)));
  }

  function finishDrag(event: ReactPointerEvent<HTMLImageElement>, commit: boolean) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraft(null);
    if (!commit) return;
    const rectangle = rectangleBetween(active.start, pointFromEvent(event));
    if (!rectangle) return;
    invalidate();
    setDrawing(false);
    setCoordinates({
      left: String(rectangle.left),
      top: String(rectangle.top),
      width: String(rectangle.width),
      height: String(rectangle.height),
    });
    setMessage("Rectangle set from the preview.");
  }

  function toggleDrawing() {
    drag.current = null;
    setDraft(null);
    setDrawing(previous => !previous);
  }

  async function make() {
    if (!region || busy || drawing) return;
    const current = ++generation.current;
    setBusy(true);
    setMessage("Making the redacted PNG on this device…");
    const canvas = document.createElement("canvas");
    try {
      const bitmap = await createImageBitmap(source.blob);
      try {
        if (current !== generation.current) return;
        if (bitmap.width !== source.width || bitmap.height !== source.height) {
          throw new Error("The decoded image size changed. Make the image again.");
        }
        canvas.width = source.width;
        canvas.height = source.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("This browser could not prepare the image.");
        ctx.drawImage(bitmap, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(region.left, region.top, region.width, region.height);
      } finally {
        bitmap.close();
      }
      const png = await encodePng(canvas);
      if (current !== generation.current) return;
      if (png.type !== "image/png") throw new Error("This browser could not export a PNG.");
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      resultUrl.current = URL.createObjectURL(png);
      setOutput(resultUrl.current);
      setMessage("Redacted PNG ready.");
    } catch (error) {
      if (current === generation.current) {
        setMessage(error instanceof Error ? error.message : "Could not make the redacted PNG.");
      }
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      if (current === generation.current) setBusy(false);
    }
  }

  const finishedPreview = drawing ? "" : output;
  const shown = draft ?? (finishedPreview ? null : region);

  return (
    <details className="image-cover">
      <summary>Cover an area</summary>
      <p>Fill a rectangle with solid black. Enter whole pixels from the top-left of the {source.width} × {source.height} image, or draw it on the preview.</p>
      <div className="image-cover-fields">
        {fields.map(field => (
          <label key={field.key}>
            {field.label}
            <input
              type="number" min={field.min} step={1} value={coordinates[field.key]} disabled={busy}
              onChange={event => edit(field.key, event.target.value)}
            />
          </label>
        ))}
      </div>
      {!region && coordinates.width && coordinates.height && (
        <p className="trim-note">Enter a rectangle that fits inside the image.</p>
      )}
      <div className="image-cover-draw-bar">
        <button type="button" className="secondary" aria-pressed={drawing} disabled={busy} onClick={toggleDrawing}>
          {drawing ? "Done drawing" : "Draw area on preview"}
        </button>
        {drawing && (
          <p className="trim-note">Drag across the preview to set the rectangle. Releasing fills the four fields and ends drawing.</p>
        )}
      </div>
      <div className={`image-cover-preview${drawing ? " is-drawing" : ""}`}>
        <img
          src={finishedPreview || source.url}
          width={source.width}
          height={source.height}
          alt={finishedPreview ? "Redacted PNG preview" : "Completed image for region selection"}
          draggable={false}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={event => finishDrag(event, true)}
          onPointerCancel={event => finishDrag(event, false)}
          onLostPointerCapture={event => finishDrag(event, false)}
        />
        {shown && (
          <span
            aria-hidden="true"
            className="image-cover-outline"
            style={{
              left: `${100 * shown.left / source.width}%`,
              top: `${100 * shown.top / source.height}%`,
              width: `${100 * shown.width / source.width}%`,
              height: `${100 * shown.height / source.height}%`,
            }}
          />
        )}
      </div>
      <div className="image-control-actions">
        <button type="button" className="secondary" disabled={!region} aria-disabled={busy || drawing} onClick={() => void make()}>
          {busy ? "Making redacted PNG…" : "Make redacted PNG"}
        </button>
        {finishedPreview && <a className="button secondary" href={finishedPreview} download="media-studio-redacted.png">Download redacted PNG</a>}
      </div>
      <p role="status" className="trim-note">{message}</p>
    </details>
  );
}
