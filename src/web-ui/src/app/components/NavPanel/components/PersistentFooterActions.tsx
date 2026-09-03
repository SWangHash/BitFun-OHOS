import React, { lazy, Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  PictureInPicture2,
  SquareTerminal,
  Terminal,
  Smartphone,
  Globe,
  ExternalLink,
  BarChart3,
  ChevronUp,
  MessageSquare,
} from 'lucide-react';
import {
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Tooltip,
  Dialog,
  DialogBody,
  DialogClose,
  DialogHeader,
  DialogHeading,
  DialogTitle,
} from '@bitfun/ui';
import { RetainedMountBoundary } from '@/shared/presence';
import { Tooltip, Modal, PresenceBoundary } from '@/component-library';
import { systemAPI } from '@/infrastructure/api';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { useSceneStore } from '../../../stores/sceneStore';
import { activateProductAction } from '@/app/global-search/productActionActivator';
import { useToolbarModeContext } from '@/flow_chat/components/toolbar-mode/ToolbarModeContext';
import { useNotification } from '@/shared/notification-system';
import { remoteConnectAPI } from '@/infrastructure/api/service-api/RemoteConnectAPI';
import { useAccountLoginState } from '@/infrastructure/account/useAccountLoginState';
import NotificationButton from '../../TitleBar/NotificationButton';
import { RemoteConnectDisclaimerContent } from '../../RemoteConnectDialog/RemoteConnectDisclaimer';
import { usePrivacy } from '../../Privacy/PrivacyContext';
import {
  hasActionableUnreadReply,
  useFeedbackInboxStore,
} from '../../FeedbackDialog/feedbackInboxStore';
import {
  RemoteConnectDisclaimerContent,
} from '../../RemoteConnectDialog/RemoteConnectDisclaimer';
import {
  getRemoteConnectDisclaimerAgreed,
  setRemoteConnectDisclaimerAgreed,
} from '../../RemoteConnectDialog/remoteConnectDisclaimerStorage';
import { getAppearanceOverlayHost } from '@/infrastructure/appearance/runtime/AppearanceOverlayHost';
import { useAnchoredPopoverPosition } from '@/shared/utils/useAnchoredPopoverPosition';
import { useSettingsStore } from '@/app/scenes/settings/settingsStore';
import DeviceStatusControl from './DeviceStatusControl';
import AppearanceQuickSwitchMenuItem from './AppearanceQuickSwitchMenuItem';

const RemoteConnectDialog = lazy(() => import('../../RemoteConnectDialog'));
const AboutDialog = lazy(() =>
  import('../../AboutDialog').then(module => ({ default: module.AboutDialog }))
);
const FeedbackDialog = lazy(() => import('../../FeedbackDialog'));

