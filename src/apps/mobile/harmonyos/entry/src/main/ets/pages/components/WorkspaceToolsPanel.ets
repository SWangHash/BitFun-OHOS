import { RuntimeLocationPolicy } from '../policy/RuntimeLocationPolicy';
import { WorkspaceFileEditorView } from './WorkspaceFileEditorView';
import { WorkspaceTerminalView } from './WorkspaceTerminalView';
import { WorkspaceToolsState, WorkspaceToolsIntent, WorkspaceFileEntry, WorkspaceTerminalEntry } from '../state/WorkspaceToolsState';
import { MobileDesignTypography } from '../../generated/MobileDesignTokens';
import { RemoteI18n } from '../../i18n/RemoteI18n';
import { INK, MUTED, PAGE_BG, LINE } from './Theme';

@ComponentV2
export struct WorkspaceToolsPanel {
  @Param state: WorkspaceToolsState = new WorkspaceToolsState();
  @Event onIntent: (intent: WorkspaceToolsIntent) => void = (_intent: WorkspaceToolsIntent) => {};
  @Local path: string = '';
  @Local input: string = '';
  @Local confirmDelete: boolean = false;
  build() {
    Column({ space: 8 }) {
      Row() {
        Text(RemoteI18n.t('workspaceTools.title')).fontSize(MobileDesignTypography.bodyLarge.size).fontColor(INK).layoutWeight(1)
        Button(RemoteI18n.t('common.close')).onClick(() => this.onIntent({ type: 'close' }))
      }
      if (this.state.error.length > 0) { Text(this.state.error).fontColor(MUTED).fontSize(MobileDesignTypography.bodySmall.size) }
      if (this.state.confirmDiscard) {
        Text(RemoteI18n.t('workspaceTools.unsaved')).fontColor(INK)
        Row({ space: 8 }) {
          Button(RemoteI18n.t('common.cancel')).onClick(() => this.onIntent({ type: 'discard-cancel' }))
          Button(RemoteI18n.t('workspaceTools.discard')).onClick(() => this.onIntent({ type: 'discard-confirm' }))
        }
      }
      Tabs({ index: this.state.initialTab }) {
        TabContent() { this.Files() }.tabBar(RemoteI18n.t('workspaceTools.files'))
        TabContent() { this.Terminal() }.tabBar(RemoteI18n.t('workspaceTools.terminal'))
      }.layoutWeight(1)
    }.padding(16).width('100%').height('100%').backgroundColor(PAGE_BG)
  }
  @Builder
  private Files() {
    if (this.state.editorVisible) { this.Editor() } else { this.FileDirectory() }
  }
  @Builder
  private FileDirectory() {
    Column({ space: 8 }) {
      Text(this.state.directory).fontColor(MUTED).fontSize(MobileDesignTypography.bodySmall.size).maxLines(2)
      Row({ space: 8 }) {
        Button(RemoteI18n.t('workspaceTools.up')).onClick(() => {
          const parent = RuntimeLocationPolicy.parent(this.state.directory);
          this.onIntent({ type: 'directory', path: parent });
        })
        Button(RemoteI18n.t('workspaceTools.refresh')).onClick(() => this.onIntent({ type: 'directory' }))
      }.enabled(!this.state.busy)
      Select([
        { value: RemoteI18n.t('workspaceTools.nameAsc') }, { value: RemoteI18n.t('workspaceTools.nameDesc') },
        { value: RemoteI18n.t('workspaceTools.modifiedAsc') }, { value: RemoteI18n.t('workspaceTools.modifiedDesc') }
      ]).selected(this.state.sort).onSelect((index: number) => this.onIntent({ type: 'sort', text: String(index) }))
      List() {
        ForEach(this.state.entries, (entry: WorkspaceFileEntry) => {
          ListItem() {
            Text(`${entry.isDirectory ? '▸ ' : ''}${entry.name}`).fontColor(INK).fontSize(MobileDesignTypography.bodyMedium.size).padding(8)
              .onClick(() => { this.path = entry.path; this.confirmDelete = false; this.onIntent({ type: entry.isDirectory ? 'directory' : 'read', path: entry.path }); })
          }
        }, (entry: WorkspaceFileEntry) => entry.path)
        if (this.state.hasMore) { ListItem() { Button(RemoteI18n.t('workspaceTools.more')).onClick(() => this.onIntent({ type: 'more' })) } }
      }.layoutWeight(1).enabled(!this.state.busy)
      Divider().color(LINE)
      TextInput({ text: this.path, placeholder: RemoteI18n.t('workspaceTools.path') }).onChange((value: string) => { this.path = value; this.confirmDelete = false; })
      Row({ space: 8 }) {
        Button(RemoteI18n.t('workspaceTools.newFile')).onClick(() => this.onIntent({ type: 'read-new', path: this.path }))
        Button(RemoteI18n.t('workspaceTools.mkdir')).onClick(() => this.onIntent({ type: 'mkdir', path: this.path }))
        Button(RemoteI18n.t('workspaceTools.rename')).enabled(this.state.selectedFile.length > 0).onClick(() => this.onIntent({ type: 'rename', path: this.path }))
      }.enabled(!this.state.busy && this.path.length > 0)
      Row({ space: 8 }) {
        Button(RemoteI18n.t('workspaceTools.download')).enabled(this.path.length > 0).onClick(() => this.onIntent({ type: 'download', path: this.path }))
        Button(RemoteI18n.t('workspaceTools.upload')).enabled(this.path.length > 0 && !this.state.uploadPending).onClick(() => this.onIntent({ type: 'upload', path: this.path }))
        if (this.state.uploadPending) {
          Button(RemoteI18n.t('workspaceTools.resumeUpload')).onClick(() => this.onIntent({ type: 'upload-resume' }))
          Button(RemoteI18n.t('workspaceTools.cancelUpload')).onClick(() => this.onIntent({ type: 'upload-cancel' }))
        }
      }.enabled(!this.state.busy)
      if (this.state.downloadStatus) { Text(this.state.downloadStatus).fontColor(MUTED).fontSize(MobileDesignTypography.bodySmall.size) }
      if (this.state.uploadPending) { Progress({ value: this.state.uploadProgress, total: 100, type: ProgressType.Linear }) }
      Row({ space: 8 }) {
        Button(RemoteI18n.t(this.confirmDelete ? 'workspaceTools.confirmDelete' : 'workspaceTools.delete'))
          .enabled(this.state.selectedFile.length > 0).onClick(() => {
            if (this.confirmDelete) { this.onIntent({ type: 'delete' }); this.confirmDelete = false; } else this.confirmDelete = true;
          })
        Button(RemoteI18n.t('workspaceTools.rmdir')).enabled(this.path.length > 0).onClick(() => this.onIntent({ type: 'rmdir', path: this.path }))
      }.enabled(!this.state.busy)
    }.padding({ top: 8 }).width('100%').height('100%')
  }
  @Builder
  private Editor() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Button(RemoteI18n.t('workspaceTools.back')).onClick(() => this.onIntent({ type: 'editor-back' }))
        Text(this.state.selectedFile).fontColor(MUTED).layoutWeight(1).maxLines(2)
      }
      Row({ space: 8 }) {
        Button(RemoteI18n.t('workspaceTools.download')).enabled(!this.state.busy).onClick(() => this.onIntent({ type: 'download' }))
        Button(RemoteI18n.t('workspaceTools.lineNumbers')).onClick(() => this.onIntent({ type: 'line-numbers' }))
        if (this.state.editing) {
          Button(RemoteI18n.t('workspaceTools.save')).enabled(!this.state.busy).onClick(() => this.onIntent({ type: 'save' }))
        } else {
          Button(RemoteI18n.t('workspaceTools.edit')).onClick(() => this.onIntent({ type: 'editor-edit' }))
        }
        if (this.state.dirty) { Text(RemoteI18n.t('workspaceTools.unsaved')).fontColor(MUTED) }
      }
      WorkspaceFileEditorView({ content: this.state.content, editing: this.state.editing,
        lineNumbers: this.state.lineNumbers, onIntent: this.onIntent }).layoutWeight(1)
    }.padding({ top: 8 }).width('100%').height('100%')
  }
  private terminalOptions(): SelectOption[] {
    return this.state.terminals.map((entry: WorkspaceTerminalEntry): SelectOption => ({ value: entry.name || entry.id }));
  }
  @Builder
  private Terminal() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Button(RemoteI18n.t('workspaceTools.createTerminal')).onClick(() => this.onIntent({ type: 'terminal-create' }))
        Select(this.terminalOptions()).onSelect((index: number) => this.onIntent({ type: 'terminal-attach', path: this.state.terminals[index]?.id }))
      }.enabled(!this.state.busy)
      Text(this.state.terminalId).fontSize(MobileDesignTypography.bodySmall.size).fontColor(MUTED)
      WorkspaceTerminalView({ terminalId: this.state.terminalId, output: this.state.output, onIntent: this.onIntent }).layoutWeight(1)
      Scroll() {
        Row({ space: 8 }) {
        Button('Esc').onClick(() => this.onIntent({ type: 'terminal-write', text: '\u001b' }))
        Button('Tab').onClick(() => this.onIntent({ type: 'terminal-write', text: '\t' }))
        Button('Enter').onClick(() => this.onIntent({ type: 'terminal-write', text: '\r' }))
        Button('Ctrl-C').onClick(() => this.onIntent({ type: 'terminal-write', text: '\u0003' }))
        Button(RemoteI18n.t('workspaceTools.closeTerminal')).onClick(() => this.onIntent({ type: 'terminal-close' }))
        }.enabled(this.state.terminalId.length > 0)
      }.width('100%').height(48).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
    }.padding({ top: 8 }).width('100%').height('100%')
  }
}
