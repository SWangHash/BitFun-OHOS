/**
 * /btw marker card.
 * Inserted into the parent stream to show where a side thread was created.
 * Clicking opens the child session.
 */

import React, { useMemo } from 'react';
import { CornerDownRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { CompactToolCard, CompactToolCardHeader } from './CompactToolCard';
import { openBtwSessionInAuxPane, openMainSession } from '../services/openBtwSession';

export const BtwMarkerCard: React.FC<ToolCardProps> = React.memo(({ toolItem, sessionId }) => {
  const { t } = useTranslation('flow-chat');

  const input = (toolItem.toolCall?.input || {}) as any;
  const title = useMemo(() => {
    const raw = typeof input?.title === 'string' ? input.title : '';
    return raw.trim() || t('btw.threadLabel', { defaultValue: 'Side thread' });
  }, [input?.title, t]);

  const childSessionId = typeof input?.childSessionId === 'string' ? input.childSessionId : '';
  const clickable = !!childSessionId;

  return (
    <CompactToolCard
      status="completed"
      isExpanded={false}
      clickable={clickable}
      onClick={async () => {
        if (!childSessionId) return;
        const parentSessionId = typeof input?.parentSessionId === 'string' && input.parentSessionId
          ? input.parentSessionId
          : sessionId;
        if (!parentSessionId) return;

        await openMainSession(parentSessionId);
        openBtwSessionInAuxPane({
          childSessionId,
          parentSessionId,
        });
      }}
      header={
        <CompactToolCardHeader
          icon={<CornerDownRight size={16} />}
          action={t('btw.title', { defaultValue: 'Side question' })}
          content={
            <span style={{ opacity: 0.95 }}>
              {title}
            </span>
          }
          extra={
            <span style={{ opacity: 0.85 }}>
              {t('btw.openThread', { defaultValue: 'Open thread' })}
            </span>
          }
        />
      }
    />
  );
});

BtwMarkerCard.displayName = 'BtwMarkerCard';

