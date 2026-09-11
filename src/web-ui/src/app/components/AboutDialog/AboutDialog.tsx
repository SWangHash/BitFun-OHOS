/**
 * About dialog component.
 * Shows product identity, build metadata, license, app-update status, and the
 * persistent GitHub repository entry point.
 */

import {
  Alert,
  Button,
  FieldGroup,
  FieldRow,
  Icon,
  IconButton,
  StatusPill,
  Tooltip,
  Dialog,
  DialogBody,
  DialogClose,
  DialogTitle,
} from '@bitfun/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/infrastructure/i18n';
import {
  formatBuildDate,
  formatDisplayedVersion,
  getAboutInfo,
} from '@/shared/utils/version';
import { createLogger } from '@/shared/utils/logger';
import { systemAPI } from '@/infrastructure/api';
import type { CheckForUpdatesResponse } from '@/infrastructure/api/service-api/SystemAPI';
import { canCheckForAppUpdates, isTauriRuntime } from '@/infrastructure/update/tauriEnv';
import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import { UpdateAvailableDialog } from '@/infrastructure/update/UpdateAvailableDialog';
import { useUpdateInstallStore } from '@/infrastructure/update/updateInstallStore';
import { formatUpdateInstallError } from '@/infrastructure/update/updateErrorMessage';
import { PrivacyStatementDialog } from '@/app/components/Privacy/PrivacyStatementDialog';
import { usePrivacy } from '@/app/components/Privacy/PrivacyContext';
import { AboutBrandMark } from './AboutBrandMark';
import './AboutDialog.scss';

const log = createLogger('AboutDialog');
const GITHUB_REPOSITORY_URL = 'https://github.com/GCWing/BitFun';
const USER_AGREEMENT_URL = 'https://agreement-drcn.hispace.dbankcloud.cn/index.html?lang=zh&agreementId=1959693293117791424';

