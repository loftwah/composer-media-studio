import type { CreateProps, RecipeV1, CreateStateV1 } from "./contracts";
import { recipeModelCompatible } from "../../public/recipe-selection.js";
import "./create.css";

const money = (micro: number) => {
  const amount = Number(micro ?? 0) / 1_000_000;
  return amount === 0
    ? "$0.00"
    : amount < 0.01
      ? `$${amount.toFixed(3)}`
      : `$${amount.toFixed(2)}`;
};
function Controls({
  recipe,
  create,
}: {
  recipe: RecipeV1;
  create: CreateStateV1;
}) {
  return (
    <>
      {recipe.controls
        .filter(
          (control) =>
            control.type !== "reference" &&
            control.application !== "provider-native" &&
            control.type !== "hidden",
        )
        .map((control) => {
          const value = create.controls[control.key] ?? control.default ?? "";
          return (
            <label key={control.key}>
              {control.label}
              {control.type === "select" ? (
                <select
                  data-input="control"
                  data-key={control.key}
                  defaultValue={String(value)}
                >
                  {(control.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  data-input="control"
                  data-key={control.key}
                  defaultValue={String(value)}
                  maxLength={200}
                />
              )}
            </label>
          );
        })}
    </>
  );
}
export function CreateWorkbench({
  create,
  models,
  recipes,
  images,
  selectedReference,
  maskAsset,
  model,
  recipe,
  estimateMicro,
  fundingBlocked,
  permissionBlocked,
  executionFailed,
}: CreateProps) {
  const needsReference = (model?.references ?? 0) > 0,
    needsMask = Boolean(model?.mask),
    promptRequired = model?.promptRequired !== false;
  const promptLabel =
    model?.kind === "audio"
      ? model.audio?.mode === "speech"
        ? "Narration script"
        : model.audio?.mode === "effect"
          ? "Describe the effect"
          : "Describe the sound"
      : model?.edit
        ? promptRequired
          ? "What belongs in the masked area?"
          : "Optional guidance"
        : "Prompt";
  const action =
    create.kind === "video"
      ? "Animate this still"
      : create.kind === "audio"
        ? "Generate sound"
        : model?.edit === "fill"
          ? "Apply fill"
          : model?.edit === "cutout"
            ? "Remove background"
            : model?.edit === "upscale"
              ? "Upscale still"
              : "Create image";
  return (
    <div className="create-workbench">
      {fundingBlocked && (
        <p className="notice warn">
          The studio's video provider refused the last request for funding.
          Image work and the library still work; add credit to the studio's own
          provider account before starting another clip.
        </p>
      )}
      {permissionBlocked && (
        <p className="notice warn">
          The provider refused this account access to a request or result.
          Nothing was regenerated. Fix the studio's provider key or endpoint
          permission, then use Reconcile on the job; the saved request id is
          kept.
        </p>
      )}
      {executionFailed && (
        <p className="notice warn">
          The last render failed. The provider's message is saved with the job.
          A new render is a separate request and will not be sent automatically.
        </p>
      )}
      <div className="grid two">
        <section className="card">
          <h2 className="create-section-title">Choose a starting point</h2>
          <div
            className="row create-kinds"
            role="group"
            aria-label="Media kind"
          >
            <button
              type="button"
              className="secondary"
              data-action="kind"
              data-kind="image"
              aria-pressed={create.kind === "image"}
            >
              Create image
            </button>
            <button
              type="button"
              className="secondary"
              data-action="kind"
              data-kind="video"
              aria-pressed={create.kind === "video"}
            >
              Animate a still
            </button>
            <button
              type="button"
              className="secondary"
              data-action="kind"
              data-kind="audio"
              aria-pressed={create.kind === "audio"}
            >
              Make sound
            </button>
          </div>
          <div className="recipe-grid">
            {recipes.map((item) => (
              <button
                type="button"
                className="recipe"
                key={item.slug}
                data-action="recipe"
                data-slug={item.slug}
                aria-pressed={create.recipeSlug === item.slug}
              >
                <strong>{item.title}</strong>
                <span>{item.description}</span>
                <span className="small">
                  {item.kind === "video" ? "Image → video" : "Still image"}
                </span>
              </button>
            ))}
          </div>
          <div
            className="row create-edits"
            role="group"
            aria-label="Still edits"
          >
            <button
              type="button"
              className="secondary"
              data-action="edit-model"
              data-model="studio-fill"
              aria-pressed={create.model === "studio-fill"}
            >
              Masked fill
            </button>
            <button
              type="button"
              className="secondary"
              data-action="edit-model"
              data-model="studio-cutout"
              aria-pressed={create.model === "studio-cutout"}
            >
              Remove background
            </button>
            <button
              type="button"
              className="secondary"
              data-action="edit-model"
              data-model="studio-upscale"
              aria-pressed={create.model === "studio-upscale"}
            >
              Upscale ×2
            </button>
          </div>
          <div className="stack create-model">
            <label>
              Model
              <select data-input="model" defaultValue={create.model}>
                {!model && <option value="" disabled>No compatible model</option>}
                {models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} — {item.provider}
                  </option>
                ))}
              </select>
            </label>
            <p className="small">
              {model?.description ?? ""}
              <br />
              {model?.costBasis ?? ""}
            </p>
          </div>
        </section>
        <section className="card">
          <h2 className="create-section-title">Direct the work</h2>
          {recipe && <Controls recipe={recipe} create={create} />}
          <label className="create-prompt">
            {promptLabel}
            <textarea
              data-input="prompt"
              maxLength={1800}
              rows={6}
              placeholder={promptRequired ? undefined : "Optional"}
              defaultValue={create.prompt}
            />
          </label>
          {model?.kind === "audio" && (
            <p className="small create-help">
              {model.audio?.mode === "speech"
                ? "Use words you wrote or have the rights to. Narration is generated once and saved as audio you can publish or assemble."
                : model.audio?.mode === "effect"
                  ? "One short cue, saved separately so it can sit beside music and narration in the mix."
                  : "Instrumental music or atmosphere. The clip is saved as an audio asset with its duration and provenance."}
            </p>
          )}
          {model?.kind === "image" && !model.edit && (
            <label className="create-field">
              Frame
              <select data-input="aspect" defaultValue={create.aspect}>
                {model.aspects.map((aspect) => (
                  <option key={aspect} value={aspect}>
                    {aspect === "square" && model.references > 0
                      ? "Square variation"
                      : aspect}
                  </option>
                ))}
              </select>
            </label>
          )}
          {model?.edit && (
            <p className="small create-help">
              <strong>
                {model.edit === "fill"
                  ? "Masked fill or outpaint"
                  : model.edit === "cutout"
                    ? "Background removal"
                    : "Two-times upscale"}
              </strong>{" "}
              · the result is saved as a separate variant; the source stays
              untouched.
            </p>
          )}
          {model?.kind === "video" && (
            <label className="create-field">
              Clip length
              <select
                data-input="duration"
                defaultValue={String(create.durationSeconds)}
              >
                {(model.durations ?? []).map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} seconds
                  </option>
                ))}
              </select>
            </label>
          )}
          {model?.kind === "audio" &&
            (model.audio?.mode === "music" ||
              model.audio?.mode === "effect") && (
              <label className="create-field">
                Length
                <select
                  data-input="audioDuration"
                  defaultValue={String(create.durationSeconds)}
                >
                  {[10, 15, 20, 25, 30]
                    .filter(
                      (seconds) =>
                        seconds >= (model.audio?.minSeconds ?? 1) &&
                        seconds <= (model.audio?.maxSeconds ?? 30),
                    )
                    .map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds} seconds
                      </option>
                    ))}
                </select>
              </label>
            )}
          {needsReference && (
            <div className="create-reference">
              <p className="small">
                <strong>Reference still</strong>{" "}
                {selectedReference
                  ? `· ${selectedReference.title}`
                  : "· none selected"}
              </p>
              <div className="row">
                {images
                  .slice(0, create.showAllReferences ? images.length : 8)
                  .map((asset) => (
                    <button
                      type="button"
                      key={asset.id}
                      className="quiet create-reference-button"
                      data-action="pick-reference"
                      data-id={asset.id}
                      aria-pressed={create.referenceAssetId === asset.id}
                      title={asset.title}
                    >
                      <img src={asset.file} alt={asset.title} />
                    </button>
                  ))}
                {images.length === 0 && (
                  <span className="small">Upload a still first.</span>
                )}
              </div>
              {images.length > 8 && (
                <button
                  type="button"
                  className="quiet"
                  data-action="toggle-references"
                  aria-expanded={Boolean(create.showAllReferences)}
                >
                  {create.showAllReferences
                    ? "Show fewer stills"
                    : `Show all ${images.length} stills`}
                </button>
              )}
            </div>
          )}
          {needsMask && selectedReference && (
            <div className="mask-editor create-mask">
              <div className="spread">
                <p className="small">
                  <strong>Mask</strong>{" "}
                  {maskAsset
                    ? `· ${maskAsset.title}`
                    : "· paint the area to change"}
                </p>
                <span className="small">White = replace</span>
              </div>
              <canvas
                id="mask-canvas"
                width="640"
                height="440"
                aria-label="Paint the area to change"
              />
              <div className="row">
                <label className="small create-brush">
                  Brush{" "}
                  <input
                    id="mask-brush"
                    type="range"
                    min="8"
                    max="140"
                    defaultValue="48"
                  />
                </label>
                <button
                  className="quiet"
                  type="button"
                  data-action="mask-clear"
                >
                  Clear
                </button>
                <button
                  className="secondary"
                  type="button"
                  data-action="mask-save"
                  data-id={selectedReference.id}
                >
                  {maskAsset ? "Save new mask" : "Save mask"}
                </button>
              </div>
              <div className="row">
                <button
                  className="quiet"
                  type="button"
                  data-action="outpaint"
                  data-id={selectedReference.id}
                >
                  Extend the frame instead
                </button>
                {maskAsset && (
                  <span className="small">
                    Mask saved · {maskAsset.width} × {maskAsset.height}
                  </span>
                )}
              </div>
              <p className="small">
                The studio scales the source and mask together before upload, so
                their dimensions always match. The original still remains in the
                library.
              </p>
            </div>
          )}
        </section>
      </div>
      <div className="card create-review">
        {recipe && !recipeModelCompatible(recipe, model) && <p className="notice warn">This recipe needs a model that accepts a reference still. Choose a compatible model or another recipe.</p>}
        <div className="spread">
          <div>
            <h2 className="create-section-title">Review and submit</h2>
            <p className="small">
              {model?.label ?? "No model"} ·{" "}
              {create.kind === "video"
                ? `${create.durationSeconds}s`
                : create.kind === "audio"
                  ? model?.audio?.mode === "speech"
                    ? "narration"
                    : `${create.durationSeconds}s`
                  : create.aspect}{" "}
              · estimated <strong>{money(estimateMicro)}</strong>
            </p>
          </div>
          <button
            type="button"
            className="button"
            data-action="submit-create"
            disabled={
              !recipeModelCompatible(recipe, model) ||
              (needsReference && !create.referenceAssetId) ||
              (needsMask && !create.maskAssetId) ||
              (promptRequired && !create.prompt.trim())
            }
          >
            {action} · {money(estimateMicro)}
          </button>
        </div>
        <p className="small">
          Each submit starts one new request. A repeat with the same request id
          is replayed without another submission. Video runs asynchronously; you can
          leave this page and come back.
        </p>
      </div>
    </div>
  );
}
