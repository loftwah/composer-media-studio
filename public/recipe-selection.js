// Choose settings only from actual available models. This prepares a draft; it never submits a job.
export function recipeModelSettings(recipe, models, current, preferredModel = null) {
  const needsReference = recipe.controls.some(control => control.type === 'reference');
  const candidates = models.filter(model => model.kind === recipe.kind && (!needsReference || model.references > 0));
  const model = [preferredModel, recipe.model, current.model]
    .map(id => candidates.find(candidate => candidate.id === id))
    .find(Boolean) ?? candidates[0];
  if (!model) return { model: '', referenceAssetId: null, maskAssetId: null };
  const result = { model: model.id };
  const aspect = recipe.controls.find(control => control.key === 'aspect')?.default ?? current.aspect;
  if (model.kind === 'image') result.aspect = model.aspects.includes(aspect) ? aspect : model.aspects[0];
  const duration = Number(recipe.controls.find(control => control.key === 'duration')?.default ?? current.durationSeconds);
  if (model.kind === 'video') result.durationSeconds = model.durations.includes(duration) ? duration : model.durations[0];
  if (!model.references) result.referenceAssetId = null;
  if (!model.mask) result.maskAssetId = null;
  return result;
}

export function recipeModelCompatible(recipe, model) {
  if (!model) return false;
  if (!recipe) return true;
  return model.kind === recipe.kind && (!recipe.controls.some(control => control.type === 'reference') || model.references > 0);
}
