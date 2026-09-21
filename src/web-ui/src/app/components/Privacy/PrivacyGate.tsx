import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogClose,
  DialogHeader,
  DialogHeading,
  DialogTitle,
} from '@bitfun/ui';
import { hideStartupOverlay } from '@/app/startup/startupOverlay';
import { useI18n } from '@/infrastructure/i18n';
import { privacyAPI } from '@/infrastructure/api/service-api/PrivacyAPI';
import { isTauriRuntime } from '@/infrastructure/runtime';
import { createLogger } from '@/shared/utils/logger';
import { PrivacyDocument } from './PrivacyDocument';
import { usePrivacy } from './PrivacyContext';
import './Privacy.scss';

const log = createLogger('PrivacyGate');

export const PrivacyGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, currentLanguage, formatDate } = useI18n('common');
  const {
    status,
    initialize,
    refresh,
    accept,
    enterNotAccepted,
    applyCollectionPolicy,
  } = usePrivacy();
  const [dismissed, setDismissed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState(false);
  const [applyRetryRequired, setApplyRetryRequired] = useState(false);

  const reveal = useCallback(async () => {
    await hideStartupOverlay();
    if (!isTauriRuntime()) return;
    try {
      await privacyAPI.showGateWindow();
    } catch (error) {
      log.warn('Failed to reveal privacy window', error);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setLoadError(false);
    if (!isTauriRuntime()) return;
    try {
      const next = await initialize();
      if (next.lifecycleState === 'choice_required' || next.lifecycleState === 'resource_error') {
        await reveal();
      }
    } catch (error) {
      log.error('Privacy initialization failed', error);
      setLoadError(true);
      await reveal();
    }
  }, [initialize, reveal]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const needsChoice =
    status !== null && status.enabled && status.lifecycleState === 'choice_required';
  const resourceError = loadError || status?.lifecycleState === 'resource_error';
  const choicePanelVisible = needsChoice || applyRetryRequired;
  const overlayVisible = !dismissed && (choicePanelVisible || resourceError);

  const dismiss = useCallback(() => {
    if (!submitting) setDismissed(true);
  }, [submitting]);

  useEffect(() => {
    if (!overlayVisible) return;
    const handleBack = () => dismiss();
    window.addEventListener('popstate', handleBack);
    return () => {
      window.removeEventListener('popstate', handleBack);
    };
  }, [dismiss, overlayVisible]);

  const handleAccept = async () => {
    const policy = status?.policy;
    if (!checked || !policy || !status?.releaseReady || submitting) return;
    setSubmitting(true);
    setMutationError(false);
    try {
      await accept({
        policyUpdatedAt: policy.updatedAt,
        consentVersion: policy.consentVersion,
        documentSha256: policy.documentSha256,
        locale: policy.locale,
      });
      setDismissed(true);
    } catch (error) {
      log.error('Privacy consent could not be saved or applied', error);
      setMutationError(true);
      try {
        const next = await refresh(currentLanguage);
        setApplyRetryRequired(
          next.lifecycleState === 'full' && next.effectiveMode === 'privacy_not_accepted',
        );
      } catch {
        setApplyRetryRequired(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyRetry = async () => {
    if (submitting) return;
    setSubmitting(true);
    setMutationError(false);
    try {
      await applyCollectionPolicy('full', currentLanguage);
      setApplyRetryRequired(false);
      setDismissed(true);
    } catch (error) {
      log.error('Full privacy mode could not be applied', error);
      setMutationError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNotAccepted = async () => {
    if (submitting) return;
    setSubmitting(true);
    setMutationError(false);
    try {
      await enterNotAccepted(status?.policy?.locale ?? currentLanguage);
      setDismissed(true);
    } catch (error) {
      log.error('Privacy not-accepted state could not be saved', error);
      setMutationError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const policy = status?.policy;
  const consentOpen = Boolean(overlayVisible && choicePanelVisible && !resourceError && policy);

  return (
    <>
      {children}
      <Dialog
        open={overlayVisible && resourceError}
        onOpenChange={() => dismiss()}
        size="sm"
        className="bitfun-privacy-gate-resource"
        closeOnEscape={!submitting}
        closeOnPointerOutside={!submitting}
      >
        <DialogHeader>
          <DialogHeading>
            <DialogTitle>{t('privacy.gateLoadError')}</DialogTitle>
          </DialogHeading>
          <DialogClose disabled={submitting} />
        </DialogHeader>
        <DialogBody>
          <div
            className="bitfun-privacy-gate__resource"
            data-bitfun-component="privacy-gate"
            data-bitfun-part="resource"
          >
            <AlertTriangle size={28} aria-hidden="true" />
            <p>{t('privacy.gateResourceErrorHint')}</p>
            <div className="bitfun-privacy-gate__actions">
              <Button variant="outline" disabled={submitting} onClick={dismiss}>
                {t('privacy.gateCloseAndContinue')}
              </Button>
              <Button variant="primary" disabled={submitting} onClick={() => void loadStatus()}>
                {t('privacy.gateRetry')}
              </Button>
            </div>
          </div>
        </DialogBody>
      </Dialog>
      <Dialog
        open={consentOpen}
        onOpenChange={() => dismiss()}
        size="2xl"
        className="bitfun-privacy-dialog"
        closeOnEscape={!submitting}
        closeOnPointerOutside={!submitting}
      >
        <DialogHeader>
          <DialogHeading>
            <DialogTitle>{t('privacy.title')}</DialogTitle>
          </DialogHeading>
          <DialogClose disabled={submitting} />
        </DialogHeader>
        <DialogBody inset="none">
          <div
            className="bitfun-privacy-dialog__body"
            data-bitfun-component="privacy-gate"
            data-bitfun-part="root"
          >
            {policy ? (
              <>
                <div
                  className="bitfun-privacy-dialog__metadata"
                  data-bitfun-component="privacy-gate"
                  data-bitfun-part="metadata"
                >
                  <span>
                    {t('privacy.effectiveAt', {
                      date: formatDate(new Date(policy.effectiveAt), { dateStyle: 'long' }),
                    })}
                  </span>
                  <span>
                    {t('privacy.updatedAt', {
                      date: formatDate(new Date(policy.updatedAt), { dateStyle: 'long' }),
                    })}
                  </span>
                </div>
                <div
                  className="bitfun-privacy-gate__intro"
                  data-bitfun-component="privacy-gate"
                  data-bitfun-part="intro"
                >
                  {t('privacy.gateIntro')}
                </div>
                <div
                  className="bitfun-privacy-dialog__document"
                  aria-label={t('privacy.title')}
                  data-bitfun-component="privacy-gate"
                  data-bitfun-part="document"
                >
                  <PrivacyDocument content={policy.content} />
                </div>
                {!status?.releaseReady ? (
                  <div
                    className="bitfun-privacy-gate__alert"
                    data-bitfun-component="privacy-gate"
                    data-bitfun-part="releaseBlocked"
                  >
                    <Alert tone="warning" message={t('privacy.gateReleaseBlocked')} showIcon />
                  </div>
                ) : null}
                {mutationError ? (
                  <div
                    className="bitfun-privacy-gate__alert"
                    role="alert"
                    data-bitfun-component="privacy-gate"
                    data-bitfun-part="error"
                  >
                    <Alert tone="error" message={t('privacy.gateSaveFailed')} showIcon />
                  </div>
                ) : null}
                <div
                  className="bitfun-privacy-dialog__actions"
                  data-bitfun-component="privacy-gate"
                  data-bitfun-part="actions"
                >
                  {applyRetryRequired ? (
                    <Button
                      variant="primary"
                      loading={submitting}
                      onClick={() => void handleApplyRetry()}
                    >
                      {t('privacy.retryFullMode')}
                    </Button>
                  ) : (
                    <div
                      className="bitfun-privacy-dialog__consent"
                      data-bitfun-component="privacy-gate"
                      data-bitfun-part="consent"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={submitting}
                        onChange={event => setChecked(event.target.checked)}
                        label={t('privacy.consentCheckbox')}
                        data-testid="privacy-consent-checkbox"
                      />
                      <div className="bitfun-privacy-gate__actions">
                        <Button
                          variant="outline"
                          disabled={submitting}
                          onClick={() => void handleNotAccepted()}
                        >
                          {t('privacy.gateDisagree')}
                        </Button>
                        <Button
                          variant="primary"
                          disabled={!checked || !status?.releaseReady}
                          loading={submitting}
                          onClick={() => void handleAccept()}
                          data-testid="privacy-accept"
                        >
                          {t('privacy.gateAgree')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </DialogBody>
      </Dialog>
      {!status && isTauriRuntime() && !loadError ? (
        <div className="bitfun-privacy-gate__loading" aria-live="polite">
          <LoaderCircle className="bitfun-privacy-gate__loading-icon" size={18} aria-hidden="true" />
          <span className="sr-only">{t('privacy.gateLoading')}</span>
        </div>
      ) : null}
    </>
  );
};
