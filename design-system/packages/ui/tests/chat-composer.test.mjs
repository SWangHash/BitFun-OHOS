import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChatComposer,
  ChatComposerActionButton,
  ChatComposerContent,
  ChatComposerEndActions,
  ChatComposerQueue,
  ChatComposerQueueAttachmentBadge,
  ChatComposerQueueHeader,
  ChatComposerQueueItem,
  ChatComposerQueueItemActions,
  ChatComposerQueueItemContent,
  ChatComposerQueueList,
  ChatComposerQueueTitle,
  ChatComposerStartActions,
} from "../dist/flow-chat.js";

test("ChatComposerActionButton shares one stable action and icon geometry", () => {
  const markup = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement(ChatComposerActionButton, {
        "aria-expanded": true,
        "aria-label": "Add context",
        icon: createElement("svg", { "data-icon": "plus" }),
        variant: "fill",
      }),
      createElement(ChatComposerActionButton, {
        "aria-label": "Send",
        icon: createElement("svg", { "data-icon": "arrow-up" }),
        variant: "primary",
      }),
    ),
  );

  assert.equal((markup.match(/data-bitfun-role="composer-action"/g) ?? []).length, 2);
  assert.equal((markup.match(/data-bitfun-shape="circle"/g) ?? []).length, 2);
  assert.match(markup, /data-bitfun-variant="fill"/);
  assert.match(markup, /data-bitfun-variant="primary"/);
});

test("ChatComposer publishes stable context, content, and action slots", () => {
  const markup = renderToStaticMarkup(
    createElement(ChatComposer, {
      contextBar: createElement("div", null, "This computer · BitFun"),
      endActions: createElement("button", { type: "button" }, "Send"),
      layout: "compact",
      startActions: createElement("button", { type: "button" }, "Add"),
      children: createElement("textarea", { "aria-label": "Message" }),
    }),
  );

  assert.match(markup, /data-bitfun-component="chat-composer"/);
  assert.match(markup, /data-has-context="true"/);
  assert.match(markup, /data-bitfun-part="contextBar"/);
  const surface = markup.match(/<div[^>]+data-bitfun-part="surface"[^>]*>/)?.[0];
  assert.ok(surface);
  assert.match(surface, /data-bitfun-layout="compact"/);
  assert.match(markup, /data-bitfun-part="startActions"/);
  assert.match(markup, /data-bitfun-part="content"/);
  assert.match(markup, /data-bitfun-part="endActions"/);
  assert.match(markup, /aria-label="Message"/);
});

test("ChatComposer exposes expanded, busy, and disabled state without owning editor behavior", () => {
  const markup = renderToStaticMarkup(
    createElement(ChatComposer, {
      busy: true,
      disabled: true,
      layout: "expanded",
      children: createElement("div", { contentEditable: true }),
    }),
  );

  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /aria-disabled="true"/);
  assert.match(markup, /data-bitfun-state="busy disabled"/);
  assert.match(markup, /data-bitfun-layout="expanded"/);
  assert.doesNotMatch(markup, /data-bitfun-part="contextBar"/);
  assert.match(markup, /contenteditable="true"/);
});

test("ChatComposer exposes a neutral pending-message queue with per-message attachment counts", () => {
  const queue = createElement(
    ChatComposerQueue,
    { "aria-label": "Wait for sending" },
    createElement(
      ChatComposerQueueHeader,
      null,
      createElement("svg", { "aria-hidden": true }),
      createElement(ChatComposerQueueTitle, { count: 13 }, "Wait for sending"),
    ),
    createElement(
      ChatComposerQueueList,
      null,
      createElement(
        ChatComposerQueueItem,
        { state: "default" },
        createElement(
          ChatComposerQueueItemContent,
          null,
          "Help me turn these photos into a painted scene.",
        ),
        createElement(ChatComposerQueueAttachmentBadge, {
          count: 3,
          label: "3 image attachments",
        }),
        createElement(
          ChatComposerQueueItemActions,
          null,
          createElement("button", { "aria-label": "Send now", type: "button" }),
        ),
      ),
    ),
  );
  const markup = renderToStaticMarkup(
    createElement(ChatComposer, {
      children: createElement("textarea", { "aria-label": "Message" }),
      layout: "compact",
      queue,
    }),
  );

  assert.match(markup, /data-bitfun-part="body"/);
  assert.match(markup, /data-bitfun-part="queue"/);
  assert.match(markup, /data-bitfun-component="chat-composer-queue"/);
  assert.match(markup, /data-bitfun-part="title"[^>]*>.*Wait for sending.*13/s);
  const attachmentBadge = markup.match(
    /<span[^>]*data-bitfun-part="attachmentCount"[^>]*>3<\/span>/,
  )?.[0];
  assert.ok(attachmentBadge);
  assert.match(attachmentBadge, /aria-label="3 image attachments"/);
  assert.match(markup, /aria-label="Send now"/);
});

test("ChatComposer queue keeps four message rows visible before scrolling", async () => {
  const styles = await readFile(
    new URL("../src/flow-chat/composer/ChatComposerQueue.module.css", import.meta.url),
    "utf8",
  );
  const listRule = styles.match(/\.list\s*\{[^}]*\}/s)?.[0];

  assert.ok(listRule);
  const maxBlockSize = listRule.match(/max-block-size:\s*calc\((.*?)\);/s)?.[1];
  assert.ok(maxBlockSize);
  assert.equal(
    (maxBlockSize.match(/--bitfun-control-chat-composer-control-height/g) ?? []).length,
    4,
  );
  assert.equal((maxBlockSize.match(/--bitfun-space-1/g) ?? []).length, 3);
  assert.match(listRule, /overflow-y:\s*auto/);
  assert.match(listRule, /overscroll-behavior-y:\s*contain/);
});

