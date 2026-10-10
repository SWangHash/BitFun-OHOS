/**
 * Waterfall row for the runtime QT toolchain provisioning.
 *
 * The question card is acknowledged as soon as its `__official__` answer is
 * accepted and collapses right away, so the install the runtime starts afterwards
 * is reported here instead: one separate row in the conversation flow, the same
 * way the image-analyzing indicator is a row of its own. The card never carries
 * this state.
 */

import React from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AmbientToolCard, AmbientToolCardHeader } from '@bitfun/ui/flow-chat';
import { i18nService } from '@/infrastructure/i18n';
import type { FlowToolItem } from '../../types/flow-chat';

type Provisioning = NonNullable<FlowToolItem['qtToolchainProvision']>;

/**
 * Wire stage name of the runtime QT toolchain provisioning channel
 * (`backend-event-qttoolchainprovision`, provisioning plan v4 stage 4) mapped to
 * its catalog key. An unknown stage is dropped instead of rendered raw, so a
 * newer backend cannot leave a key literal on the row.
 */
const QT_TOOLCHAIN_PROVISION_STAGE_KEYS: Record<string, string> = {
  checking_existing: 'checkingExisting',
  reused: 'reused',
  fetching_checksum: 'fetchingChecksum',
  downloading: 'downloading',
  verifying_archive: 'verifyingArchive',
  extracting: 'extracting',
  verifying_install: 'verifyingInstall',
  publishing: 'publishing',
  completed: 'completed',
};

/**
 * Status line for the runtime provisioning that follows an accepted
 * `__official__` toolchain answer. The card was acknowledged before the install
 * finished, so this row is what keeps the state visible; a failure surfaces the
 * backend's stable error code.
 */
export function qtToolchainProvisioningStatusText(
  t: TFunction<'flow-chat'>,
  provisioning: FlowToolItem['qtToolchainProvision'],
): string | null {
  if (!provisioning) return null;
  if (provisioning.status === 'failed') {
    return t('toolCards.askUser.qtMigration.provisioningFailed', {
      code: provisioning.errorCode ?? t('toolCards.askUser.qtMigration.provisioningFailedUnknownCode'),
    });
  }
  if (provisioning.status === 'succeeded') {
    return t('toolCards.askUser.qtMigration.provisioningDone');
  }
  const parts = [t('toolCards.askUser.qtMigration.provisioning')];
  const stageKey = QT_TOOLCHAIN_PROVISION_STAGE_KEYS[provisioning.stage ?? ''];
  if (stageKey) {
    parts.push(t(`toolCards.askUser.qtMigration.provisioningStage.${stageKey}`));
  }
  const total = provisioning.totalBytes;
  if (typeof total === 'number' && total > 0 && typeof provisioning.downloadedBytes === 'number') {
    const percent = Math.min(100, Math.round((provisioning.downloadedBytes / total) * 100));
    parts.push(t('toolCards.askUser.qtMigration.provisioningPercent', {
      percent: i18nService.formatNumber(percent, { useGrouping: false }),
    }));
  }
  return parts.join(' · ');
}

interface QtToolchainProvisionItemProps {
  provisioning: Provisioning;
}

export const QtToolchainProvisionItem: React.FC<QtToolchainProvisionItemProps> = ({
  provisioning,
}) => {
  const { t } = useTranslation('flow-chat');
  const statusText = qtToolchainProvisioningStatusText(t, provisioning);
  if (!statusText) return null;

  // The installed path is the fact the model works from in the next round, so it
  // stays on the row once publishing succeeded.
  const content = provisioning.status === 'succeeded' && provisioning.kitRoot
    ? `${statusText} · ${provisioning.kitRoot}`
    : statusText;

  const icon = provisioning.status === 'failed'
    ? <AlertCircle size={16} />
    : provisioning.status === 'succeeded'
      ? <CheckCircle2 size={16} />
      : <Loader2 className="animate-spin" size={16} />;

  return (
    <div data-bitfun-component="virtual-item" data-bitfun-part="qtToolchainProvision">
      <AmbientToolCard
        status={provisioning.status === 'failed'
          ? 'error'
          : provisioning.status === 'succeeded'
            ? 'completed'
            : 'running'}
        header={
          <AmbientToolCardHeader
            icon={icon}
            content={content}
          />
        }
      />
    </div>
  );
};
