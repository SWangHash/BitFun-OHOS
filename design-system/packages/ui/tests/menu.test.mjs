import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
} from "../dist/index.js";

test("Menu composes grouped items, heading actions, and separators with native roles", () => {
  const markup = renderToStaticMarkup(
    createElement(
      Menu,
      { "aria-label": "Sessions", scrollbarVisibility: "always" },
      createElement(
        MenuSection,
        {
          actions: [{ icon: createElement("svg"), id: "add", label: "Add session" }],
          title: "Sessions",
        },
        createElement(MenuItem, null, "First session"),
        createElement(MenuItem, { checked: true, role: "menuitemcheckbox" }, "Pinned"),
      ),
      createElement(MenuSeparator),
      createElement(MenuSection, { "aria-label": "More" },
        createElement(MenuItem, { disabled: true }, "Disabled session"),
      ),
    ),
  );

  assert.match(markup, /data-bitfun-component="menu"/);
  assert.match(markup, /role="menu"/);
  assert.match(markup, /data-bitfun-scrollbar-visibility="always"/);
  assert.match(markup, /aria-labelledby="[^"]+"[^>]+role="group"/);
  assert.match(markup, /data-bitfun-part="heading-actions"/);
  assert.match(markup, /aria-label="Add session"/);
  assert.equal((markup.match(/role="menuitem"/g) ?? []).length, 3);
  assert.match(markup, /aria-checked="true"[^>]+role="menuitemcheckbox"/);
  assert.match(markup, /role="separator"/);
});

test("Menu owns roving focus and standard single-level navigation keys", async () => {
  const source = await readFile(
    new URL("../src/components/Menu/Menu.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /querySelectorAll<HTMLButtonElement>\("\[data-bitfun-menu-item\]"\)/);
  assert.match(source, /case "ArrowDown"/);
  assert.match(source, /case "ArrowUp"/);
  assert.match(source, /case "Home"/);
  assert.match(source, /case "End"/);
  assert.match(source, /label\.startsWith\(query\)/);
  assert.match(source, /autoFocusFirstItem/);
});

test("Menu keeps roving focus scoped to items owned by the current menu", async () => {
  const source = await readFile(
    new URL("../src/components/Menu/Menu.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /item\.closest\('\[role="menu"\]'\) === root/);
});

test("Menu styling uses only public surface, geometry, action, and scrollbar tokens", async () => {
  const styles = await readFile(
    new URL("../src/components/Menu/Menu.module.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /--bitfun-overlay-menu-inline-size/);
  assert.match(styles, /--bitfun-overlay-menu-item-height/);
  assert.match(styles, /\.list\s*\{[^}]*gap: 0/);
  assert.match(styles, /\.items\s*\{[^}]*gap: 0/);
  assert.match(styles, /\.separator\s*\{[^}]*margin-block: var\(--bitfun-overlay-menu-section-gap\)/);
  assert.match(styles, /--bitfun-color-surface-panel/);
  assert.match(styles, /--bitfun-shadow-menu/);
  assert.match(styles, /--bitfun-overlay-menu-scrollbar-gap/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}/i);
});

test("Menu keeps focus rings inside items without adding a permanent gutter", async () => {
  const styles = await readFile(new URL("../src/components/Menu/Menu.module.css", import.meta.url), "utf8");
  const scrollStyles = await readFile(new URL("../src/components/ScrollArea/ScrollArea.module.css", import.meta.url), "utf8");
  const itemStyles = await readFile(new URL("../src/components/ActionItem/ActionItem.module.css", import.meta.url), "utf8");
  assert.match(styles, /\.list\s*\{[^}]*padding:\s*0/);
  assert.match(itemStyles, /\.root:has\(\.trigger:focus-visible\)\s*\{[^}]*box-shadow:\s*0 0 0 var\(--bitfun-focus-width\)/);
  assert.match(styles, /\.item:has\(> \[data-bitfun-part="trigger"\]:focus-visible\)\s*\{[^}]*box-shadow:\s*inset 0 0 0 var\(--bitfun-focus-width\)/);
  // Keep clipping and scrolling; the item owns its focus indicator.
  assert.match(scrollStyles, /data-bitfun-orientation="vertical"\]\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto/);
  assert.doesNotMatch(styles, /overflow[^:]*:\s*visible/);
});

test("Menu keeps equal item insets while its scrollbar stays on the surface edge", async () => {
  const styles = await readFile(new URL("../src/components/Menu/Menu.module.css", import.meta.url), "utf8");

  assert.match(styles, /\.root\s*\{[^}]*padding-inline:\s*var\(--bitfun-overlay-menu-surface-padding\) 0/);
  assert.match(styles, /\.viewport\s*\{[^}]*padding-inline-end:\s*var\(--bitfun-overlay-menu-scrollbar-gap\);[^}]*scrollbar-gutter:\s*auto/);
  assert.match(
    styles,
    /\.list\s*\{[^}]*padding-inline-end:\s*calc\(\s*var\(--bitfun-overlay-menu-surface-padding\)\s*- var\(--bitfun-overlay-menu-scrollbar-gap\)\s*\)/,
  );
  assert.doesNotMatch(styles, /scrollbar-gutter:\s*stable/);
});

test("content-sized menus hug their widest row inside the shared menu bounds", async () => {
  const styles = await readFile(new URL("../src/components/Menu/Menu.module.css", import.meta.url), "utf8");
  const popover = await readFile(new URL("../src/components/Menu/MenuPopover.tsx", import.meta.url), "utf8");
  const contentRule = styles.match(/\.root\[data-bitfun-inline-size="content"\]\s*\{[^}]*\}/)?.[0] ?? "";

  assert.notEqual(contentRule, "");
  assert.match(contentRule, /inline-size:\s*max-content/);
  assert.match(contentRule, /min-inline-size:\s*var\(--bitfun-overlay-menu-min-inline-size\)/);
  assert.match(contentRule, /max-inline-size:\s*min\(var\(--bitfun-overlay-menu-inline-size\), 100%\)/);
  // The default surface keeps the fixed token instead of hugging content.
  assert.match(styles, /\.root\s*\{[^}]*inline-size:\s*var\(--bitfun-overlay-menu-inline-size\)/);

  const contentMarkup = renderToStaticMarkup(createElement(Menu, { inlineSize: "content" }, createElement(MenuItem, null, "Paste")));
  const defaultMarkup = renderToStaticMarkup(createElement(Menu, null, createElement(MenuItem, null, "Paste")));
  assert.match(contentMarkup, /data-bitfun-inline-size="content"/);
  assert.match(defaultMarkup, /data-bitfun-inline-size="fixed"/);
  // Submenus are separate surfaces and must inherit the requested sizing mode.
  assert.match(popover, /items=\{activeEntry\.submenu!\}[^>]*inlineSize=\{inlineSize\}/);
});

