import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeSceneAfterAdd,
  activeSceneAfterRemove,
  clampScene,
  conflictBase,
} from '../src/frontend/promo-workbench.ts';

test('scene selection stays on a real scene after add, remove and stale indexes', () => {
  assert.equal(clampScene(-1, 2), 0);
  assert.equal(clampScene(0, 2), 0);
  assert.equal(clampScene(9, 2), 1);
  assert.equal(clampScene(9, 0), 0);

  assert.equal(activeSceneAfterAdd(0), 0);
  assert.equal(activeSceneAfterAdd(2), 2);
  assert.equal(activeSceneAfterAdd(5), 5);

  assert.equal(activeSceneAfterRemove(1, 2), 0);
  assert.equal(activeSceneAfterRemove(0, 3), 0);
  assert.equal(activeSceneAfterRemove(1, 3), 1);
  assert.equal(activeSceneAfterRemove(2, 3), 1);
  assert.equal(activeSceneAfterRemove(5, 6), 4);
});

test('a conflict resolves against the refreshed saved brief, never a deleted or different one', () => {
  const briefs = [
    { id: 'promo_a', revision: 3, title: 'Latest A' },
    { id: 'promo_b', revision: 1, title: 'B' },
  ];
  assert.deepEqual(conflictBase('promo_a', briefs), briefs[0]);
  assert.equal(conflictBase('promo_deleted', briefs), null);
  assert.equal(conflictBase(null, briefs), null);
  assert.equal(conflictBase('promo_a', []), null);
});
