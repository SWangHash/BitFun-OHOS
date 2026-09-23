/**
 * FileHistoryView — per-file commit history for the Git scene.
 *
 * Left column: commits that touch the repository-relative path
 * (git log -- <path>). Right column: the diff of the selected commit
 * restricted to that file (git diff <parent> <commit> -- <path>).
 */

import { OverflowText, Button, Icon, IconButton, ScrollArea, Tooltip, SegmentedControl } from '@bitfun/ui';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileCode2, History } from 'lucide-react';
import { useGitSceneStore } from '../gitSceneStore';
import { gitService } from '@/tools/git/services';
import type { GitCommit } from '@/tools/git/types';
import type { GitWorkspaceScope } from '@/infrastructure/api/service-api/GitAPI';
import { GitDiffView } from '@/tools/git/components/GitDiffView';
import { InlineDiffPreview } from '@/flow_chat/components/InlineDiffPreview';
import { snapshotAPI, type FileChangeEntry, type SandboxOperationDiff } from '@/infrastructure/api/service-api/SnapshotAPI';
import { i18nService } from '@/infrastructure/i18n';
import { describeGitTrustFailure } from '@/shared/services/gitTrustService';
import { createLogger } from '@/shared/utils/logger';
import './FileHistoryView.scss';

const log = createLogger('FileHistoryView');

interface FileHistoryViewProps {
  workspacePath?: string;
  workspaceId?: string;
  filePath?: string | null;
  isActive?: boolean;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return i18nService.t('panels/git:relativeTime.justNow');
  if (diff < 3600) {
    return i18nService.t('panels/git:relativeTime.minutesAgo', { count: Math.floor(diff / 60) });
  }
  if (diff < 86400) {
    return i18nService.t('panels/git:relativeTime.hoursAgo', { count: Math.floor(diff / 3600) });
  }
  if (diff < 604800) {
    return i18nService.t('panels/git:relativeTime.daysAgo', { count: Math.floor(diff / 86400) });
  }
  if (diff < 2592000) {
    return i18nService.t('panels/git:relativeTime.weeksAgo', { count: Math.floor(diff / 604800) });
  }
  if (diff < 31536000) {
    return i18nService.t('panels/git:relativeTime.monthsAgo', { count: Math.floor(diff / 2592000) });
  }
  return i18nService.t('panels/git:relativeTime.yearsAgo', { count: Math.floor(diff / 31536000) });
}

/** Root commits have no parent to diff against; show the full content instead. */
const RootCommitContent: React.FC<{
  scope: GitWorkspaceScope;
  filePath: string;
  commitHash: string;
}> = ({ scope, filePath, commitHash }) => {
  const { t } = useTranslation('panels/git');
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    gitService
      .getFileContent(scope, filePath, commitHash)
      .then((value) => {
        if (!cancelled) setContent(value);
      })
      .catch((err) => {
        log.error('Failed to load root-commit file content', { repositoryPath: scope.repositoryPath, filePath, commitHash, error: err });
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, filePath, commitHash]);

  return (
    <div data-bitfun-component="file-history-view" data-bitfun-part="rootContent" className="bitfun-git-file-history__root-content">
      <div className="bitfun-git-file-history__root-banner">{t('fileHistory.addedInCommit')}</div>
      {failed ? (
        <div className="bitfun-git-file-history__root-failed">{t('fileHistory.loadFailed')}</div>
      ) : content === null ? (
        <div className="bitfun-git-file-history__state">{t('fileHistory.loading')}</div>
      ) : (
        <pre className="bitfun-git-file-history__root-pre">{content}</pre>
      )}
    </div>
  );
};

/** Localized label for a snapshot operation type (Create/Modify/Delete/Rename). */
function operationTypeLabel(type: string): string {
  switch (type) {
    case 'Create':
      return i18nService.t('panels/git:fileHistory.operation.create');
    case 'Modify':
      return i18nService.t('panels/git:fileHistory.operation.modify');
    case 'Delete':
      return i18nService.t('panels/git:fileHistory.operation.delete');
    case 'Rename':
      return i18nService.t('panels/git:fileHistory.operation.rename');
    default:
      return type;
  }
}

/** FileChangeEntry timestamp is { secs_since_epoch, nanos_since_epoch } → epoch seconds. */
function entryTimeSeconds(entry: FileChangeEntry): number {
  return entry.timestamp.secs_since_epoch + entry.timestamp.nanos_since_epoch / 1e9;
}

