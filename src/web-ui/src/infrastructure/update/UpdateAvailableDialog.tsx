/**
 * Dialog when a remote update is available (daily prompt or manual check).
 */

import {
  Button,
  Icon,
  ScrollArea,
  Dialog,
  DialogBody,
  DialogClose,
  DialogHeader,
  DialogHeading,
  DialogTitle,
} from '@bitfun/ui';
import React, { useRef } from 'react';
;
import { useI18n } from '@/infrastructure/i18n';
import type { CheckForUpdatesResponse } from '@/infrastructure/api/service-api/SystemAPI';
import './UpdateAvailableDialog.scss';

export interface UpdateAvailableDialogProps {
  isOpen: boolean;
  variant: 'daily' | 'manual';
  data: CheckForUpdatesResponse | null;
  onLater: () => void;
  onSkip?: () => void;
  onInstall: () => void;
}

export const UpdateAvailableDialog: React.FC<UpdateAvailableDialogProps> = ({
  isOpen,
  variant,
  data,
  onLater,
  onSkip,
  onInstall
}) => {
  const { t } = useI18n('common');
  const lastAvailableDataRef = useRef<CheckForUpdatesResponse | null>(null);
  if (data?.updateAvailable) {
    lastAvailableDataRef.current = data;
  }
  const displayData = data?.updateAvailable ? data : lastAvailableDataRef.current;
  const modalOpen = isOpen && data?.updateAvailable === true;

  if (!displayData) {
    return null;
  }

  const latest = displayData.latestVersion ?? '';
  const notes = displayData.releaseNotes?.trim();

  return (
    <Dialog
      open={modalOpen}
      onOpenChange={(nextOpen) => { if (!nextOpen) onLater(); }}
      size="md"
    >
      <DialogHeader>
        <DialogHeading>
          <DialogTitle>{t('update.availableTitle')}</DialogTitle>
        </DialogHeading>
        <DialogClose />
      </DialogHeader>
      <DialogBody>
      <div
        className="bitfun-update-available"
        data-bitfun-component="update"
        data-bitfun-part="availableRoot"
        data-bitfun-variant={variant}
      >
        <div
          className="bitfun-update-available__lead"
          data-bitfun-component="update"
          data-bitfun-part="lead"
        >
          <div
            className="bitfun-update-available__lead-icon"
            aria-hidden
            data-bitfun-component="update"
            data-bitfun-part="leadIcon"
          >
            <Icon name="arrow-down" size="lg" />
          </div>
          <p
            className="bitfun-update-available__subtitle"
            data-bitfun-component="update"
            data-bitfun-part="subtitle"
          >{t('update.availableSubtitle')}</p>
        </div>

        <div
          className="bitfun-update-available__versions bitfun-update-available__versions--card"
          data-bitfun-component="update"
          data-bitfun-part="versions"
        >
          <div
            className="bitfun-update-available__row"
            data-bitfun-component="update"
            data-bitfun-part="versionRow"
          >
            <span className="bitfun-update-available__label" data-bitfun-component="update" data-bitfun-part="versionLabel">{t('update.currentVersion')}</span>
            <span className="bitfun-update-available__value" data-bitfun-component="update" data-bitfun-part="versionValue">{displayData.currentVersion}</span>
          </div>
          <div
            className="bitfun-update-available__row bitfun-update-available__row--highlight"
            data-bitfun-component="update"
            data-bitfun-part="versionRow"
            data-bitfun-state="highlight"
          >
            <span className="bitfun-update-available__label" data-bitfun-component="update" data-bitfun-part="versionLabel">{t('update.latestVersion')}</span>
            <span className="bitfun-update-available__value" data-bitfun-component="update" data-bitfun-part="versionValue">{latest}</span>
          </div>
        </div>

        {notes ? (
          <div className="bitfun-update-available__notes" data-bitfun-component="update" data-bitfun-part="notes">
            <div className="bitfun-update-available__notes-label" data-bitfun-component="update" data-bitfun-part="notesLabel">{t('update.releaseNotes')}</div>
            <ScrollArea className="bitfun-update-available__notes-body" data-bitfun-component="update" data-bitfun-part="notesBody">
              <pre>{notes}</pre>
            </ScrollArea>
          </div>
        ) : null}

        <div className="bitfun-update-available__actions" data-bitfun-component="update" data-bitfun-part="actions">
          {variant === 'daily' ? (
            <>
              <Button variant="fill" size="md" onClick={onLater}>
                {t('update.later')}
              </Button>
              {onSkip ? (
                <Button variant="outline" size="md" onClick={onSkip}>
                  {t('update.skipVersion')}
                </Button>
              ) : null}
              <Button variant="primary" size="md" onClick={onInstall}>
                {t('update.backgroundInstall')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="fill" size="md" onClick={onLater}>
                {t('update.cancel')}
              </Button>
              <Button variant="primary" size="md" onClick={onInstall}>
                {t('update.backgroundInstall')}
              </Button>
            </>
          )}
        </div>
      </div>
          </DialogBody>
    </Dialog>
  );
};
