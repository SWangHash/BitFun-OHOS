import { lazyWithRecovery } from '@/shared/utils/lazyWithRecovery';
import React, { Suspense, useState, useCallback, useEffect, useRef } from 'react';

import { createOverlayPortal,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  type MenuItemProps,
  Tooltip,
  Dialog,
  DialogClose,
  DialogHeader,
  DialogHeading,
  DialogTitle,
} from '@bitfun/ui';
import { RetainedMountBoundary } from '@/shared/presence';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { useSceneStore } from '../../../stores/sceneStore';
import { activateProductAction } from '@/app/global-search/productActionActivator';
import { useToolbarModeContext } from '@/flow_chat/components/toolbar-mode/ToolbarModeContext';
import { systemAPI } from '@/infrastructure/api';
import { remoteConnectAPI } from '@/infrastructure/api/service-api/RemoteConnectAPI';
import NotificationButton from '../../TitleBar/NotificationButton';
import { RemoteConnectDisclaimer } from '../../RemoteConnectDialog/RemoteConnectDisclaimer';
import { usePrivacy } from '../../Privacy/PrivacyContext';
import {
  needsFeedbackInboxAttention,
  useFeedbackInboxStore,
} from '../../FeedbackDialog/feedbackInboxStore';
import {
  getRemoteConnectDisclaimerAgreed,
  setRemoteConnectDisclaimerAgreed,
} from '../../RemoteConnectDialog/remoteConnectDisclaimerStorage';
import { requestBrowserNavigation } from '@/app/scenes/browser/browserNavigation';
import { getAppearanceOverlayHost } from '@/infrastructure/appearance/runtime/AppearanceOverlayHost';
import { useAnchoredPopoverPosition } from '@/shared/utils/useAnchoredPopoverPosition';
import { useSettingsStore } from '@/app/scenes/settings/settingsStore';
import { PeerConnectionStatus } from '@/infrastructure/peer-device/PeerConnectionStatus';
import DeviceStatusControl from './DeviceStatusControl';
import AppearanceQuickSwitchMenuItem from './AppearanceQuickSwitchMenuItem';
import { UpdateIndicator } from '@/infrastructure/update/UpdateIndicator';
import { useHasAppUpdate } from '@/infrastructure/update/useHasAppUpdate';
import { UpdateDownloadIndicator } from '@/infrastructure/update/UpdateDownloadIndicator';
import { UpdateMenuItems } from '@/infrastructure/update/UpdateMenuItems';
import { useUpdateInstallStore } from '@/infrastructure/update/updateInstallStore';
import { notificationService } from '@/shared/notification-system';

const RemoteConnectDialog = lazyWithRecovery(() => import('../../RemoteConnectDialog'));
const FeedbackDialog = lazyWithRecovery(() => import('../../FeedbackDialog'));
const PrivacyStatementDialog = lazyWithRecovery(() => import('../../Privacy/PrivacyStatementDialog').then(
  module => ({ default: module.PrivacyStatementDialog }),
));
const CHANGELOG_URL = 'https://www.bitfun.work/Changelog.html';
const USER_GUIDE_URL = 'https://www.bitfun.work/docs.html';
const USER_AGREEMENT_URL = 'https://agreement-drcn.hispace.dbankcloud.cn/index.html?lang=zh&agreementId=1959693293117791424';

const HelpMenuEntry = React.forwardRef<HTMLButtonElement, MenuItemProps & { 'data-menu-id'?: string }>(
  function HelpMenuEntry(props, ref) {
    const { t } = useI18n('common');
    return (
      <MenuItem
        {...props}
        ref={ref}
        data-testid={props['data-menu-id']}
        aria-label={props.shortcut && props['data-menu-id'] === 'nav-footer-feedback-item'
          ? t('feedback.inbox.entryAttention')
          : props.shortcut && props['data-menu-id'] === 'nav-footer-privacy-item'
            ? t('privacy.entryUpdated')
            : props['aria-label']}
      />
    );
  },
);

const HELP_MENU_PARTS = { item: HelpMenuEntry };

