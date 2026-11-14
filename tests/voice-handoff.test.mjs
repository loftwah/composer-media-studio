import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareVoiceDraft, restoreCreateDraft, switchCreateProject, createEventBelongsToProject } from '../public/voice-handoff.js';
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

test('each studio restores its own Create draft across project switches',()=>{
 const cache=new Map(); const first={prompt:'studio A private text',controls:{seed:'a'}};
 const second=switchCreateProject(cache,'a',first,'b',()=>({prompt:'',controls:{}}));
 assert.equal(second.prompt,''); second.prompt='studio B private text';
 const back=switchCreateProject(cache,'b',second,'a',()=>{throw new Error('must restore')});
 assert.equal(back.prompt,'studio A private text'); back.controls.seed='changed';
 const again=switchCreateProject(cache,'a',back,'b',()=>{throw new Error('must restore')});
 assert.equal(again.prompt,'studio B private text'); assert.equal(cache.get('a').controls.seed,'changed');
});

test('late input from the previously rendered studio is ignored during a project switch',()=>{
 assert.equal(createEventBelongsToProject('a','b','a'),false);
 assert.equal(createEventBelongsToProject('a','b','b'),false);
 assert.equal(createEventBelongsToProject('b','b','b'),true);
 assert.equal(createEventBelongsToProject(undefined,'b','b'),true);
});
