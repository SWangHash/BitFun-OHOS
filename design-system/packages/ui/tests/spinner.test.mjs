import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingState, Spinner } from "../dist/index.js";

test("Spinner exposes logo and bar presentations with the legacy matrix alias", () => {
  const matrix = renderToStaticMarkup(createElement(Spinner, { size: "sm", variant: "matrix" }));
  const bars = renderToStaticMarkup(createElement(Spinner, {
    "aria-label": "Loading",
    variant: "bars",
  }));

  assert.match(renderToStaticMarkup(createElement(Spinner, { active: false })), /data-active="false"/);
  assert.match(matrix, /data-bitfun-component="spinner"/);
  assert.match(matrix, /data-variant="logo"/);
  assert.equal((matrix.match(/aria-hidden="true"/g) ?? []).length, 2);
  assert.match(bars, /role="status"/);
  assert.match(bars, /aria-label="Loading"/);
  assert.equal((bars.match(/class=/g) ?? []).length, 4);
});

test("LoadingState composes Spinner with optional support copy", () => {
  const markup = renderToStaticMarkup(createElement(LoadingState, null, "Loading project"));
  assert.match(markup, /data-bitfun-component="loading-state"/);
  assert.match(markup, /data-bitfun-component="spinner"/);
  assert.match(markup, /data-bitfun-part="label">Loading project/);
});

test("Spinner styling uses public system, motion, and semantic tokens", async () => {
  const styles = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");
  assert.match(styles, /mask-image:/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /--bitfun-motion-duration-loop/);
  assert.match(styles, /--bitfun-color-content-muted/);
});
