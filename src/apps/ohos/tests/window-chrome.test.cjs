const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const abilitySource = fs.readFileSync(
  path.join(__dirname, '../entry/src/main/ets/entryability/EntryAbility.ets'),
  'utf8',
);

test('the launch surface never carries the system title buttons', () => {
  // HarmonyOS paints min/max/close in the window frame, so the splash cannot
  // cover them. The host hides the cluster while the window is created and only
  // the shell's own request (`set_decorations_ohos`) brings it back.
  assert.match(
    abilitySource,
    /setWindowDecorVisible\(false\);[\s\S]{0,400}this\.setNativeTitleButtonsVisible\(false, 'startup'\)/,
    'the startup window configuration must hide the native title buttons',
  );
  assert.match(
    abilitySource,
    /setWindowTitleButtonVisible\(visible, visible, visible\)/,
    'the window-stage toggle must set all three buttons together',
  );
  assert.match(
    abilitySource,
    /setWindowTitleButtonVisible\(\s*req\.visible,\s*req\.visible,\s*req\.visible,?\s*\)/,
    'the shell-driven toggle must set all three buttons together',
  );
});

test('the launch cluster is hidden in the first synchronous step of window stage creation', () => {
  // The window frame is created with the cluster already painted, so the hide
  // must run before the bridge registration and the launch-page load that fill
  // the rest of this callback. Hiding it only from the later decor pass leaves
  // the buttons on screen until then, which reads as the cluster appearing,
  // disappearing, then reappearing at handoff.
  assert.match(
    abilitySource,
    /onWindowStageCreate\(windowStage: window\.WindowStage\): Promise<void> \{[\s\S]{0,900}?this\.mainWindowStage = windowStage;[\s\S]{0,200}?this\.setNativeTitleButtonsVisible\(false, 'startup-sync'\);/,
    'the launch cluster must be hidden synchronously before the launch page loads',
  );
});

test('the decor configuration applies as soon as the launch page takes effect', () => {
  // `setWindowDecorVisible` / `setWindowDecorHeight` / `setDecorButtonStyle` are
  // dropped before loadContent takes effect, so they must run after the content
  // load resolves -- and immediately, not from a timer: a deferred apply leaves
  // the native caption strip painted over the launch surface, which reads as the
  // title bar appearing and then vanishing.
  assert.match(
    abilitySource,
    /await super\.onWindowStageCreate\(windowStage\);[\s\S]{0,120}?this\.applyLaunchSurfaceDecor\(windowStage\);/,
    'the window configuration must apply right after the launch page takes effect',
  );
  assert.doesNotMatch(
    abilitySource,
    /setTimeout\(\(\) => \{[\s\S]{0,600}?setWindowDecorVisible\(false\);/,
    'the window configuration must not be deferred behind a timer',
  );
});

test('an explicit shell chrome request supersedes the startup fallback', () => {
  assert.match(
    abilitySource,
    /registerArktsFunction\('set_decorations_ohos'[\s\S]{0,600}clearTimeout\(this\.startupChromeWatchdog\)/,
    'set_decorations_ohos must cancel the startup fallback timer',
  );
});

test('a window that never reports a handoff stays closable', () => {
  assert.match(
    abilitySource,
    /STARTUP_WINDOW_CHROME_WATCHDOG_MS = \d+/,
    'the startup fallback needs an explicit upper bound',
  );
  assert.match(
    abilitySource,
    /this\.startupChromeWatchdog = setTimeout\(\(\) => \{[\s\S]{0,200}this\.setNativeTitleButtonsVisible\(true, 'startup-chrome-watchdog'\)/,
    'the fallback must reveal the title buttons',
  );
});
