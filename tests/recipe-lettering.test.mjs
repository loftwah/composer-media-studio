import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinRecipes, renderPrompt } from '../src/lib/recipes.mjs';
import { getModel, runImage } from '../src/lib/providers.mjs';

test('starting recipes permit lettering without removing other creative constraints', () => {
  assert.equal(builtinRecipes.length,5);
  for (const recipe of builtinRecipes) {
    const prompt=renderPrompt(recipe,{});
    assert.doesNotMatch(prompt,/\bno\s+(?:added\s+)?(?:text|lettering|words|typography)\b/i,recipe.slug);
    assert.match(prompt,/\blegib/i,recipe.slug);
  }
  assert.match(renderPrompt(builtinRecipes.find(r=>r.slug==='animate-a-still'),{}),/no morphing.*no camera shake/i);
  assert.match(renderPrompt(builtinRecipes.find(r=>r.slug==='product-plate'),{}),/no packaging logos, no hands/i);
});

test('draft model no longer silently suppresses text in its provider request', async () => {
  let payload;
  const env={ AI:{ run:async (_model,input) => { payload=input; return new Response(new Uint8Array(300)).body; } } };
  await runImage(env,getModel('studio-draft'),{prompt:'A hand-painted sign saying hello',aspect:'square'},[]);
  assert.doesNotMatch(payload.negative_prompt,/\btext\b/i);
  assert.match(payload.negative_prompt,/watermark/);
  assert.match(payload.prompt,/hand-painted sign/);
});
