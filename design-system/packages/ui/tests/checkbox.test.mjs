import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { Checkbox } from "../dist/index.js";

test("Checkbox keeps native semantics and independent content", () => {
  const markup = renderToStaticMarkup(createElement(Checkbox, {
    checked: true,
    description: "Runs at startup",
    label: "Enable hooks",
    readOnly: true,
  }));
  assert.match(markup, /type="checkbox"/);
  assert.match(markup, /checked=""/);
  assert.match(markup, /Enable hooks/);
  assert.match(markup, /Runs at startup/);
  assert.match(markup, /data-bitfun-component="checkbox"/);
});

test("Checkbox exposes canonical sizes and states", () => {
  const markup = renderToStaticMarkup(createElement(Checkbox, {
    disabled: true,
    invalid: true,
    indeterminate: true,
    size: "sm",
  }));
  assert.match(markup, /data-size="sm"/);
  assert.match(markup, /data-disabled="true"/);
  assert.match(markup, /data-invalid="true"/);
  assert.match(markup, /data-indeterminate="true"/);
});

test("Checkbox native presentation retains the input without a painted substitute", () => {
  const markup = renderToStaticMarkup(createElement(Checkbox, {
    appearance: "native", size: "sm", defaultChecked: true, disabled: true,
    name: "redact", value: "yes", required: true, label: "Redact paths",
  }));
  assert.match(markup, /data-appearance="native"/);
  assert.match(markup, /<input[^>]*type="checkbox"/);
  assert.match(markup, /name="redact"/);
  assert.match(markup, /value="yes"/);
  assert.match(markup, /checked=""/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /required=""/);
  assert.doesNotMatch(markup, /data-bitfun-part="box"/);

  const defaults = renderToStaticMarkup(createElement(Checkbox, { label: "Custom" }));
  assert.match(defaults, /data-appearance="custom"/);
  assert.match(defaults, /data-bitfun-part="box"/);
});
