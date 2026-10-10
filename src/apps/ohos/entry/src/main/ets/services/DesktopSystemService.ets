import { autoStartupManager } from '@kit.AbilityKit';

/** Device-local lifecycle capabilities; never changes system startup settings. */
export class DesktopSystemService {
  async getLaunchAtLogin(): Promise<boolean> {
    return autoStartupManager.getAutoStartupStatusForSelf();
  }

}
