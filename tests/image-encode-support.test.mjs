// Focused check for the single tiny Canvas WebP-encode probe used by the image
// workbench. No browser: a stub canvas returns the data URI a real engine would.
import assert from "node:assert/strict";
import test from "node:test";

async function probeWith(dataUri) {
  let created = 0;
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      created += 1;
      return {
        width: 0,
        height: 0,
        getContext() {
          return { fillStyle: "", fillRect() {} };
        },
        toDataURL(type) {
          assert.equal(type, "image/webp");
          return dataUri;
        },
      };
    },
  };
  try {
    const module = await import(
      `../src/frontend/image-encode-support.ts?case=${encodeURIComponent(dataUri)}`
    );
    const first = module.canEncodeWebP();
    assert.equal(module.canEncodeWebP(), first, "the cached result is stable");
    assert.equal(created, 1, "one tiny canvas, probed once");
    return first;
  } finally {
    globalThis.document = previous;
  }
}

test("a real WebP data URI means WebP encoding is available", async () => {
  assert.equal(await probeWith("data:image/webp;base64,UklGRg=="), true);
});

test("a silent PNG fallback means WebP encoding is unavailable", async () => {
  assert.equal(await probeWith("data:image/png;base64,iVBORw0K"), false);
});

test("no document reports unavailable rather than throwing", async () => {
  const previous = globalThis.document;
  delete globalThis.document;
  try {
    const module = await import("../src/frontend/image-encode-support.ts?case=ssr");
    assert.equal(module.canEncodeWebP(), false);
  } finally {
    globalThis.document = previous;
  }
});
