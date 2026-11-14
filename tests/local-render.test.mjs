import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLocalInputs } from '../src/frontend/local-render.ts';
const clip = (id, extra={}) => ({id,kind:'video',durationMs:2000,bytes:1000,width:320,height:180,...extra});
const audio = {id:'audio_1',kind:'audio',mime:'audio/wav',durationMs:4000,bytes:2000};
const comp = {shots:[{assetId:'clip_1'},{assetId:'clip_2'}],audioAssetId:'audio_1',audioTracks:[]};
test('local MP4 preflight accepts bounded available clips and a matching mixed bed',()=>{
 const result=validateLocalInputs(comp,[clip('clip_1'),clip('clip_2'),audio]);
 assert.equal(result.totalMs,4000);assert.equal(result.sound.id,'audio_1');
});
test('local MP4 refuses missing clips, overlong media, unmixed tracks and inconsistent audio',()=>{
 assert.throws(()=>validateLocalInputs(comp,[clip('clip_1'),audio]),/two to six/);
 assert.throws(()=>validateLocalInputs(comp,[clip('clip_1',{durationMs:17000}),clip('clip_2'),audio]),/16 seconds/);
 assert.throws(()=>validateLocalInputs({...comp,audioAssetId:null,audioTracks:[{assetId:'audio_1'}]},[clip('clip_1'),clip('clip_2'),audio]),/Mix soundtrack/);
 assert.throws(()=>validateLocalInputs(comp,[clip('clip_1'),clip('clip_2'),{...audio,durationMs:5000}]),/match the storyboard/);
 assert.throws(()=>validateLocalInputs(comp,[clip('clip_1'),clip('clip_2'),{...audio,mime:'audio/mpeg'}]),/save a WAV mix/);
 assert.throws(()=>validateLocalInputs(comp,[clip('clip_1',{bytes:130*1024*1024}),clip('clip_2'),audio]),/128 MiB/);
});
test('local MP4 validates saved ranges and measures the soundtrack against the trimmed cut',()=>{
 const trimmed={...comp,shots:[{assetId:'clip_1',trimStartMs:500,trimEndMs:1500,durationMs:1000},{assetId:'clip_2'}],totalMs:3000};
 const assets=[clip('clip_1'),clip('clip_2'),{...audio,durationMs:3000}];
 const result=validateLocalInputs(trimmed,assets);
 assert.deepEqual(result.ranges.map(x=>[x.start,x.end]),[[500,1500],[0,2000]]);
 assert.equal(result.totalMs,3000);
 assert.throws(()=>validateLocalInputs({...trimmed,shots:[{assetId:'clip_1',trimStartMs:500},trimmed.shots[1]]},assets),/invalid trim/);
 assert.throws(()=>validateLocalInputs({...trimmed,shots:[{...trimmed.shots[0],trimEndMs:2500},trimmed.shots[1]]},assets),/invalid trim/);
 assert.throws(()=>validateLocalInputs(trimmed,[...assets.slice(0,2),audio]),/match the storyboard/);
 assert.throws(()=>validateLocalInputs({...trimmed,totalMs:4000},assets),/duration does not match/);
});
