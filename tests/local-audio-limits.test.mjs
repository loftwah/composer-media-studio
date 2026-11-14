import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localAudioFits,trimWavFits} from '../src/frontend/local-audio-limits.mjs';
test('five-minute stereo sources fit only within the device PCM budget',()=>{
 const source={seconds:267.574,channels:2,sourceRate:48000,deviceRate:48000};
 assert.equal(localAudioFits(source),true);
 for (const patch of [{seconds:301},{channels:3},{sourceRate:96000},{deviceRate:96000},{seconds:NaN},{channels:0}]) assert.equal(localAudioFits({...source,...patch}),false);
});
test('trim output must fit a bounded PCM WAV',()=>{
 assert.equal(trimWavFits(60*48000,2),true);
 assert.equal(trimWavFits(180*48000,2),true);
 assert.equal(trimWavFits(60*96000,2),true);
 assert.equal(trimWavFits(11000000,2),false);
 assert.equal(trimWavFits(0,2),false);
});
