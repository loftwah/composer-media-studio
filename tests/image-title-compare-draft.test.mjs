import test from "node:test";
import assert from "node:assert/strict";
import { readTitleDraft, saveTitleDraft } from "../src/frontend/image-title-compare-draft.ts";

const empty = () => ({ title: "", alt: "", note: "", hypothesis: "", anchor: "centre", file: null });

function sample() {
  return {
    selectedId: "c",
    preferredId: "a",
    pairs: [
      {
        title: "Une île",
        alt: "Red shape",
        note: "Retain this crop",
        hypothesis: "Reads at 168px",
        anchor: "topLeft",
        file: new File([new Uint8Array([0, 1, 252, 255])], "my:test-image.png", { type: "image/png" }),
      },
      empty(),
      { ...empty(), title: "Partial pair" },
    ],
  };
}

test("an editable draft keeps exact thumbnail bytes and all pair metadata", async () => {
  const draft = sample();
  const result = await readTitleDraft(saveTitleDraft(draft));
  const { file, ...metadata } = result.pairs[0];
  const { file: source, ...expected } = draft.pairs[0];
  assert.deepEqual(metadata, expected);
  assert.deepEqual(await file.bytes(), await source.bytes());
  assert.equal(file.name, "my_test-image.png");
  assert.equal(file.type, "image/png");
  assert.equal(result.selectedId, "c");
  assert.equal(result.preferredId, "a");
  assert.deepEqual(result.pairs.slice(1), draft.pairs.slice(1));
});

test("an editable draft rejects invalid layout, preferences and file boundaries", async () => {
  const draft = sample();
  const saved = saveTitleDraft(draft);
  const invalidDrafts = [
    saveTitleDraft({ ...draft, preferredId: "c" }),
    saveTitleDraft({ ...draft, selectedId: "__proto__" }),
    saveTitleDraft({ ...draft, pairs: [empty(), empty()] }),
    saveTitleDraft({ ...draft, pairs: [{ ...empty(), anchor: "__proto__" }, empty(), empty()] }),
    saveTitleDraft({ ...draft, pairs: [{ ...empty(), title: "x".repeat(201) }, empty(), empty()] }),
    saved.slice(0, saved.size - 1),
    new Blob([saved, "trailing"]),
    new Blob([new Uint8Array([255, 255, 255, 255]), "{}"]),
  ];
  for (const file of invalidDrafts) assert.equal(await readTitleDraft(file), null);
});
