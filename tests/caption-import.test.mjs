import {test} from 'node:test';import assert from 'node:assert/strict';import {parseCaptionFile} from '../src/frontend/caption-import.ts';
import {reviewedCaptionFor} from '../src/lib/public-captions.ts';
import {setup,addAsset} from './harness.mjs';import {createSongPlan,updateSongCaptions,exportSongCaptions} from '../src/lib/song-plans.ts';

const SLUG='PbvQYtyGG-YlF0Dh',SHA='187134b76dc0687d95e263d7b3bb2b7cf6507affb4204e61c2badaeff567d046';
test('parses SRT and WebVTT relative to the selected song segment without guessing speakers',()=>{ const srt='1\r\n00:00:00,500 --> 00:00:01,500\r\nDean: Hello\r\nworld\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nA &lt; B';
 const result=parseCaptionFile(srt,10000,20000);assert.deepEqual(result,[{startMs:10500,endMs:11500,text:'Dean: Hello world',speaker:''},{startMs:12000,endMs:13000,text:'A < B',speaker:''}]);
 const vtt='WEBVTT\n\ncue-a\n00:00.500 --> 00:01.500\nA &amp; B &lt; C\n\n00:02.000 --> 00:03.000\nNext';
 assert.deepEqual(parseCaptionFile(vtt,10000,20000).map(c=>c.text),['A & B < C','Next']);
 // The real published English VTT carries one line:12% hint on every cue. Import drops
 // that placement hint but keeps the same plain-text cue timings and text.
 const published=reviewedCaptionFor(SLUG,SHA);assert.ok(published);
 assert.deepEqual(parseCaptionFile(published,0,180000),[
  {startMs:0,endMs:600,text:'[A sharp click]',speaker:''},
  {startMs:600,endMs:2050,text:'Bring your AI agent.',speaker:''},
  {startMs:2050,endMs:3650,text:'Build an app.',speaker:''},
  {startMs:3850,endMs:7700,text:'[Power-up chime] Take it with you.',speaker:''},
 ]);
 // One standalone in-range percentage, including fractional values and both bounds, is accepted.
 for(const hint of [' line:0%',' line:100%',' line:12.5%'])
  assert.equal(parseCaptionFile(`WEBVTT\n\n00:00.000 --> 00:01.000${hint}\nA`,0,10000)[0].text,'A');
});
test('rejects malformed, overlapping, styled, out-of-segment and oversized input',()=>{
 const cases=['','1\n00:00:00,000 --> 00:00:01,000\n<i>style</i>','1\n00:00:00,000 --> 00:00:02,000\nA\n\n2\n00:00:01,000 --> 00:00:03,000\nB','WEBVTT\n\n00:00.000 --> 00:01.000 align:center\nA','1\n00:00:00,000 --> 00:00:11,000\nA','1\n00:00:00,000 --> 00:00:01,000\nA\u0000B','x'.repeat(65537),
  // Rejection boundaries around the one accepted WebVTT line percentage.
  'WEBVTT\n\n00:00.000 --> 00:01.000 line:101%\nA',
  'WEBVTT\n\n00:00.000 --> 00:01.000 line:-1%\nA',
  'WEBVTT\n\n00:00.000 --> 00:01.000 line:12\nA',
  'WEBVTT\n\n00:00.000 --> 00:01.000 line:12% align:center\nA',
  'WEBVTT\n\n00:00.000 --> 00:01.000 line:12% line:13%\nA',
  '1\n00:00:00,000 --> 00:00:01,000 line:12%\nA'];
 for(const text of cases)assert.throws(()=>parseCaptionFile(text,0,10000));
});
test('imports Studio-exported SRT and VTT cue timings into their original source-song positions',async()=>{
 const {env,project}=await setup();await addAsset(env,project,{id:'asset_song1',kind:'audio',durationMs:30000});const plan=await createSongPlan(env,project,{songAssetId:'asset_song1',rightsConfirmed:true,title:'Example',aspect:'16:9',startMs:10000,endMs:20000,sceneCount:2});await updateSongCaptions(env,project,plan.id,{expectedRevision:1,rightsConfirmed:true,cues:[{id:'cue_a001',startMs:10500,endMs:11500,text:'A & B < C',speaker:''}]});
 for(const format of ['srt','vtt']){const out=await exportSongCaptions(env,project,plan.id,format);const cues=parseCaptionFile(out.content,10000,20000);assert.equal(cues[0].startMs,10500);assert.equal(cues[0].endMs,11500);assert.equal(cues[0].text,'A & B < C');}
});
test('Video Clip opts into one bounded WebVTT voice annotation; every other caller stays strict',()=>{
 const vtt='WEBVTT\n\n00:00.500 --> 00:01.500\n<v Dean &amp; Jane>Hello &amp; welcome</v>\n\n00:02.000 --> 00:03.000\n<v Sam>No closing tag\n\n00:03.000 --> 00:04.000\nPlain';
 // The shared saved-song import and SRT ingestion never pass the option.
 assert.throws(()=>parseCaptionFile(vtt,0,10000),/markup and styling/);
 assert.deepEqual(parseCaptionFile(vtt,10000,20000,{voices:true}),[
  {startMs:10500,endMs:11500,text:'Hello & welcome',speaker:'Dean & Jane'},
  {startMs:12000,endMs:13000,text:'No closing tag',speaker:'Sam'},
  {startMs:13000,endMs:14000,text:'Plain',speaker:''},
 ]);
 // SRT has no voice annotation, so the option cannot make one valid.
 assert.throws(()=>parseCaptionFile('1\n00:00:00,000 --> 00:00:01,000\n<v Dean>Hi</v>',0,10000,{voices:true}),/markup and styling/);
});
test('voice annotations reject nesting, mixed content, styling and unbounded names',()=>{
 for(const raw of [
  '<v Dean><i>Hello</i></v>',
  '<v Dean>Hello</v> trailing',
  'Hello <v Dean>there',
  '<v Dean>one</v><v Sam>two</v>',
  '<v>Unnamed</v>',
  '<v.loud Dean>Loud</v>',
  `<v ${'x'.repeat(81)}>Long</v>`,
  '<v Dean>Hello</v></v>',
  '<v Dean>Hello</v><v Sam>there</v>',
 ])assert.throws(()=>parseCaptionFile(`WEBVTT\n\n00:00.000 --> 00:01.000\n${raw}`,0,10000,{voices:true}));
});
