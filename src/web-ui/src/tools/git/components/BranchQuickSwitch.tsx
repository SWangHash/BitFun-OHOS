import type { GitWorkspaceScope } from '@/infrastructure/api/service-api/GitAPI';
/** Searchable branch picker with non-destructive checkout and failure notifications. */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createOverlayPortal,
  Icon,
  Listbox,
  ListboxEmpty,
  ListboxOption,
  SearchField,
  useDismissibleLayer,
  usePresence,
} from '@bitfun/ui';
import { Loader2 } from 'lucide-react';

import { getAppearanceOverlayHost } from '@/infrastructure/appearance/runtime/AppearanceOverlayHost';
import { useI18n } from '@/infrastructure/i18n';
import { notificationService } from '@/shared/notification-system/services/NotificationService';
import { isImeOwnedKeyboardEvent } from '@/shared/utils/ime';
import { createLogger } from '@/shared/utils/logger';
import { useAnchoredPopoverPosition } from '@/shared/utils/useAnchoredPopoverPosition';
import { gitEventService, gitService } from '@/tools/git/services';
import { gitStateManager } from '@/tools/git/state/GitStateManager';
import type { GitBranch } from '@/tools/git/types/repository';
import { getBranchSwitchFailureMessage } from './branchSwitchFailure';
import { useStableGitWorkspaceScope } from '../hooks/useStableGitWorkspaceScope';
import './BranchQuickSwitch.scss';

const log = createLogger('BranchQuickSwitch');

export interface BranchQuickSwitchProps {
  id?: string;
  isOpen: boolean;
  onClose: () => void;
  repositoryPath: GitWorkspaceScope;
  currentBranch: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onSwitchSuccess?: (branchName: string) => void;
}

const branchListFromCache = (repositoryPath: GitWorkspaceScope): GitBranch[] | undefined => (
  gitStateManager.getState(repositoryPath)?.branches
);

