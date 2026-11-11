import { commonEventManager } from '@kit.BasicServicesKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x0000;
export const PET_WINDOW_TAG: string = 'BitFunPetWindow';

/**
 * Custom common events that connect the Agent companion pet window
 * (`AgentCompanionAbility`) with the main ability.
 *
 * The two windows may run in different ArkTS runtimes, so they cannot share
 * objects or call into each other. Common events are process/system routed and
 * work in both topologies, which keeps the bridge independent of that detail.
 *
 * Payload rules: every event carries one `data` string that is already a JSON
 * payload. The pet page parses it exactly like the desktop window parses a Tauri
 * event payload, so no shape translation happens in ArkTS.
 */
export const PET_DELIVER_EVENT: string = 'bitfun.agentCompanion.deliver';
export const PET_COMMAND_EVENT: string = 'bitfun.agentCompanion.command';
/** Ask the pet ability to close its window (`{ }`, no payload). */
export const PET_HIDE_EVENT: string = 'bitfun.agentCompanion.hide';
/** Ask the pet window to take a CSS pixel size (`{ width, height }`). */
export const PET_RECT_EVENT: string = 'bitfun.agentCompanion.rect';
/**
 * The pet page has measured itself and is drawing. The window stays hidden until
 * this arrives so the first visible frame already contains the pet instead of the
 * page's boot background.
 */
export const PET_READY_EVENT: string = 'bitfun.agentCompanion.ready';
/**
 * AppStorage key holding the carrier that actually created the pet window
 * (`float` / `main-topmost` / `subwindow` / `none`). The page uses it to pick a
 * blur material the compositor can sample behind the window.
 */
export const PET_CARRIER_KEY: string = 'bitfunPetWindowCarrier';

/** `{ event, payload }` — payload keeps its original JSON type. */
export interface PetWindowDeliverEnvelope {
  event: string;
  payload: string;
}

/**
 * Build the `{event, payload}` envelope the injected commands expect. The payload
 * is spliced in verbatim because it is already JSON text; wrapping it again would
 * turn the object into a string on the receiving side.
 */
export function buildPetCommandEnvelope(event: string, payloadJson: string): string {
  const payload: string = payloadJson.length > 0 ? payloadJson : 'null';
  return '{"event":' + JSON.stringify(event) + ',"payload":' + payload + '}';
}

/**
 * Publish a common event, logging instead of throwing on delivery failure.
 *
 * `publish` only offers the callback form, so it is wrapped here to keep the
 * bridge's call sites linear.
 */
export async function publishPetEvent(eventName: string, data: string): Promise<void> {
  const options: commonEventManager.CommonEventPublishData = { data: data };
  await new Promise<void>((resolve) => {
    try {
      commonEventManager.publish(eventName, options, (error: BusinessError) => {
        if (error) {
          hilog.warn(DOMAIN, PET_WINDOW_TAG,
            `publish ${eventName} failed: code=${error.code} message=${error.message}`);
        }
        resolve();
      });
    } catch (error) {
      // A rejected publish call must settle the promise too, otherwise a caller
      // that awaits a delivery would wait forever.
      const businessError: BusinessError = error as BusinessError;
      hilog.warn(DOMAIN, PET_WINDOW_TAG,
        `publish ${eventName} threw: ${businessError.message ?? String(error)}`);
      resolve();
    }
  });
}

/**
 * Create a subscriber for one of the pet events.
 *
 * Uses the callback form of `createSubscriber` rather than the sync variant so
 * the bridge does not depend on an API level higher than the packaged
 * `compatibleSdkVersion`.
 */
export async function createPetSubscriber(
  eventName: string,
  handler: (data: string) => void,
): Promise<commonEventManager.CommonEventSubscriber | null> {
  const subscriber: commonEventManager.CommonEventSubscriber | null =
    await new Promise<commonEventManager.CommonEventSubscriber | null>((resolve) => {
      commonEventManager.createSubscriber({ events: [eventName] },
        (error: BusinessError, created: commonEventManager.CommonEventSubscriber) => {
          if (error) {
            hilog.error(DOMAIN, PET_WINDOW_TAG,
              `create subscriber for ${eventName} failed: code=${error.code} message=${error.message}`);
            resolve(null);
            return;
          }
          resolve(created);
        });
    });
  if (subscriber === null) {
    return null;
  }
  try {
    commonEventManager.subscribe(subscriber, (error: BusinessError, data: commonEventManager.CommonEventData) => {
      if (error) {
        hilog.warn(DOMAIN, PET_WINDOW_TAG,
          `${eventName} delivery error: code=${error.code} message=${error.message}`);
        return;
      }
      // `data` is optional on the platform event; a delivery without a body is
      // forwarded as empty text so handlers keep one parameter shape.
      handler(data.data ?? '');
    });
  } catch (error) {
    const businessError: BusinessError = error as BusinessError;
    hilog.error(DOMAIN, PET_WINDOW_TAG,
      `subscribe ${eventName} failed: code=${businessError.code} message=${businessError.message}`);
    return null;
  }
  return subscriber;
}

/** Stop receiving an event created by {@link createPetSubscriber}. */
export function disposePetSubscriber(
  subscriber: commonEventManager.CommonEventSubscriber | null,
): void {
  if (subscriber === null) {
    return;
  }
  try {
    commonEventManager.unsubscribe(subscriber);
  } catch (error) {
    // Unsubscribing a subscriber that never attached has nothing to undo.
  }
}

/**
 * Escape a value for embedding as a JavaScript string literal inside
 * `runJavaScript`. The package already has to hand JSON text to the webview, and
 * a raw splice would break on quotes in task titles or output text.
 */
export function toJavaScriptStringLiteral(value: string): string {
  return JSON.stringify(value);
}
