// MIT. A checkbox must stay a checkbox: the shared text-field styling is
// deliberately scoped away from checkboxes and radios so tool controls that
// sit in a flex row (mute, blind review, import options) keep their native size.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../public/studio.css", import.meta.url), "utf8");

test("the shared field styling leaves checkboxes and radios at their native size", () => {
  const fieldRule = css.match(/\ninput, textarea, select \{[^}]*\}/);
  assert.ok(fieldRule, "the shared field rule is present");
  assert.match(fieldRule[0], /width: 100%/);

  const override = css.match(/input\[type="checkbox"\], input\[type="radio"\] \{[^}]*\}/);
  assert.ok(override, "checkboxes and radios have their own rule");
  assert.match(override[0], /width: auto/);
  assert.match(override[0], /flex: none/);
  assert.match(override[0], /padding: 0/);

  // The override must come after the shared rule, or it would be overridden.
  assert.ok(
    css.indexOf(override[0]) > css.indexOf(fieldRule[0]),
    "the checkbox rule follows the shared field rule",
  );
});
