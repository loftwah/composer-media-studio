import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTACT_SHEET_TILE_SIZES,
  contactSheetDocument,
  contactSheetLayout,
  contactSheetPlacement,
} from "../src/frontend/image-contact-sheet.ts";

test("a contact sheet uses a fixed bounded grid including its partially filled last row", () => {
  assert.equal(contactSheetLayout(0), null);
  assert.equal(contactSheetLayout(1), null);
  assert.equal(contactSheetLayout(2.5), null);
  assert.equal(contactSheetLayout(21), null);
  assert.deepEqual(contactSheetLayout(3), { count: 3, columns: 3, tileSize: 240, width: 720, height: 240 });
  assert.deepEqual(contactSheetLayout(9), { count: 9, columns: 4, tileSize: 240, width: 960, height: 720 });
  assert.deepEqual(contactSheetLayout(20), { count: 20, columns: 4, tileSize: 240, width: 960, height: 1200 });
});

test("an explicit column count changes geometry while Auto keeps the incumbent grid", () => {
  const auto = contactSheetLayout(3);
  assert.deepEqual(auto, { count: 3, columns: 3, tileSize: 240, width: 720, height: 240 });
  assert.deepEqual(contactSheetLayout(3, 1), { count: 3, columns: 1, tileSize: 240, width: 240, height: 720 });
  assert.deepEqual(contactSheetLayout(3, 2), { count: 3, columns: 2, tileSize: 240, width: 480, height: 480 });
  assert.deepEqual(contactSheetLayout(3, 4), { count: 3, columns: 4, tileSize: 240, width: 960, height: 240 });
  assert.deepEqual(contactSheetLayout(3, 9), auto, "an out-of-range choice falls back to Auto");
  assert.equal(contactSheetLayout(21, 2), null, "the 2-20 input bound still holds");
  assert.deepEqual(contactSheetPlacement(contactSheetLayout(3, 1), 2, 480, 240), { x: 0, y: 540, width: 240, height: 120 });
  const document = contactSheetDocument(contactSheetLayout(3, 2), { sha256: "abc", bytes: 10 }, []);
  assert.equal(document.version, 1);
  assert.equal(document.layout.columns, 2, "the layout document records the actual columns");
  assert.equal(document.layout.tileSize, 240, "the default document still records the Standard tile");
  assert.equal(
    JSON.stringify(document),
    '{"schema":"media-studio/contact-sheet-layout","version":1,"layout":{"kind":"fixed-contact-sheet","tileSize":240,"columns":2,"count":3,"background":"transparent"},"sheet":{"width":480,"height":480,"sha256":"abc","bytes":10},"tiles":[]}',
    "the default v1 layout JSON stays byte-identical",
  );
});

test("compact and large tiles scale the grid, placement and document together", () => {
  assert.deepEqual(CONTACT_SHEET_TILE_SIZES, [120, 240, 360]);
  assert.deepEqual(contactSheetLayout(3, 2, 120), { count: 3, columns: 2, tileSize: 120, width: 240, height: 240 });
  assert.deepEqual(contactSheetLayout(3, 2, 360), { count: 3, columns: 2, tileSize: 360, width: 720, height: 720 });
  assert.deepEqual(contactSheetLayout(20, 1, 120), { count: 20, columns: 1, tileSize: 120, width: 120, height: 2400 });
  assert.deepEqual(contactSheetLayout(20, 4, 360), { count: 20, columns: 4, tileSize: 360, width: 1440, height: 1800 });

  assert.deepEqual(contactSheetPlacement(contactSheetLayout(3, 2, 120), 2, 640, 480), { x: 0, y: 135, width: 120, height: 90 });
  assert.deepEqual(contactSheetPlacement(contactSheetLayout(3, 2, 360), 2, 640, 480), { x: 0, y: 405, width: 360, height: 270 });

  const document = contactSheetDocument(contactSheetLayout(2, 1, 120), { sha256: "abc", bytes: 10 }, []);
  assert.equal(document.layout.tileSize, 120);
  assert.deepEqual(document.sheet, { width: 120, height: 240, sha256: "abc", bytes: 10 });
});

test("an unsupported tile size falls back to the Standard 240 grid", () => {
  assert.deepEqual(contactSheetLayout(3, 2, 200), contactSheetLayout(3, 2, 240));
  assert.deepEqual(contactSheetLayout(3, 2, 0), contactSheetLayout(3, 2));
});

test("landscape and portrait outputs keep their orientation and centre in list order", () => {
  const layout = contactSheetLayout(5);
  assert.deepEqual(contactSheetPlacement(layout, 0, 640, 480), { x: 0, y: 30, width: 240, height: 180 });
  assert.deepEqual(contactSheetPlacement(layout, 1, 480, 640), { x: 270, y: 0, width: 180, height: 240 });
  assert.deepEqual(contactSheetPlacement(layout, 4, 1, 2000), { x: 119, y: 240, width: 1, height: 240 });
  assert.throws(() => contactSheetPlacement(layout, 5, 1, 2), RangeError);
  assert.throws(() => contactSheetPlacement(layout, 1, Number.NaN, 2), RangeError);
});
