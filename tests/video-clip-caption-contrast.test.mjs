import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/frontend/video-clip.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/frontend/video-clip.css', import.meta.url), 'utf8');

test('caption contrast is a bounded, display-only original-video preview choice', () => {
  assert.match(component, /type CaptionPreviewContrast = "default" \| "contrast";/);
  assert.match(component, /useState<CaptionPreviewContrast>\("default"\)/);

  assert.match(component, /<label>Preview caption contrast<select[\s\S]*?aria-describedby="source-caption-note"[\s\S]*?<\/select><\/label>/);
  assert.match(component, /<option value="default">Default<\/option>\s*<option value="contrast">High contrast<\/option>/);
  assert.match(component, /setSourceCaptionContrast\(event\.currentTarget\.value === "contrast" \? "contrast" : "default"\)/);

  const note = component.match(/<p id="source-caption-note"[^>]*>([^<]*)<\/p>/)?.[1] ?? '';
  assert.match(note, /High contrast for pale yellow captions on near-black/);

  // The original video carries the look; the native cue track, its VTT and the
  // placement serializer keep their existing inputs and identity.
  assert.match(component, /<video ref=\{sourceVideo\} className="video-tool-player" data-caption-contrast=\{sourceCaptionContrast\}/);
  assert.match(component, /sourcePreviewVtt\(captionDraft\.cues, duration, captionOffsetMs, sourceCaptionPlacement, \{ voices: true \}\)/);
  assert.doesNotMatch(component, /sourcePreviewVtt\([^)]*sourceCaptionContrast/);
  assert.match(component, /\{sourceCaptionUrl && <track ref=\{sourceCaptions\}[^>]*>\}/);
});

test('high-contrast cue colours are scoped to the original video and the selected option', () => {
  assert.match(css, /\.video-tool-player\[data-caption-contrast="contrast"\]::cue\s*\{[^}]*color:#fff2a8;[^}]*background-color:#111111;[^}]*\}/);
  assert.doesNotMatch(css, /(?:^|\n)\s*video::cue\s*\{/);
  assert.doesNotMatch(css, /(?:^|\n)\s*::cue\s*\{/);
});
