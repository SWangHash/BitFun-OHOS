import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useCurrentWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useGitState } from '@/tools/git/hooks/useGitState';
import './ChatEmptyState.scss';

/**
 * Chat empty state component
 * Displays current workspace, branch info, and prompts user to interact via AI chat.
 *
 * Uses the shared GitStateManager so the branch label stays in sync with
 * external changes (e.g. `git checkout` from the integrated terminal) via
 * the manager's polling interval instead of being stuck at mount-time value.
 */
export const ChatEmptyState: React.FC = () => {
  const { t } = useTranslation('flow-chat');
  const { workspace: currentWorkspace } = useCurrentWorkspace();

  const scope = currentWorkspace?.id
    ? { workspaceId: currentWorkspace.id }
    : { workspaceId: '' };

  const { isRepository, currentBranch } = useGitState({
    repositoryPath: scope,
    layers: ['basic'],
    isActive: !!currentWorkspace?.id,
    refreshOnMount: !!currentWorkspace?.id,
    refreshOnActive: true,
    participateInWindowFocusRefresh: true,
    debugSource: 'chat_empty_state',
  });

  const loading = !!currentWorkspace?.id && !isRepository && !currentBranch;

  return (
    <div data-bitfun-component="chat-empty-state" data-bitfun-part="root" data-bitfun-state={loading ? 'loading' : ''} className="fc-chat-empty">
      <div data-bitfun-component="chat-empty-state" data-bitfun-part="container" className="fc-chat-empty__container">
        {!loading && currentWorkspace && (
          <>
            <div data-bitfun-component="chat-empty-state" data-bitfun-part="greeting" className="fc-chat-empty__greeting">
              <p>{t('emptyState.welcomeBack')}</p>
              <p>
                {currentBranch ? (
                  <Trans
                    i18nKey="emptyState.workingInWithBranch"
                    t={t}
                    values={{ workspace: currentWorkspace.name, branch: currentBranch }}
                    components={{
                      workspace: <span className="fc-chat-empty__workspace-name" />,
                      branch: <span className="fc-chat-empty__branch-name" />
                    }}
                  />
                ) : (
                  <Trans
                    i18nKey="emptyState.workingIn"
                    t={t}
                    values={{ workspace: currentWorkspace.name }}
                    components={{
                      workspace: <span className="fc-chat-empty__workspace-name" />
                    }}
                  />
                )}
              </p>
            </div>

            <div data-bitfun-component="chat-empty-state" data-bitfun-part="divider" className="fc-chat-empty__divider" />

            <div data-bitfun-component="chat-empty-state" data-bitfun-part="prompt" className="fc-chat-empty__prompt">
              <p>{t('emptyState.capabilities')}</p>
              <p>{t('emptyState.capabilities2')}</p>
              <p className="fc-chat-empty__prompt-hint">{t('emptyState.readyToHelp')}</p>
            </div>
          </>
        )}

        {!loading && !currentWorkspace && (
          <div data-bitfun-component="chat-empty-state" data-bitfun-part="noWorkspace" className="fc-chat-empty__no-workspace">
            <p>{t('emptyState.noWorkspace')}</p>
            <p className="fc-chat-empty__hint">{t('emptyState.openProject')}</p>
          </div>
        )}
      </div>
    </div>
  );
};
