import { Icon } from '@bitfun/ui';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDashed, LoaderCircle } from 'lucide-react';

import type { AcpPlanEntry } from '@/infrastructure/api/service-api/ACPClientAPI';
import './AcpPlanPanel.scss';

export interface AcpPlanPanelProps {
  entries: AcpPlanEntry[];
}

function statusIcon(status: string): React.ReactNode {
  switch (status) {
    case 'completed':
      return <Icon name="check-line" size="lg" style={{ width: 13, height: 13 }} className="bitfun-acp-plan__icon bitfun-acp-plan__icon--done" />;
    case 'in_progress':
      return (
        <LoaderCircle
          size={13}
          className="bitfun-acp-plan__icon bitfun-acp-plan__icon--active"
        />
      );
    default:
      return (
        <CircleDashed size={13} className="bitfun-acp-plan__icon bitfun-acp-plan__icon--pending" />
      );
  }
}

export const AcpPlanPanel: React.FC<AcpPlanPanelProps> = ({ entries }) => {
  const { t } = useTranslation('flow-chat');
  if (entries.length === 0) return null;

  const done = entries.filter((entry) => entry.status === 'completed').length;

  return (
    <div data-bitfun-component="acp-plan-panel" data-bitfun-part="root" className="bitfun-acp-plan" data-testid="acp-plan-panel">
      <div data-bitfun-component="acp-plan-panel" data-bitfun-part="header" className="bitfun-acp-plan__header">
        <span data-bitfun-component="acp-plan-panel" data-bitfun-part="title" className="bitfun-acp-plan__title">{t('chatInput.acpPlan.title')}</span>
        <span data-bitfun-component="acp-plan-panel" data-bitfun-part="progress" className="bitfun-acp-plan__progress">
          {done}/{entries.length}
        </span>
      </div>
      <ul data-bitfun-component="acp-plan-panel" data-bitfun-part="list" className="bitfun-acp-plan__list">
        {entries.map((entry, index) => (
          <li
            key={`${index}-${entry.content}`}
            data-bitfun-component="acp-plan-panel"
            data-bitfun-part="item"
            data-bitfun-status={entry.status}
            className={`bitfun-acp-plan__item bitfun-acp-plan__item--${entry.status}`}
          >
            {statusIcon(entry.status)}
            <span data-bitfun-component="acp-plan-panel" data-bitfun-part="content" className="bitfun-acp-plan__content">{entry.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

AcpPlanPanel.displayName = 'AcpPlanPanel';
