// MIT. Focused regression for the bounded native-pixel sprite-atlas sibling:
// original geometry, integer centres, transparent padding and pre-allocation
// bounds. The v1 contact-sheet document is asserted unchanged separately.
import assert from "node:assert/strict";
import test from "node:test";
import {
  ATLAS_LAYOUT_SCHEMA,
  atlasBoundsProblem,
  atlasDocument,
  atlasLayout,
  atlasPlacement,
} from "../src/frontend/image-atlas.ts";
import { contactSheetDocument, contactSheetLayout } from "../src/frontend/image-contact-sheet.ts";

test("an atlas uses native-size cells and integer centres with transparent padding", () => {
  const sizes = [{ width: 3, height: 2 }, { width: 2, height: 3 }, { width: 4, height: 1 }];
  const layout = atlasLayout(sizes);
  assert.deepEqual(layout, { count: 3, columns: 3, cellWidth: 4, cellHeight: 3, width: 12, height: 3 });

  // Rectangles are the source's own pixels: no scaling, no resampling.
  assert.deepEqual(atlasPlacement(layout, 0, 3, 2), { x: 0, y: 0, width: 3, height: 2 });
  assert.deepEqual(atlasPlacement(layout, 1, 2, 3), { x: 5, y: 0, width: 2, height: 3 });
  assert.deepEqual(atlasPlacement(layout, 2, 4, 1), { x: 8, y: 1, width: 4, height: 1 });

  const twoColumns = atlasLayout(sizes, 2);
  assert.deepEqual(twoColumns, { count: 3, columns: 2, cellWidth: 4, cellHeight: 3, width: 8, height: 6 });
  assert.deepEqual(atlasPlacement(twoColumns, 2, 4, 1), { x: 0, y: 4, width: 4, height: 1 });
});

test("unsafe counts, dimensions and cells are refused", () => {
  assert.equal(atlasLayout([]), null);
  assert.equal(atlasLayout([{ width: 1, height: 1 }]), null);
  assert.equal(atlasLayout([{ width: 0, height: 1 }, { width: 1, height: 1 }]), null);
  const layout = atlasLayout([{ width: 2, height: 2 }, { width: 2, height: 2 }]);
  assert.throws(() => atlasPlacement(layout, 2, 1, 1), RangeError);
  assert.throws(() => atlasPlacement(layout, 0, 3, 1), RangeError, "a source larger than its cell is refused");
});

test("over-bound atlases are refused before any canvas is allocated", () => {
  const wide = atlasLayout([{ width: 8192, height: 8 }, { width: 8192, height: 8 }], 2);
  assert.match(atlasBoundsProblem(wide), /8192 px on each side/);

  const manyPixels = atlasLayout([{ width: 8192, height: 4096 }, { width: 8192, height: 4096 }], 1);
  assert.equal(manyPixels.width, 8192);
  assert.equal(manyPixels.height, 8192);
  assert.match(atlasBoundsProblem(manyPixels), /40 megapixels/);

  const small = atlasLayout([{ width: 3, height: 2 }, { width: 2, height: 3 }], 2);
  assert.equal(atlasBoundsProblem(small), null);
});

test("the atlas document is a sibling schema and does not repurpose a v1 field", () => {
  const layout = atlasLayout([{ width: 3, height: 2 }, { width: 2, height: 3 }], 2);
  const document = atlasDocument(layout, { sha256: "abc", bytes: 10 }, []);
  assert.equal(document.schema, ATLAS_LAYOUT_SCHEMA);
  assert.notEqual(document.schema, "media-studio/contact-sheet-layout");
  assert.equal(document.layout.kind, "sprite-atlas");
  assert.equal(document.layout.resample, "none");
  assert.equal(document.layout.background, "transparent");
  assert.equal(document.layout.cellWidth, 3);
  assert.equal(document.layout.cellHeight, 3);
  assert.equal(document.layout.tileSize, undefined, "the v1 tileSize field is not reused for a cell");
  assert.deepEqual(document.sheet, { width: 6, height: 3, sha256: "abc", bytes: 10 });

  const v1 = contactSheetDocument(contactSheetLayout(2), { sha256: "abc", bytes: 10 }, []);
  assert.equal(v1.schema, "media-studio/contact-sheet-layout");
  assert.equal(v1.version, 1);
  assert.equal(v1.layout.kind, "fixed-contact-sheet");
  assert.equal(v1.layout.tileSize, 240);
});
