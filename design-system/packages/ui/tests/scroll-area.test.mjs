import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScrollArea } from "../dist/index.js";

test("ScrollArea defaults to a native vertical viewport with automatic visibility", () => {
  const markup = renderToStaticMarkup(
    createElement(ScrollArea, { "aria-label": "Activity" }, "Content"),
  );

  assert.match(markup, /data-bitfun-component="scroll-area"/);
  assert.match(markup, /data-bitfun-part="viewport"/);
  assert.match(markup, /data-bitfun-orientation="vertical"/);
  assert.match(markup, /data-bitfun-scrollbar-visibility="auto"/);
  assert.match(markup, /aria-label="Activity"/);
});

test("ScrollArea exposes orientation and scrollbar visibility contracts", () => {
  const markup = renderToStaticMarkup(
    createElement(
      ScrollArea,
      { orientation: "both", scrollbarVisibility: "always" },
      "Content",
    ),
  );

  assert.match(markup, /data-bitfun-orientation="both"/);
  assert.match(markup, /data-bitfun-scrollbar-visibility="always"/);
});

test("ScrollArea preserves feature-owned appearance contracts", () => {
  const markup = renderToStaticMarkup(
    createElement(
      ScrollArea,
      { "data-bitfun-component": "model-settings", "data-bitfun-part": "root" },
      "Content",
    ),
  );

  assert.match(markup, /data-bitfun-component="model-settings"/);
  assert.match(markup, /data-bitfun-part="root"/);
});

test("ScrollArea styling uses public scrollbar tokens and preserves native scrolling", async () => {
  const styles = await readFile(
    new URL("../src/components/ScrollArea/ScrollArea.module.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /overflow-y: auto/);
  assert.match(styles, /overflow-x: auto/);
  assert.match(styles, /overflow: scroll/);
  assert.doesNotMatch(styles, /scrollbar-color:|::-webkit-scrollbar/);

  // The published stylesheet must carry the shared policy for both ordinary
  // native scroll containers and ScrollArea, including standalone consumers.
  const publishedStyles = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");
  assert.match(publishedStyles, /--bitfun-scrollbar-width/);
  assert.match(publishedStyles, /--bitfun-scrollbar-radius/);
  assert.match(publishedStyles, /--bitfun-color-scrollbar-thumb/);
  assert.match(publishedStyles, /--bitfun-color-scrollbar-thumb-hover/);
  assert.match(publishedStyles, /\[data-bitfun-scrollbar-visibility\]/);
  assert.match(publishedStyles, /scrollbar-width:\s*none/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}/i);
});