test("ChatComposer queue reveals row actions on hover and keyboard focus", async () => {
  const styles = await readFile(
    new URL("../src/flow-chat/composer/ChatComposerQueue.module.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(
    styles,
    /\.actions\s*\{[^}]*pointer-events:\s*none;[^}]*opacity:\s*0;/s,
  );
  assert.match(
    styles,
    /\.item:hover \.actions,\s*\.item:focus-within \.actions\s*\{[^}]*pointer-events:\s*auto;[^}]*opacity:\s*1;/s,
  );
});

test("ChatComposer queue promotes message text from secondary to primary on interaction", async () => {
  const styles = await readFile(
    new URL("../src/flow-chat/composer/ChatComposerQueue.module.css", import.meta.url),
    "utf8",
  );
  const contentRule = styles.match(/\.content\s*\{[^}]*\}/s)?.[0];

  assert.ok(contentRule);
  assert.match(contentRule, /color:\s*var\(--bitfun-color-content-secondary\)/);
  assert.match(
    styles,
    /\.item:hover \.content,\s*\.item:focus-within \.content\s*\{[^}]*color:\s*var\(--bitfun-color-content-primary\)/s,
  );
});

test("ChatComposer queue never changes the input surface geometry", async () => {
  const styles = await readFile(
    new URL("../src/flow-chat/composer/ChatComposer.module.css", import.meta.url),
    "utf8",
  );
  const bodyRule = styles.match(/\.body\s*\{[^}]*\}/s)?.[0];
  const queueRule = styles.match(/\.queue\s*\{[^}]*\}/s)?.[0];

  assert.ok(bodyRule);
  assert.match(bodyRule, /display:\s*flex/);
  assert.match(bodyRule, /flex-direction:\s*column/);
  assert.match(bodyRule, /gap:\s*var\(--bitfun-space-2\)/);
  assert.ok(queueRule);
  assert.match(queueRule, /display:\s*contents/);
  assert.doesNotMatch(styles, /\.body:has\(/);
  assert.doesNotMatch(styles, /\.queue:empty/);
});

test("ChatComposer resolves compound slots into the same stable anatomy", () => {
  const markup = renderToStaticMarkup(
    createElement(
      ChatComposer,
      { layout: "expanded" },
      createElement(
        ChatComposerContent,
        null,
        createElement("div", { "data-editor": true }, "Draft"),
      ),
      createElement(
        ChatComposerStartActions,
        null,
        createElement("button", { type: "button" }, "Add"),
      ),
      createElement(
        ChatComposerEndActions,
        null,
        createElement("button", { type: "button" }, "Send"),
      ),
    ),
  );

  assert.match(markup, /data-bitfun-part="content"[^>]*><div data-editor="true">Draft<\/div>/);
  assert.match(markup, /data-bitfun-part="startActions"[^>]*><button type="button">Add<\/button>/);
  assert.match(markup, /data-bitfun-part="endActions"[^>]*><button type="button">Send<\/button>/);
  assert.equal((markup.match(/>Draft</g) ?? []).length, 1);
});

test("ChatComposer geometry is driven by public system and semantic tokens", async () => {
  const styles = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");

  assert.match(styles, /--bitfun-control-height-md/);
  assert.match(styles, /--bitfun-control-chat-composer-compact-gap/);
  assert.match(styles, /--bitfun-control-chat-composer-compact-height/);
  assert.match(styles, /--bitfun-control-chat-composer-compact-padding-block/);
  assert.match(styles, /--bitfun-control-chat-composer-compact-padding-inline/);
  assert.match(styles, /--bitfun-control-chat-composer-compact-track-height/);
  assert.match(styles, /--bitfun-control-chat-composer-action-icon-size/);
  assert.match(styles, /--bitfun-control-chat-composer-control-height/);
  assert.match(styles, /--bitfun-space-8/);
  assert.match(styles, /--bitfun-control-composer-surface-radius/);
  assert.match(styles, /--bitfun-color-surface-panel/);
  assert.match(styles, /--bitfun-color-surface-subtle/);
  assert.match(styles, /--bitfun-color-surface-raised/);
  const contextBackgroundRule = styles.match(
    /\.\w+\[data-has-context=(?:"true"|true)\][^{]*\{[^}]*\}/,
  );
  assert.ok(contextBackgroundRule);
  assert.match(contextBackgroundRule[0], /background:\s*var\(--bitfun-color-composer-context-background\)/);
  assert.match(styles, /--bitfun-color-composer-border/);
  assert.match(styles, /--bitfun-shadow-composer/);
  assert.match(
    styles,
    /border:\s*var\(--bitfun-border-width-default\)\s+solid\s+var\(--bitfun-color-composer-border\)/,
  );
  assert.match(styles, /min-block-size:\s*var\(--bitfun-control-height-md\)/);
  assert.match(styles, /grid-template-areas:\s*"start content end"/);
  assert.match(
    styles,
    /grid-template-rows:\s*var\(--bitfun-control-chat-composer-compact-track-height\)/,
  );
  assert.match(styles, /"content content"\s*"start end"/);
  assert.match(
    styles,
    /\[data-bitfun-layout=(?:"compact"|compact)\][^{]*\{[^}]*block-size:\s*var\(--bitfun-control-chat-composer-compact-height\)[^}]*border-radius:\s*var\(--bitfun-control-composer-surface-radius\)/,
  );
  assert.match(
    styles,
    /\[data-bitfun-layout=(?:"compact"|compact)\][^{]*\.\w+\s*\{[^}]*block-size:\s*var\(--bitfun-control-chat-composer-compact-track-height\)[^}]*align-self:\s*center/,
  );
});
