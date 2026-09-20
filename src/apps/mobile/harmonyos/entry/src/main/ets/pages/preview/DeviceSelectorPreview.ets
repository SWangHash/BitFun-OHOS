import { SidebarWorkspaceSection } from '../components/SidebarWorkspaceSection';
import { DeviceDirectoryState, emptyDeviceDirectoryEntry } from '../state/DeviceDirectoryState';
import { PAGE_BG } from '../components/Theme';

/** Isolated production-sidebar fixture; never reads credentials or opens a transport. */
@ComponentV2
export struct DeviceSelectorPreview {
  @Local directory: DeviceDirectoryState = this.makeDirectory();

  private makeDirectory(): DeviceDirectoryState {
    const state = new DeviceDirectoryState();
    const first = emptyDeviceDirectoryEntry('preview-mac', 'MacBook Pro', true);
    first.status = 'ready';
    first.workspaces = [{ path: '/workspace/bitfun', name: 'BitFun', lastOpened: '', workspaceKind: 'normal' }];
    const second = emptyDeviceDirectoryEntry('preview-linux', 'Linux Desktop', true);
    second.status = 'ready';
    second.workspaces = [{ path: '/workspace/demo', name: 'Demo', lastOpened: '', workspaceKind: 'normal' }];
    const offline = emptyDeviceDirectoryEntry('preview-offline', 'Offline Desktop', false);
    state.replace([first, second, offline]);
    state.select(first.deviceId);
    return state;
  }

  build() {
    Scroll() {
      SidebarWorkspaceSection({
        directoryState: this.directory,
        onSelectDevice: (id: string): void => { this.directory.select(id); }
      })
        .width('100%')
        .constraintSize({ maxWidth: 360 })
        .padding(16)
    }
    .align(Alignment.TopStart)
    .width('100%').height('100%')
    .backgroundColor(PAGE_BG)
  }
}