const PersistentFooterActions: React.FC = () => {
  const { t } = useI18n('common');
  const activeTabId = useSceneStore((s) => s.activeTabId);
  const { enableToolbarMode } = useToolbarModeContext();
  const { status: privacyStatus } = usePrivacy();
  const initializeFeedbackForMode = useFeedbackInboxStore(state => state.initializeForMode);
  const hasFeedbackAttention = useFeedbackInboxStore(state =>
    state.records.some(needsFeedbackInboxAttention),
  );
  const hasPrivacyUpdate = Boolean(
    privacyStatus?.enabled && privacyStatus.hasUnreadUpdate,
  );
  const hasMoreMenuAttention = hasFeedbackAttention || hasPrivacyUpdate;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [appearanceSubmenuOpen, setAppearanceSubmenuOpen] = useState(false);
  const [helpSubmenuOpen, setHelpSubmenuOpen] = useState(false);
  const [deviceOverviewOpen, setDeviceOverviewOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuPopoverRef = useRef<HTMLDivElement>(null);
  const helpMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuLayout = useAnchoredPopoverPosition({
    open: menuOpen,
    anchorRef: menuTriggerRef,
    popoverRef: menuPopoverRef,
    preferredPlacement: 'top',
    alignment: 'end',
    gap: 6,
  });
  const hasAppUpdate = useHasAppUpdate();
  const updateVersion = useUpdateInstallStore(state => state.downloadVersion ?? state.availableUpdate?.latestVersion);
  const [showFeedback, setShowFeedback] = useState(false);
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  const [showRemoteConnect, setShowRemoteConnect] = useState(false);
  const [remoteInitialGroup, setRemoteInitialGroup] = useState<'network' | 'bot' | 'account' | undefined>(undefined);
  const [showRemoteDisclaimer, setShowRemoteDisclaimer] = useState(false);
  const [feedbackPlatformEnabled, setFeedbackPlatformEnabled] = useState<boolean | null>(null);
  const [hasAgreedRemoteDisclaimer, setHasAgreedRemoteDisclaimer] = useState<boolean>(
    () => getRemoteConnectDisclaimerAgreed(),
  );

  // Periodic token-expiry check. Only auto-open the dialog if the token has
  // actually expired while the app is running — not on startup. Lands on the
  // account group so the user can sign in again right away.
  useEffect(() => {
    const expiryCheck = setInterval(() => {
      remoteConnectAPI.accountTokenExpired().then((expired) => {
        if (expired) {
          setRemoteInitialGroup('account');
          setShowRemoteConnect(true);
        }
      });
    }, 60000);
    return () => clearInterval(expiryCheck);
  }, []);

  useEffect(() => {
    let active = true;
    void systemAPI.getSystemInfo().then(systemInfo => {
      if (active) setFeedbackPlatformEnabled(systemInfo.platform === 'openharmony');
    }).catch(() => {
      if (active) setFeedbackPlatformEnabled(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!feedbackPlatformEnabled || !privacyStatus) return;
    void initializeFeedbackForMode(privacyStatus.effectiveMode);
  }, [feedbackPlatformEnabled, initializeFeedbackForMode, privacyStatus]);

  const closeMenu = useCallback(() => {
    setAppearanceSubmenuOpen(false);
    setHelpSubmenuOpen(false);
    setMenuClosing(true);
    setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
    }, 150);
  }, []);

  const toggleMenu = () => {
    if (menuOpen) {
      closeMenu();
    } else {
      setDeviceOverviewOpen(false);
      setAppearanceSubmenuOpen(false);
      setHelpSubmenuOpen(false);
      setMenuOpen(true);
    }
  };

  const handleDeviceOverviewOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen && menuOpen) {
      closeMenu();
    }
    // The dialog grows out of the card: have its code ready before it is asked for.
    if (nextOpen) void import('../../RemoteConnectDialog');
    setDeviceOverviewOpen(nextOpen);
  }, [closeMenu, menuOpen]);

  const handleOpenSettings = useCallback(() => {
    closeMenu();
    void activateProductAction('settings.open');
  }, [closeMenu]);

  const handleOpenAppearanceSettings = useCallback(() => {
    closeMenu();
    useSettingsStore.getState().openPage('application.appearance');
    void activateProductAction('settings.open');
  }, [closeMenu]);

  const handleShowAbout = () => {
    closeMenu();
    window.dispatchEvent(new Event('nav:show-about'));
  };

  const handleFeedback = useCallback(async () => {
    closeMenu();
    if (feedbackPlatformEnabled) {
      setShowFeedback(true);
      return;
    }
    try {
      const systemInfo = await systemAPI.getSystemInfo();
      if (systemInfo.platform === 'openharmony') {
        setFeedbackPlatformEnabled(true);
        setShowFeedback(true);
        return;
      }
    } catch {
      // Web and older desktop hosts retain the external feedback behavior.
    }

    const account = accountIdentity.status === 'signed-in' ? accountIdentity.me?.user : undefined;
    const url = buildPublicFeedbackFormUrl(import.meta.env.VITE_BITFUN_FEEDBACK_FORM_URL, {
      uid: account?.accountId ?? account?.githubId,
      version: getVersionInfo().version,
      deviceInfo: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    });
    if (!url) {
      void systemAPI.openExternal('https://gitcode.com/OpenBitFun/bitfun_ade/issues').catch(() => {
        notificationService.error(t('nav.settingsMenu.feedbackOpenFailed'));
      });
      return;
    }
    void systemAPI.openExternal(url).catch(() => {
      notificationService.error(t('nav.settingsMenu.feedbackOpenFailed'));
    });
  }, [accountIdentity.me, accountIdentity.status, closeMenu, feedbackPlatformEnabled, t]);

  const handleOpenHelpPage = useCallback((url: string, title: string) => {
    closeMenu();
    if (activeTabId === 'session' || activeTabId?.startsWith('session:')) {
      window.dispatchEvent(new CustomEvent('agent-create-tab', {
        detail: {
          type: 'browser',
          title,
          data: { url },
          checkDuplicate: true,
          duplicateCheckKey: `browser-panel:${url}`,
          replaceExisting: false,
        },
      }));
      return;
    }

    useSceneStore.getState().openScene('browser');
    requestBrowserNavigation(url);
  }, [activeTabId, closeMenu]);

  const openPrivacyStatement = useCallback(() => {
    closeMenu();
    if (privacyStatus?.enabled && privacyStatus.policy) {
      setPrivacyDialogOpen(true);
      return;
    }
    void systemAPI.openExternal(USER_AGREEMENT_URL).catch(() => {
      notificationService.error(t('nav.customization.openFailed', { name: t('about.userAgreement') }));
    });
  }, [closeMenu, privacyStatus, t]);

  const closeAfterPrivacyModeChange = useCallback(() => {
    setPrivacyDialogOpen(false);
  }, []);

  const handleFloatingMode = () => {
    closeMenu();
    enableToolbarMode();
  };

  const handleRemoteConnect = useCallback((group?: 'account') => {
    setRemoteInitialGroup(group);
    if (hasAgreedRemoteDisclaimer || getRemoteConnectDisclaimerAgreed()) {
      setHasAgreedRemoteDisclaimer(true);
      setShowRemoteConnect(true);
      return;
    }

    setShowRemoteDisclaimer(true);
  }, [hasAgreedRemoteDisclaimer]);

  useEffect(() => {
    const handlePlaybookOpen = (event: Event) => {
      const requestedGroup = (event as CustomEvent<{ group?: 'network' | 'bot' | 'account' }>).detail?.group;
      setRemoteInitialGroup(requestedGroup);
      if (hasAgreedRemoteDisclaimer || getRemoteConnectDisclaimerAgreed()) {
        setHasAgreedRemoteDisclaimer(true);
        setShowRemoteConnect(true);
      } else {
        setShowRemoteDisclaimer(true);
      }
    };
    window.addEventListener('bitfun:open-remote-connect', handlePlaybookOpen);
    return () => window.removeEventListener('bitfun:open-remote-connect', handlePlaybookOpen);
  }, [hasAgreedRemoteDisclaimer]);

  const handleAgreeDisclaimer = useCallback(() => {
    setRemoteConnectDisclaimerAgreed();
    setHasAgreedRemoteDisclaimer(true);
    setShowRemoteDisclaimer(false);
    setShowRemoteConnect(true);
  }, []);

  const isSettingsActive = activeTabId === 'settings';

  return (
    <>
      <PeerConnectionStatus />
      <div className="bitfun-nav-panel__footer" data-bitfun-component="nav-panel" data-bitfun-part="footer">
        <div className="bitfun-nav-panel__footer-left">
          <DeviceStatusControl
            open={deviceOverviewOpen}
            onOpenChange={handleDeviceOverviewOpenChange}
            onManageDevices={handleRemoteConnect}
          />
        </div>

        <div className="bitfun-nav-panel__footer-right">
          <UpdateDownloadIndicator />
          <div className="bitfun-nav-panel__footer-menu-wrap">
            <Tooltip
              content={hasAppUpdate ? t('update.availableVersion', { version: updateVersion }) : t('actions.more')}
              placement="right"
              followCursor
              disabled={menuOpen}
            >
              <IconButton
                ref={menuTriggerRef}
                className={`bitfun-nav-panel__footer-btn bitfun-nav-panel__footer-btn--icon${menuOpen || isSettingsActive ? ' is-active' : ''}${hasMoreMenuAttention ? ' has-attention' : ''}`}
                aria-label={hasAppUpdate
                  ? t('update.moreAttention')
                  : hasMoreMenuAttention
                    ? t('header.moreOptionsAttention')
                    : t('actions.more')}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-pressed={isSettingsActive}
                onClick={toggleMenu}
                data-testid="nav-footer-settings-item"
                data-bitfun-component="nav-panel"
                data-bitfun-part="settingsEntry"
                data-bitfun-state={menuOpen ? 'open' : isSettingsActive ? 'active' : undefined}
                icon={(
                  <span className="bitfun-nav-panel__footer-settings-icon bitfun-update-indicator-anchor">
                    <Icon name="gear" size="sm" aria-hidden="true" />
                    {hasMoreMenuAttention ? (
                      <span className="bitfun-nav-panel__footer-more-unread" />
                    ) : null}
                    <UpdateIndicator />
                  </span>
                )}
                size="sm"
                variant="quiet"
              />
            </Tooltip>

            {menuOpen && createOverlayPortal(
              <>
                <div
                  className="bitfun-nav-panel__footer-backdrop"
                  onClick={closeMenu}
                />
                <Menu
                  ref={menuPopoverRef}
                  className={`bitfun-nav-panel__footer-menu${menuClosing ? ' is-closing' : ''}`}
                  inlineSize="content"
                  aria-label={t('actions.more')}
                  data-testid="nav-settings-menu"
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    if (appearanceSubmenuOpen) {
                      setAppearanceSubmenuOpen(false);
                    } else if (helpSubmenuOpen) {
                      setHelpSubmenuOpen(false);
                    } else {
                      closeMenu();
                      menuTriggerRef.current?.focus();
                    }
                  }}
                  style={{
                    top: `${menuLayout?.top ?? 0}px`,
                    left: `${menuLayout?.left ?? 0}px`,
                    visibility: menuLayout ? 'visible' : 'hidden',
                  }}
                >
                  <MenuItem
                    leading={<Icon name="floating-window" size="sm" aria-hidden="true" />}
                    onClick={handleFloatingMode}
                    data-testid="nav-settings-floating-item"
                  >
                    {t('nav.settingsMenu.floatingWindow')}
                  </MenuItem>
                  <NotificationButton menuItem onActivate={closeMenu} />
                  <AppearanceQuickSwitchMenuItem
                    open={appearanceSubmenuOpen}
                    onOpenChange={(open) => {
                      setHelpSubmenuOpen(false);
                      setAppearanceSubmenuOpen(open);
                    }}
                    onCloseParentMenu={closeMenu}
                    onOpenAppearanceSettings={handleOpenAppearanceSettings}
                  />
                  <MenuSeparator />
                  <UpdateMenuItems onCloseMenu={closeMenu} />
                  <MenuItem
                    ref={helpMenuTriggerRef}
                    leading={<Icon name="message-circle-question" size="sm" aria-hidden="true" />}
                    metadata={hasPrivacyUpdate ? t('privacy.updated') : hasFeedbackAttention ? (
                      <span className="bitfun-nav-panel__footer-menu-unread" aria-hidden="true" />
                    ) : undefined}
                    shortcut={<Icon name="chevron-right" size="sm" aria-hidden="true" />}
                    aria-haspopup="menu"
                    aria-expanded={helpSubmenuOpen}
                    aria-label={hasMoreMenuAttention ? t('nav.settingsMenu.helpAttention') : undefined}
                    onClick={() => {
                      setAppearanceSubmenuOpen(false);
                      setHelpSubmenuOpen(open => !open);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowRight') return;
                      event.preventDefault();
                      event.stopPropagation();
                      setAppearanceSubmenuOpen(false);
                      setHelpSubmenuOpen(true);
                    }}
                    data-testid="nav-settings-help-item"
                  >
                    {t('nav.settingsMenu.help')}
                  </MenuItem>
                  <MenuPopover
                    open={helpSubmenuOpen}
                    onClose={() => setHelpSubmenuOpen(false)}
                    anchorRef={helpMenuTriggerRef}
                    placement="right"
                    inlineSize="content"
                    aria-label={t('nav.settingsMenu.help')}
                    data-testid="nav-settings-help-menu"
                    parts={HELP_MENU_PARTS}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'Escape') return;
                      event.preventDefault();
                      event.stopPropagation();
                      setHelpSubmenuOpen(false);
                      helpMenuTriggerRef.current?.focus();
                    }}
                    items={[
                      {
                        id: 'nav-footer-user-guide-item',
                        label: t('nav.settingsMenu.userGuide'),
                        icon: <Icon name="book-open" size="sm" aria-hidden="true" />,
                        onSelect: () => handleOpenHelpPage(USER_GUIDE_URL, t('nav.settingsMenu.userGuide')),
                      },
                      {
                        id: 'nav-footer-changelog-item',
                        label: t('header.changelog'),
                        icon: <Icon name="files" size="sm" aria-hidden="true" />,
                        onSelect: () => handleOpenHelpPage(CHANGELOG_URL, t('header.changelog')),
                      },
                      {
                        id: 'nav-footer-feedback-item',
                        label: t('header.feedback'),
                        icon: <Icon name="waitlist-message" size="sm" aria-hidden="true" />,
                        shortcut: hasFeedbackAttention
                          ? <span className="bitfun-nav-panel__footer-menu-unread" aria-hidden="true" />
                          : undefined,
                        onSelect: () => void handleFeedback(),
                      },
                      {
                        id: 'nav-footer-privacy-item',
                        label: privacyStatus?.enabled ? t('about.privacyStatement') : t('about.userAgreement'),
                        icon: <Icon name="eye" size="sm" aria-hidden="true" />,
                        shortcut: hasPrivacyUpdate ? t('privacy.updated') : undefined,
                        onSelect: openPrivacyStatement,
                      },
                    ]}
                  />
                  <MenuSeparator />
                  <MenuItem
                    leading={<Icon name="gear" size="sm" aria-hidden="true" />}
                    onClick={handleOpenSettings}
                    data-testid="nav-settings-open-item"
                  >
                    {t('nav.settingsMenu.openSettings')}
                  </MenuItem>
                  <MenuItem
                    leading={<Icon name="info" size="sm" aria-hidden="true" />}
                    onClick={handleShowAbout}
                    data-testid="nav-settings-about-item"
                  >
                    {t('nav.settingsMenu.about')}
                  </MenuItem>
                </Menu>
              </>,
              getAppearanceOverlayHost(),
              null,
              { open: !menuClosing, ownerRef: menuTriggerRef, surfaceRef: menuPopoverRef, onDismiss: closeMenu },
            )}
          </div>
        </div>
      </div>
      <RetainedMountBoundary present={showFeedback}>
        <Suspense fallback={null}>
          <FeedbackDialog isOpen={showFeedback} onClose={() => setShowFeedback(false)} />
        </Suspense>
      </RetainedMountBoundary>
      <RetainedMountBoundary present={showRemoteConnect}>
        <Suspense fallback={null}>
          <RemoteConnectDialog
            isOpen={showRemoteConnect}
            onClose={() => setShowRemoteConnect(false)}
            initialGroup={remoteInitialGroup}
          />
        </Suspense>
      </RetainedMountBoundary>
      <RetainedMountBoundary present={privacyDialogOpen}>
        <Suspense fallback={null}>
          <PrivacyStatementDialog
            isOpen={privacyDialogOpen}
            onClose={() => setPrivacyDialogOpen(false)}
            onModeChangeComplete={closeAfterPrivacyModeChange}
          />
        </Suspense>
      </RetainedMountBoundary>
      <Dialog
        open={showRemoteDisclaimer}
        onOpenChange={(nextOpen) => { if (!nextOpen) setShowRemoteDisclaimer(false); }}
        size="lg"
      >
        <DialogHeader>
          <DialogHeading>
            <DialogTitle>{t('remoteConnect.disclaimerTitle')}</DialogTitle>
          </DialogHeading>
          <DialogClose />
        </DialogHeader>
        <RemoteConnectDisclaimer
          agreed={hasAgreedRemoteDisclaimer}
          onClose={() => setShowRemoteDisclaimer(false)}
          onAgree={handleAgreeDisclaimer}
        />
      </Dialog>
    </>
  );
};

export default PersistentFooterActions;
