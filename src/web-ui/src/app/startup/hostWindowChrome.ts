import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('hostWindowChrome');

/**
 * Upper bound for waiting on the host's acknowledgement. HarmonyOS applies the
 * cluster update on its UI thread, which is still painting the app's first
 * frames, so the request can take a while; past this bound the launch surface
 * gives up waiting rather than hiding a ready interface behind a stalled host.
 *
 * The request is kicked off at the first React render and only awaited at the
 * launch-surface handoff, so this bound is normally spent overlapping the
 * workspace bootstrap. It still has to fit the shared launch-surface budget
 * (see `MIN_SPLASH_MS`), because the wait is served on top of the hold and the
 * exit fade whenever the host is slow to answer.
 */
const HANDOVER_TIMEOUT_MS = 260;

async function revealChromeOnHarmonyOS(): Promise<void> {
  const { workspaceAPI } = await import('@/infrastructure/api/service-api/WorkspaceAPI');
  await workspaceAPI.setDecorationsOhos(true);
}

/**
 * Reveal the host-drawn window chrome and wait (bounded) for the host to
 * confirm it.
 *
 * HarmonyOS paints the system min/max/close cluster in its own window frame, so
 * the app shell cannot hide or show it with CSS. The host keeps that cluster
 * hidden from the launch window, and the caller keeps the launch surface up
 * until the buttons are really there instead of showing the interface first and
 * the buttons a beat later.
 */
async function performHostWindowChromeHandover(): Promise<void> {
  let timeoutId: number | undefined;
  try {
    await Promise.race([
      revealChromeOnHarmonyOS(),
      new Promise<void>((resolve) => {
        timeoutId = window.setTimeout(resolve, HANDOVER_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    log.debug('Failed to reveal the HarmonyOS window chrome after startup', error);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

// The HarmonyOS handover starts at most once: a caller can kick it off as soon
// as the shell has painted and await the same promise at the launch-surface
// handoff, so the host's bounded round trip — served on a UI thread that is
// still painting the first frames — overlaps the workspace bootstrap instead of
// adding to it. The bound covers the host's acknowledgement, not how long a
// later caller waits to ask, so the timeout is armed once with the request.
let handoverPromise: Promise<void> | null = null;

/**
 * Hand the window chrome that the host draws outside the web view over to the
 * app surface.
 *
 * Desktop platforms own the same buttons inside the app shell and have nothing
 * to hand over, so they resolve immediately and cache nothing.
 */
export function handOverHostWindowChromeToAppSurface(): Promise<void> {
  if (!isOpenHarmonyRuntime()) {
    return Promise.resolve();
  }
  handoverPromise ??= performHostWindowChromeHandover();
  return handoverPromise;
}
