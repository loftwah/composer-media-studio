import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BLUR_PIXEL_BUDGET, blurFitsPixelBudget, blurPixels } from "./image-blur.ts";
import { coverAreas, EMPTY_COVER_FIELDS, MAX_COVER_AREAS, type CoverFields, type CoverRegion } from "./image-cover-region.ts";
import { MAX_IMAGE_INPUT_BYTES } from "./image-limits.ts";
import { mosaicBlockSize, mosaicFitsPixelBudget, pixelateMosaic } from "./image-mosaic.ts";

type CoverSource = { blob: Blob; url: string; width: number; height: number };
type Props = {
  source: CoverSource;
  encodePng: (canvas: HTMLCanvasElement) => Promise<Blob>;
  addToBatch: (file: File) => Promise<boolean>;
  canAddToBatch: boolean;
  batchFull: boolean;
};

type CoverMode = "solid" | "mosaic" | "blur";

const MODES = [
  {
    value: "solid",
    label: "Solid cover",
    note: "Fills each area with opaque black. This is the choice for concealing content.",
  },
  {
    value: "mosaic",
    label: "Mosaic",
    note: "Decorative pixelation with a fixed block pattern. It can leave content recognisable and does not conceal it.",
  },
  {
    value: "blur",
    label: "Soft blur",
    note: "Decorative local softening inside each area. It can leave content recognisable and does not conceal it; use Solid cover for private or identifying content.",
  },
] as const satisfies readonly { value: CoverMode; label: string; note: string }[];

const MODE_SUMMARIES: Record<CoverMode, string> = {
  solid: "Fill a rectangle with solid black.",
  mosaic: "Pixelate a rectangle with a fixed block pattern.",
  blur: "Soften a rectangle with a local blur that reads only pixels inside it.",
};

type OutputText = {
  name: string;
  title: string;
  file: string;
  previewAlt: string;
  progress: string;
  busy: string;
  make: string;
  download: string;
  added: string;
  add: string;
  ready: string;
  failed: string;
};

