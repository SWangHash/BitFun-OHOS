import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { IconButton } from "../dist/index.js";

test("IconButton requires an accessible label and keeps its icon decorative", () => {
  const markup = renderToStaticMarkup(
    createElement(IconButton, {
      "aria-label": "Show list",
      icon: createElement("svg", { "data-icon": "list" }),
    }),
  );

  assert.match(markup, /data-bitfun-component="icon-button"/);
  assert.match(markup, /data-bitfun-part="progress"/);
  assert.match(markup, /data-bitfun-part="icon"/);
  assert.match(markup, /aria-label="Show list"/);
  assert.match(markup, /aria-hidden="true"/);
  assert.match(markup, /data-icon="list"/);
  assert.match(markup, /data-bitfun-variant="quiet"/);
  assert.match(markup, /data-bitfun-shape="square"/);
  assert.match(markup, /type="button"/);
});

test("IconButton exposes presentation, shape, tone, and size independently", () => {
  const markup = renderToStaticMarkup(
    createElement(IconButton, {
      "aria-label": "Delete",
      icon: createElement("svg"),
      shape: "circle",
      size: "lg",
      tone: "danger",
      variant: "primary",
    }),
  );

  assert.match(markup, /data-bitfun-variant="primary"/);
  assert.match(markup, /data-bitfun-shape="circle"/);
  assert.match(markup, /data-bitfun-tone="danger"/);
  assert.match(markup, /data-size="lg"/);
});

test("IconButton exposes an extra-compact size for dense row actions", () => {
  const markup = renderToStaticMarkup(
    createElement(IconButton, {
      "aria-label": "Copy",
      icon: createElement("svg"),
      size: "xs",
    }),
  );

  assert.match(markup, /data-size="xs"/);
});

test("loading preserves the label while disabling activation", () => {
  const markup = renderToStaticMarkup(
    createElement(IconButton, {
      "aria-label": "Refresh",
      icon: createElement("svg"),
      loading: true,
    }),
  );

  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /data-loading="true"/);
});

test("outlined circles compose the standard size with disabled and loading states", () => {
  for (const state of [{}, { disabled: true }, { loading: true }]) {
    const markup = renderToStaticMarkup(createElement(IconButton, {
      "aria-label": "Add", icon: createElement("svg"),
      size: "standard", shape: "circle", variant: "outline", ...state,
    }));
    assert.match(markup, /data-size="standard"/);
    assert.match(markup, /data-bitfun-shape="circle"/);
    assert.match(markup, /data-bitfun-variant="outline"/);
    if (state.disabled || state.loading) assert.match(markup, /disabled=""/);
  }
});

test("IconButton styles consume shared action and geometry tokens", async () => {
  const styles = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");

  assert.match(styles, /\[data-bitfun-variant=primary\]/);
  assert.match(styles, /--bitfun-color-action-neutral-surface-hover/);
  assert.match(styles, /--bitfun-color-action-primary-background/);
  assert.match(styles, /--bitfun-control-height-sm/);
  assert.match(styles, /--bitfun-control-icon-button-xs-size/);
  assert.match(styles, /--bitfun-radius-sm/);
  assert.match(styles, /--bitfun-radius-pill/);
});

test("quiet IconButtons are transparent at rest while emphasized variants retain an opaque surface", async () => {
  const styles = await readFile(
    new URL("../src/components/IconButton/IconButton.module.css", import.meta.url),
    "utf8",
  );

  assert.match(
    styles,
    /\.button\s*\{[^}]*--_icon-button-background:\s*transparent;[^}]*\n\s*background:\s*transparent;/s,
  );
  assert.match(
    styles,
    /\.button::before\s*\{[^}]*background:\s*var\(--_icon-button-background\)/s,
  );
  assert.match(
    styles,
    /\.button\[data-bitfun-variant="fill"\],\s*\.button\[data-bitfun-variant="primary"\]\s*\{[^}]*background:\s*var\(--bitfun-color-surface-tertiary\)/s,
  );
  assert.doesNotMatch(styles, /--_icon-button-background-(?:hover|active):\s*transparent/);
  for (const state of ["hover", "active"]) {
    assert.ok(styles.includes(`:is(:${state}, [data-bitfun-preview-state="${state}"]):not(:disabled)::before`));
  }
  assert.match(styles, /\.button:focus-visible\s*\{[^}]*outline:.*var\(--bitfun-color-focus-ring\)/s);
});
