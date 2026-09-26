import React from 'react';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CardBody, CardFooter, CardHeader, Icon, OverflowText } from '@bitfun/ui';
import { Badge } from '@/component-library';
import type { AgentWithCapabilities } from '../agentsStore';
import { AGENT_ICON_MAP } from '../agentsIcons';
import { getCardGradient } from '@/shared/utils/cardGradients';
import { getAgentDescription } from '../utils';
import AgentCatalogCard from './AgentCatalogCard';
import './AgentCatalogCard.scss';

/**
 * Industry agent card —renders a real backend-registered agent (e.g.
 * QtMigration) with a vertical-domain presentation: localized name/description
 * and an "industry agent" badge. Reuses `.agent-card` styling and the shared
 * AGENT_ICON_MAP icon source so it renders consistently with AgentCard.
 */
interface IndustryAgentCardProps {
  agent: AgentWithCapabilities;
  index?: number;
  onOpenDetails?: (agent: AgentWithCapabilities) => void;
}

const IndustryAgentCard: React.FC<IndustryAgentCardProps> = ({
  agent,
  index = 0,
  onOpenDetails,
}) => {
  const { t } = useTranslation('scenes/agents');
  const iconSource = AGENT_ICON_MAP[(agent.iconKey ?? 'bot') as keyof typeof AGENT_ICON_MAP] ?? { glyph: Bot };
  const name = t(`industryAgentsZone.agents.${agent.id}.name`, { defaultValue: agent.name });
  const description = t(
    `industryAgentsZone.agents.${agent.id}.description`,
    { defaultValue: getAgentDescription(t, agent) },
  );

  return (
    <AgentCatalogCard
      agent={{ ...agent, name }}
      onOpenDetails={(selectedAgent) => onOpenDetails?.(selectedAgent)}
      data-bitfun-component="industry-agent-card"
      data-bitfun-part="root"
      style={{
        '--surface-stagger-index': index,
        '--agent-card-gradient': getCardGradient(agent.id || agent.name),
      } as React.CSSProperties}
    >
      <CardHeader
        align="center"
        className="agent-catalog-card__header"
        data-bitfun-component="industry-agent-card"
        data-bitfun-part="header"
        title={(
          <div className="agent-catalog-card__title" data-bitfun-component="industry-agent-card" data-bitfun-part="headerInfo">
            <div className="agent-catalog-card__title-row" data-bitfun-component="industry-agent-card" data-bitfun-part="titleRow">
              <OverflowText className="agent-catalog-card__name" data-bitfun-component="industry-agent-card" data-bitfun-part="name" data-testid="agent-list-item-title">
                {name}
              </OverflowText>
              <span className="agent-catalog-card__identity">
                <span className="agent-catalog-card__icon" data-bitfun-component="industry-agent-card" data-bitfun-part="iconArea" aria-hidden="true">
                  <span data-bitfun-component="industry-agent-card" data-bitfun-part="icon">
                    <Icon {...iconSource} size="sm" />
                  </span>
                </span>
                <span data-bitfun-component="industry-agent-card" data-bitfun-part="badges">
                  <Badge variant="accent">{t('industryAgentsZone.badge')}</Badge>
                </span>
              </span>
            </div>
          </div>
        )}
      />

      <CardBody data-bitfun-component="industry-agent-card" data-bitfun-part="body">
        <OverflowText as="p" lines={2} className="agent-catalog-card__description" data-bitfun-component="industry-agent-card" data-bitfun-part="description" data-testid="agent-list-item-description">
          {description}
        </OverflowText>
      </CardBody>

      <CardFooter align="start" className="agent-catalog-card__footer" data-bitfun-component="industry-agent-card" data-bitfun-part="footer">
        <span className="agent-catalog-card__identity" data-bitfun-component="industry-agent-card" data-bitfun-part="meta">
          <Icon {...iconSource} size="xs" />
          {t('industryAgentsZone.workflowLabel')}
        </span>
      </CardFooter>
    </AgentCatalogCard>
  );
};

export default IndustryAgentCard;
