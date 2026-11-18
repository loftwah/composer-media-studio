/**
 * One tiny Canvas probe, cached for the lifetime of the image workbench.
 *
 * Native Canvas WebP *encoding* is not universal: some engines (notably WebKit)
 * silently return PNG bytes for an `image/webp` request instead of failing. We
 * detect that once, when the image tool module is first imported, so the UI can
 * default to a format the browser can actually encode and label WebP honestly.
 *
 * Decoding WebP *inputs* is a separate, still-supported path and is untouched.
 * Real exports keep their byte-level MIME and magic-byte verification, so a
 * forced WebP selection in an unsupported browser still reports the mismatch
 * instead of mislabelling a PNG as WebP.
 */
let encodable: boolean | null = null;

export function canEncodeWebP(): boolean {
  if (encodable !== null) return encodable;
  encodable = detect();
  return encodable;
}

function detect(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.fillStyle = "#000000";
    context.fillRect(0, 0, 1, 1);
    const ok = canvas.toDataURL("image/webp").startsWith("data:image/webp");
    canvas.width = 0;
    canvas.height = 0;
    return ok;
  } catch {
    return false;
  }
}
