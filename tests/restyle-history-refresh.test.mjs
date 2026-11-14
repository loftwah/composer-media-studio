import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeHistoryRead} from '../public/restyle-history-refresh.js';

test('read-only History refresh discovers a lost-response job without regressing concurrent progress', () => {
  const project={generations:[{id:'old',status:'saved',updatedAt:5}],budget:{reservedMicro:0},draft:{prompt:'keep this'}};
  mergeHistoryRead(project,{generations:[{id:'new',status:'submitted',updatedAt:2},{id:'old',status:'running',updatedAt:4}],budget:{reservedMicro:840000}});
  assert.deepEqual(project.generations.map(x=>[x.id,x.status]),[['new','submitted'],['old','saved']]);
  assert.equal(project.budget.reservedMicro,0);
  assert.deepEqual(project.draft,{prompt:'keep this'});
  mergeHistoryRead(project,{generations:[{id:'new',status:'running',updatedAt:3},{id:'old',status:'saved',updatedAt:5}],budget:{reservedMicro:840000}});
  assert.equal(project.generations[0].status,'running');
  assert.equal(project.budget.reservedMicro,840000);
});

test('a delayed project read cannot remove a newly admitted in-memory job',()=>{
  const project={generations:[{id:'new',updatedAt:3}],budget:{reservedMicro:840000}};
  mergeHistoryRead(project,{generations:[],budget:{reservedMicro:0}});
  assert.equal(project.generations[0].id,'new');assert.equal(project.budget.reservedMicro,840000);
});
