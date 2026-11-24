import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { imagesPage, loginPage, publicPage } from "../src/lib/ui.mjs";

const workbench = readFileSync(new URL("../src/frontend/images.tsx", import.meta.url), "utf8");

test("the public image page mounts the tracked wrapper with the build revision", () => {
  const html = imagesPage({ revision: "abc123" });
  assert.match(html, /<title>Image tools — Media Studio<\/title>/);
  assert.match(html, /<div id="images" data-studio-revision="abc123">/);
  assert.match(html, /src="\/images\.js\?v=abc123"/);
  assert.match(html, /JavaScript is required/);
});

test("login discovery links to the signed-out image workbench", () => {
  assert.match(loginPage({ revision: "abc123" }), /href="\/tools\/images"/);
});

test("only the published film's own eligible poster gets a social handoff", () => {
  const film = {
    origin: "https://media.example",
    slug: "Film_1",
    title: "Published film",
    kind: "video",
    mime: "video/mp4",
    media: "/p/Film_1/media",
    download: "/p/Film_1/download",
  };
  for (const route of ["poster", "thumb"]) {
    const poster = `/p/Film_1/${route}`;
    const html = publicPage({ ...film, poster, posterMime: "image/webp" });
    assert.ok(html.includes(`href="${poster}" download>Download poster</a>`));
    assert.ok(html.includes(`href="/tools/images#public-poster=${encodeURIComponent(poster)}">Make social sizes</a>`));
  }
  assert.doesNotMatch(publicPage({ ...film, poster: "/p/Another/thumb" }), /Make social sizes/);
  assert.doesNotMatch(publicPage({ ...film, kind: "image", poster: "/p/Film_1/thumb" }), /Make social sizes/);
  assert.doesNotMatch(publicPage({ ...film, poster: null }), /Make social sizes/);
  assert.doesNotMatch(publicPage({ ...film, poster: "/p/Film_1/poster", posterMime: "image/webp" }), /Edit in Image Tools/);
});

test("only a published PNG, JPEG or WebP still gets the explicit editor handoff", () => {
  const still = {
    origin: "https://media.example",
    slug: "Still_1",
    title: "Published still",
    kind: "image",
    mime: "image/jpeg",
    media: "/p/Still_1/media",
    download: "/p/Still_1/download",
  };
  const handoff = 'href="/tools/images#public-still=Still_1">Edit in Image Tools</a>';
  for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
    const html = publicPage({ ...still, mime });
    assert.ok(html.includes(handoff), mime);
  }
  assert.doesNotMatch(publicPage({ ...still, kind: "video", mime: "video/mp4" }), /Edit in Image Tools/);
  assert.doesNotMatch(publicPage({ ...still, kind: "audio", mime: "audio/mpeg" }), /Edit in Image Tools/);
  for (const mime of ["image/avif", "image/gif", "image/svg+xml"]) {
    assert.doesNotMatch(publicPage({ ...still, mime }), /Edit in Image Tools/, mime);
  }
  assert.doesNotMatch(publicPage({ ...still, media: "/p/Another/media" }), /Edit in Image Tools/);
  assert.doesNotMatch(publicPage({ ...still, media: "/p/Still_1/download" }), /Edit in Image Tools/);
});

