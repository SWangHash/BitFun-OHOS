import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionIcon } from "../dist/index.js";


test("SessionIcon renders the Lucide conversation glyph with standalone opacity", () => {
  const markup = renderToStaticMarkup(createElement(SessionIcon));
  assert.match(markup, /viewBox="0 0 24 24"/);
  assert.match(markup, /lucide-message-circle/);
  assert.match(markup, /stroke="currentColor"/);
  assert.match(markup, /stroke-width="1.6"/);
  assert.match(markup, /opacity:var\(--openbitfun-opacity-icon-artwork\)/);
});

test("SessionIcon accepts size and standard SVG properties", () => {
  const markup = renderToStaticMarkup(createElement(SessionIcon, {
    "aria-label": "Session",
    className: "session-icon",
    "data-owner": "design-system",
    size: 18,
    width: 20,
  }));

  assert.match(markup, /width="20"/);
  assert.match(markup, /height="18"/);
  assert.match(markup, /class="[^"]*session-icon[^"]*"/);
  assert.match(markup, /aria-label="Session"/);
  assert.match(markup, /data-owner="design-system"/);
  assert.doesNotMatch(markup, /size=/);
});
