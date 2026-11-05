import { Play } from 'lucide-react';
import { Icon, IconButton, OverflowText, Tooltip } from '@bitfun/ui';
import { useI18n } from '@/infrastructure/i18n';
import type { MenuItem } from '@/shared/context-menu-system/types/menu.types';
import type { ShellEntry, UseShellEntriesReturn } from '../shell/hooks';
import { getShellEntryState } from '../shell/hooks/shellEntryTypes';
import { showResourceMenu } from './resourceMenus';

interface Props {
  terminals: UseShellEntriesReturn;
  busy: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  run: (action: () => void | Promise<unknown>) => void;
  onReveal: (path: string) => void;
  canReveal: (path: string) => boolean;
}

export default function WorkspaceTerminals({ terminals, busy, selectedId, onSelect, run, onReveal, canReveal }: Props) {
  const { t } = useI18n('common');
  const { entries, error, loading } = terminals;
  const statusLabels = {
    running: t('nav.resources.status.running'), saved: t('nav.resources.status.saved'),
    exited: t('nav.resources.status.exited'), unknown: t('nav.resources.status.unknown'),
    starting: t('nav.resources.status.starting'), stopping: t('nav.resources.status.stopping'), error: t('nav.resources.status.error'),
  };
  const open = (entry: ShellEntry) => {
    onSelect(entry.sessionId);
    if (entry.isRunning) run(() => terminals.openEntry(entry));
    else if (entry.isPersisted) run(() => terminals.openEditModal(entry));
    else run(() => terminals.openEntry(entry));
  };
  const menuItems = (entry: ShellEntry): MenuItem[] => {
    const cwd = entry.cwd ?? entry.workingDirectory;
    return [
      ...(entry.isRunning ? [{
        id: 'stop', label: t('nav.shell.context.stop'), icon: 'Square',
        disabled: busy || Boolean(error), onClick: () => run(() => terminals.stopEntry(entry)),
      }] : entry.source === 'manual' && ['saved', 'exited', 'error'].includes(getShellEntryState(entry)) ? [{
        id: 'start', label: t('nav.shell.context.start'), icon: 'Play',
        disabled: busy || Boolean(error),
        onClick: () => run(async () => { onSelect(await terminals.startEntry(entry)); }),
      }] : []),
      {
        id: 'configure', label: t(entry.isPersisted ? 'nav.shell.context.editConfig' : 'nav.shell.context.saveConfig'),
        icon: 'Settings', disabled: busy, onClick: () => run(() => terminals.openEditModal(entry)),
      },
      ...(cwd ? [{
        id: 'reveal-directory', label: t('nav.resources.revealDirectory'), icon: 'FolderOpen',
        disabled: busy || !canReveal(cwd), onClick: () => run(() => onReveal(cwd)),
      }] : []),
      {
        id: 'remove', label: t(entry.isPersisted ? 'nav.shell.context.deleteSavedTerminal' : 'nav.resources.removeTerminal'),
        icon: 'Trash2', disabled: busy || (!entry.isPersisted && entry.isRunning) || Boolean(error),
        onClick: () => run(() => terminals.deleteEntry(entry)),
      },
    ];
  };
  return (
    <div className="bitfun-file-viewer-nav__terminal-list" data-bitfun-component="file-viewer-nav" data-bitfun-part="terminalList" aria-busy={loading}>
      {entries.map(entry => {
        const cwd = entry.cwd ?? entry.workingDirectory;
        const state = error ? 'unknown' : getShellEntryState(entry);
        const status = statusLabels[state];
        const label = `${entry.name} · ${status}`;
        return (
          <div key={entry.id} className={`bitfun-file-viewer-nav__terminal-row${selectedId === entry.sessionId ? ' is-selected' : ''}`}
            data-bitfun-component="file-viewer-nav" data-bitfun-part="terminalRow"
            data-testid="workspace-terminal" data-session-id={entry.sessionId}
            onContextMenu={event => showResourceMenu(event, menuItems(entry), true)}>
            <button type="button" data-overflow-trigger className="bitfun-file-viewer-nav__terminal-open"
              data-bitfun-component="file-viewer-nav" data-bitfun-part="terminalOpen"
              aria-label={label} aria-pressed={selectedId === entry.sessionId} disabled={busy || Boolean(error) || state === 'unknown' || state === 'stopping'}
              onClick={() => open(entry)}>
              <Icon name="terminal" size="sm" />
              <span className="bitfun-file-viewer-nav__terminal-text">
                <OverflowText>{entry.name}</OverflowText>
                <span className="bitfun-file-viewer-nav__terminal-meta" data-bitfun-component="file-viewer-nav" data-bitfun-part="terminalMeta">
                  <span className="bitfun-file-viewer-nav__source">{t(entry.source === 'agent' ? 'nav.resources.agent' : 'nav.resources.manual')}</span>
                  {cwd && <OverflowText title={cwd}>{cwd}</OverflowText>}
                </span>
              </span>
              <span className="bitfun-file-viewer-nav__status" data-status={state}
                data-bitfun-component="file-viewer-nav" data-bitfun-part="status">{status}</span>
            </button>
            <div className="bitfun-file-viewer-nav__terminal-actions" data-bitfun-component="file-viewer-nav" data-bitfun-part="terminalActions">
              {entry.isPersisted && ['saved', 'exited', 'error'].includes(state) && (
                <Tooltip content={t('nav.shell.context.start')}>
                  <IconButton size="xs" aria-label={t('nav.shell.context.start')} icon={<Play size={12} />}
                    disabled={busy || Boolean(error)}
                    onClick={() => run(async () => { onSelect(await terminals.startEntry(entry)); })} />
                </Tooltip>
              )}
              <IconButton size="xs" aria-label={t('nav.resources.terminalActions')} icon={<Icon name="more" size="xs" />}
                aria-haspopup="menu" onClick={event => showResourceMenu(event, menuItems(entry))} />
            </div>
          </div>
        );
      })}
      {!loading && entries.length === 0 && !error && (
        <p className="bitfun-file-viewer-nav__empty" data-bitfun-component="file-viewer-nav" data-bitfun-part="empty">{t('nav.resources.noTerminals')}</p>
      )}
    </div>
  );
}
