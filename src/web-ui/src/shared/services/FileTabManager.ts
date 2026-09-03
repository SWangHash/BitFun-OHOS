/**
 * File tab manager.
 *
 * Opens files in the editor canvas and supports optional line/range navigation.
 */
import { normalizePath } from '@/shared/utils/pathUtils';
import { getEditorType } from '@/infrastructure/language-detection';
import { type LineRange } from '@/shared/editor/LineRange';
import { enqueuePendingTab } from './pendingTabQueue';
import type { PendingTabDetail } from './pendingTabQueue';
import { workspaceAPI } from '@/infrastructure/api';

export interface FileTabOptions {
   
  filePath: string;
   
  fileName?: string;
   
  workspacePath?: string;
   
  jumpToLine?: number;
   
  jumpToColumn?: number;
   
  jumpToRange?: LineRange;
  
  navigationToken?: number;
   
  mode?: 'agent' | 'project';
   
  forceNew?: boolean;
   
  splitView?: boolean;
   
  targetGroup?: 'primary' | 'secondary';
  /**
   * Pass `true` when the target scene was just added to openTabs (i.e. it was
   * not previously mounted).  The tab event will be enqueued instead of
   * dispatched directly, so it is processed once the scene's ContentCanvas
   * mounts and registers its event listener.
   */
  sceneJustOpened?: boolean;
}

 
class FileTabManager {
  private static instance: FileTabManager;

  private constructor() {}

  public static getInstance(): FileTabManager {
    if (!FileTabManager.instance) {
      FileTabManager.instance = new FileTabManager();
    }
    return FileTabManager.instance;
  }

   
  public openFile(options: FileTabOptions): void {
    const {
      filePath,
      fileName: providedFileName,
      workspacePath,
      jumpToLine,
      jumpToColumn,
      jumpToRange,
      navigationToken,
      mode = 'agent',
      forceNew = false,
      splitView = false,
      targetGroup = 'secondary',
      sceneJustOpened = false,
    } = options;

    
    const normalizedPath = normalizePath(filePath);
    
    const fileName = providedFileName || normalizedPath.split(/[/\\]/).pop() || '';

    // HTML files open in the built-in browser panel instead of the code editor
    // so the rendered page is visible. Applies to all open paths: file tree,
    // file search, and flow-chat right-click "Open".
    if (/\.(html?|xhtml|shtml)$/i.test(fileName)) {
      this.openHtmlInBrowser(normalizedPath, fileName, mode);
      return;
    }
    
    const editorType = getEditorType(fileName);
    
    
    const finalJumpToRange = jumpToRange || (jumpToLine ? { start: jumpToLine, end: jumpToColumn ? jumpToLine : undefined } : undefined);
    
    
    const tabData = {
      filePath: normalizedPath,
      fileName,
      workspacePath,
      navigationToken: navigationToken ?? Date.now(),
      
      ...(finalJumpToRange && { jumpToRange: finalJumpToRange }),
      
      ...(!finalJumpToRange && jumpToLine && { jumpToLine }),
      ...(!finalJumpToRange && jumpToColumn && { jumpToColumn })
    };
    
    
    const eventDetail: PendingTabDetail = {
      type: editorType,
      title: fileName,
      data: tabData,
      metadata: {
        duplicateCheckKey: normalizedPath
      },
      checkDuplicate: !forceNew,
      duplicateCheckKey: normalizedPath
    };

    
    if (splitView) {
      eventDetail.targetGroup = targetGroup;
      eventDetail.enableSplitView = true;
    }
    
    
    const eventName = mode === 'project' ? 'project-create-tab' : 'agent-create-tab';
    
    
    window.dispatchEvent(new CustomEvent('expand-right-panel'));

    // When the target scene was just added to openTabs it hasn't mounted yet,
    // so the ContentCanvas event listener doesn't exist.  Enqueue the event;
    // useTabLifecycle will drain and process it once it registers its listener.
    if (sceneJustOpened) {
      enqueuePendingTab(mode === 'project' ? 'project' : 'agent', eventDetail);
      return;
    }
    
    
    const isRightPanelCollapsed = this.isRightPanelCollapsed();
    
    if (isRightPanelCollapsed) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }));
      }, 300);
    } else {
      window.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }));
    }
  }

  /**
   * Open a local HTML file in the built-in browser panel. The OHOS Web
   * component cannot load `file://` URLs for workspace files, so the file
   * content is read and passed as raw HTML to the browser panel, which uses
   * `loadData` to render it. Applies to all open paths: file tree, file
   * search, and flow-chat right-click "Open".
   */
  private openHtmlInBrowser(
    filePath: string,
    fileName: string,
    mode: 'agent' | 'project',
  ): void {
    void this.loadHtmlIntoBrowserTab(filePath, fileName, mode);
  }

  private async loadHtmlIntoBrowserTab(
    filePath: string,
    fileName: string,
    mode: 'agent' | 'project',
  ): Promise<void> {
    let htmlContent: string;
    try {
      htmlContent = await workspaceAPI.readFileContent(filePath);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[FileTabManager] Failed to read HTML file for browser tab', { filePath, error });
      return;
    }

    const duplicateKey = `browser-panel:${filePath}`;
    const eventDetail: PendingTabDetail = {
      type: 'browser',
      title: fileName,
      data: { html: htmlContent },
      metadata: { duplicateCheckKey: duplicateKey },
      checkDuplicate: true,
      duplicateCheckKey: duplicateKey,
      replaceExisting: false,
    };

    const eventName = mode === 'project' ? 'project-create-tab' : 'agent-create-tab';

    window.dispatchEvent(new CustomEvent('expand-right-panel'));

    if (this.isRightPanelCollapsed()) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }));
      }, 300);
    } else {
      window.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }));
    }
  }

   
  private isRightPanelCollapsed(): boolean {
    
    try {
      const layoutState = (window as any).__BITFUN_LAYOUT_STATE__;
      return layoutState?.rightPanelCollapsed ?? false;
    } catch {
      return false;
    }
  }

   
  public openFileAndJump(
    filePath: string,
    line: number,
    column?: number,
    options?: Partial<FileTabOptions>
  ): void {
    this.openFile({
      filePath,
      jumpToLine: line,
      jumpToColumn: column,
      ...options
    });
  }

   
  public openFileAndJumpToRange(
    filePath: string,
    range: LineRange,
    options?: Partial<FileTabOptions>
  ): void {
    this.openFile({
      filePath,
      jumpToRange: range,
      ...options
    });
  }
}


export const fileTabManager = FileTabManager.getInstance();


export type { FileTabManager };
