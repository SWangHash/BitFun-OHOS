import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Field, Input } from "../dist/index.js";

test("Field associates label, description, and required state with its control", () => {
  const markup = renderToStaticMarkup(
    createElement(Field, {
      description: "Used in generated output",
      label: "Project name",
      required: true,
    }, createElement(Input, {
      "aria-describedby": "project-help",
      id: "project-name",
    })),
  );

  assert.match(markup, /data-bitfun-component="field"/);
  assert.match(markup, /data-orientation="vertical"/);
  assert.match(markup, /data-required="true"/);
  assert.match(markup, /<label[^>]+for="project-name"/);
  assert.match(markup, /data-bitfun-part="required"[^>]*>\*<\/span>/);
  assert.match(markup, /id="project-name-description"/);
  assert.match(markup, /aria-describedby="project-help project-name-description"/);
  assert.match(markup, /id="project-name"/);
  assert.match(markup, /required=""/);
});

test("Field renders a validation message wired to the control accessibility contract", () => {
  const markup = renderToStaticMarkup(
    createElement(Field, {
      error: "Name is already taken",
      label: "Project name",
    }, createElement(Input, {
      id: "project-name",
    })),
  );

  assert.match(markup, /data-invalid="true"/);
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /data-bitfun-part="error"[^>]*id="project-name-error"/);
  assert.match(markup, /aria-describedby="project-name-error"/);
  assert.match(markup, /Name is already taken/);
});

test("Field exposes horizontal layout independently from its control", () => {
  const markup = renderToStaticMarkup(
    createElement(Field, {
      label: "Notifications",
      orientation: "horizontal",
    }, createElement("input", { type: "checkbox" })),
  );

  assert.match(markup, /data-orientation="horizontal"/);
  assert.match(markup, /data-bitfun-part="content"/);
  assert.match(markup, /data-bitfun-part="control"/);
  assert.match(markup, /type="checkbox"/);
});

test("Field exposes reusable horizontal label and fill-control geometry", () => {
  const markup = renderToStaticMarkup(
    createElement(Field, {
      controlWidth: "fill",
      horizontalGap: "lg",
      label: "Provider name",
      labelWidth: "md",
      orientation: "horizontal",
    }, createElement(Input)),
  );

  assert.match(markup, /data-control-width="fill"/);
  assert.match(markup, /data-horizontal-gap="lg"/);
  assert.match(markup, /data-label-width="md"/);
});

test("Field keeps label and control adornments outside the associated control", () => {
  const markup = renderToStaticMarkup(
    createElement(Field, {
      controlLeading: createElement("button", { type: "button" }, "Toggle"),
      controlTrailing: createElement("button", { type: "button" }, "More"),
      label: "Appearance",
      labelAction: createElement("button", { type: "button" }, "Help"),
    }, createElement(Input, { id: "appearance" })),
  );

  assert.match(markup, /data-bitfun-part="label-row"/);
  assert.match(markup, /data-bitfun-part="label-action"[^>]*><button[^>]*>Help/);
  assert.match(markup, /data-bitfun-part="control-leading"[^>]*><button[^>]*>Toggle/);
  assert.match(markup, /data-bitfun-part="control-trailing"[^>]*><button[^>]*>More/);
  assert.match(markup, /<label[^>]+for="appearance"/);
  const labelMarkup = /<label[^>]*>.*?<\/label>/s.exec(markup)?.[0] ?? "";
  assert.doesNotMatch(labelMarkup, /<button/);
});

test("Field styles consume shared content and typography tokens", async () => {
  const styles = await readFile(new URL("../src/components/Field/Field.module.css", import.meta.url), "utf8");

  assert.match(styles, /--bitfun-color-content-primary/);
  assert.match(styles, /--bitfun-color-content-secondary/);
  assert.match(styles, /--bitfun-color-content-required-indicator/);
  assert.doesNotMatch(styles, /--bitfun-color-status-danger-content[^\n]*required/);
  assert.match(styles, /--bitfun-type-label-selected-font-size/);
  assert.match(styles, /--bitfun-type-support-font-size/);
  assert.match(styles, /--bitfun-layout-field-root-gap/);
  assert.match(styles, /--bitfun-layout-field-label-action-gap/);
  assert.match(styles, /--bitfun-layout-field-control-gap/);
  assert.match(styles, /--bitfun-layout-field-horizontal-gap-wide/);
  assert.match(styles, /--bitfun-layout-field-label-width-md/);
});
