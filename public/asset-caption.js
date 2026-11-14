// Local render provenance was historically stored in the caption field. Keep it
// intact, but do not treat its private identifiers as public-facing copy.
export function isLocalRenderProvenance(caption) {
  return typeof caption === "string" && (/^Browser MP4 from saved storyboard;/.test(caption) || /^Browser MP4 from storyboard [^,\n]+, saved version [^;\n]+(?:;|$)/.test(caption));
}

export function publicCaption(caption) {
  return isLocalRenderProvenance(caption) ? "" : (caption ?? "");
}

// Share imports stored their catalogue, optional source and credit as caption lines.
// Only recognise the exact catalogue shape; leave other authored captions alone.
export function shareImportProvenance(caption) {
  if (typeof caption !== "string") return null;
  const lines = caption.split("\n");
  if (lines.length < 2 || lines.length > 3 || !/^https:\/\/woodhouse\.loftwah\.com\/api\/v1\/assets\/[a-z0-9][a-z0-9-]{0,127}$/.test(lines[0])) return null;
  let source = null, credit = lines[1];
  if (lines.length === 3) {
    try { const url = new URL(lines[1]); if (url.protocol !== "https:" || url.hostname !== "woodhouse.loftwah.com" || url.port || url.username || url.password) return null; source = url.href; } catch { return null; }
    credit = lines[2];
  }
  if (!credit || /^https?:\/\//i.test(credit)) return null;
  return { catalogue: lines[0], source, credit };
}
