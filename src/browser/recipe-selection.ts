// MIT. Choose settings only from actual available models. This prepares a draft;
// it never submits a job.
//
// Authored here; public/recipe-selection.js is emitted by scripts/launcher-assets.mjs.

/** The control fields recipe selection reads; other recipe fields are ignored. */
export interface RecipeControlLike {
  type: string;
  key?: string;
  default?: string | number;
}

export interface RecipeLike {
  kind: string;
  model?: string | null;
  controls: readonly RecipeControlLike[];
}

/** A model already offered to this studio, including its supported settings. */
export interface ModelSettingsLike {
  id: string;
  kind: string;
  references: number;
  aspects: readonly string[];
  durations: readonly number[] | null;
  mask: boolean;
}

/** The draft settings this helper reads before choosing a model. */
export interface RecipeSelectionDraft {
  model: string;
  aspect?: string;
  durationSeconds?: number;
}

export interface RecipeModelSelection {
  model: string;
  aspect?: string;
  durationSeconds?: number;
  referenceAssetId?: string | null;
  maskAssetId?: string | null;
}

export function recipeModelSettings(recipe: RecipeLike, models: readonly ModelSettingsLike[], current: RecipeSelectionDraft, preferredModel: string | null = null): RecipeModelSelection {
  const needsReference = recipe.controls.some(control => control.type === 'reference');
  const candidates = models.filter(model => model.kind === recipe.kind && (!needsReference || model.references > 0));
  const model = [preferredModel, recipe.model, current.model]
    .map(id => candidates.find(candidate => candidate.id === id))
    .find(Boolean) ?? candidates[0];
  if (!model) return { model: '', referenceAssetId: null, maskAssetId: null };
  const result: RecipeModelSelection = { model: model.id };
  const aspect = recipe.controls.find(control => control.key === 'aspect')?.default ?? current.aspect;
  if (model.kind === 'image') result.aspect = model.aspects.includes(aspect as string) ? aspect as string : model.aspects[0];
  const duration = Number(recipe.controls.find(control => control.key === 'duration')?.default ?? current.durationSeconds);
  if (model.kind === 'video') result.durationSeconds = model.durations!.includes(duration) ? duration : model.durations![0];
  if (!model.references) result.referenceAssetId = null;
  if (!model.mask) result.maskAssetId = null;
  return result;
}

/** The two fields compatibility needs; kept broader than a full model record. */
export interface CompatibleModelLike {
  kind: string;
  references: number;
}

export interface CompatibleRecipeLike {
  kind: string;
  controls: readonly { type: string }[];
}

export function recipeModelCompatible(recipe: CompatibleRecipeLike | null, model: CompatibleModelLike | null): boolean {
  if (!model) return false;
  if (!recipe) return true;
  return model.kind === recipe.kind && (!recipe.controls.some(control => control.type === 'reference') || model.references > 0);
}
