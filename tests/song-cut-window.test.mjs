import {test} from 'node:test';import assert from 'node:assert/strict';import {songCutWindow} from '../src/frontend/song-cut-window.ts';
test('uses up to two seconds on either side, bounded by the selected segment',()=>{
 const scenes=[{startMs:3000,endMs:4500},{startMs:4500,endMs:8000},{startMs:8000,endMs:9000}];
 assert.deepEqual(songCutWindow(scenes,0,3000,9000,12000),{startMs:3000,endMs:6500});
 assert.deepEqual(songCutWindow(scenes,1,3000,9000,12000),{startMs:6000,endMs:9000});
});
test('rejects gaps, invalid bounds and missing or out-of-range source durations',()=>{
 const scenes=[{startMs:0,endMs:5000},{startMs:5001,endMs:10000}];
 assert.equal(songCutWindow(scenes,0,0,10000,10000),null);scenes[1].startMs=5000;
 for(const [start,end,duration] of [[0,10000,null],[-1,10000,10000],[0,10001,10000],[0,5000,10000],[NaN,10000,10000]]) assert.equal(songCutWindow(scenes,0,start,end,duration),null);
});
