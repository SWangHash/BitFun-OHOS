import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { common, wantAgent, WantAgent } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x0000;
const TAG: string = 'BitFunKeepAlive';

export interface KeepAliveStatus {
  ok: boolean;
  alreadyRunning: boolean;
  error: string;
}

/**
 * Requests a `taskKeeping` continuous task through Background Tasks Kit.
 *
 * HarmonyOS freezes the app process shortly after it is minimized or the
 * screen turns off, which suspends every in-process timer — including the
 * tokio loop behind the cron (scheduled jobs) service — until the app
 * returns to the foreground. The continuous task keeps the process running
 * so scheduled jobs fire on time. A persistent "running in background"
 * notification is shown by the system while the task is active.
 */
class BackgroundKeepAliveService {
  private running: boolean = false;

  isRunning(): boolean {
    return this.running;
  }

  async start(context: common.UIAbilityContext): Promise<KeepAliveStatus> {
    if (this.running) {
      return { ok: true, alreadyRunning: true, error: '' };
    }
    try {
      const agent: WantAgent = await wantAgent.getWantAgent({
        wants: [{
          bundleName: context.abilityInfo.bundleName,
          abilityName: context.abilityInfo.name,
        }],
        operationType: wantAgent.OperationType.START_ABILITY,
        requestCode: 0,
        wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
      });
      await backgroundTaskManager.startBackgroundRunning(
        context,
        backgroundTaskManager.BackgroundMode.TASK_KEEPING,
        agent,
      );
      this.running = true;
      hilog.info(DOMAIN, TAG, 'continuous task started: mode=taskKeeping');
      return { ok: true, alreadyRunning: false, error: '' };
    } catch (e) {
      const be = e as BusinessError;
      const message: string = `code=${be.code}, msg=${be.message}`;
      hilog.error(DOMAIN, TAG, 'startBackgroundRunning failed: ' + message);
      return { ok: false, alreadyRunning: false, error: message };
    }
  }

  async stop(context: common.UIAbilityContext): Promise<KeepAliveStatus> {
    if (!this.running) {
      return { ok: true, alreadyRunning: true, error: '' };
    }
    try {
      await backgroundTaskManager.stopBackgroundRunning(context);
      this.running = false;
      hilog.info(DOMAIN, TAG, 'continuous task stopped');
      return { ok: true, alreadyRunning: false, error: '' };
    } catch (e) {
      const be = e as BusinessError;
      const message: string = `code=${be.code}, msg=${be.message}`;
      hilog.error(DOMAIN, TAG, 'stopBackgroundRunning failed: ' + message);
      return { ok: false, alreadyRunning: false, error: message };
    }
  }
}

export const backgroundKeepAliveService: BackgroundKeepAliveService =
  new BackgroundKeepAliveService();
