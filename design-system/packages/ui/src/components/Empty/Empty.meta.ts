import type { ComponentMeta } from "../../registry.types";

export const emptyMeta = {
  category: "feedback",
  description: "Explains an empty result or unavailable collection with optional identity and actions.",
  maturity: "stable",
  name: "Empty",
  props: [
    { name: "title", type: "ReactNode" },
    { name: "description", type: "ReactNode" },
    { name: "icon", type: "ReactNode" },
    { name: "actions", type: "ReactNode" },
    { defaultValue: "md", name: "imageSize", type: "sm | md | lg" },
  ],
  states: ["default", "with-title", "with-actions"],
  tokens: [
    "component.empty.media",
    "color.content.muted",
    "layout.empty.gap",
    "layout.empty.paddingBlock",
    "layout.empty.paddingInline",
    "layout.empty.mediaSizeSm",
    "layout.empty.mediaSizeMd",
    "layout.empty.mediaSizeLg",
    "layout.empty.iconSizeSm",
    "layout.empty.iconSizeMd",
    "layout.empty.iconSizeLg",
    "type.label.md.fontSize",
    "type.body.sm.fontSize",
  ],
} as const satisfies ComponentMeta;
