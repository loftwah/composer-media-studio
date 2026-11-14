import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptionPainter } from '../src/frontend/caption-paint.ts';

test('paints only during a cue on the segment-relative clock', () => {
  const drawn=[]; const ctx={measureText:s=>({width:s.length*8}),save(){},restore(){},fillRect(...v){drawn.push(['box',...v])},fillText(...v){drawn.push(['text',...v])}};
  const paint=createCaptionPainter(ctx,640,360,{sourceStartMs:1000,cues:[{id:'cue_a',startMs:1500,endMs:2500,text:'Hello',speaker:'Singer'}]});
  paint(499); assert.equal(drawn.length,0); paint(500); assert.equal(drawn[1][1],'Singer: Hello'); paint(1500); assert.equal(drawn.length,2);
});
test('lower-third keeps the box inside frame margins and left-aligns text in both orientations',()=>{
 for(const [width,height] of [[640,360],[360,640],[1280,720],[720,1280]]){
  const calls=[];const ctx={measureText:s=>({width:s.length*8}),save(){},restore(){},fillRect(...args){calls.push({type:'rect',args,colour:this.fillStyle})},fillText(...args){calls.push({type:'text',args,align:this.textAlign})}};
  const paint=createCaptionPainter(ctx,width,height,{sourceStartMs:0,cues:[{id:'cue_a',startMs:0,endMs:1000,text:'A fictional lyric',speaker:''}]},'lower-third');paint(500);
  const panel=calls[0].args,accent=calls[1],line=calls[2];assert.ok(panel[0]>=width*.07);assert.ok(panel[0]+panel[2]<=width*.93);assert.ok(panel[1]>=0&&panel[1]+panel[3]<=height*.9+1);assert.equal(accent.colour,'#ff6b1a');assert.equal(line.align,'left');assert.ok(line.args[1]>panel[0]&&line.args[1]<panel[0]+panel[2]);
 }
});