/**
 * Local change timeline for one file: Agent operations recorded by the snapshot
 * system (session id / turn / tool). Selecting an entry loads the before/after
 * content of that operation via getOperationDiff.
 */
const FileLocalHistory: React.FC<{
  workspacePath: string;
  filePath: string;
}> = ({ workspacePath, filePath }) => {
  const { t } = useTranslation('panels/git');
  const [entries, setEntries] = useState<FileChangeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FileChangeEntry | null>(null);
  const [diff, setDiff] = useState<SandboxOperationDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  /** Snapshot records use absolute paths; the scene's filePath is repo-relative. */
  const fullPath = useMemo(() => {
    const ws = workspacePath.replace(/\\/g, '/');
    const file = filePath.replace(/\\/g, '/');
    return ws.endsWith('/') ? ws + file : ws + '/' + file;
  }, [workspacePath, filePath]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedEntry(null);
    setDiff(null);
    try {
      const result = await snapshotAPI.getFileChangeHistory(fullPath, workspacePath);
      setEntries(result);
    } catch (err) {
      log.error('Failed to load local change history', { fullPath, error: err });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fullPath, workspacePath]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const handleSelect = useCallback(
    async (entry: FileChangeEntry) => {
      setSelectedEntry(entry);
      setDiff(null);
      setDiffError(null);
      if (!entry.operation_id) return;
      setDiffLoading(true);
      try {
        const result = await snapshotAPI.getOperationDiff(entry.session_id, fullPath, entry.operation_id, workspacePath);
        setDiff(result);
      } catch (err) {
        log.error('Failed to load operation diff', {
          sessionId: entry.session_id,
          operationId: entry.operation_id,
          error: err,
        });
        setDiffError(err instanceof Error ? err.message : String(err));
      } finally {
        setDiffLoading(false);
      }
    },
    [fullPath, workspacePath]
  );

  const sortedEntries = useMemo(() => [...entries].reverse(), [entries]);

  return (
    <>
      <div data-bitfun-component="file-history-view" data-bitfun-part="commits" className="bitfun-git-file-history__commits">
        {loading ? (
          <div data-bitfun-component="file-history-view" data-bitfun-part="state" className="bitfun-git-file-history__state">
            {t('fileHistory.loading')}
          </div>
        ) : error ? (
          <div data-bitfun-component="file-history-view" data-bitfun-part="state" className="bitfun-git-file-history__state">
            <p>{t('fileHistory.localLoadFailedWithMessage', { error })}</p>
            <Button variant="outline" size="sm" onClick={() => void loadEntries()}>
              {t('fileHistory.retry')}
            </Button>
          </div>
        ) : sortedEntries.length === 0 ? (
          <div data-bitfun-component="file-history-view" data-bitfun-part="state" className="bitfun-git-file-history__state">
            {t('fileHistory.localEmpty')}
          </div>
        ) : (
          <ScrollArea
            data-bitfun-component="file-history-view"
            data-bitfun-part="commitList"
            className="bitfun-git-file-history__commit-list"
          >
            {sortedEntries.map((entry, index) => {
              const isSelected = selectedEntry === entry;
              return (
                <div
                  data-bitfun-component="file-history-view"
                  data-bitfun-part="commit"
                  data-bitfun-state={isSelected ? 'selected' : undefined}
                  key={`${entry.session_id}-${entry.turn_index}-${entry.snapshot_id}`}
                  className={`bitfun-git-file-history__commit ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => void handleSelect(entry)}
                  title={`${entry.tool_name} · ${entry.session_id}`}
                >
                  <div data-bitfun-component="file-history-view" data-bitfun-part="timeline" className="bitfun-git-file-history__timeline">
                    <div className="bitfun-git-file-history__timeline-node" title={entry.tool_name}>
                      <History size={11} />
                    </div>
                    {index < sortedEntries.length - 1 && <div className="bitfun-git-file-history__timeline-line" />}
                  </div>
                  <div data-bitfun-component="file-history-view" data-bitfun-part="commitInfo" className="bitfun-git-file-history__commit-info">
                    <div className="bitfun-git-file-history__commit-message">
                      <OverflowText>
                        <span className="bitfun-git-file-history__operation-badge">
                          {operationTypeLabel(entry.operation_type)}
                        </span>
                        <span className="bitfun-git-file-history__tool-name">{entry.tool_name}</span>
                      </OverflowText>
                    </div>
                    <div className="bitfun-git-file-history__commit-meta">
                      <span className="bitfun-git-file-history__commit-time">
                        {formatRelativeTime(entryTimeSeconds(entry))}
                      </span>
                      <span className="bitfun-git-file-history__commit-hash">
                        {t('fileHistory.turn', { turn: entry.turn_index + 1 })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </ScrollArea>
        )}
      </div>

      <div data-bitfun-component="file-history-view" data-bitfun-part="diff" className="bitfun-git-file-history__diff">
        {diffLoading ? (
          <div data-bitfun-component="file-history-view" data-bitfun-part="state" className="bitfun-git-file-history__state">
            {t('fileHistory.loading')}
          </div>
        ) : diffError ? (
          <div data-bitfun-component="file-history-view" data-bitfun-part="state" className="bitfun-git-file-history__state">
            <p>{t('fileHistory.localLoadFailedWithMessage', { error: diffError })}</p>
          </div>
        ) : diff ? (
          diff.originalContent === diff.modifiedContent ? (
            <div data-bitfun-component="file-history-view" data-bitfun-part="diffEmpty" className="bitfun-git-file-history__diff-empty">
              {t('fileHistory.localNoDiff')}
            </div>
          ) : (
            <InlineDiffPreview
              originalContent={diff.originalContent}
              modifiedContent={diff.modifiedContent}
              filePath={fullPath}
              className="bitfun-git-file-history__local-diff"
            />
          )
        ) : (
          <div data-bitfun-component="file-history-view" data-bitfun-part="diffEmpty" className="bitfun-git-file-history__diff-empty">
            {t('fileHistory.selectChange')}
          </div>
        )}
      </div>
    </>
  );
};

const FileHistoryView: React.FC<FileHistoryViewProps> = ({
  workspacePath = '',
  workspaceId,
  filePath,
  isActive = true,
}) => {
  const { t } = useTranslation('panels/git');
  const scope = useMemo<GitWorkspaceScope>(
    () => ({ workspaceId: workspaceId ?? '', repositoryPath: workspacePath }),
    [workspaceId, workspacePath],
  );
  const setActiveView = useGitSceneStore((s) => s.setActiveView);
  const [tab, setTab] = useState<'git' | 'local'>('git');
  const [localReloadKey, setLocalReloadKey] = useState(0);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!workspacePath || !filePath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await gitService.getFileHistory(scope, filePath);
      setCommits(result);
      setSelectedHash((prev) => (prev && result.some((c) => c.hash === prev) ? prev : result[0]?.hash ?? null));
    } catch (err) {
      log.error('Failed to load file history', { workspacePath, filePath, error: err });
      setError(describeGitTrustFailure(err) ?? (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, [scope, workspacePath, filePath]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const selectedCommit = useMemo(
    () => commits.find((c) => c.hash === selectedHash) ?? null,
    [commits, selectedHash]
  );

  const handleBack = useCallback(() => {
    setActiveView('working-copy');
  }, [setActiveView]);

  if (!isActive) {
    return (
      <div data-bitfun-component="file-history-view" data-bitfun-part="root" data-bitfun-view="hidden" aria-hidden="true" className="bitfun-git-file-history" />
    );
  }

  if (!workspacePath || !filePath) {
    return (
      <div data-bitfun-component="file-history-view" data-bitfun-part="root" data-bitfun-state="empty" className="bitfun-git-file-history">
        <div data-bitfun-component="file-history-view" data-bitfun-part="empty" className="bitfun-git-file-history__state">
          <FileCode2 size={40} aria-hidden />
          <p>{t('fileHistory.emptyPath')}</p>
        </div>
      </div>
    );
  }

  return (
    <div data-bitfun-component="file-history-view" data-bitfun-part="root" className="bitfun-git-file-history">
      <div data-bitfun-component="file-history-view" data-bitfun-part="header" className="bitfun-git-file-history__header">
        <div data-bitfun-component="file-history-view" data-bitfun-part="headerLeft" className="bitfun-git-file-history__header-left">
          <Tooltip content={t('fileHistory.back')}>
            <IconButton
              aria-label={t('fileHistory.back')}
              size="sm"
              onClick={handleBack}
              icon={<ArrowLeft size={14} />}
            />
          </Tooltip>
          <SegmentedControl
            className="bitfun-git-file-history__tabs"
            options={[
              { value: 'git', label: t('fileHistory.tabs.git') },
              { value: 'local', label: t('fileHistory.tabs.local') },
            ]}
            value={tab}
            onValueChange={(value) => setTab(value === 'local' ? 'local' : 'git')}
          />
          <OverflowText className="bitfun-git-file-history__path" title={filePath}>
            {filePath}
          </OverflowText>
        </div>
        <div data-bitfun-component="file-history-view" data-bitfun-part="headerRight" className="bitfun-git-file-history__header-right">
          <Tooltip content={t('fileHistory.refresh')}>
            <IconButton
              aria-label={t('fileHistory.refresh')}
              size="sm"
              onClick={() => {
                if (tab === 'local') {
                  setLocalReloadKey((key) => key + 1);
                } else {
                  void loadHistory();
                }
              }}
              icon={<Icon name="refresh" size="sm" />}
            />
          </Tooltip>
        </div>
      </div>

      <div data-bitfun-component="file-history-view" data-bitfun-part="main" className="bitfun-git-file-history__main">
        {tab === 'git' ? (
          <>
        <div data-bitfun-component="file-history-view" data-bitfun-part="commits" className="bitfun-git-file-history__commits">
          {loading ? (
            <div data-bitfun-component="file-history-view" data-bitfun-part="state" className="bitfun-git-file-history__state">
              {t('fileHistory.loading')}
            </div>
          ) : error ? (
            <div data-bitfun-component="file-history-view" data-bitfun-part="state" className="bitfun-git-file-history__state">
              <p>{t('fileHistory.loadFailedWithMessage', { error })}</p>
              <Button variant="outline" size="sm" onClick={() => void loadHistory()}>
                {t('fileHistory.retry')}
              </Button>
            </div>
          ) : commits.length === 0 ? (
            <div data-bitfun-component="file-history-view" data-bitfun-part="state" className="bitfun-git-file-history__state">
              {t('fileHistory.noCommits')}
            </div>
          ) : (
            <ScrollArea
              data-bitfun-component="file-history-view"
              data-bitfun-part="commitList"
              className="bitfun-git-file-history__commit-list"
            >
              {commits.map((commit, index) => {
                const isSelected = commit.hash === selectedHash;
                return (
                  <div
                    data-bitfun-component="file-history-view"
                    data-bitfun-part="commit"
                    data-bitfun-state={isSelected ? 'selected' : undefined}
                    key={commit.hash}
                    className={`bitfun-git-file-history__commit ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => setSelectedHash(commit.hash)}
                    title={commit.message}
                  >
                    <div data-bitfun-component="file-history-view" data-bitfun-part="timeline" className="bitfun-git-file-history__timeline">
                      <div className="bitfun-git-file-history__timeline-node" title={commit.author}>
                        {commit.author.charAt(0).toUpperCase()}
                      </div>
                      {index < commits.length - 1 && <div className="bitfun-git-file-history__timeline-line" />}
                    </div>
                    <div data-bitfun-component="file-history-view" data-bitfun-part="commitInfo" className="bitfun-git-file-history__commit-info">
                      <div className="bitfun-git-file-history__commit-message">
                        <OverflowText>{commit.message}</OverflowText>
                      </div>
                      <div className="bitfun-git-file-history__commit-meta">
                        <OverflowText className="bitfun-git-file-history__commit-author">{commit.author}</OverflowText>
                        <span className="bitfun-git-file-history__commit-time">
                          {formatRelativeTime(commit.date.getTime() / 1000)}
                        </span>
                        <span className="bitfun-git-file-history__commit-hash">{commit.shortHash}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </ScrollArea>
          )}
        </div>

        <div data-bitfun-component="file-history-view" data-bitfun-part="diff" className="bitfun-git-file-history__diff">
          {selectedCommit ? (
            selectedCommit.parents.length === 0 ? (
              <RootCommitContent scope={scope} filePath={filePath} commitHash={selectedCommit.hash} />
            ) : (
              <GitDiffView
                repositoryPath={scope}
                sourceCommit={selectedCommit.parents[0]}
                targetCommit={selectedCommit.hash}
                filePath={filePath}
              />
            )
          ) : (
            <div data-bitfun-component="file-history-view" data-bitfun-part="diffEmpty" className="bitfun-git-file-history__diff-empty">
              {t('fileHistory.selectCommit')}
            </div>
          )}
        </div>
          </>
        ) : (
          <FileLocalHistory key={localReloadKey} workspacePath={workspacePath} filePath={filePath} />
        )}
      </div>
    </div>
  );
};

export default FileHistoryView;
