# Settings pages

Follow the Web UI guide and the configuration component guide for public control
sizing. Keep HarmonyOS entry gates and platform adapters with their existing owners.

Panel layout, content width and sidebar pins are controller-local presentation
preferences. Sending and automatic selection actions belong to the active host's
configuration. Missing fields on older hosts retain their original behavior and
make the new editing controls explicitly unavailable.

For these preferences and their consumers, run the focused checks:

```bash
pnpm --dir src/web-ui run test:run src/app/navigation/sidebarPreferences.test.ts src/app/navigation/sidebarRegistry.test.ts src/app/scenes/settings/pages/application src/app/scenes/settings/settingsRegistry.test.ts src/app/scenes/session/SessionScene.resize.test.tsx src/app/scenes/session/sessionPaneLayoutStore.test.ts src/infrastructure/appearance/preferences/flowChatWidthStore.test.ts src/flow_chat/components/FlowChatWidthBoundary.test.tsx src/infrastructure/config/hooks/useChatInputSendPreference.test.tsx src/infrastructure/config/hooks/useSelectionToolbarPreference.test.tsx src/flow_chat/hooks/useMessageSender.test.tsx src/flow_chat/services/flow-chat-manager/MessageModule.test.ts src/flow_chat/selection/FlowChatSelectionBar.test.tsx src/infrastructure/config/components/EditorConfig.test.tsx src/tools/editor/hooks/useEditorFontFamily.test.tsx
```

These are source and DOM contracts. They do not establish native layout, live
remote behavior or device acceptance. Follow the parent guide for `check:web`.
