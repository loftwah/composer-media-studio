// Only public catalogue data, independently checked against saved input bytes.
import { shareApi, shareAsset, shareOriginal, woodhouseUrl } from "./woodhouse-share.mjs";
import { sha256Hex } from "./util.mjs";

// Known source credit forms reviewed for the first-party catalogue. Unknown
// third-party credits fail closed until their licence obligations are handled.
const credits = new Set([
  "Pirates promotional preparation · original OpenAI image_gen illustration and editable typography; not original-game art",
  "Woodhouse · Codex ImageGen poster and original product mark",
  "Woodhouse · GPT Image 2.6 via Fal",
  "Woodhouse · gpt-image-2.6-flare · OpenAI Image API",
  "Woodhouse · gpt-image-2.6-flare · Tabler Icons (MIT)",
  "Woodhouse · new generated promotional illustration; built-in Codex image_gen; concept, not a real invitation",
  "Woodhouse · new generated promotional illustration; built-in Codex image_gen; conceptual discovery instrument",
]);

export async function verifiedShareCredit(reference) {
  const anchor = String(reference.caption ?? "").split("\n", 1)[0];
  if (!anchor.startsWith(`${shareApi}/`)) return null;
  const shareId = anchor.slice(shareApi.length + 1);
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(shareId) || anchor !== `${shareApi}/${shareId}`) return null;
  try {
    const source = await shareAsset(shareId, 1500);
    if (!credits.has(source.credit) || source.reuse !== "unconfirmed" || !woodhouseUrl(source.sourceUrl)) return null;
    const original = await shareOriginal(source, 32 * 1024 * 1024, 1500);
    if ((await sha256Hex(original)) !== reference.sha256) return null;
    return [{ id: shareId, credit: source.credit, sourceUrl: woodhouseUrl(source.sourceUrl), reuse: "unconfirmed", catalogueUrl: `${shareApi}/${shareId}`, tablerMit: source.credit === "Woodhouse · gpt-image-2.6-flare · Tabler Icons (MIT)" }];
  } catch {
    return null; // Network failures, withdrawal or changed sources never grant publication.
  }
}
