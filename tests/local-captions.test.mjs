import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionLines, resolveCaptionSnapshot } from '../src/frontend/local-captions.ts';
const scenes=[{id:'scn_a',selectedTakeId:'asset_a',startMs:1000,endMs:3000},{id:'scn_b',selectedTakeId:'asset_b',startMs:3000,endMs:6000}];
const origin={id:'plan_a',revision:4,songSha256:'song_hash',sourceStartMs:1000,sourceEndMs:6000,scenes};
const composition={id:'cmp_a',shots:[{assetId:'asset_a'},{assetId:'asset_b'}],totalMs:5000,audioAssetId:null,createdAt:1,originSongPlan:origin};
const assets=[{id:'song',kind:'audio',sha256:'song_hash'},{id:'asset_a',kind:'video',durationMs:2000},{id:'asset_b',kind:'video',durationMs:3000}];
const plan={id:'plan_a',revision:4,songAssetId:'song',songSha256:'song_hash',startMs:1000,endMs:6000,scenes,captions:{source:'owner_supplied',rightsConfirmed:true,cues:[{id:'cue_1',startMs:1250,endMs:2500,text:'Hello world',speaker:'Singer'}]}};

test('uses only permission-confirmed captions from the exact saved song and storyboard revision',()=>{
 const snapshot=resolveCaptionSnapshot(composition,assets,plan);
 assert.equal(snapshot.sourceStartMs,1000); assert.equal(snapshot.revision,4); assert.equal(snapshot.cues[0].text,'Hello world');
 assert.throws(()=>resolveCaptionSnapshot(composition,assets,{...plan,revision:5}),/changed/);
 assert.throws(()=>resolveCaptionSnapshot(composition,assets,{...plan,captions:{...plan.captions,rightsConfirmed:false}}),/permission/);
 assert.throws(()=>resolveCaptionSnapshot({...composition,shots:[{assetId:'asset_b'},{assetId:'asset_a'}]},assets,plan),/no longer matches/);
 assert.throws(()=>resolveCaptionSnapshot(composition,[{...assets[0],sha256:'changed'},...assets.slice(1)],plan),/song.*changed/);
});
test('refuses overlapping or out-of-range cues and never silently clips caption text',()=>{
 const cue=plan.captions.cues[0];
 assert.throws(()=>resolveCaptionSnapshot(composition,assets,{...plan,captions:{...plan.captions,cues:[cue,{...cue,id:'cue_2',startMs:2000,endMs:2800}]}}),/non-overlapping/);
 assert.throws(()=>resolveCaptionSnapshot(composition,assets,{...plan,captions:{...plan.captions,cues:[{...cue,endMs:6001}]}}),/non-overlapping/);
 assert.deepEqual(captionLines('one two three',7,s=>s.length),['one two','three']);
 assert.throws(()=>captionLines('extraordinary',4,s=>s.length),/too wide/);
 assert.throws(()=>captionLines('one two six ten',3,s=>s.length),/three lines/);
});
test('captioned trimmed cuts must match the frozen source in- and out-points',()=>{
 const longer=[assets[0],{...assets[1],durationMs:4000},assets[2]];
 const frozen=[{...scenes[0],trimStartMs:0,trimEndMs:2000},scenes[1]];
 const trimmed={...composition,shots:[{assetId:'asset_a',trimStartMs:0,trimEndMs:2000,durationMs:2000},{assetId:'asset_b'}],originSongPlan:{...origin,scenes:frozen}};
 assert.equal(resolveCaptionSnapshot(trimmed,longer,plan).revision,4);
 assert.throws(()=>resolveCaptionSnapshot({...trimmed,shots:[{assetId:'asset_a',trimStartMs:500,trimEndMs:2500,durationMs:2000},{assetId:'asset_b'}]},longer,plan),/no longer matches/);
 assert.throws(()=>resolveCaptionSnapshot({...trimmed,originSongPlan:{...origin,scenes}},longer,plan),/no longer matches/);
});
test('non-zero scene in-points retain captions only while the frozen ranges match',()=>{
 const longer=[assets[0],{...assets[1],durationMs:4000},assets[2]];
 const frozen=[{...scenes[0],trimStartMs:500,trimEndMs:2500},scenes[1]];
 const cut={...composition,shots:[{assetId:'asset_a',trimStartMs:500,trimEndMs:2500,durationMs:2000},{assetId:'asset_b'}],originSongPlan:{...origin,scenes:frozen}};
 assert.equal(resolveCaptionSnapshot(cut,longer,plan).revision,4);
 assert.throws(()=>resolveCaptionSnapshot({...cut,shots:[{assetId:'asset_a',trimStartMs:600,trimEndMs:2600,durationMs:2000},{assetId:'asset_b'}]},longer,plan),/no longer matches/);
});
