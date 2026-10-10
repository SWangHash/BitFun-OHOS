import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('hostWindowChrome');

/**
 * Upper bound for waiting on the host's acknowledgement. HarmonyOS applies the
 * cluster update on its UI thread, which is still painting the app's first
 * frames, so the request can take a while; past this bound the launch surface
 * gives up waiting rather than hiding a ready interface behind a stalled host.
 */
const HANDOVER_TIMEOUT_MS = 400;

async function revealChromeOnHarmonyOS(): Promise<void> {
  const { workspaceAPI } = await import('@/infrastructure/api/service-api/WorkspaceAPI');
  await workspaceAPI.setDecorationsOhos(true);
}

/**
 * Hand the window chrome that the host draws outside the web view over to the
 * app surface.
 *
 * HarmonyOS paints the system min/max/close cluster in its own window frame, so
 * the app shell cannot hide or show it with CSS. The host keeps that cluster
 * hidden from the launch window; this reveals it and waits (bounded) for the
 * host to confirm the update, so the caller can keep the launch surface up until
 * the buttons are really there instead of showing the interface first and the
 * buttons a beat later. Desktop platforms own the same buttons in the app shell
 * and have nothing to hand over.
 */
export async function handOverHostWindowChromeToAppSurface(): Promise<void> {
  if (!isOpenHarmonyRuntime()) return;

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
