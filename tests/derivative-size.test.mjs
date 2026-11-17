import assert from "node:assert/strict";
import { test } from "node:test";

import { DERIVATIVE_LONG_EDGE, derivativeSize } from "../public/derivative-size.js";

test("a preview keeps the source aspect at a 720px long edge", () => {
  assert.equal(DERIVATIVE_LONG_EDGE, 720);
  assert.deepEqual(derivativeSize(1440, 810), { width: 720, height: 405 });
  assert.deepEqual(derivativeSize(810, 1440), { width: 405, height: 720 });
  assert.deepEqual(derivativeSize(1000, 1000), { width: 720, height: 720 });
  assert.deepEqual(derivativeSize(1001, 667), { width: 720, height: 480 });
});

test("small frames are not upscaled and bad dimensions are refused", () => {
  assert.deepEqual(derivativeSize(400, 300), { width: 400, height: 300 });
  assert.deepEqual(derivativeSize(720, 480), { width: 720, height: 480 });
  for (const [width, height] of [
    [0, 0],
    [0, 720],
    [720, 0],
    [-1, 720],
    [720, -1],
    [Number.NaN, 720],
    [720, Number.POSITIVE_INFINITY],
    [undefined, 720],
    [720, null],
  ]) {
    assert.equal(derivativeSize(width, height), null, `${width}x${height}`);
  }
  assert.equal(derivativeSize(1000, 500, 0), null);
  assert.equal(derivativeSize(1000, 500, Number.NaN), null);
  assert.deepEqual(derivativeSize(1000, 500, 100), { width: 100, height: 50 });
});

test("native preview and poster sizes keep the public helper's existing contract", () => {
  assert.deepEqual(derivativeSize(1920, 1080), { width: 720, height: 405 });
  assert.deepEqual(derivativeSize(1080, 1920), { width: 405, height: 720 });
  assert.deepEqual(derivativeSize(801, 800), { width: 720, height: 719 });
  assert.deepEqual(derivativeSize(1, 1), { width: 1, height: 1 });
  assert.equal(derivativeSize(0, 10), null);
  assert.deepEqual(derivativeSize(1920, 1080, 1024), { width: 1024, height: 576 });
});
