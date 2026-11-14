import {test} from 'node:test';import assert from 'node:assert/strict';import {parseCaptionFile} from '../src/frontend/caption-import.ts';
import {setup,addAsset} from './harness.mjs';import {createSongPlan,updateSongCaptions,exportSongCaptions} from '../src/lib/song-plans.mjs';
test('parses SRT and WebVTT relative to the selected song segment without guessing speakers',()=>{
 const srt='1\r\n00:00:00,500 --> 00:00:01,500\r\nDean: Hello\r\nworld\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nA &lt; B';
 const result=parseCaptionFile(srt,10000,20000);assert.deepEqual(result,[{startMs:10500,endMs:11500,text:'Dean: Hello world',speaker:''},{startMs:12000,endMs:13000,text:'A < B',speaker:''}]);
 const vtt='WEBVTT\n\ncue-a\n00:00.500 --> 00:01.500\nA &amp; B &lt; C\n\n00:02.000 --> 00:03.000\nNext';
 assert.deepEqual(parseCaptionFile(vtt,10000,20000).map(c=>c.text),['A & B < C','Next']);
});
test('rejects malformed, overlapping, styled, out-of-segment and oversized input',()=>{
 const cases=['','1\n00:00:00,000 --> 00:00:01,000\n<i>style</i>','1\n00:00:00,000 --> 00:00:02,000\nA\n\n2\n00:00:01,000 --> 00:00:03,000\nB','WEBVTT\n\n00:00.000 --> 00:01.000 align:center\nA','1\n00:00:00,000 --> 00:00:11,000\nA','1\n00:00:00,000 --> 00:00:01,000\nA\u0000B','x'.repeat(65537)];
 for(const text of cases)assert.throws(()=>parseCaptionFile(text,0,10000));
});
test('imports Studio-exported SRT and VTT cue timings into their original source-song positions',async()=>{
 const {env,project}=await setup();await addAsset(env,project,{id:'asset_song1',kind:'audio',durationMs:30000});const plan=await createSongPlan(env,project,{songAssetId:'asset_song1',rightsConfirmed:true,title:'Example',aspect:'16:9',startMs:10000,endMs:20000,sceneCount:2});await updateSongCaptions(env,project,plan.id,{expectedRevision:1,rightsConfirmed:true,cues:[{id:'cue_a001',startMs:10500,endMs:11500,text:'A & B < C',speaker:''}]});
 for(const format of ['srt','vtt']){const out=await exportSongCaptions(env,project,plan.id,format);const cues=parseCaptionFile(out.content,10000,20000);assert.equal(cues[0].startMs,10500);assert.equal(cues[0].endMs,11500);assert.equal(cues[0].text,'A & B < C');}
});
