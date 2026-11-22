import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('a failed native caption load is reported as recoverable while captions are enabled',()=>{
 const component=readFileSync(new URL('../src/frontend/clip-poster.tsx',import.meta.url),'utf8');
 // The native <track> element's own error/load events drive the status;
 // the component never renders cues itself.
 assert.match(component,/track\.addEventListener\("error"/);
 assert.match(component,/track\.addEventListener\("load"/);
 assert.doesNotMatch(component,/\.cues\b/);
 // Visible only when captions are enabled, announced politely like the other statuses.
 assert.match(component,/showCaptions && trackProblem/);
 assert.match(component,/role="status"/);
 // Only the track-specific problem clears on a source replacement; the
 // message, copy and kit statuses are untouched by this effect.
 assert.match(component,/useEffect\(\(\) => \{\s*setTrackProblem\(""\);[\s\S]*?\}, \[src, captionTrack\]\);/);
 // The recovery named in the status must keep output and rights intact.
 assert.match(component,/Make MP4 again to retry/);
});
