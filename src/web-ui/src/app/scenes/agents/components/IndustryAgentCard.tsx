import React from 'react';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@bitfun/ui';
import { Badge } from '@/component-library';
import type { AgentWithCapabilities } from '../agentsStore';
import { AGENT_ICON_MAP } from '../agentsIcons';
import { getCardGradient } from '@/shared/utils/cardGradients';
import './AgentCard.scss';

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
  const openDetails = () => onOpenDetails?.(agent);

  return (
    <div
      data-bitfun-component="industry-agent-card"
      data-bitfun-part="root"
      className="agent-card"
      style={{
        '--surface-stagger-index': index,
        '--agent-card-gradient': getCardGradient(agent.id || agent.name),
      } as React.CSSProperties}
      onClick={openDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && openDetails()}
      aria-label={agent.name}
      data-testid="agent-list-item"
      data-agent-id={agent.id}
      data-agent-name={agent.name}
    >
      <div className="agent-card__header" data-bitfun-component="industry-agent-card" data-bitfun-part="header">
        <div className="agent-card__icon-area" data-bitfun-component="industry-agent-card" data-bitfun-part="iconArea">
          <div className="agent-card__icon" data-bitfun-component="industry-agent-card" data-bitfun-part="icon">
            <Icon {...iconSource} size="lg" />
          </div>
        </div>
        <div className="agent-card__header-info" data-bitfun-component="industry-agent-card" data-bitfun-part="headerInfo">
          <div className="agent-card__title-row" data-bitfun-component="industry-agent-card" data-bitfun-part="titleRow">
            <span className="agent-card__name" data-bitfun-component="industry-agent-card" data-bitfun-part="name" data-testid="agent-list-item-title">
              {t('industryAgentsZone.qtMigration.name')}
            </span>
            <div className="agent-card__badges" data-bitfun-component="industry-agent-card" data-bitfun-part="badges">
              <Badge variant="accent">{t('industryAgentsZone.badge')}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="agent-card__body" data-bitfun-component="industry-agent-card" data-bitfun-part="body">
        <p className="agent-card__desc" data-bitfun-component="industry-agent-card" data-bitfun-part="description" data-testid="agent-list-item-description">
          {t('industryAgentsZone.qtMigration.description')}
        </p>
      </div>

      <div className="agent-card__footer" data-bitfun-component="industry-agent-card" data-bitfun-part="footer">
        <div className="agent-card__meta" data-bitfun-component="industry-agent-card" data-bitfun-part="meta">
          <span className="agent-card__meta-item">
            <Icon {...iconSource} size="xs" />
            {t('industryAgentsZone.workflowLabel')}
          </span>
        </div>
      </div>
    </div>
  );
};

export default IndustryAgentCard;