test("the workbench exposes labelled colour and output controls", () => {
  assert.match(workbench, /<label>Resampling/);
  assert.match(workbench, /Nearest-neighbour · pixel art/);
  assert.match(workbench, /<label>Target size \(KiB, optional\)/);
  assert.match(workbench, /aria-describedby="image-target-note"/);
  assert.match(workbench, /id="image-target-note"/);
  assert.match(workbench, /Trim transparent edges/);
  assert.match(workbench, /Trim removes fully transparent padding/);
  assert.match(workbench, /Extract palette/);
  assert.match(workbench, /Fully transparent pixels are ignored/);
  assert.match(workbench, /<h3>Eyedropper<\/h3>/);
  assert.match(workbench, /Copy HEX/);
  assert.match(workbench, /Copy RGB/);
  assert.match(workbench, /Copy HSL/);
  assert.match(workbench, /image-swatch/);
  assert.match(workbench, /aria-label=\{`Copy HEX/);
  assert.match(workbench, /ArrowLeft/);
  assert.match(workbench, /ArrowRight/);
  assert.match(workbench, /ArrowUp/);
  assert.match(workbench, /ArrowDown/);
});

test("the export path wires trim, target search and nearest-neighbour smoothing", () => {
  assert.match(workbench, /alphaBounds\(data/);
  assert.match(workbench, /mapBoundsThroughTransform\(found\.bounds/);
  assert.match(workbench, /const smoothing = imageSmoothingFor\(settings\.resample\)/);
  assert.match(workbench, /context\.imageSmoothingEnabled = smoothing\.enabled/);
  assert.match(workbench, /searchTargetQuality\(\{/);
  assert.match(workbench, /const cropRect =[\s\S]*trimSnapshot\.itemId === item\.id/);
  assert.match(workbench, /describeTransform\(\{[\s\S]*resample: selected\.result\.settings\.resample/);
});

test("WebP choices follow the one-time probe while the byte-level MIME check stays", () => {
  assert.match(workbench, /const WEBP_ENCODABLE = canEncodeWebP\(\)/);
  assert.match(workbench, /WEBP_ENCODABLE \? "WebP · smaller" : "WebP · unavailable in this browser"/);
  assert.match(workbench, /useState<SocialKitFormat>\(defaultSocialKitFormat\(WEBP_ENCODABLE\)\)/);
  assert.match(workbench, /format: defaultSocialKitFormat\(WEBP_ENCODABLE\)/);
  assert.match(workbench, /image-webp-unavailable-note/);
  assert.equal([...workbench.matchAll(/disabled=\{value === "webp" && !WEBP_ENCODABLE\}/g)].length, 3);
  assert.match(workbench, /Format for this image/);
  assert.match(workbench, /<option value="">Use batch<\/option>/);
  assert.match(workbench, /if \(value === "webp" && !WEBP_ENCODABLE\) return;/);
  assert.match(workbench, /if \(blob\.type !== mime\)/);
  assert.match(workbench, /if \(!sniffed\.supported \|\| sniffed\.mime !== mime\)/);
});

test("each social size shows the actual crop from its existing blob URL", () => {
  assert.match(workbench, /<img\s+src=\{output\.url\}[^>]+className="image-social-thumb"[^>]*\/>\s*<div[^>]*>\s*<a href=\{output\.url\} download=/);
});

test("PNG states that a byte target is not achievable and offers resize guidance", () => {
  assert.match(workbench, /PNG is lossless, so a byte target is not achievable here/);
  assert.match(workbench, /Lower the output width and height, or choose JPEG/);
  assert.match(workbench, /reports the real encoded bytes/);
  assert.match(workbench, /not met/);
});

test("the new colour and trim modules stay browser-local and dependency-free", () => {
  const colour = readFileSync(
    new URL("../src/frontend/image-colour.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(colour, /from "react"|fetch\(|XMLHttpRequest|import\(/);
  assert.doesNotMatch(colour, /https?:\/\//);
});

test("the workbench ships local photo adjustments with real pixel values", () => {
  assert.match(workbench, /<legend>Light and colour<\/legend>/);
  assert.match(workbench, /ADJUSTMENT_PRESETS\.map/);
  assert.match(workbench, /presetIdFor\(settings\.adjust\)/);
  assert.match(workbench, /setAdjustment\(key, Number\(event\.target\.value\)\)/);
  assert.match(workbench, /adjustPixels\(pixels\.data, \{/);
  assert.match(workbench, /adjustmentsAreNeutral\(settings\.adjust\)/);
  assert.match(workbench, /Reset adjustments/);
  assert.match(workbench, /alpha channel is never changed/);
  assert.match(workbench, /Adjustments changed \{selected\.result\.adjustChanged\.toLocaleString\(\)\}/);
  assert.match(workbench, /adjustments: describeAdjustments\(selected\.result\.settings\.adjust\)/);
});

test("crop position and embed code are wired as honest controls", () => {
  assert.match(workbench, /<label>Crop position/);
  assert.match(workbench, /Object\.entries\(CROP_ANCHOR_LABELS\)\.map/);
  assert.match(workbench, /cropAnchor: settings\.cropAnchor/);
  assert.match(workbench, /disabled=\{running \|\| \(settings\.cropAspect === "original" && selectedSettings\.cropAspect === "original"\)\}/);
  assert.match(workbench, /<h2 id="image-embed-heading">Embed code<\/h2>/);
  assert.match(workbench, /buildImageSnippets\(\{/);
  assert.match(workbench, /It is not encryption, redaction/);
  assert.match(workbench, /embed code stops at/);
  assert.match(workbench, /SNIPPET_KINDS\.map/);
  assert.match(workbench, /Copy \{SNIPPET_LABELS\[snippetKind\]\}/);
  assert.match(workbench, /Move up/);
  assert.match(workbench, /Move down/);
  assert.match(workbench, /draggable=\{!running\}/);
});

test("the completed result has an on-demand exact alpha inspection", () => {
  assert.match(workbench, /<h3>Result alpha<\/h3>/);
  assert.match(workbench, /Inspect result alpha/);
  assert.match(workbench, /Transparent is\s+alpha 0, partial is 1–254/);
  assert.match(workbench, /createImageBitmap\(result\.blob\)/);
  assert.match(workbench, /alphaProfile\(data, \{ width, height: rows \}\)/);
  assert.match(workbench, /alphaMapPlan\(width, height\)/);
  assert.match(workbench, /writeAlphaMapBand\(mapPlan, data, y\)/);
  assert.match(workbench, /alphaInspect\?\.key === outputResultKey \? alphaInspect\.map : null/);
  assert.match(workbench, /className="image-alpha-map"/);
  assert.match(workbench, /role="img"/);
  assert.match(workbench, /This preview samples the finished image/);
  assert.match(workbench, /Download alpha report \(JSON\)/);
  assert.match(workbench, /download="studio-alpha-report\.json"/);
  assert.match(workbench, /report: buildAlphaReport\(\{ result, profile \}\)/);
  assert.match(workbench, /alphaInspect\?\.key === outputResultKey \? alphaInspect\.report : null/);
  assert.match(workbench, /data:application\/json;charset=utf-8,\$\{encodeURIComponent\(JSON\.stringify\(visibleAlphaReport\)\)\}/);
  assert.match(workbench, /key === currentOutputKey\.current/);
  assert.match(workbench, /alphaRevision\.current \+= 1/);
  assert.match(workbench, /aria-disabled=\{alphaBusy \|\| running\}/);
});

test("the embed-code button keeps keyboard focus while it is building", () => {
  assert.match(workbench, /\n\s+disabled=\{running\}\n\s+aria-disabled=\{snippetBusy \|\| running\}/);
  assert.match(workbench, /if \(!selected\?\.result \|\| snippetBusy \|\| running\) return;/);
});

test("the make-image button keeps keyboard focus while the canvas encodes", () => {
  assert.match(workbench, /disabled=\{socialBusy \|\| adding \|\| sheetBusy \|\| importing \|\| !plan\?\.ok \|\| Boolean\(targetProblem\)\}\s+aria-disabled=\{running\}\s+onClick=\{\(\) => \{\s+if \(running\) return;\s+void runItems\(\[selected\]\);/);
});

test("the contact-sheet button keeps keyboard focus while its canvas encodes", () => {
  assert.match(workbench, /disabled=\{running \|\| socialBusy \|\| adding \|\| zipBusy \|\| \(isAtlasMode\s*\? !atlasPlan \|\| Boolean\(atlasProblem\)\s*: doneItems\.length < CONTACT_SHEET_MIN_IMAGES\)\}\s+aria-disabled=\{sheetBusy\}\s+onClick=\{\(\) => \{\s+if \(sheetBusy\) return;\s+void makeSheet\(\);/);
  assert.match(workbench, /async function makeSheet\(\): Promise<void> \{\s+if \(batchExport \|\| addingRef\.current \|\| runningRef\.current \|\| socialController\.current\) return;/);
  assert.match(workbench, /if \(!layout\) return;/);
});

test("the prepare-ZIP button keeps keyboard focus while its ZIP assembles", () => {
  assert.match(workbench, /disabled=\{running \|\| socialBusy \|\| adding \|\| sheetBusy \|\| !doneItems\.length\}\s+aria-disabled=\{zipBusy\}\s+onClick=\{\(\) => \{\s+if \(zipBusy\) return;\s+void makeZip\(\);/);
  assert.match(workbench, /if \(!doneItems\.length \|\| batchExport \|\| addingRef\.current \|\| runningRef\.current \|\| socialController\.current\) return;/);
});

test("a batch row can set its own long edge without touching the batch", () => {
  assert.match(workbench, /Long edge for this image \(px\)/);
  assert.match(workbench, /leave blank to use the batch resize/i);
  assert.match(workbench, /longEdgeFromControl\(event\.currentTarget\)/);
  assert.match(workbench, /const invalidLongEdgeItem = items\.find/);
  assert.match(workbench, /Boolean\(invalidLongEdgeItem\)/);
});

test("a batch row can choose its own export format without touching the batch", () => {
  assert.match(workbench, /value=\{item\.formatOverride \?\? ""\}/);
  assert.match(workbench, /setFormatOverride\(/);
  assert.match(workbench, /formatOverride: value/);
  assert.match(workbench, /item\.formatOverride !== undefined/);
  assert.match(workbench, /rowIsLossy\(item\)/);
  assert.match(workbench, /selected\.formatOverride/);
});

test("intake decodes each candidate before it queues or resets exports", () => {
  assert.match(workbench, /async function browserDecodeProblem\(file: File\): Promise<string \| null> \{/);
  assert.match(workbench, /bitmap = await createImageBitmap\(file\);[\s\S]*?finally \{\s*bitmap\?\.close\(\);\s*\}/);
  const decodeAt = workbench.indexOf("const decodeProblem = await browserDecodeProblem(file)");
  const resetAt = workbench.indexOf("if (!added) clearBatchExports()");
  assert.ok(decodeAt > 0, "intake calls the browser decoder");
  assert.ok(resetAt > decodeAt, "the decoder runs before the first export reset");
});

test("chooser intake restores focus only when the picker owned it and focus stayed put", () => {
  assert.match(workbench, /const restorePickerFocus = useRef\(false\)/);
  const restoreAt = workbench.indexOf("if (adding || !restorePickerFocus.current) return;");
  const guardAt = workbench.indexOf("if (!active || active === document.body || active === fileInputRef.current) fileInputRef.current?.focus();");
  assert.ok(restoreAt > 0 && guardAt > restoreAt, "the focus return is gated on adding and current focus");
  assert.match(workbench, /restorePickerFocus\.current = fromPicker && document\.activeElement === fileInputRef\.current/);
  assert.match(workbench, /void addFiles\(files, true\)/);
  assert.ok(!/addFiles\(files\)/.test(workbench.replace("void addFiles(files, true)", "")), "paste and drop do not pass the picker flag");
});

test("the metadata strip button keeps keyboard focus while the bytes load", () => {
  assert.match(workbench, /disabled=\{running \|\| importing\} aria-disabled=\{stripBusy \|\| running\} onClick=\{\(\) => void stripSelected\(\)\}/);
  assert.match(workbench, /if \(!selected \|\| stripBusy \|\| running \|\| importing\) return;/);
  assert.match(workbench, /Download verified copy/);
});

test("batch writes a bounded GIF from the ordered source stills", () => {
  assert.match(workbench, /<legend>Make an animated GIF<\/legend>/);
  assert.match(workbench, /GIF frame size/);
  assert.match(workbench, /GIF delay \(ms per frame\)/);
  assert.match(workbench, /GIF matte/);
  assert.match(workbench, /Repeat after the last frame/);
  assert.match(workbench, /<summary>Per-frame delays \(optional\)<\/summary>/);
  assert.match(workbench, /Frame \{index \+ 1\} delay \(ms\)/);
  assert.match(workbench, /items\.length > 0 && items\.length <= GIF_MAX_FRAMES && \(/);
  assert.match(workbench, /aria-describedby=\{`image-gif-delays-note image-gif-delay-source-\$\{item\.id\}`\}/);
  assert.match(workbench, /title=\{item\.file\.name\}\s*>\s*\{item\.file\.name\}\s*<\/span>/);
  assert.match(workbench, /const gifSourceKey = items\.map/);
  assert.match(workbench, /item\.gifDelayMsOverride \?\? gifDelayMs/);
  assert.match(
    workbench,
    /const frameDelaysMs = snapshot\.map\(\(item\) => item\.gifDelayMsOverride \?\? delayMs\)/,
  );
  assert.match(
    workbench,
    /gifFrameDelaysProblem\(\{ frameCount: snapshot\.length, frameDelaysMs \}\)/,
  );
  assert.match(
    workbench,
    /candidate\.id === item\.id \? \{ \.\.\.candidate, gifDelayMsOverride: value \} : candidate/,
  );
  assert.match(
    workbench,
    /encodeGif\(\{\s*frames,\s*width: size,\s*height: size,\s*delayMs,\s*\.\.\.\(hasOverrides \? \{ frameDelaysMs \} : \{\}\),\s*loop,\s*compact,\s*\}\)/,
  );
  assert.match(workbench, /const \[gifCompact, setGifCompact\] = useState\(false\)/);
  assert.match(workbench, /const compact = gifCompact/);
  assert.match(workbench, /GIF compact setting changed\. Make the GIF again\./);
  assert.match(workbench, /Compact file/);
  assert.match(workbench, /if \(attempt !== gifRevision\.current\) return;/);
  assert.match(workbench, /gifOutputDelaySummary\?\.token/);
  assert.match(workbench, /gifOutputDelaySummary\?\.phrase/);
  assert.match(workbench, /alt=\{`Encoded GIF:/);
  assert.match(workbench, /src=\{gifOutput\.url\}/);
  assert.match(workbench, /disabled=\{\s*gifBusy \|\| Boolean\(batchExport\)/);

  const gif = readFileSync(new URL("../src/frontend/image-gif.ts", import.meta.url), "utf8");
  assert.doesNotMatch(gif, /from "|fetch\(|XMLHttpRequest|https?:\/\//);
  assert.match(gif, /GIF89a/);
  assert.match(gif, /NETSCAPE2\.0/);
  assert.match(gif, /frameDelaysMs/);
});

test("the adjustment and snippet modules stay local and dependency-free", () => {
  for (const file of ["image-adjust.ts", "image-snippets.ts"]) {
    const source = readFileSync(new URL(`../src/frontend/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from "react"|fetch\(|XMLHttpRequest|import\(/, file);
    assert.doesNotMatch(source, /https?:\/\//, file);
    assert.doesNotMatch(source, /from "[^"]+"/, `${file} imports no module`);
  }
});

test("the workbench straightens by a real angle and shows the kept area", () => {
  assert.match(workbench, /<legend>Rotate, straighten and flip<\/legend>/);
  assert.match(workbench, /<label>\s*Straighten\{" "\}/);
  assert.match(workbench, /min=\{-MAX_STRAIGHTEN_DEGREES\}/);
  assert.match(workbench, /max=\{MAX_STRAIGHTEN_DEGREES\}/);
  assert.match(workbench, /step="0\.1"/);
  assert.match(workbench, /aria-describedby="image-straighten-note"/);
  assert.match(workbench, /largest area that is entirely real pixels/);
  assert.match(workbench, /Reset straighten/);
  assert.match(workbench, /keptAreaPolygon\(plan\)/);
  assert.match(workbench, /className="image-keep-overlay"/);
  assert.match(workbench, /The dimmed area is discarded by the export/);
  assert.match(workbench, /Reset controls/);
  assert.match(workbench, /straighten: settings\.straighten/);
  assert.match(workbench, /drawStraightened\(stage, plan\.straighten\)/);
  assert.match(workbench, /straighten: selected\.result\.settings\.straighten/);
  assert.match(workbench, /Set straighten to 0° before trimming/);
});
