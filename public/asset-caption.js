// Local render provenance was historically stored in the caption field. Keep it
// intact, but do not treat its private identifiers as public-facing copy.
export function isLocalRenderProvenance(caption) {
  return typeof caption === "string" && /^Browser MP4 from storyboard [^,\n]+, saved version [^;\n]+(?:;|$)/.test(caption);
}

export function publicCaption(caption) {
  return isLocalRenderProvenance(caption) ? "" : (caption ?? "");
}
