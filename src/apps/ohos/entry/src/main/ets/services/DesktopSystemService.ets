import { autoStartupManager } from '@kit.AbilityKit';
import { deviceInfo, runningLock, commonEventManager } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

/** Device-local lifecycle capabilities; never changes system startup settings. */
export class DesktopSystemService {
  private lock: runningLock.RunningLock | undefined = undefined;
  private subscriber: commonEventManager.CommonEventSubscriber | undefined = undefined;
  private forcedSleep: boolean = false;

  async getLaunchAtLogin(): Promise<boolean> {
    return autoStartupManager.getAutoStartupStatusForSelf();
  }

  async setPreventSleep(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.dispose();
      return;
    }
    if (deviceInfo.sdkApiVersion < 23) {
      throw new Error('OHOS_SLEEP_API_23_REQUIRED');
    }
    if (this.lock !== undefined) return;
    const type = runningLock.RunningLockType.BACKGROUND_USER_IDLE;
    if (!runningLock.isSupported(type)) {
      throw new Error('OHOS_SLEEP_UNSUPPORTED');
    }
    const subscriber = await commonEventManager.createSubscriber({
      events: [commonEventManager.Support.COMMON_EVENT_ENTER_FORCE_SLEEP,
        commonEventManager.Support.COMMON_EVENT_EXIT_FORCE_SLEEP],
    });
    try {
      commonEventManager.subscribe(subscriber, (error, data) => {
        if (error) return;
        try {
          if (data.event === commonEventManager.Support.COMMON_EVENT_ENTER_FORCE_SLEEP) {
            this.forcedSleep = true;
            this.lock?.unhold();
          } else if (data.event === commonEventManager.Support.COMMON_EVENT_EXIT_FORCE_SLEEP) {
            this.forcedSleep = false;
            this.lock?.hold(0);
          }
        } catch (failure) {
          hilog.error(0, 'DesktopSystem', 'Failed to update idle sleep lock: %{public}s', String(failure));
        }
      });
      const lock = await runningLock.create('BitFun idle sleep prevention', type);
      if (!this.forcedSleep) lock.hold(0);
      this.lock = lock;
      this.subscriber = subscriber;
    } catch (error) {
      commonEventManager.unsubscribe(subscriber);
      throw error as Error;
    }
  }

  dispose(): void {
    this.lock?.unhold();
    this.lock = undefined;
    if (this.subscriber !== undefined) {
      commonEventManager.unsubscribe(this.subscriber);
      this.subscriber = undefined;
    }
    this.forcedSleep = false;
  }
}
