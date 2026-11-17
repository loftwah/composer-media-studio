import assert from "node:assert/strict";
import test from "node:test";
import { contactSheetLayout, contactSheetPlacement } from "../src/frontend/image-contact-sheet.ts";

test("a contact sheet uses a fixed bounded grid including its partially filled last row", () => {
  assert.equal(contactSheetLayout(0), null);
  assert.equal(contactSheetLayout(1), null);
  assert.equal(contactSheetLayout(2.5), null);
  assert.equal(contactSheetLayout(21), null);
  assert.deepEqual(contactSheetLayout(3), { count: 3, columns: 3, width: 720, height: 240 });
  assert.deepEqual(contactSheetLayout(9), { count: 9, columns: 4, width: 960, height: 720 });
  assert.deepEqual(contactSheetLayout(20), { count: 20, columns: 4, width: 960, height: 1200 });
});

test("landscape and portrait outputs keep their orientation and centre in list order", () => {
  const layout = contactSheetLayout(5);
  assert.deepEqual(contactSheetPlacement(layout, 0, 640, 480), { x: 0, y: 30, width: 240, height: 180 });
  assert.deepEqual(contactSheetPlacement(layout, 1, 480, 640), { x: 270, y: 0, width: 180, height: 240 });
  assert.deepEqual(contactSheetPlacement(layout, 4, 1, 2000), { x: 119, y: 240, width: 1, height: 240 });
  assert.throws(() => contactSheetPlacement(layout, 5, 1, 2), RangeError);
  assert.throws(() => contactSheetPlacement(layout, 1, Number.NaN, 2), RangeError);
});
