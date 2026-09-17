import React from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { OverflowText, Tooltip } from '@bitfun/ui';
import './SessionRuntimeStatusEntry.scss';

interface SessionRuntimeStatusEntryProps {
  onOpen?: () => void;
}

export const SessionRuntimeStatusEntry: React.FC<SessionRuntimeStatusEntryProps> = ({
  onOpen,
}) => {
  if (!onOpen) {
    return null;
  }

  return <SessionRuntimeButton onOpen={onOpen} />;
};

function SessionRuntimeButton({
  onOpen,
}: {
  onOpen: () => void;
}) {
  const { t } = useTranslation('flow-chat');
  return (
    <Tooltip content={t('usage.runtime.tooltip')}>
      <button data-overflow-trigger data-bitfun-component="session-runtime-status-entry" data-bitfun-part="root"
        className="session-runtime-status-entry"
        type="button"
        onClick={onOpen}
        aria-label={t('usage.runtime.open')}
      >
        <Activity size={13} data-bitfun-component="session-runtime-status-entry" data-bitfun-part="icon" aria-hidden />
        <OverflowText data-bitfun-component="session-runtime-status-entry" data-bitfun-part="label">{t('usage.runtime.button')}</OverflowText>
      </button>
    </Tooltip>
  );
}

SessionRuntimeStatusEntry.displayName = 'SessionRuntimeStatusEntry';
