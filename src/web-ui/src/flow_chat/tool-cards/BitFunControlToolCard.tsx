import React, { useEffect, useMemo, useState } from 'react';
import { Button, Icon, OverflowText } from '@bitfun/ui';
import {
  AmbientToolCard, AmbientToolCardHeader, ProminentToolCard, ProminentToolCardSummary, ToolCardStatusSlot,
} from '@bitfun/ui/flow-chat';
import { useI18n } from '@/infrastructure/i18n';
import type { ToolCardProps } from '../types/flow-chat';
import { useToolCardHeightContract } from './useToolCardHeightContract';
import { useBitFunControlDiscovery } from './useBitFunControlDiscovery';
import {
  buildBitFunControlCardModel, controlDescription, controlTitle, isBitFunControlDiscovery,
} from './bitFunControlCardModel';
import './BitFunControlToolCard.scss';

export const BitFunControlToolCard: React.FC<ToolCardProps> = ({ toolItem, onExpand }) => {
  const { t, currentLanguage, formatNumber } = useI18n('flow-chat');
  const [isExpanded, setExpanded] = useState(false);
  const [localCapability, setLocalCapability] = useState<unknown>();
  const model = useMemo(() => buildBitFunControlCardModel(toolItem, currentLanguage, localCapability),
    [toolItem, currentLanguage, localCapability]);
  const discovery = useBitFunControlDiscovery(toolItem, model, isExpanded);
  const { cardRootRef, applyExpandedState } = useToolCardHeightContract({
    toolId: toolItem.id, toolName: toolItem.toolName,
  });

  useEffect(() => {
    if (!model.capabilityId) return;
    let active = true;
    // Reuse the product catalog for labels only, and keep it out of the initial chat bundle.
    void import('@/app/global-search/interactiveCapabilityCatalog').then(({ getInteractiveCapability }) => {
      if (active) setLocalCapability(getInteractiveCapability(model.capabilityId!));
    }).catch(() => {
      // Older/remote capabilities and unavailable label chunks remain readable by their IDs.
      if (active) setLocalCapability(undefined);
    });
    return () => { active = false; };
  }, [model.capabilityId]);

  const actionLabels = {
    list: t('toolCards.bitFunControl.actions.list'),
    search: t('toolCards.bitFunControl.actions.search'),
    get: t('toolCards.bitFunControl.actions.get'),
    open: t('toolCards.bitFunControl.actions.open'),
    execute: t('toolCards.bitFunControl.actions.execute'),
    configure: t('toolCards.bitFunControl.actions.configure'),
  };
  const actionLabel = model.action ? actionLabels[model.action] : t('toolCards.bitFunControl.actions.unknown');
  const valueText = (value: unknown): string => {
    if (value === undefined) return t('toolCards.bitFunControl.noValue');
    if (value === null) return t('toolCards.bitFunControl.nullValue');
    if (typeof value === 'boolean') return value ? t('toolCards.bitFunControl.trueValue') : t('toolCards.bitFunControl.falseValue');
    if (typeof value === 'number') return formatNumber(value);
    if (typeof value === 'string') return value || t('toolCards.bitFunControl.emptyValue');
    return JSON.stringify(value, null, 2);
  };
  const waitingForApproval = model.status === 'pending_confirmation' || Boolean(
    toolItem.requiresConfirmation && !toolItem.userConfirmed
    && !['completed', 'error', 'cancelled', 'rejected'].includes(model.status),
  );
  const summary = [actionLabel, model.query ?? model.target].filter(Boolean).join(' · ');
  const icon = <Icon name="settings" size="sm" />;
  const statusIcon = (model.status === 'completed' && !model.confirmed) || waitingForApproval
    ? icon
    : <ToolCardStatusSlot status={model.status === 'confirmed' ? 'preparing' : model.status} toolIcon={icon} />;
  const fields = [
    model.target && { label: t('toolCards.bitFunControl.target'), value: model.target },
    model.query && { label: t('toolCards.bitFunControl.query'), value: model.query },
    model.action === 'configure' && model.requestedValue !== undefined && {
      label: t('toolCards.bitFunControl.requestedValue'), value: valueText(model.requestedValue),
    },
    model.confirmed && model.effectiveValue !== undefined && {
      label: t('toolCards.bitFunControl.effectiveValue'), value: valueText(model.effectiveValue),
    },
    ...model.currentValues.map(item => ({ label: item.label, value: valueText(item.value) })),
  ].filter((field): field is { label: string; value: string } => Boolean(field));
  const description = controlDescription(model.capability, currentLanguage);
  const hasDiscoveryResults = model.confirmed && (model.action === 'list' || model.action === 'search');
  const hasAvailabilityNotice = model.action === 'get' && Boolean(model.availability) && model.availability !== 'available';
  const hasDetails = Boolean(model.failed || description || fields.length || hasAvailabilityNotice || model.syncPending || hasDiscoveryResults);
  const toggle = () => applyExpandedState(isExpanded, !isExpanded, setExpanded, { onExpand });
  const details = (
    <div className="bitfun-control-card__details" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="details">
      {model.failed && <p className="bitfun-control-card__error" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="error">{model.error || t('toolCards.default.failed')}</p>}
      {description && <p className="bitfun-control-card__description" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="description">{description}</p>}
      {fields.length > 0 && <dl className="bitfun-control-card__fields" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="fields">
        {fields.map((field, index) => <div className="bitfun-control-card__field" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="field" key={index}>
          <dt data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="label">{field.label}</dt>
          <dd data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="value">{field.value}</dd>
        </div>)}
      </dl>}
      {hasAvailabilityNotice && (
        <p className="bitfun-control-card__notice" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="notice">
          {t('toolCards.bitFunControl.controlUnavailable')}{model.availabilityReason && ` · ${model.availabilityReason}`}
        </p>
      )}
      {model.syncPending && <p className="bitfun-control-card__notice" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="notice">
        {t('toolCards.bitFunControl.syncPendingDetails')}{model.syncReason && ` · ${model.syncReason}`}
      </p>}
      {hasDiscoveryResults && (
        <div className="bitfun-control-card__results" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="results">
          {discovery.items.length === 0 ? (!discovery.loading && !discovery.error && <p data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="description">{t('toolCards.bitFunControl.noResults')}</p>) : (
            <ul className="bitfun-control-card__list" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="list">
              {discovery.items.map((item, index) => <li className="bitfun-control-card__result" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="result" key={index} data-overflow-trigger>
                <OverflowText>{controlTitle(item, currentLanguage) ?? String(item.capabilityId ?? item.id ?? '')}</OverflowText>
                {controlDescription(item, currentLanguage) && <p data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="description">{controlDescription(item, currentLanguage)}</p>}
              </li>)}
            </ul>
          )}
          {discovery.loading && <p role="status" className="bitfun-control-card__description" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="description">
            {t('toolCards.bitFunControl.loadingAll')}
          </p>}
          {discovery.error && <>
            <p role="status" className="bitfun-control-card__notice" data-bitfun-component="bitfun-control-tool-card" data-bitfun-part="notice">
              {discovery.error === 'catalog-changed' ? t('toolCards.bitFunControl.catalogChanged')
                : discovery.error === 'surface-changed' ? t('toolCards.bitFunControl.sourceDeviceRequired')
                  : t('toolCards.bitFunControl.loadAllFailed')}
            </p>
            {discovery.error === 'load-failed' && <Button variant="text" size="sm" onClick={discovery.retry}>
              {t('toolCards.bitFunControl.retryLoad')}
            </Button>}
          </>}
        </div>
      )}
    </div>
  );
  const common = {
    'data-bitfun-tool-card': 'bitfun-control',
    status: model.status,
    isExpanded: isExpanded && hasDetails,
    expandedContent: hasDetails ? details : undefined,
  };

  return <div ref={cardRootRef} data-bitfun-adapter="bitfun-control" data-tool-card-id={toolItem.id}>
    {isBitFunControlDiscovery(model.input) ? (
      <AmbientToolCard {...common} onClick={hasDetails ? toggle : undefined}
        header={<AmbientToolCardHeader action={t('toolCards.bitFunControl.title')} content={summary}
          icon={statusIcon} />} />
    ) : (
      <ProminentToolCard {...common} allowExpandedWhenFailed onToggle={hasDetails ? toggle : undefined} requiresConfirmation={waitingForApproval}
        summary={<ProminentToolCardSummary action={t('toolCards.bitFunControl.title')} content={summary}
          icon={statusIcon} />} />
    )}
  </div>;
};
