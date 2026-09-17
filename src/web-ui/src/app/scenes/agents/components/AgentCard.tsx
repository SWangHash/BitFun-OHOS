import React from 'react';
import { CardBody, CardFooter, CardHeader, Icon, OverflowText } from '@bitfun/ui';
import { useTranslation } from 'react-i18next';
import type { AgentWithCapabilities } from '../agentsStore';
import { getAgentIcon } from '../agentsIcons';
import { getAgentBadge, getAgentDescription, getCapabilityLabel } from '../utils';
import AgentCatalogCard, { AgentCatalogMetrics } from './AgentCatalogCard';
import './AgentCatalogCard.scss';

interface AgentCardProps {
  agent: AgentWithCapabilities;
  toolCount?: number;
  skillCount?: number;
  subagentCount?: number;
  disabledReason?: string;
  onOpenDetails: (agent: AgentWithCapabilities) => void;
}

const AgentCard: React.FC<AgentCardProps> = ({ agent, disabledReason, onOpenDetails, ...metrics }) => {
  const { t } = useTranslation('scenes/agents');
  const badge = getAgentBadge(t, agent.agentKind, agent.source ?? agent.subagentSource);
  const agentIcon = getAgentIcon(agent.iconKey);
  const capabilities = agent.capabilities.slice(0, 2).map(cap => getCapabilityLabel(t, cap.category)).join(' · ');

  return (
    <AgentCatalogCard
      agent={agent}
      onOpenDetails={onOpenDetails}
      data-bitfun-product-component="agent-card"
      data-bitfun-product-part="root"
    >
      <CardHeader
        align="center"
        className="agent-catalog-card__header"
        data-bitfun-product-component="agent-card"
        data-bitfun-product-part="header"
        title={(
          <div className="agent-catalog-card__title" data-bitfun-product-component="agent-card" data-bitfun-product-part="headerInfo">
            <div className="agent-catalog-card__title-row" data-bitfun-product-component="agent-card" data-bitfun-product-part="titleRow">
              <OverflowText className="agent-catalog-card__name" data-bitfun-product-component="agent-card" data-bitfun-product-part="name" data-testid="agent-list-item-title">
                {agent.name}
              </OverflowText>
              <span className="agent-catalog-card__identity">
                <span className="agent-catalog-card__icon" data-bitfun-product-component="agent-card" data-bitfun-product-part="iconArea" aria-hidden="true">
                  <span data-bitfun-product-component="agent-card" data-bitfun-product-part="icon">
                    <Icon {...agentIcon} size="sm" />
                  </span>
                </span>
                <OverflowText behavior="marquee">
                  <span data-bitfun-product-component="agent-card" data-bitfun-product-part="badges">{badge.label}</span>
                  <span data-bitfun-product-component="agent-card" data-bitfun-product-part="capabilities">{capabilities ? ` · ${capabilities}` : null}</span>
                </OverflowText>
              </span>
            </div>
          </div>
        )}
      />
      <CardBody data-bitfun-product-component="agent-card" data-bitfun-product-part="body">
        <OverflowText as="p" lines={2} className="agent-catalog-card__description" data-bitfun-product-component="agent-card" data-bitfun-product-part="description" data-testid="agent-list-item-description">
          {getAgentDescription(t, agent)}
        </OverflowText>
      </CardBody>
      <CardFooter align={disabledReason ? 'between' : 'start'} className="agent-catalog-card__footer" data-bitfun-product-component="agent-card" data-bitfun-product-part="footer">
        <AgentCatalogMetrics {...metrics} agent={agent} data-bitfun-product-component="agent-card" data-bitfun-product-part="meta" />
        {disabledReason && (
          <span className="agent-catalog-card__status" data-bitfun-state="disabled" title={disabledReason}>
            <Icon className="agent-catalog-card__status-icon" name="unselected" size="2xs" />
            <OverflowText>{disabledReason}</OverflowText>
          </span>
        )}
      </CardFooter>
    </AgentCatalogCard>
  );
};

export default AgentCard;
