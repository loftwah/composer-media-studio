import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRestyleResponse } from '../public/restyle-history.js';

test('restyle admission reaches matching History once without overwriting a newer budget', () => {
  const project = {id:'project_a', generations:[{id:'old',updatedAt:1}],budget:{reservedMicro:0}};
  const response = {generation:{id:'new',status:'submitted',updatedAt:2},budget:{reservedMicro:1008000}};
  assert.equal(mergeRestyleResponse(project,'project_b',response),false);
  assert.deepEqual(project.generations.map(x=>x.id),['old']);
  assert.equal(mergeRestyleResponse(project,'project_a',response),true);
  assert.deepEqual(project.generations.map(x=>x.id),['new','old']);
  assert.equal(project.budget.reservedMicro,0);
  assert.equal(mergeRestyleResponse(project,'project_a',response),true);
  assert.equal(project.generations.length,2);
  project.generations[0]={id:'new',status:'saved',updatedAt:3};
  assert.equal(mergeRestyleResponse(project,'project_a',response),false);
  assert.equal(project.generations[0].status,'saved');
});