const PersistentFooterActions: React.FC = () => {
  const { t } = useI18n('common');
  const activeTabId = useSceneStore((s) => s.activeTabId);
  const { enableToolbarMode } = useToolbarModeContext();
  const { warning } = useNotification();
  const { loggedIn: accountLoggedIn, deviceName: accountDeviceName } = useAccountLoginState();
  const { status: privacyStatus } = usePrivacy();
  const initializeFeedbackForMode = useFeedbackInboxStore(state => state.initializeForMode);
  const hasUnreadFeedback = useFeedbackInboxStore(state =>
    state.records.some(hasActionableUnreadReply),
  );
  const hasPrivacyUpdate = Boolean(
    privacyStatus?.enabled && privacyStatus.hasUnreadUpdate,
  );
  const hasMoreMenuAttention = hasUnreadFeedback || hasPrivacyUpdate;

  useEffect(() => {
    const onAutoExit = (event: Event) => {
      const detail = (event as CustomEvent<{ deviceName?: string; reason?: string }>).detail;
      const name = detail?.deviceName || 'peer';
      if (detail?.reason === 'peer_offline') {
        warning(t('accountLogin.peerAutoExitOffline', { name }));
      } else if (detail?.reason === 'rpc_failures') {
        warning(t('accountLogin.peerAutoExitRpc', { name }));
      }
    };
    window.addEventListener('peer-mode:auto-exit', onAutoExit);
    return () => window.removeEventListener('peer-mode:auto-exit', onAutoExit);
  }, [t, warning]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [appearanceSubmenuOpen, setAppearanceSubmenuOpen] = useState(false);
  const [deviceOverviewOpen, setDeviceOverviewOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuPopoverRef = useRef<HTMLDivElement>(null);
  const menuLayout = useAnchoredPopoverPosition({
    open: menuOpen,
    anchorRef: menuTriggerRef,
    popoverRef: menuPopoverRef,
    preferredPlacement: 'top',
    alignment: 'end',
    gap: 6,
  });
  const [showAbout, setShowAbout] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  // const [showAccountLogin, setShowAccountLogin] = useState(false);
  const [showRemoteConnect, setShowRemoteConnect] = useState(false);
  const [remoteInitialGroup, setRemoteInitialGroup] = useState<'network' | 'bot' | 'account' | undefined>(undefined);
  const [showRemoteDisclaimer, setShowRemoteDisclaimer] = useState(false);
  const [feedbackPlatformEnabled, setFeedbackPlatformEnabled] = useState<boolean | null>(null);
  const [hasAgreedRemoteDisclaimer, setHasAgreedRemoteDisclaimer] = useState<boolean>(() => getRemoteConnectDisclaimerAgreed());
  const [hasAgreedRemoteDisclaimer, setHasAgreedRemoteDisclaimer] = useState<boolean>(
    () => getRemoteConnectDisclaimerAgreed(),
  );

  useEffect(() => {
    let active = true;
    void systemAPI.getSystemInfo().then(info => {
      if (active) setFeedbackPlatformEnabled(info.platform === 'openharmony');
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

  // Account login retirement: do not reopen the disabled login dialog when a
  // stored account token expires.

  const closeMenu = useCallback(() => {
    setAppearanceSubmenuOpen(false);
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
      setMenuOpen(true);
    }
  };

  const handleDeviceOverviewOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen && menuOpen) {
      closeMenu();
    }
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
    setShowAbout(true);
  };

  const handleFloatingMode = useCallback(() => {
    closeMenu();
    void enableToolbarMode();
  }, [closeMenu, enableToolbarMode]);

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
    await systemAPI.openExternal('https://gitcode.com/OpenBitFun/bitfun_ade/issues');
  }, [closeMenu, feedbackPlatformEnabled]);

  // const handleAccountLogin = () => {
  //   closeMenu();
  //   setShowAccountLogin(true);
  // };

  const handleRemoteConnect = useCallback(() => {
    if (hasAgreedRemoteDisclaimer || getRemoteConnectDisclaimerAgreed()) {
      setHasAgreedRemoteDisclaimer(true);
      setRemoteInitialGroup(undefined);
      setShowRemoteConnect(true);
      return;
    }

    setRemoteInitialGroup(undefined);
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
      <div className="bitfun-nav-panel__footer" data-bf-component="nav-panel" data-bf-part="footer">
        <div className="bitfun-nav-panel__footer-left">
          <DeviceStatusControl
            open={deviceOverviewOpen}
            onOpenChange={handleDeviceOverviewOpenChange}
            onManageDevices={handleRemoteConnect}
          />
        </div>

        <div className="bitfun-nav-panel__footer-right">
          <div className="bitfun-nav-panel__footer-menu-wrap">
            <Tooltip
              content={t('shared:features.settings')}
              placement="right"
              followCursor
              disabled={menuOpen}
            >
              <IconButton
                ref={menuTriggerRef}
                className={`bitfun-nav-panel__footer-btn bitfun-nav-panel__footer-btn--icon${menuOpen || isSettingsActive ? ' is-active' : ''}`}
                aria-label={t('shared:features.settings')}
                type="button"
                className={`bitfun-nav-panel__footer-btn bitfun-nav-panel__footer-btn--icon bitfun-nav-panel__footer-more-btn${menuOpen ? ' is-active' : ''}`}
                aria-label={hasMoreMenuAttention
                  ? t('header.moreOptionsAttention')
                  : t('nav.moreOptions')}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-pressed={isSettingsActive}
                onClick={toggleMenu}
                data-testid="nav-footer-settings-item"
                data-bf-component="nav-panel"
                data-bf-part="settingsEntry"
                data-bf-state={menuOpen ? 'open' : isSettingsActive ? 'active' : undefined}
                icon={<Icon name="gear" size="sm" aria-hidden="true" />}
                size="sm"
                variant="quiet"
              />
                data-bf-part="footerButton"
                data-bf-state={menuOpen ? 'active' : undefined}
              >
                {menuOpen ? (
                  <MoreVertical size={15} aria-hidden="true" />
                ) : (
                  <span className="bitfun-nav-panel__footer-btn-icon-swap" aria-hidden="true">
                    <MoreVertical size={15} className="bitfun-nav-panel__footer-btn-icon-swap-default" />
                    <ChevronUp size={15} className="bitfun-nav-panel__footer-btn-icon-swap-hover" />
                  </span>
                )}
                {hasMoreMenuAttention ? (
                  <span className="bitfun-nav-panel__footer-more-unread" aria-hidden="true" />
                ) : null}
              </button>
            </Tooltip>

            {menuOpen && createPortal(
              <>
                <div
                  className="bitfun-nav-panel__footer-backdrop"
                  onClick={closeMenu}
                />
                <Menu
                  ref={menuPopoverRef}
                  className={`bitfun-nav-panel__footer-menu${menuClosing ? ' is-closing' : ''}`}
                  aria-label={t('shared:features.settings')}
                  data-testid="nav-settings-menu"
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    if (appearanceSubmenuOpen) {
                      setAppearanceSubmenuOpen(false);
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
                    leading={<PictureInPicture2 size={14} aria-hidden="true" />}
                    onClick={handleFloatingMode}
                    data-testid="nav-settings-floating-item"
                  >
                    {t('nav.settingsMenu.floatingWindow')}
                  </MenuItem>
                  <NotificationButton menuItem onActivate={closeMenu} />
                  <AppearanceQuickSwitchMenuItem
                    open={appearanceSubmenuOpen}
                    onOpenChange={setAppearanceSubmenuOpen}
                    onCloseParentMenu={closeMenu}
                    onOpenAppearanceSettings={handleOpenAppearanceSettings}
                  />
                  <MenuSeparator />
                  <MenuItem
                    leading={<Icon name="settings" size="sm" aria-hidden="true" />}
                    onClick={handleOpenSettings}
                    data-testid="nav-settings-open-item"
                  >
                    {t('nav.settingsMenu.openSettings')}
                  </MenuItem>
                  <MenuItem
                    leading={<Icon name="info" size="sm" aria-hidden="true" />}
                    onClick={handleShowAbout}
                    data-testid="nav-settings-about-item"
                    <Settings size={14} />
                    <span>{t('shared:features.settings')}</span>
                  </button>
                  <button
                    type="button"
                    className="bitfun-nav-panel__footer-menu-item"
                    role="menuitem"
                    onClick={handleFeedback}
                    aria-label={hasUnreadFeedback
                      ? t('feedback.inbox.entryUnread')
                      : t('header.feedback')}
                  >
                    <MessageSquare size={14} />
                    <span>{t('header.feedback')}</span>
                    {hasUnreadFeedback ? (
                      <span className="bitfun-nav-panel__footer-menu-unread" aria-hidden="true" />
                    ) : null}
                  </button>
                  <button
                      type="button"
                      className="bitfun-nav-panel__footer-menu-item"
                      role="menuitem"
                      data-bf-component="nav-panel"
                      data-bf-part="footerMenuItem"
                      onClick={handleShowAbout}
                      aria-label={hasPrivacyUpdate
                        ? t('privacy.aboutEntryUpdated')
                        : t('header.about')}
                  >
                    {t('nav.settingsMenu.about')}
                  </MenuItem>
                </Menu>
                      <Info size={14} />
                      <span>{t('header.about')}</span>
                      {hasPrivacyUpdate ? (
                        <span className="bitfun-nav-panel__footer-menu-unread" aria-hidden="true" />
                      ) : null}
                  </button>
                </div>
              </>,
              getAppearanceOverlayHost(),
            )}
          </div>

          <Tooltip content={t('scenes.shell')} placement="right">
            <button
              type="button"
              className={`bitfun-nav-panel__footer-btn bitfun-nav-panel__footer-btn--icon${showSceneNav && navSceneId === 'shell' ? ' is-active' : ''}`}
              aria-label={t('scenes.shell')}
              aria-pressed={showSceneNav && navSceneId === 'shell'}
              onClick={handleOpenShell}
              data-testid="shell-panel-entry"
              data-bf-component="nav-panel"
              data-bf-part="footerButton"
              data-bf-state={showSceneNav && navSceneId === 'shell' ? 'active' : undefined}
            >
              <span className="bitfun-nav-panel__footer-btn-icon-swap" aria-hidden="true">
                <SquareTerminal size={15} className="bitfun-nav-panel__footer-btn-icon-swap-default" />
                <Terminal size={15} className="bitfun-nav-panel__footer-btn-icon-swap-hover" />
              </span>
            </button>
          </Tooltip>

          <Tooltip content={t('scenes.browser')} placement="right">
            <button
              type="button"
              className={`bitfun-nav-panel__footer-btn bitfun-nav-panel__footer-btn--icon${isBrowserActive ? ' is-active' : ''}`}
              aria-label={t('scenes.browser')}
              aria-pressed={isBrowserActive}
              onClick={handleOpenBrowser}
              data-testid="browser-panel-entry"
              data-bf-component="nav-panel"
              data-bf-part="footerButton"
              data-bf-state={isBrowserActive ? 'active' : undefined}
            >
              <span className="bitfun-nav-panel__footer-btn-icon-swap" aria-hidden="true">
                <Globe size={15} className="bitfun-nav-panel__footer-btn-icon-swap-default" />
                <ExternalLink size={15} className="bitfun-nav-panel__footer-btn-icon-swap-hover" />
              </span>
            </button>
          </Tooltip>
        </div>

        <div className="bitfun-nav-panel__footer-right">
          <NotificationButton className="bitfun-nav-panel__footer-btn" navFooterHoverIconSwap />
        </div>
      </div>
      <RetainedMountBoundary present={showAbout}>
        <Suspense fallback={null}>
          <AboutDialog isOpen={showAbout} onClose={() => setShowAbout(false)} />
        </Suspense>
      </RetainedMountBoundary>
      <RetainedMountBoundary present={showRemoteConnect}>
      </PresenceBoundary>
      <PresenceBoundary active={showFeedback}>
        <Suspense fallback={null}>
          <FeedbackDialog isOpen={showFeedback} onClose={() => setShowFeedback(false)} />
        </Suspense>
      </PresenceBoundary>
      {/* BitFun account login dialog is intentionally disabled. */}
      <PresenceBoundary active={showRemoteConnect}>
        <Suspense fallback={null}>
          <RemoteConnectDialog
            isOpen={showRemoteConnect}
            onClose={() => setShowRemoteConnect(false)}
            initialGroup={remoteInitialGroup}
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
        <DialogBody>
        <RemoteConnectDisclaimerContent
          agreed={hasAgreedRemoteDisclaimer}
          onClose={() => setShowRemoteDisclaimer(false)}
          onAgree={handleAgreeDisclaimer}
        />
              </DialogBody>
      </Dialog>
    </>
  );
};

export default PersistentFooterActions;
