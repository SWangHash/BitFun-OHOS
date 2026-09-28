import React from 'react';
import { CardBody, CardFooter, CardHeader, Icon, OverflowText } from '@bitfun/ui';
import { useTranslation } from 'react-i18next';
import type { AgentWithCapabilities } from '../agentsStore';
import { getAgentIcon } from '../agentsIcons';
import { getAgentDescription } from '../utils';
import AgentCatalogCard from './AgentCatalogCard';
import './AgentCatalogCard.scss';

/**
 * Industry agent card.
 *
 * Renders a real backend-registered vertical-domain agent (QtMigration) with the
 * shared catalog card anatomy plus an "industry agent" badge and its built-in
 * domain workflow label. It reuses AgentCatalogCard and the AgentCard slot
 * classes so it stays visually consistent with the rest of the catalog.
 */
interface IndustryAgentCardProps {
  agent: AgentWithCapabilities;
  index?: number;
  onOpenDetails: (agent: AgentWithCapabilities) => void;
}

const IndustryAgentCard: React.FC<IndustryAgentCardProps> = ({
  agent,
  index = 0,
  onOpenDetails,
}) => {
  const { t } = useTranslation('scenes/agents');
  const agentIcon = getAgentIcon(agent.iconKey);
  const name = t(`industryAgentsZone.agents.${agent.id}.name`, { defaultValue: agent.name });
  const description = t(
    `industryAgentsZone.agents.${agent.id}.description`,
    { defaultValue: getAgentDescription(t, agent) },
  );

  return (
    <AgentCatalogCard
      agent={{ ...agent, name }}
      onOpenDetails={onOpenDetails}
      style={{ '--surface-stagger-index': index } as React.CSSProperties}
      data-bitfun-product-component="industry-agent-card"
      data-bitfun-product-part="root"
    >
      <CardHeader
        align="center"
        className="agent-catalog-card__header"
        data-bitfun-product-component="industry-agent-card"
        data-bitfun-product-part="header"
        title={(
          <div className="agent-catalog-card__title" data-bitfun-product-component="industry-agent-card" data-bitfun-product-part="headerInfo">
            <div className="agent-catalog-card__title-row" data-bitfun-product-component="industry-agent-card" data-bitfun-product-part="titleRow">
              <OverflowText className="agent-catalog-card__name" data-bitfun-product-component="industry-agent-card" data-bitfun-product-part="name" data-testid="agent-list-item-title">
                {name}
              </OverflowText>
              <span className="agent-catalog-card__identity">
                <span className="agent-catalog-card__icon" data-bitfun-product-component="industry-agent-card" data-bitfun-product-part="iconArea" aria-hidden="true">
                  <span data-bitfun-product-component="industry-agent-card" data-bitfun-product-part="icon">
                    <Icon {...agentIcon} size="sm" />
                  </span>
                </span>
                <OverflowText behavior="marquee">
                  <span data-bitfun-product-component="industry-agent-card" data-bitfun-product-part="badges">{t('industryAgentsZone.badge')}</span>
                </OverflowText>
              </span>
            </div>
          </div>
        )}
      />
      <CardBody data-bitfun-product-component="industry-agent-card" data-bitfun-product-part="body">
        <OverflowText as="p" lines={2} className="agent-catalog-card__description" data-bitfun-product-component="industry-agent-card" data-bitfun-product-part="description" data-testid="agent-list-item-description">
          {description}
        </OverflowText>
      </CardBody>
      <CardFooter align="start" className="agent-catalog-card__footer" data-bitfun-product-component="industry-agent-card" data-bitfun-product-part="footer">
        <span className="agent-catalog-card__metric" data-bitfun-product-component="industry-agent-card" data-bitfun-product-part="meta">
          <Icon {...agentIcon} size="2xs" aria-hidden="true" />
          <span>{t('industryAgentsZone.workflowLabel')}</span>
        </span>
      </CardFooter>
    </AgentCatalogCard>
  );
};

export default IndustryAgentCard;
