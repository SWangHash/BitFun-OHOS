import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
    .replace(/\r\n?/g, '\n');
}

const ANCHORED_OVERLAYS = [
  { name: 'shared Select', path: '../../component-library/components/Select/Select.tsx' },
  { name: 'chat input pickers', path: './ChatInput.tsx' },
  { name: 'file mention picker', path: './FileMentionPicker.tsx' },
  { name: 'permission menu', path: './ChatInputWorkspaceStrip.tsx' },
  { name: 'welcome workspace menu', path: './WelcomePanel.tsx' },
  { name: 'session menu', path: './session-menu/SessionMenu.tsx' },
  { name: 'toolbar overflow menu', path: './toolbar-mode/ToolbarMode.tsx' },
  { name: 'message copy menu', path: './modern/ModelRoundItem.tsx' },
  { name: 'session file menus', path: './modern/SessionFilesBadge.tsx' },
  { name: 'session tree panel', path: './modern/SessionTreePopover.tsx' },
  { name: 'background command panel', path: './modern/FlowChatHeader.tsx' },
  { name: 'tool timeout menu', path: '../tool-cards/ToolTimeoutIndicator.tsx' },
  { name: 'dispatch target menu', path: '../../features/dispatch/DispatchTargetPicker.tsx' },
  { name: 'profile avatar menu', path: '../../app/scenes/profile/views/AssistantAvatarPicker.tsx' },
  { name: 'shell creation menu', path: '../../app/scenes/shell/ShellNav.tsx' },
  { name: 'navigation footer menu', path: '../../app/components/NavPanel/components/PersistentFooterActions.tsx' },
];

describe.each(ANCHORED_OVERLAYS)('$name clipping contract', ({ path }) => {
  const source = readSource(path);

  it('escapes ancestor overflow and tracks its trigger in the viewport', () => {
    expect(source).toContain('createPortal');
    expect(source).toContain('getAppearanceOverlayHost');
    expect(source).toContain('useAnchoredPopoverPosition');
  });
});

describe('existing FlowChat background command menus', () => {
  it('enables their fixed-position portal modifier at both render sites', () => {
    const source = readSource('./modern/FlowChatHeader.tsx');
    expect(source.match(/flowchat-header__background-command-menu--portal/g)).toHaveLength(2);
  });
});

describe('chat input slash picker interaction contract', () => {
  const source = readSource('./ChatInput.tsx');
  const styles = readSource('./ChatInput.scss');

  it('tracks the selected item inside the portalled picker', () => {
    expect(source).toContain('const selectedItem = slashCommandPickerRef.current?.querySelector(');
    expect(source).not.toContain('const selectedItem = containerRef.current?.querySelector(');
  });

  it('dismisses the picker when the session scene deactivates or focus moves outside it', () => {
    expect(source).toContain('if (!isSceneActive) {');
    expect(source).toContain("document.addEventListener('mousedown', handleSlashPickerPointerDown)");
    expect(source).toContain("document.removeEventListener('mousedown', handleSlashPickerPointerDown)");
  });

  it('avoids an ArkWeb backdrop layer that can survive picker removal', () => {
    const pickerStyles = styles.slice(
      styles.indexOf('&__slash-command-picker'),
      styles.indexOf('&__slash-command-header'),
    );

    expect(pickerStyles).not.toContain('backdrop-filter');
  });
});
