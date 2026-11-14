import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('poster preview preserves its image aspect and secondary action remains visible',()=>{
 const component=readFileSync(new URL('../src/frontend/clip-poster.tsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../src/frontend/video-clip.css',import.meta.url),'utf8');
 assert.match(component, /className="clip-poster-preview" src=\{poster\}/);
 assert.match(css, /\.clip-poster-preview\s*\{[^}]*width:auto;[^}]*height:auto;[^}]*max-width:[^;]+;[^}]*max-height:[^;]+;/);
 assert.match(css, /\.trim-result \.button\.secondary[^}]*color:var\(--ink\)/);
});