interface AboutDialogProps {
  /** Whether visible */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useI18n('common');
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [manualCheckBusy, setManualCheckBusy] = useState(false);
  const [manualCheckStatus, setManualCheckStatus] = useState<'idle' | 'latest' | 'error'>('idle');
  const [manualCheckErrorMessage, setManualCheckErrorMessage] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualData, setManualData] = useState<CheckForUpdatesResponse | null>(null);
  const [nativeVersion, setNativeVersion] = useState<string | null>(null);
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  const { status: privacyStatus } = usePrivacy();
  const updateStatus = useUpdateInstallStore(state => state.status);
  const updateProgress = useUpdateInstallStore(state => state.progress);
  const updateError = useUpdateInstallStore(state => state.error);
  const startUpdateInstall = useUpdateInstallStore(state => state.startInstall);
  const requestInstall = useUpdateInstallStore(state => state.requestInstall);
  const updateVersion = useUpdateInstallStore(state => state.version);
  const updateInitialized = useUpdateInstallStore(state => state.initialized);

  const aboutInfo = getAboutInfo();
  const { version, license } = aboutInfo;
  const nativeRuntime = isTauriRuntime();
  const updateChecksAvailable = canCheckForAppUpdates();
  const displayedVersion = formatDisplayedVersion(
    version,
    nativeVersion,
    nativeRuntime,
    import.meta.env.DEV,
  );
  const updateProgressPercent =
    updateProgress.total != null && updateProgress.total > 0
      ? Math.min(100, Math.round((updateProgress.downloaded / updateProgress.total) * 100))
      : null;
  const licenseName = license.type === 'MIT' ? 'MIT License' : license.type;
  const licenseCopyright = license.text?.startsWith(`${licenseName} - `)
    ? license.text.slice(`${licenseName} - `.length)
    : license.text;
  const legalCopyright = licenseCopyright
    ? `${licenseCopyright.replace(/\.$/, '')}. ${t('about.allRightsReserved')}`
    : t('about.copyright');

  let releaseLabel = t('about.stableBuild');
  if (displayedVersion.endsWith('-dev')) {
    releaseLabel = t('about.developmentBuild');
  } else if (version.releaseChannel === 'beta') {
    releaseLabel = t('about.betaBuild');
  } else if (version.releaseChannel === 'nightly') {
    releaseLabel = t('about.nightlyBuild');
  }

  useEffect(() => {
    if (isOpen) {
      setManualCheckStatus('idle');
      setManualCheckErrorMessage(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !nativeRuntime) return;
    // OHOS has no staged in-app update flow; the AppGallery owns updates.
    if (canCheckForAppUpdates() && !isOpenHarmonyRuntime()) {
      void useUpdateInstallStore.getState().initialize();
    }
    let active = true;
    void systemAPI.getAppVersion()
      .then(currentVersion => {
        if (active) setNativeVersion(currentVersion);
      })
      .catch(error => {
        log.warn('get_app_version failed; using generated version metadata', error);
      });
    return () => {
      active = false;
    };
  }, [isOpen, nativeRuntime]);

  const handleCheckForUpdates = useCallback(async () => {
    if (!canCheckForAppUpdates()) return;

    setManualCheckStatus('idle');
    setManualCheckErrorMessage(null);
    setManualCheckBusy(true);
    try {
      if (isOpenHarmonyRuntime()) {
        // OHOS: the AppGallery check shows the system update dialog when an
        // update exists; the in-app install flow stays desktop-only.
        const ohosRes = await systemAPI.checkForUpdatesOhos();
        if (ohosRes.error) {
          setManualCheckErrorMessage(String(ohosRes.error));
          setManualCheckStatus('error');
        } else if (!ohosRes.updateAvailable) {
          setManualCheckStatus('latest');
        }
        // updateAvailable === true: native dialog already shown
      } else {
        const res = await systemAPI.checkForUpdates();
        if (!res.updateAvailable) {
          setManualCheckStatus('latest');
        } else {
          setManualData(res);
          setManualOpen(true);
        }
      }
    } catch (error) {
      log.error('check_for_updates failed', error);
      const message = error instanceof Error ? error.message : String(error);
      setManualCheckErrorMessage(formatUpdateInstallError(message, t));
      setManualCheckStatus('error');
    } finally {
      setManualCheckBusy(false);
    }
  }, [t]);

  const handleGithubStar = useCallback(() => {
    systemAPI.openExternal(GITHUB_REPOSITORY_URL).catch(error => {
      log.error('Failed to open the GitHub repository', { url: GITHUB_REPOSITORY_URL, error });
    });
  }, []);

  const openPrivacyStatement = useCallback(() => {
    if (privacyStatus?.enabled && privacyStatus.policy) {
      setPrivacyDialogOpen(true);
      return;
    }
    void systemAPI.openExternal(USER_AGREEMENT_URL);
  }, [privacyStatus]);

  const closeAfterPrivacyModeChange = useCallback(() => {
    setPrivacyDialogOpen(false);
    onClose();
  }, [onClose]);

  const onManualLater = useCallback(() => {
    setManualOpen(false);
    setManualData(null);
  }, []);

  const onManualInstall = useCallback(() => {
    setManualOpen(false);
    setManualData(null);
    void startUpdateInstall();
  }, [startUpdateInstall]);

  const onRestart = useCallback(() => {
    onClose();
    requestInstall();
  }, [onClose, requestInstall]);

  const copyToClipboard = async (text: string, itemId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(itemId);
      window.setTimeout(() => setCopiedItem(null), 2000);
    } catch (error) {
      log.error('Failed to copy to clipboard', error);
    }
  };

  const updateState = `${manualCheckBusy ? 'checking' : ''} ${manualCheckStatus} ${updateStatus}`.trim();
  const updateBusy = !updateInitialized || manualCheckBusy || updateStatus === 'downloading' || updateStatus === 'ready' || updateStatus === 'installing';

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
        size="xl"
        className="bitfun-about-dialog"
        aria-label={t('about.dialogTitle')}
        data-testid="about-dialog-modal"
      >
        <DialogClose className="bitfun-about-dialog__close" />
        <DialogBody className="bitfun-about-dialog__modal-content" inset="none">
          <div
            className="bitfun-about-dialog__content"
            data-bitfun-component="about-dialog"
            data-bitfun-part="root"
          >
            <div className="bitfun-about-dialog__body">
              <div
                className="bitfun-about-dialog__brand"
                data-bitfun-component="about-dialog"
                data-bitfun-part="hero"
                aria-hidden="true"
              >
                <div className="bitfun-about-dialog__artwork">
                  <AboutBrandMark active={isOpen} />
                </div>
                <p className="bitfun-about-dialog__brand-statement">
                  {t('about.brandStatement')}
                </p>
              </div>

              <section
                className="bitfun-about-dialog__metadata"
                data-bitfun-component="about-dialog"
                data-bitfun-part="content"
                aria-label={t('about.details')}
              >
                <header className="bitfun-about-dialog__brand-copy">
                  <DialogTitle
                    className="bitfun-about-dialog__title"
                    data-bitfun-component="about-dialog"
                    data-bitfun-part="title"
                  >
                    {version.name}
                  </DialogTitle>
                  <p className="bitfun-about-dialog__tagline">{t('about.tagline')}</p>
                </header>

                <FieldGroup className="bitfun-about-dialog__details" appearance="plain" dividers={false}>
                  <FieldRow padding="none">
                    <dl className="bitfun-about-dialog__info-row" data-bitfun-component="about-dialog" data-bitfun-part="infoRow">
                      <dt className="bitfun-about-dialog__info-label" data-bitfun-component="about-dialog" data-bitfun-part="infoLabel">
                        <span>{t('about.versionLabel')}</span>
                      </dt>
                      <dd className="bitfun-about-dialog__info-value-group">
                        <span
                          className="bitfun-about-dialog__info-value"
                          data-bitfun-component="about-dialog"
                          data-bitfun-part="infoValue"
                          data-testid="about-version-value"
                        >
                          {displayedVersion}
                        </span>
                        <span
                          className="bitfun-about-dialog__channel-badge"
                          data-bitfun-component="about-dialog"
                          data-bitfun-part="channelBadge"
                        >
                          <StatusPill tone="neutral">{releaseLabel}</StatusPill>
                        </span>
                      </dd>
                    </dl>
                  </FieldRow>

                  <FieldRow padding="none">
                    <dl className="bitfun-about-dialog__info-row" data-bitfun-component="about-dialog" data-bitfun-part="infoRow">
                      <dt className="bitfun-about-dialog__info-label" data-bitfun-component="about-dialog" data-bitfun-part="infoLabel">
                        <span>{t('about.buildDate')}</span>
                      </dt>
                      <dd className="bitfun-about-dialog__info-value-group">
                        <span className="bitfun-about-dialog__info-value" data-bitfun-component="about-dialog" data-bitfun-part="infoValue">
                          {formatBuildDate(version.buildDate)}
                        </span>
                      </dd>
                    </dl>
                  </FieldRow>

                  <FieldRow padding="none">
                    <dl className="bitfun-about-dialog__info-row" data-bitfun-component="about-dialog" data-bitfun-part="infoRow">
                      <dt className="bitfun-about-dialog__info-label" data-bitfun-component="about-dialog" data-bitfun-part="infoLabel">
                        <span>{t('about.commit')}</span>
                      </dt>
                      <dd className="bitfun-about-dialog__info-value-group">
                        <span
                          className="bitfun-about-dialog__info-value bitfun-about-dialog__info-value--mono"
                          data-bitfun-component="about-dialog"
                          data-bitfun-part="infoValue"
                        >
                          {version.gitCommit ?? t('about.notAvailable')}
                        </span>
                        {version.gitCommit ? (
                          <span
                            className="bitfun-about-dialog__copy-action"
                            data-bitfun-component="about-dialog"
                            data-bitfun-part="copyButton"
                          >
                            <Tooltip content={t('about.copy')}>
                              <IconButton
                                size="xs"
                                variant="quiet"
                                icon={<Icon name={copiedItem === 'commit' ? 'check-line' : 'duplicate'} size="sm" />}
                                onClick={() => void copyToClipboard(version.gitCommit ?? '', 'commit')}
                                aria-label={t('about.copyCommit')}
                              />
                            </Tooltip>
                          </span>
                        ) : null}
                      </dd>
                    </dl>
                  </FieldRow>

                  <FieldRow padding="none">
                    <dl className="bitfun-about-dialog__info-row" data-bitfun-component="about-dialog" data-bitfun-part="infoRow">
                      <dt className="bitfun-about-dialog__info-label" data-bitfun-component="about-dialog" data-bitfun-part="infoLabel">
                        <span>{t('about.branch')}</span>
                      </dt>
                      <dd className="bitfun-about-dialog__info-value-group">
                        <span
                          className="bitfun-about-dialog__info-value"
                          data-bitfun-component="about-dialog"
                          data-bitfun-part="infoValue"
                          data-testid="about-branch-value"
                          title={version.gitBranch}
                        >
                          {version.gitBranch ?? t('about.notAvailable')}
                        </span>
                      </dd>
                    </dl>
                  </FieldRow>

                  <FieldRow padding="none">
                    <dl className="bitfun-about-dialog__info-row" data-bitfun-component="about-dialog" data-bitfun-part="infoRow">
                      <dt className="bitfun-about-dialog__info-label" data-bitfun-component="about-dialog" data-bitfun-part="infoLabel">
                        <span>{t('about.license')}</span>
                      </dt>
                      <dd className="bitfun-about-dialog__info-value-group">
                        <span
                          className="bitfun-about-dialog__info-value"
                          data-bitfun-component="about-dialog"
                          data-bitfun-part="license"
                          data-testid="about-license-value"
                        >
                          {licenseName}
                        </span>
                      </dd>
                    </dl>
                  </FieldRow>
                </FieldGroup>

                {updateChecksAvailable ? (
                  <div
                    className="bitfun-about-dialog__update-card"
                    data-bitfun-component="about-dialog"
                    data-bitfun-part="updateCard"
                    data-bitfun-state={updateState}
                  >
                    <div
                      className="bitfun-about-dialog__update-card-actions"
                      data-bitfun-component="about-dialog"
                      data-bitfun-part="updateActions"
                    >
                      {manualCheckStatus === 'latest' && updateStatus === 'idle' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          leadingIcon={<Icon name="check-circle" size="sm" aria-hidden="true" />}
                          onClick={() => void handleCheckForUpdates()}
                          data-testid="about-check-updates"
                        >
                          {t('update.noUpdate')}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          leadingIcon={<Icon name="refresh" size="sm" aria-hidden="true" />}
                          loading={manualCheckBusy}
                          disabled={updateBusy}
                          onClick={() => void handleCheckForUpdates()}
                          data-testid="about-check-updates"
                        >
                          {manualCheckBusy ? t('update.checking') : t('update.checkForUpdates')}
                        </Button>
                      )}
                    </div>

                    <div
                      className="bitfun-about-dialog__update-feedback"
                      data-bitfun-component="about-dialog"
                      data-bitfun-part="updateFeedback"
                    >
                      {manualCheckStatus === 'error' && manualCheckErrorMessage ? (
                        <Alert
                          tone="error"
                          message={manualCheckErrorMessage}
                          showIcon
                          className="bitfun-about-dialog__update-alert"
                        />
                      ) : null}
                      {updateStatus === 'downloading' ? (
                        <div className="bitfun-about-dialog__download-status" role="status">
                          <div
                            className="bitfun-about-dialog__download-bar"
                            data-bitfun-component="about-dialog"
                            data-bitfun-part="progress"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={updateProgressPercent ?? undefined}
                            aria-label={t('update.downloadingTitle')}
                          >
                            <div
                              data-bitfun-component="about-dialog"
                              data-bitfun-part="progressFill"
                              className={updateProgressPercent != null
                                ? 'bitfun-about-dialog__download-fill'
                                : 'bitfun-about-dialog__download-fill bitfun-about-dialog__download-fill--indeterminate'}
                              style={updateProgressPercent != null
                                ? { width: `${updateProgressPercent}%` }
                                : undefined}
                            />
                          </div>
                          <div className="bitfun-about-dialog__download-meta">
                            <span>{t('update.backgroundDownloading')}</span>
                            <span>
                              {updateProgressPercent != null
                                ? t('update.progressPercent', { percent: String(updateProgressPercent) })
                                : t('update.progressUnknown')}
                            </span>
                          </div>
                          <p className="bitfun-about-dialog__download-hint">
                            {t('update.backgroundDownloadHint')}
                          </p>
                        </div>
                      ) : null}
                      {updateStatus === 'ready' || updateStatus === 'installing' ? (
                        <div className="bitfun-about-dialog__update-installed">
                          <div className="bitfun-about-dialog__update-status bitfun-about-dialog__update-status--success">
                            <Icon name="check-circle" size="sm" className="bitfun-about-dialog__update-status-icon" aria-hidden="true" />
                            <span>{t('update.readyVersion', { version: updateVersion ?? '' })}</span>
                          </div>
                          <Button variant="primary" size="sm" disabled={updateStatus === 'installing'} onClick={onRestart}>
                            {t(updateStatus === 'installing' ? 'update.installing' : 'update.installAndRestart')}
                          </Button>
                        </div>
                      ) : null}
                      {updateStatus === 'error' && updateError ? (
                        <Alert
                          tone="error"
                          message={formatUpdateInstallError(updateError, t)}
                          showIcon
                          className="bitfun-about-dialog__update-alert"
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="bitfun-about-dialog__update-card-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    leadingIcon={<Icon name="eye" size="sm" aria-hidden="true" />}
                    onClick={openPrivacyStatement}
                    data-testid="about-privacy-statement"
                  >
                    {privacyStatus?.enabled ? t('about.privacyStatement') : t('about.userAgreement')}
                    {privacyStatus?.enabled && privacyStatus.hasUnreadUpdate ? (
                      <span className="bitfun-about-dialog__privacy-updated">
                        {t('privacy.updated')}
                      </span>
                    ) : null}
                  </Button>
                </div>
              </section>
            </div>

            <footer
              className="bitfun-about-dialog__footer"
              data-bitfun-component="about-dialog"
              data-bitfun-part="footer"
            >
              <div
                className="bitfun-about-dialog__star-callout"
                data-bitfun-component="about-dialog"
                data-bitfun-part="starCallout"
                role="group"
                aria-labelledby="bitfun-about-star-title"
              >
                <div className="bitfun-about-dialog__star-copy">
                  <h3 id="bitfun-about-star-title" className="bitfun-about-dialog__star-title">
                    {t('about.githubStarTitle')}
                  </h3>
                  <p className="bitfun-about-dialog__star-description">
                    {t('about.githubStarDescription')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="bitfun-about-dialog__star-button"
                  leadingIcon={<Icon name="star" size="sm" aria-hidden="true" />}
                  onClick={handleGithubStar}
                  data-testid="about-github-star"
                >
                  {t('about.githubStarAction')}
                </Button>
              </div>
              <p
                className="bitfun-about-dialog__copyright"
                data-bitfun-component="about-dialog"
                data-bitfun-part="copyright"
              >
                {legalCopyright}
              </p>
            </footer>
          </div>
        </DialogBody>
      </Dialog>

      <UpdateAvailableDialog
        isOpen={manualOpen}
        variant="manual"
        data={manualData}
        onLater={onManualLater}
        onInstall={onManualInstall}
      />
      <PrivacyStatementDialog
        isOpen={privacyDialogOpen}
        onClose={() => setPrivacyDialogOpen(false)}
        onModeChangeComplete={closeAfterPrivacyModeChange}
      />
    </>
  );
};

export default AboutDialog;
