import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareVoiceDraft, restoreCreateDraft } from '../public/voice-handoff.js';
const model={id:'studio-voice',kind:'audio',audio:{mode:'speech',maxChars:1200}};
test('explicit handoff preserves every field in the prior draft and never mutates its source',()=>{
 const source={kind:'image',model:'studio-print',recipeSlug:'print',prompt:'Unsaved destination text',referenceAssetId:'asset_a',maskAssetId:'asset_m',controls:{aspect:'square'}};
 const {previous,voice}=prepareVoiceDraft(source,'A spoken line',model);
 assert.deepEqual(previous,source); assert.equal(voice.prompt,'A spoken line'); assert.equal(voice.model,'studio-voice'); assert.equal(voice.kind,'audio'); assert.equal(voice.referenceAssetId,null); assert.equal(source.prompt,'Unsaved destination text');
 voice.controls.changed=true; assert.equal(source.controls.changed,undefined);
});
test('restoring a selected earlier draft also retains the draft being left',()=>{
 const a={prompt:'first'}, b={prompt:'second'}, current={prompt:'voice'};
 const {restored,remaining}=restoreCreateDraft([a,b],0,current);
 assert.equal(restored.prompt,'first'); assert.deepEqual(remaining.map(x=>x.prompt),['second','voice']); assert.deepEqual([a,b],[{prompt:'first'},{prompt:'second'}]);
 assert.throws(()=>restoreCreateDraft([a],2,current),/Choose/);
});
test('voice capability and provider length are checked before any draft is replaced',()=>{
 const original={prompt:'keep'};
 for (const [script,capability] of [['',model],['x'.repeat(1201),model],['words',null],['words',{...model,audio:{mode:'music'}}]]) assert.throws(()=>prepareVoiceDraft(original,script,capability));
 assert.equal(original.prompt,'keep');
});
