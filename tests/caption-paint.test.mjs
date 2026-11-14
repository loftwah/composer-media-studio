import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptionPainter } from '../src/frontend/caption-paint.ts';

test('paints only during a cue on the segment-relative clock', () => {
  const drawn=[]; const ctx={measureText:s=>({width:s.length*8}),save(){},restore(){},fillRect(...v){drawn.push(['box',...v])},fillText(...v){drawn.push(['text',...v])}};
  const paint=createCaptionPainter(ctx,640,360,{sourceStartMs:1000,cues:[{id:'cue_a',startMs:1500,endMs:2500,text:'Hello',speaker:'Singer'}]});
  paint(499); assert.equal(drawn.length,0); paint(500); assert.equal(drawn[1][1],'Singer: Hello'); paint(1500); assert.equal(drawn.length,2);
});
