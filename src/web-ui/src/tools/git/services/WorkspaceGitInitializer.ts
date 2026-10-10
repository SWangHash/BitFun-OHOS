/**
 * Workspace Git initializer
 * 
 * Responsibilities:
 * - Monitor workspace open/close/switch events
 * - Auto-refresh/cleanup Git state
 * - Keep Git state synced with workspace changes
 */

import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { gitStateManager } from '../state/GitStateManager';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import { isGitRepositoryUntrustedError } from '@/infrastructure/api/errors/TauriCommandError';
import { requestGitRepositoryTrust } from '@/shared/services/gitTrustService';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('WorkspaceGitInitializer');

class WorkspaceGitInitializer {
  private static instance: WorkspaceGitInitializer | null = null;
  private removeListener: (() => void) | null = null;
  private activation = 0;
  private currentWorkspaceId: string | null = null;

  private constructor() {}

  static getInstance(): WorkspaceGitInitializer {
    if (!this.instance) {
      this.instance = new WorkspaceGitInitializer();
    }
    return this.instance;
  }

  start(): void {
    if (this.removeListener) {
      return;
    }

    this.removeListener = workspaceManager.addEventListener(async (event) => {
      switch (event.type) {
        case 'workspace:opened':
          await this.handleWorkspaceOpened(event.workspace.id);
          break;

        case 'workspace:closed':
          await this.handleWorkspaceClosed(event.workspaceId);
          break;

        case 'workspace:switched':
          await this.handleWorkspaceSwitched(event.workspace.id);
          break;
      }
    });

    const currentState = workspaceManager.getState();
    if (currentState.currentWorkspace) {
      this.handleWorkspaceOpened(currentState.currentWorkspace.id);
    }
  }

  stop(): void {
    this.activation++;
    if (this.removeListener) {
      this.removeListener();
      this.removeListener = null;
    }
  }

  private async handleWorkspaceOpened(workspaceId: string): Promise<void> {
    const activation = ++this.activation;
    const surface = getActiveSurfaceScope();
    this.currentWorkspaceId = workspaceId;
    const isCurrent = () => surface.isCurrent()
      && this.activation === activation
      && workspaceManager.getState().currentWorkspace?.id === workspaceId;
    const currentWorkspace = workspaceManager.getState().currentWorkspace;
    const scope = { workspaceId, repositoryPath: currentWorkspace?.rootPath };
    try {
      await gitStateManager.refresh(scope, {
        layers: ['basic'],
        reason: 'mount',
        force: true,
        source: 'workspace_git_initializer',
      });
    } catch (error) {
      if (isCurrent() && isGitRepositoryUntrustedError(error)) {
        try {
          if (await requestGitRepositoryTrust(scope, { isCurrent }) && isCurrent()) {
            await gitStateManager.refresh(scope, {
              layers: ['basic', 'status'],
              reason: 'operation',
              force: true,
              source: 'workspace_git_initializer',
            });
          }
        } catch (recoveryError) {
          log.error('Failed to refresh Git after workspace trust', { workspaceId, error: recoveryError });
        }
      } else {
        log.error('Failed to initialize Git state', { workspaceId, error });
      }
    }
  }

  private async handleWorkspaceClosed(workspaceId: string): Promise<void> {
    if (this.currentWorkspaceId !== workspaceId) return;
    this.activation++;
    try {
      if (this.currentWorkspaceId) {
        gitStateManager.invalidateCache({ workspaceId: this.currentWorkspaceId }, ['basic', 'status', 'detailed']);
      }
      this.currentWorkspaceId = null;
    } catch (error) {
      log.error('Failed to cleanup Git state', { workspaceId, error });
    }
  }

  private async handleWorkspaceSwitched(workspaceId: string): Promise<void> {
    try {
      if (this.currentWorkspaceId && this.currentWorkspaceId !== workspaceId) {
        gitStateManager.invalidateCache({ workspaceId: this.currentWorkspaceId }, ['basic', 'status', 'detailed']);
      }
      await this.handleWorkspaceOpened(workspaceId);
    } catch (error) {
      log.error('Failed to initialize Git state for switched workspace', { workspaceId, error });
    }
  }
}

export const workspaceGitInitializer = WorkspaceGitInitializer.getInstance();
