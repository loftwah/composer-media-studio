import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinRecipes, projectRecipes } from '../src/lib/recipes.mjs';
import { publicModels } from '../src/lib/providers.mjs';
import { recipeModelSettings } from '../public/recipe-selection.js';

test('project recipes retain the model that makes their workflow possible', () => {
  const recipes = projectRecipes('project', []);
  for (const builtin of builtinRecipes) assert.equal(recipes.find(r => r.slug === builtin.slug).model, builtin.model);
  const reference = recipes.find(r => r.slug === 'reference-variation');
  const next = recipeModelSettings(reference, publicModels(), { model:'studio-print', aspect:'portrait' });
  assert.equal(next.model, 'studio-detail');
  assert.equal(next.aspect, 'square');
});

test('video recipe respects compatible project preference and adjusts unsupported duration', () => {
  const video = projectRecipes('project', []).find(r => r.slug === 'animate-a-still');
  const next = recipeModelSettings(video, publicModels(), { model:'studio-print', durationSeconds:6 }, 'h3-max-turbo');
  assert.equal(next.model, 'h3-max-turbo');
  assert.equal(next.durationSeconds, 5);
  const missing = recipeModelSettings(video, publicModels().filter(m => m.kind !== 'video'), { model:'studio-print' });
  assert.equal(missing.model, '');
});

test('incompatible and unavailable models cannot execute a reference recipe', async () => {
  const { recipeModelCompatible } = await import('../public/recipe-selection.js');
  const reference = projectRecipes('project', []).find(r => r.slug === 'reference-variation');
  const models = publicModels();
  assert.equal(recipeModelCompatible(reference, models.find(m => m.id === 'studio-print')), false);
  assert.equal(recipeModelCompatible(reference, models.find(m => m.id === 'studio-detail')), true);
  assert.equal(recipeModelCompatible(reference, null), false);
});
