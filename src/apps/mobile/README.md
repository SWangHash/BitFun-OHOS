# OpenBitFun Native Mobile Apps

This directory contains the native mobile product surfaces for OpenBitFun:

- `android/`: Android application code and resources.
- `ios/`: iOS application code and resources.
- `harmonyos/`: HarmonyOS application code and resources.

The mobile apps are remote controllers: GitHub login and the account device
directory select a desktop or CLI host that owns configuration and Agent Runtime
execution. Phones submit tasks and display results; they do not synchronize model
configuration or execute agents locally.

Each platform directory owns its native UI, lifecycle, permissions, packaging,
and platform adapters. Product logic and stable contracts should remain in the
platform-agnostic Rust layers and be exposed to these apps through explicit
interfaces.

## Image messages

All three apps can send images with or without text. Camera photos are decoded
on the phone and converted to a supported format before upload. Failed sends
retain the draft and images; acknowledgement removes only the submitted content.

Model selection belongs to the connected host. A primary model that supports
images receives their pixels directly. For a text-only primary model, select an
enabled image-understanding model in the host settings and keep `analyze_image`
enabled for the agent. The receiving runtime saves inline attachments so the
same images remain available after restoring a conversation, including sessions
in SSH workspaces. An unavailable model or unreadable image produces an error.

## Shared visual contract

HarmonyOS is the current visual baseline. The source contract in
[`design-system/`](design-system/README.md) records the stable HarmonyOS colors,
type scale, geometry, breakpoints, motion, component anatomy, and deterministic
preview scenarios. A generator emits native constants for ArkUI, Compose, and
SwiftUI; each platform still owns its native component implementation.

```bash
pnpm run mobile:ui:generate
pnpm run mobile:ui:check
pnpm run mobile:ui:preview
```

The preview command opens a local three-column desktop surface for HarmonyOS,
Android, and iOS. It renders the same scenario from the contract and can overlay
native simulator or IDE-preview captures for pixel-level comparison.