export const BranchQuickSwitch: React.FC<BranchQuickSwitchProps> = ({
  id,
  isOpen,
  onClose,
  repositoryPath: workspaceReference,
  currentBranch,
  anchorRef,
  onSwitchSuccess,
}) => {
  const repositoryPath = useStableGitWorkspaceScope(workspaceReference);
  const { t } = useI18n('panels/git');
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputCompositionActive, setInputCompositionActive] = useState(false);
  const { present, state: phase } = usePresence(isOpen, 100);

  const inputRef = useRef<HTMLInputElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const switchInFlightRef = useRef(false);

  // The "current" marker comes from the shared branch (passed in by the
  // composer strip) rather than from the fetched list's own flag, so a switch
  // that happened elsewhere — or the optimistic write a manual switch performs
  // — moves the marker here at once. The fetched flag is only a fallback for
  // the moment before the shared state has ever been populated.
  const effectiveCurrentBranch = currentBranch || branches.find(b => b.current)?.name || null;
  const displayBranches = useMemo(
    () => branches.map(branch => (
      branch.current === (branch.name === effectiveCurrentBranch)
        ? branch
        : { ...branch, current: branch.name === effectiveCurrentBranch }
    )),
    [branches, effectiveCurrentBranch],
  );

  const filteredBranches = useMemo(() => {
    const lowerSearch = searchTerm.trim().toLowerCase();
    const filtered = lowerSearch
      ? displayBranches.filter(branch => branch.name.toLowerCase().includes(lowerSearch))
      : displayBranches;
    return [...filtered].sort((left, right) => {
      if (left.current) return -1;
      if (right.current) return 1;
      return left.name.localeCompare(right.name);
    });
  }, [displayBranches, searchTerm]);

  const popoverLayout = useAnchoredPopoverPosition({
    open: present,
    anchorRef,
    popoverRef: layerRef,
    preferredPlacement: 'top',
    alignment: 'start',
    gap: 7,
    layoutRevision: `${isLoading}:${loadFailed}:${filteredBranches.length}`,
  });

  const closePicker = useCallback((restoreFocus = true) => {
    const panel = panelRef.current;
    // Async checkout must not take focus back after the user left the picker.
    if (restoreFocus && panel?.contains(panel.ownerDocument.activeElement)) {
      anchorRef.current?.focus({ preventScroll: true });
    }
    onClose();
  }, [anchorRef, onClose]);

  useDismissibleLayer({
    enabled: isOpen,
    layerRef,
    branchRefs: [anchorRef],
    dismissOnEscape: !inputCompositionActive,
    onDismiss: reason => closePicker(reason !== 'pointer-outside'),
  });
  const focusReady = isOpen && present && Boolean(popoverLayout);
  useLayoutEffect(() => {
    if (focusReady) inputRef.current?.focus({ preventScroll: true });
  }, [focusReady]);

  const loadBranches = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const cachedBranches = branchListFromCache(repositoryPath);
      if (cachedBranches?.length) setBranches(cachedBranches);

      await gitStateManager.refresh(repositoryPath, {
        layers: ['detailed'],
        force: true,
        silent: true,
        reason: 'manual',
        source: 'branch_quick_switch',
      });
      const refreshedBranches = branchListFromCache(repositoryPath);
      if (refreshedBranches) {
        setBranches(refreshedBranches);
        return;
      }

      const serviceBranches = await gitService.getBranches(repositoryPath, false);
      setBranches(serviceBranches);
    } catch (error) {
      log.error('Failed to load branches', { repositoryPath, error });
      setLoadFailed(true);
      if (!branchListFromCache(repositoryPath)?.length) setBranches([]);
    } finally {
      setIsLoading(false);
    }
  }, [repositoryPath]);

  useEffect(() => {
    if (!present) {
      setSearchTerm('');
      setSelectedIndex(0);
      setInputCompositionActive(false);
    }
  }, [present]);

  useEffect(() => {
    if (!isOpen) return;
    void loadBranches();
  }, [isOpen, loadBranches]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredBranches.length, searchTerm]);

  useEffect(() => {
    const items = listRef.current?.querySelectorAll<HTMLElement>(
      '[data-bitfun-part="option"]',
    );
    const selectedItem = items?.[selectedIndex];
    if (typeof selectedItem?.scrollIntoView === 'function') {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }, [filteredBranches.length, selectedIndex]);

  const completeSwitch = useCallback((branchName: string) => {
    notificationService.success(
      t('quickSwitch.notifications.switchSuccess', { branch: branchName }),
      { duration: 3000 },
    );
    gitEventService.emit('branch:changed', {
      repositoryPath,
      branch: {
        name: branchName,
        current: true,
        remote: false,
        ahead: 0,
        behind: 0,
      },
      timestamp: new Date(),
    });
    onSwitchSuccess?.(branchName);
    closePicker();
  }, [closePicker, onSwitchSuccess, repositoryPath, t]);

  const showSwitchFailure = useCallback((targetBranch: string, error?: string) => {
    notificationService.error(getBranchSwitchFailureMessage(error, targetBranch, t), {
      title: t('quickSwitch.errors.title'),
      duration: 5000,
    });
  }, [t]);

  const handleSwitchBranch = useCallback(async (branchName: string) => {
    if (
      branchName === effectiveCurrentBranch
      || switchInFlightRef.current
    ) return;

    switchInFlightRef.current = true;
    setIsSwitching(true);
    setSwitchingBranch(branchName);
    try {
      const result = await gitService.checkoutBranch(repositoryPath, branchName);
      if (result.success) {
        completeSwitch(result.data?.branch ?? branchName);
      } else {
        showSwitchFailure(branchName, result.error);
      }
    } catch (error) {
      log.error('Failed to switch branch', { repositoryPath, branchName, error });
      notificationService.error(t('quickSwitch.errors.unexpected'), { duration: 5000 });
    } finally {
      switchInFlightRef.current = false;
      setIsSwitching(false);
      setSwitchingBranch(null);
    }
  }, [completeSwitch, effectiveCurrentBranch, repositoryPath, showSwitchFailure, t]);

  const handleListKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (
      (event.key === 'Enter' || event.key === 'Escape')
      && isImeOwnedKeyboardEvent(event, inputCompositionActive)
    ) {
      event.stopPropagation();
      return;
    }
    if (event.key === 'Tab') {
      // Resume the page's tab order at the trigger, outside the portal.
      closePicker();
      return;
    }
    if (filteredBranches.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex(current => Math.min(current + 1, filteredBranches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(current => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = filteredBranches[selectedIndex];
      if (selected && !selected.current) void handleSwitchBranch(selected.name);
    }
  }, [closePicker, filteredBranches, handleSwitchBranch, inputCompositionActive, selectedIndex]);

  const popover = present ? (
    <div
      id={id}
      ref={panelRef}
      className="branch-quick-switch"
      data-bitfun-product-component="branch-quick-switch"
      data-bitfun-product-part="root"
      data-testid="branch-quick-switch"
      data-motion="presence"
      role="dialog"
      aria-modal={false}
      aria-label={t('quickSwitch.menuLabel')}
      onKeyDown={handleListKeyDown}
    >
      <div
        className="branch-quick-switch__search"
        data-bitfun-product-component="branch-quick-switch"
        data-bitfun-product-part="search"
      >
        <SearchField
          ref={inputRef}
          className="branch-quick-switch__input-field"
          leadingIcon={<Icon name="search" size="sm" aria-hidden />}
          aria-label={t('quickSwitch.searchLabel')}
          placeholder={t('quickSwitch.searchPlaceholder')}
          value={searchTerm}
          onValueChange={setSearchTerm}
          onCompositionStart={() => setInputCompositionActive(true)}
          onCompositionEnd={() => setInputCompositionActive(false)}
          data-bitfun-product-component="branch-quick-switch"
          data-bitfun-product-part="input"
        />
      </div>
      <Listbox
        ref={listRef}
        aria-label={t('quickSwitch.menuLabel')}
        className="branch-quick-switch__list"
        focusMode="virtual"
      >
        {isLoading && branches.length === 0 ? (
          <ListboxEmpty
            className="branch-quick-switch__loading"
            data-bitfun-product-component="branch-quick-switch"
            data-bitfun-product-part="loading"
          >
            <Loader2 size={16} className="branch-quick-switch__spinner" aria-hidden />
            <span>{t('quickSwitch.loading')}</span>
          </ListboxEmpty>
        ) : loadFailed && branches.length === 0 ? (
          <ListboxEmpty
            className="branch-quick-switch__empty"
            data-bitfun-product-component="branch-quick-switch"
            data-bitfun-product-part="empty"
            aria-live="polite"
          >
            {t('quickSwitch.errors.loadFailed')}
          </ListboxEmpty>
        ) : filteredBranches.length === 0 ? (
          <ListboxEmpty
            className="branch-quick-switch__empty"
            data-bitfun-product-component="branch-quick-switch"
            data-bitfun-product-part="empty"
          >
            {searchTerm ? t('empty.noMatchingBranches') : t('empty.noBranches')}
          </ListboxEmpty>
        ) : (
          filteredBranches.map((branch, index) => (
            <ListboxOption
              active={index === selectedIndex}
              className="branch-quick-switch__item"
              data-index={index}
              data-bitfun-state={branch.current ? 'current' : undefined}
              data-testid="branch-quick-switch-option"
              disabled={isSwitching}
              indicator={switchingBranch === branch.name
                ? <Loader2 size={14} className="branch-quick-switch__spinner" aria-hidden />
                : undefined}
              key={branch.name}
              leading={<Icon name="git" size="sm" aria-hidden />}
              onClick={() => void handleSwitchBranch(branch.name)}
              selected={branch.current}
              value={branch.name}
            >
              {branch.name}
            </ListboxOption>
          ))
        )}
      </Listbox>
    </div>
  ) : null;

  return popover ? createOverlayPortal(
    <div
      ref={layerRef}
      className="branch-quick-switch__layer"
      data-bitfun-native-webview-occlusion
      data-bitfun-placement={popoverLayout?.placement ?? 'top'}
      data-state={phase}
      data-motion="presence"
      aria-hidden={!isOpen || undefined}
      {...(!isOpen ? { inert: '' } : {})}
      style={{
        top: popoverLayout?.bottom === undefined ? `${popoverLayout?.top ?? 0}px` : undefined,
        bottom: popoverLayout?.bottom === undefined ? undefined : `${popoverLayout.bottom}px`,
        left: `${popoverLayout?.left ?? 0}px`,
        visibility: popoverLayout ? 'visible' : 'hidden',
      }}
    >
      {popover}
    </div>,
    getAppearanceOverlayHost(),
  ) : null;
};

BranchQuickSwitch.displayName = 'BranchQuickSwitch';

export default BranchQuickSwitch;
