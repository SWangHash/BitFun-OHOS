import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { Alert } from "../dist/index.js";

test("Alert exposes semantic tone and public anatomy", () => {
  const markup = renderToStaticMarkup(createElement(Alert, {
    description: "Reconnect to continue.",
    message: "The remote host is offline.",
    showIcon: false,
    title: "Connection unavailable",
    tone: "warning",
  }));

  assert.match(markup, /data-openbitfun-component="alert"/);
  assert.match(markup, /data-openbitfun-tone="warning"/);
  assert.match(markup, /data-openbitfun-part="title"/);
  assert.match(markup, /data-openbitfun-part="message"/);
  assert.match(markup, /data-openbitfun-part="description"/);
});

test("Alert preserves explicit announcement roles and live priority", () => {
  for (const [props, role, live] of [
    [{}, "alert", "polite"],
    [{ tone: "error" }, "alert", "assertive"],
    [{ role: "status", tone: "error" }, "status", "polite"],
    [{ role: "alert" }, "alert", "assertive"],
    [{ role: "status", "aria-live": "off" }, "status", "off"],
  ]) {
    const markup = renderToStaticMarkup(createElement(Alert, { message: "Notice", ...props }));
    assert.match(markup, new RegExp(`role="${role}"`));
    assert.match(markup, new RegExp(`aria-live="${live}"`));
  }
});
