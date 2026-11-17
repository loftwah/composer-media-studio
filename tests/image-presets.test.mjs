import assert from "node:assert/strict";
import test from "node:test";
import { planImageTransform } from "../src/frontend/image-ops.ts";

test("maximum long edge applies to each source and to the crop", () => {
  const resize = { mode: "long-edge", longEdge: 1600, shrinkOnly: true };
  const cases = [
    [{ sourceWidth: 4000, sourceHeight: 3000 }, [1600, 1200]],
    [{ sourceWidth: 900, sourceHeight: 600 }, [900, 600]],
    [{ sourceWidth: 600, sourceHeight: 900, rotate: 1 }, [900, 600]],
    [{ sourceWidth: 4000, sourceHeight: 3000, cropRect: { x: 8, y: 8, width: 250, height: 140 } }, [250, 140]],
  ];
  for (const [input, expected] of cases) {
    const plan = planImageTransform({ ...input, resize });
    assert.equal(plan.ok, true);
    assert.deepEqual([plan.outputWidth, plan.outputHeight], expected);
    assert.equal(plan.upscaled, false);
  }
});

test("an ordinary long edge can still deliberately upscale", () => {
  const plan = planImageTransform({
    sourceWidth: 800,
    sourceHeight: 400,
    resize: { mode: "long-edge", longEdge: 1600 },
  });
  assert.equal(plan.ok, true);
  assert.deepEqual([plan.outputWidth, plan.outputHeight], [1600, 800]);
  assert.equal(plan.upscaled, true);
});
