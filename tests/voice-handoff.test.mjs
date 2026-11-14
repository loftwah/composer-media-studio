import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareVoiceDraft, restoreCreateDraft, switchCreateProject, createEventBelongsToProject, hasCreateDraftChanges, shouldWarnCreateDrafts } from '../public/voice-handoff.js';
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
 const cache=new Map(); const baselines=new Map([['a',{prompt:'',controls:{}}]]); const first={prompt:'studio A private text',controls:{seed:'a'}};
 const second=switchCreateProject(cache,baselines,'a',first,'b',()=>({prompt:'',controls:{}}));
 assert.equal(second.prompt,''); second.prompt='studio B private text';
 const back=switchCreateProject(cache,baselines,'b',second,'a',()=>{throw new Error('must restore')});
 assert.equal(back.prompt,'studio A private text'); back.controls.seed='changed';
 const again=switchCreateProject(cache,baselines,'a',back,'b',()=>{throw new Error('must restore')});
 assert.equal(again.prompt,'studio B private text'); assert.equal(cache.get('a').controls.seed,'changed');
});

test('late input from the previously rendered studio is ignored during a project switch',()=>{
 assert.equal(createEventBelongsToProject('a','b','a'),false);
 assert.equal(createEventBelongsToProject('a','b','b'),false);
 assert.equal(createEventBelongsToProject('b','b','b'),true);
 assert.equal(createEventBelongsToProject(undefined,'b','b'),true);
});

test('untouched studio switches do not create dirty recovery drafts',()=>{
 const cache=new Map(), baselines=new Map();
 const initial=switchCreateProject(cache,baselines,null,null,'a',()=>({prompt:'default',controls:{}}));
 const second=switchCreateProject(cache,baselines,'a',initial,'b',()=>({prompt:'default B',controls:{}}));
 assert.equal(cache.size,0); assert.equal(hasCreateDraftChanges(second,baselines.get('b')),false);
 const again=switchCreateProject(cache,baselines,'b',second,'a',()=>{throw new Error('existing baseline')});
 assert.equal(cache.size,0); assert.equal(hasCreateDraftChanges(again,baselines.get('a')),false);
 assert.equal(shouldWarnCreateDrafts(cache,new Map(),again,baselines.get('a')),false);
 again.prompt='edited'; switchCreateProject(cache,baselines,'a',again,'b',()=>{throw new Error('existing baseline')});
 assert.equal(cache.get('a').prompt,'edited'); assert.equal(hasCreateDraftChanges(again,baselines.get('a')),true);
 assert.equal(shouldWarnCreateDrafts(cache,new Map(),second,baselines.get('b')),true);
});
test('restoring a draft does not retain an unchanged default',()=>{
 const {restored,remaining}=restoreCreateDraft([{prompt:'earlier'}],0,{prompt:'default'},false);
 assert.equal(restored.prompt,'earlier');assert.equal(remaining.length,0);
});
test('handoff leaves no recovery entry for an untouched default but retains edited text',()=>{
 const baseline={kind:'image',model:'studio-print',prompt:'starting text',controls:{}};
 const drafts=[]; const initial=prepareVoiceDraft(baseline,'spoken',model);
 if (hasCreateDraftChanges(initial.previous,baseline)) drafts.push(initial.previous);
 assert.equal(drafts.length,0);
 const edited={...baseline,prompt:'my words'}; const next=prepareVoiceDraft(edited,'spoken',model);
 if (hasCreateDraftChanges(next.previous,baseline)) drafts.push(next.previous);
 assert.equal(drafts.length,1); assert.equal(drafts[0].prompt,'my words');
});
