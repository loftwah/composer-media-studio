import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultFraming, framingNote, resolveFrame } from '../src/frontend/local-framing.ts';

test('default preserves first-shot orientation and explicit frames are bounded',()=>{
 assert.deepEqual(resolveFrame(defaultFraming,{width:1920,height:1080}),{width:640,height:360,fit:'contain'});
 assert.deepEqual(resolveFrame(defaultFraming,{width:720,height:1280}),{width:360,height:640,fit:'contain'});
 assert.deepEqual(resolveFrame({aspect:'1:1',fit:'cover'},{width:720,height:1280}),{width:480,height:480,fit:'cover'});
 assert.match(framingNote(resolveFrame({aspect:'9:16',fit:'cover'},{width:720,height:1280})),/360x640; fit centre-fill \(cropped\)/);
 assert.throws(()=>resolveFrame({aspect:'source',fit:'contain'},{width:null,height:null}),/measured frame/);
 assert.throws(()=>resolveFrame({aspect:'bad',fit:'cover'},{width:1,height:1}),/valid output/);
});