const OUTPUT: Record<CoverMode, OutputText> = {
  solid: {
    name: "redacted",
    title: "Redacted",
    file: "media-studio-redacted.png",
    previewAlt: "Redacted PNG preview",
    progress: "Making the redacted PNG on this device…",
    busy: "Making redacted PNG…",
    make: "Make redacted PNG",
    download: "Download redacted PNG",
    added: "Redacted PNG added",
    add: "Add redacted PNG to batch",
    ready: "Redacted PNG ready.",
    failed: "Could not make the redacted PNG.",
  },
  mosaic: {
    name: "mosaic",
    title: "Mosaic",
    file: "media-studio-mosaic.png",
    previewAlt: "Mosaic PNG preview",
    progress: "Pixelating the mosaic PNG on this device…",
    busy: "Pixelating mosaic PNG…",
    make: "Make mosaic PNG",
    download: "Download mosaic PNG",
    added: "Mosaic PNG added",
    add: "Add mosaic PNG to batch",
    ready: "Mosaic PNG ready.",
    failed: "Could not make the mosaic PNG.",
  },
  blur: {
    name: "soft blur",
    title: "Soft blur",
    file: "media-studio-soft-blur.png",
    previewAlt: "Soft blur PNG preview",
    progress: "Softening the soft blur PNG on this device…",
    busy: "Softening soft blur PNG…",
    make: "Make soft blur PNG",
    download: "Download soft blur PNG",
    added: "Soft blur PNG added",
    add: "Add soft blur PNG to batch",
    ready: "Soft blur PNG ready.",
    failed: "Could not make the soft blur PNG.",
  },
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

export function ImageCover({ source, encodePng, addToBatch, canAddToBatch, batchFull }: Props) {
  const [coordinates, setCoordinates] = useState<CoverFields>(EMPTY_COVER_FIELDS);
  const [mode, setMode] = useState<CoverMode>("solid");
  const [output, setOutput] = useState<{ blob: Blob; url: string; mode: CoverMode } | null>(null);
  const [addedUrl, setAddedUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<CoverRegion | null>(null);
  const [retained, setRetained] = useState<CoverRegion[]>([]);
  const [nativeInvalid, setNativeInvalid] = useState(false);
  const fieldsElement = useRef<HTMLDivElement>(null);
  const resultUrl = useRef("");
  const generation = useRef(0);
  const drag = useRef<{ pointerId: number; start: Point } | null>(null);
  const areas = coverAreas(coordinates, retained, source.width, source.height);
  const pending = areas.pending || nativeInvalid;
  const mosaicOverBudget = mode === "mosaic" && !mosaicFitsPixelBudget(areas.regions);
  const blurOverBudget = mode === "blur" && !blurFitsPixelBudget(areas.regions);
  const overBudget = mosaicOverBudget || blurOverBudget;

  useEffect(() => () => {
    generation.current += 1;
    drag.current = null;
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
  }, []);

  function invalidate() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = "";
    setOutput(null);
    setMessage("");
  }

  function edit(key: keyof CoverFields, value: string) {
    invalidate();
    setNativeInvalid(Boolean(fieldsElement.current?.querySelector("input:invalid")));
    setCoordinates(previous => ({ ...previous, [key]: value }));
  }

  function changeMode(next: CoverMode) {
    if (busy || next === mode) return;
    invalidate();
    setMode(next);
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
    setNativeInvalid(false);
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

  function clearArea() {
    invalidate();
    fieldsElement.current?.querySelectorAll<HTMLInputElement>("input:invalid").forEach(input => {
      input.value = "";
    });
    setNativeInvalid(false);
    setCoordinates(EMPTY_COVER_FIELDS);
    fieldsElement.current?.querySelector("input")?.focus();
  }

  function retainArea() {
    const current = areas.current;
    if (!areas.canRetain || !current || pending) return;
    clearArea();
    setRetained(previous => [...previous, current]);
    setMessage(`Area added. Set the next rectangle or make the ${OUTPUT[mode].name} PNG.`);
  }

  function removeArea(index: number) {
    if (busy || drawing || index < 0 || index >= retained.length) return;
    invalidate();
    setRetained(previous => previous.filter((_, i) => i !== index));
    fieldsElement.current?.querySelector("input")?.focus();
    setMessage(`Area ${index + 1} removed.`);
  }

  async function make() {
    if (!areas.canExport || pending || busy || drawing || overBudget) return;
    const invalidField = fieldsElement.current?.querySelector<HTMLInputElement>("input:invalid");
    if (invalidField) {
      setNativeInvalid(true);
      invalidField.focus();
      return;
    }
    const current = ++generation.current;
    const exportMode = mode;
    const treatment = OUTPUT[exportMode];
    setBusy(true);
    setMessage(treatment.progress);
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
        const ctx = canvas.getContext("2d", { willReadFrequently: exportMode !== "solid" });
        if (!ctx) throw new Error("This browser could not prepare the image.");
        ctx.drawImage(bitmap, 0, 0);
        if (exportMode === "mosaic") {
          for (const area of areas.regions) {
            const pixels = ctx.getImageData(area.left, area.top, area.width, area.height);
            pixelateMosaic(
              pixels,
              { left: 0, top: 0, width: area.width, height: area.height },
              mosaicBlockSize(area),
            );
            ctx.putImageData(pixels, area.left, area.top);
          }
        } else if (exportMode === "blur") {
          for (const area of areas.regions) {
            const pixels = ctx.getImageData(area.left, area.top, area.width, area.height);
            blurPixels(pixels, { left: 0, top: 0, width: area.width, height: area.height });
            ctx.putImageData(pixels, area.left, area.top);
          }
        } else {
          ctx.fillStyle = "#000";
          for (const area of areas.regions) {
            ctx.fillRect(area.left, area.top, area.width, area.height);
          }
        }
      } finally {
        bitmap.close();
      }
      const png = await encodePng(canvas);
      if (current !== generation.current) return;
      if (png.type !== "image/png") throw new Error("This browser could not export a PNG.");
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      resultUrl.current = URL.createObjectURL(png);
      setOutput({ blob: png, url: resultUrl.current, mode: exportMode });
      setMessage(treatment.ready);
    } catch (error) {
      if (current === generation.current) {
        setMessage(error instanceof Error ? error.message : treatment.failed);
      }
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      if (current === generation.current) setBusy(false);
    }
  }

  const finished = drawing ? null : output;
  const finishedPreview = finished?.url ?? "";
  const finishedMode = finished?.mode ?? mode;
  const outlined = finishedPreview ? [] : draft ? [...retained, draft] : areas.regions;
  const alreadyAdded = finished?.url === addedUrl;
  const tooLargeToAdd = finished ? finished.blob.size > MAX_IMAGE_INPUT_BYTES : false;
  const finishedText = OUTPUT[finishedMode];

  async function addFinishedPng() {
    if (!finished || pending || busy || alreadyAdded || !canAddToBatch || tooLargeToAdd || batchFull) return;
    const added = await addToBatch(new File([finished.blob], OUTPUT[finished.mode].file, { type: "image/png" }));
    if (added && resultUrl.current === finished.url) {
      setAddedUrl(finished.url);
      setMessage(`${OUTPUT[finished.mode].title} PNG added to the batch. Open it from the batch to continue editing.`);
    }
  }

  return (
    <details className="image-cover" data-image-region-treatment={mode}>
      <summary>Cover, mosaic or blur an area</summary>
      <p>{MODE_SUMMARIES[mode]} Enter whole pixels from the top-left of the
        {" "}{source.width} × {source.height} image, or draw it on the preview.</p>
      <fieldset className="image-cover-mode">
        <legend>Treatment</legend>
        {MODES.map(option => (
          <label key={option.value}>
            <input
              type="radio"
              name="image-cover-mode"
              value={option.value}
              checked={mode === option.value}
              disabled={busy}
              onChange={() => changeMode(option.value)}
            />
            <span>
              <strong>{option.label}</strong>
              <span className="trim-note">{option.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="image-cover-fields" ref={fieldsElement}>
        {fields.map(field => (
          <label key={field.key}>
            {field.label}
            <input
              type="number" min={field.min} step={1} value={coordinates[field.key]} disabled={busy}
              onInput={event => edit(field.key, event.currentTarget.value)}
            />
          </label>
        ))}
      </div>
      {areas.pending && (
        <p className="trim-note">Enter a rectangle that fits inside the image.</p>
      )}
      <div className="image-cover-draw-bar">
        <button type="button" className="secondary" aria-pressed={drawing} disabled={busy} onClick={toggleDrawing}>
          {drawing ? "Done drawing" : "Draw area on preview"}
        </button>
        {areas.canRetain && !pending && (
          <button type="button" className="secondary" disabled={busy || drawing} onClick={retainArea}>
            Add another area
          </button>
        )}
        {(areas.current || pending) && (
          <button type="button" className="secondary" disabled={busy || drawing} onClick={clearArea}>
            Clear current area
          </button>
        )}
        {drawing && (
          <p className="trim-note">Drag across the preview to set the rectangle. Releasing fills the four fields and ends drawing.</p>
        )}
      </div>
      {retained.length > 0 && (
        <div>
          <p className="trim-note">Added areas ({retained.length}/{MAX_COVER_AREAS}). Each area gets the same treatment in the same PNG.</p>
          <ul className="image-cover-area-list">
            {retained.map((area, index) => (
              <li key={`${area.left}-${area.top}-${index}`}>
                <span>Area {index + 1}: {area.left}, {area.top}, {area.width} × {area.height} px</span>
                <button
                  type="button" className="secondary" disabled={busy || drawing}
                  aria-label={`Remove added area ${index + 1}`}
                  onClick={() => removeArea(index)}
                >Remove</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={`image-cover-preview${drawing ? " is-drawing" : ""}`}>
        <img
          src={finishedPreview || source.url}
          width={source.width}
          height={source.height}
          alt={finishedPreview ? finishedText.previewAlt : "Completed image for region selection"}
          draggable={false}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={event => finishDrag(event, true)}
          onPointerCancel={event => finishDrag(event, false)}
          onLostPointerCapture={event => finishDrag(event, false)}
        />
        {outlined.map((area, index) => (
          <span
            key={`${area.left}-${area.top}-${index}`}
            aria-hidden="true"
            className="image-cover-outline"
            style={{
              left: `${100 * area.left / source.width}%`,
              top: `${100 * area.top / source.height}%`,
              width: `${100 * area.width / source.width}%`,
              height: `${100 * area.height / source.height}%`,
            }}
          />
        ))}
      </div>
      <div className="image-control-actions">
        <button
          type="button"
          className="secondary"
          data-image-region-export={mode}
          disabled={!areas.canExport || pending || overBudget}
          aria-disabled={busy || drawing}
          onClick={() => void make()}
        >
          {busy ? finishedText.busy : finishedText.make}
        </button>
        {finished && (
          <>
            <a
              className="button secondary"
              data-image-region-download={finished.mode}
              href={finished.url}
              download={finishedText.file}
            >
              {finishedText.download}
            </a>
            <button
              className="button secondary"
              type="button"
              aria-disabled={busy || pending || alreadyAdded || !canAddToBatch || tooLargeToAdd || batchFull}
              onClick={() => void addFinishedPng()}
            >
              {alreadyAdded ? finishedText.added : finishedText.add}
            </button>
          </>
        )}
      </div>
      <p role="status" className="trim-note">{pending ? "Finish or clear the current rectangle before exporting." : message}</p>
      {mosaicOverBudget && <p className="trim-note">Make the mosaic areas smaller. One export can pixelate up to 8 million pixels.</p>}
      {blurOverBudget && (
        <p className="trim-note">
          Make the blur areas smaller. One export can soften up to {BLUR_PIXEL_BUDGET / 1_000_000} million pixels.
        </p>
      )}
      {finished && (tooLargeToAdd || batchFull) && (
        <p className="trim-note">
          {tooLargeToAdd ? `New inputs must be ${MAX_IMAGE_INPUT_BYTES / 1024 / 1024} MiB or smaller.` : "Remove an image before adding this PNG."}
        </p>
      )}
    </details>
  );
}
