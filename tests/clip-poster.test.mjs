import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipPosterError } from '../src/frontend/clip-poster-eligibility.mjs';
test('a poster requires a paused, loaded, bounded output frame',()=>{
 const frame={paused:true,seeking:false,readyState:2,videoWidth:360,videoHeight:640};
 assert.equal(clipPosterError(frame),'');
 assert.equal(clipPosterError({...frame,videoWidth:720,videoHeight:1280}),'');
 assert.equal(clipPosterError({...frame,videoWidth:1280,videoHeight:720}),'');
 assert.equal(clipPosterError({...frame,videoWidth:720,videoHeight:720}),'');
 for(const patch of [{paused:false},{seeking:true},{readyState:1},{videoWidth:0},{videoWidth:2000}]) assert.notEqual(clipPosterError({...frame,...patch}),'');
 assert.notEqual(clipPosterError(null),'');
});
