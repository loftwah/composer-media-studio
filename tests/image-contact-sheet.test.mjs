import assert from "node:assert/strict";
import test from "node:test";
import { contactSheetDocument, contactSheetLayout, contactSheetPlacement } from "../src/frontend/image-contact-sheet.ts";

test("a contact sheet uses a fixed bounded grid including its partially filled last row", () => {
  assert.equal(contactSheetLayout(0), null);
  assert.equal(contactSheetLayout(1), null);
  assert.equal(contactSheetLayout(2.5), null);
  assert.equal(contactSheetLayout(21), null);
  assert.deepEqual(contactSheetLayout(3), { count: 3, columns: 3, width: 720, height: 240 });
  assert.deepEqual(contactSheetLayout(9), { count: 9, columns: 4, width: 960, height: 720 });
  assert.deepEqual(contactSheetLayout(20), { count: 20, columns: 4, width: 960, height: 1200 });
});

test("an explicit column count changes geometry while Auto keeps the incumbent grid", () => {
  const auto = contactSheetLayout(3);
  assert.deepEqual(auto, { count: 3, columns: 3, width: 720, height: 240 });
  assert.deepEqual(contactSheetLayout(3, 1), { count: 3, columns: 1, width: 240, height: 720 });
  assert.deepEqual(contactSheetLayout(3, 2), { count: 3, columns: 2, width: 480, height: 480 });
  assert.deepEqual(contactSheetLayout(3, 4), { count: 3, columns: 4, width: 960, height: 240 });
  assert.deepEqual(contactSheetLayout(3, 9), auto, "an out-of-range choice falls back to Auto");
  assert.equal(contactSheetLayout(21, 2), null, "the 2-20 input bound still holds");
  assert.deepEqual(contactSheetPlacement(contactSheetLayout(3, 1), 2, 480, 240), { x: 0, y: 540, width: 240, height: 120 });
  const document = contactSheetDocument(contactSheetLayout(3, 2), { sha256: "abc", bytes: 10 }, []);
  assert.equal(document.version, 1);
  assert.equal(document.layout.columns, 2, "the layout document records the actual columns");
});

test("landscape and portrait outputs keep their orientation and centre in list order", () => {
  const layout = contactSheetLayout(5);
  assert.deepEqual(contactSheetPlacement(layout, 0, 640, 480), { x: 0, y: 30, width: 240, height: 180 });
  assert.deepEqual(contactSheetPlacement(layout, 1, 480, 640), { x: 270, y: 0, width: 180, height: 240 });
  assert.deepEqual(contactSheetPlacement(layout, 4, 1, 2000), { x: 119, y: 240, width: 1, height: 240 });
  assert.throws(() => contactSheetPlacement(layout, 5, 1, 2), RangeError);
  assert.throws(() => contactSheetPlacement(layout, 1, Number.NaN, 2), RangeError);
});
