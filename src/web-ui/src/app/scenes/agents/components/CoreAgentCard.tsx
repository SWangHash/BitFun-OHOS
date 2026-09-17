import React from 'react';
import { CardBody, CardFooter, CardHeader, Icon, OverflowText } from '@bitfun/ui';
import { useTranslation } from 'react-i18next';
import type { AgentWithCapabilities } from '../agentsStore';
import { getAgentIcon } from '../agentsIcons';
import { getAgentDescription } from '../utils';
import AgentCatalogCard, { AgentCatalogMetrics } from './AgentCatalogCard';
import './AgentCatalogCard.scss';

export interface CoreAgentMeta {
  role: string;
  accentColor: string;
  accentBg: string;
}

interface CoreAgentCardProps {
  agent: AgentWithCapabilities;
  meta: CoreAgentMeta;
  toolCount?: number;
  skillCount?: number;
  subagentCount?: number;
  onOpenDetails: (agent: AgentWithCapabilities) => void;
  /** Replaces the connected status when the capability is off in Settings. */
  disabledReason?: string;
}

const CoreAgentCard: React.FC<CoreAgentCardProps> = ({
  agent, meta, disabledReason, onOpenDetails, ...metrics
}) => {
  const { t } = useTranslation('scenes/agents');
  const statusLabel = disabledReason ?? t('agentCard.status.connected');
  const agentIcon = getAgentIcon(agent.iconKey);

  return (
    <AgentCatalogCard
      agent={agent}
      onOpenDetails={onOpenDetails}
      data-bitfun-product-component="core-agent-card"
      data-bitfun-product-part="root"
    >
      <CardHeader
        align="center"
        className="agent-catalog-card__header"
        data-bitfun-product-component="core-agent-card"
        data-bitfun-product-part="header"
        title={(
          <div className="agent-catalog-card__title" data-bitfun-product-component="core-agent-card" data-bitfun-product-part="headerInfo">
            <div className="agent-catalog-card__title-row">
              <OverflowText className="agent-catalog-card__name" data-bitfun-product-component="core-agent-card" data-bitfun-product-part="name" data-testid="agent-list-item-title">
                {agent.name}
              </OverflowText>
              <span className="agent-catalog-card__identity">
                <span className="agent-catalog-card__icon" data-bitfun-product-component="core-agent-card" data-bitfun-product-part="icon" aria-hidden="true">
                  <Icon {...agentIcon} size="sm" />
                </span>
                <OverflowText data-bitfun-product-component="core-agent-card" data-bitfun-product-part="role">
                  {meta.role}
                </OverflowText>
              </span>
            </div>
          </div>
        )}
      />
      <CardBody data-bitfun-product-component="core-agent-card" data-bitfun-product-part="body">
        <OverflowText as="p" lines={2} className="agent-catalog-card__description" data-bitfun-product-component="core-agent-card" data-bitfun-product-part="description" data-testid="agent-list-item-description">
          {getAgentDescription(t, agent)}
        </OverflowText>
      </CardBody>
      <CardFooter align="between" className="agent-catalog-card__footer" data-bitfun-product-component="core-agent-card" data-bitfun-product-part="footer">
        <AgentCatalogMetrics {...metrics} agent={agent} data-bitfun-product-component="core-agent-card" data-bitfun-product-part="meta" />
        <span
          className="agent-catalog-card__status"
          data-bitfun-product-component="core-agent-card"
          data-bitfun-product-part="status"
          data-bitfun-state={disabledReason ? 'disabled' : 'connected'}
          title={statusLabel}
        >
          <Icon className="agent-catalog-card__status-icon" name="unselected" size="2xs" />
          <OverflowText>{statusLabel}</OverflowText>
        </span>
      </CardFooter>
    </AgentCatalogCard>
  );
};

export default CoreAgentCard;
