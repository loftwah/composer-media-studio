import { useEffect, useRef, useState } from "react";
import { coverRegion, type CoverFields } from "./image-cover-region.ts";

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

export function ImageCover({ source, encodePng }: Props) {
  const [coordinates, setCoordinates] = useState<CoverFields>({ left: "0", top: "0", width: "", height: "" });
  const [output, setOutput] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const resultUrl = useRef("");
  const generation = useRef(0);
  const region = coverRegion(coordinates, source.width, source.height);

  useEffect(() => () => {
    generation.current += 1;
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
  }, []);

  function edit(key: keyof CoverFields, value: string) {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = "";
    setOutput("");
    setMessage("");
    setCoordinates(previous => ({ ...previous, [key]: value }));
  }

  async function make() {
    if (!region || busy) return;
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

  return (
    <details className="image-cover">
      <summary>Cover an area</summary>
      <p>Fill a rectangle with solid black. Enter whole pixels from the top-left of the {source.width} × {source.height} image.</p>
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
      <div className="image-cover-preview">
        <img
          src={output || source.url}
          width={source.width}
          height={source.height}
          alt={output ? "Redacted PNG preview" : "Completed image for region selection"}
        />
        {region && !output && (
          <span
            aria-hidden="true"
            className="image-cover-outline"
            style={{
              left: `${100 * region.left / source.width}%`,
              top: `${100 * region.top / source.height}%`,
              width: `${100 * region.width / source.width}%`,
              height: `${100 * region.height / source.height}%`,
            }}
          />
        )}
      </div>
      <div className="image-control-actions">
        <button type="button" className="secondary" disabled={!region} aria-disabled={busy} onClick={() => void make()}>
          {busy ? "Making redacted PNG…" : "Make redacted PNG"}
        </button>
        {output && <a className="button secondary" href={output} download="media-studio-redacted.png">Download redacted PNG</a>}
      </div>
      <p role="status" className="trim-note">{message}</p>
    </details>
  );
}
