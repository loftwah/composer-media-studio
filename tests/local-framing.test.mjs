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
test('HD output is explicit and aspect-correct while legacy framing remains standard',()=>{
 assert.deepEqual(resolveFrame({aspect:'16:9',fit:'contain',quality:'hd'},{width:1920,height:1080}),{width:1280,height:720,fit:'contain'});
 assert.deepEqual(resolveFrame({aspect:'9:16',fit:'cover',quality:'hd'},{width:1920,height:1080}),{width:720,height:1280,fit:'cover'});
 assert.deepEqual(resolveFrame({aspect:'source',fit:'contain',quality:'hd'},{width:1000,height:1000}),{width:720,height:720,fit:'contain'});
 assert.throws(()=>resolveFrame({aspect:'1:1',fit:'cover',quality:'other'},{width:720,height:1280}),/valid output/);
});
