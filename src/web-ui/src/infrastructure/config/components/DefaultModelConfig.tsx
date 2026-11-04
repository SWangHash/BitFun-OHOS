import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { Combobox, Icon, IconButton, Tooltip } from '@bitfun/ui';
import { Spinner } from '@bitfun/ui';
import { notificationService } from '@/shared/notification-system';
import { configManager } from '../services/ConfigManager';
import type {
  AIModelConfig,
  DefaultModels,
} from '../types';
import { ConfigEmptyState, ConfigPageRow } from './common';
import { createLogger } from '@/shared/utils/logger';
import { useModelSelectPresentation } from './ModelSelectPresentation';
import {
  filterSelectableTextChatModels,
  isSelectableModelForCapability,
} from '../services/modelCategory';
import './DefaultModelConfig.scss';

const log = createLogger('DefaultModelConfig');

const normalizeSelectValue = (value: string | number | (string | number)[]): string | number =>
  Array.isArray(value) ? (value[0] ?? '') : value;

type DefaultModelSlot = 'primary' | 'fast' | 'image_understanding' | 'speech_recognition';

function normalizeDefaultModels(config: Partial<DefaultModels> | null | undefined): DefaultModels {
  return {
    primary: config?.primary || null,
    fast: config?.fast || null,
    image_understanding: config?.image_understanding || null,
    speech_recognition: config?.speech_recognition || null,
  };
}

function mergeConfirmedDefaults(
  current: DefaultModels,
  confirmed: DefaultModels,
  pendingSlots: ReadonlySet<DefaultModelSlot>,
): DefaultModels {
  return {
    primary: pendingSlots.has('primary') ? current.primary : confirmed.primary,
    fast: pendingSlots.has('fast') ? current.fast : confirmed.fast,
    image_understanding: pendingSlots.has('image_understanding')
      ? current.image_understanding
      : confirmed.image_understanding,
    speech_recognition: pendingSlots.has('speech_recognition')
      ? current.speech_recognition
      : confirmed.speech_recognition,
  };
}

interface DefaultModelConfigProps {
  compact?: boolean;
  models?: AIModelConfig[];
  defaultModels?: DefaultModels;
  loading?: boolean;
  disabled?: boolean;
  onDefaultModelsChange?: (models: DefaultModels) => void;
}

export const DefaultModelConfig: React.FC<DefaultModelConfigProps> = ({
  compact = false, models: providedModels, defaultModels: providedDefaults, loading: providedLoading,
  disabled = false, onDefaultModelsChange,
}) => {
  const externallyLoaded = providedModels !== undefined && providedDefaults !== undefined;
  const { t } = useTranslation('settings/default-model');
  const { buildModelOption } = useModelSelectPresentation();
  const renderSlotLabel = (label: string, description: string) => compact ? (
    <span className="default-model-config__slot-label-content">{label}
      <Tooltip content={description} placement="top"><IconButton size="xs" variant="quiet" aria-label={description} icon={<Icon name="info" size="xs" />} /></Tooltip>
    </span>
  ) : label;
  const renderOptionalLabel = (text: string) => (
    <>
      {text}
      <span className="default-model-config__optional-label">（{t('core.optional')}）</span>
    </>
  );
  
  
  const [loading, setLoading] = useState(!externallyLoaded);
  const [models, setModels] = useState<AIModelConfig[]>(providedModels ?? []);
  const [defaultModels, setDefaultModels] = useState<DefaultModels>(providedDefaults ?? {
    primary: null,
    fast: null,
    image_understanding: null,
    speech_recognition: null,
  });
  const loadRevisionRef = useRef(0);
  const pendingDefaultSlotsRef = useRef(new Set<DefaultModelSlot>());
  const slotMutationRevisionRef = useRef<Record<DefaultModelSlot, number>>({
    primary: 0,
    fast: 0,
    image_understanding: 0,
    speech_recognition: 0,
  });

  const loadData = useCallback(async (initial: boolean) => {
    const revision = ++loadRevisionRef.current;
    try {
      if (initial) setLoading(true);

      const configs = await configManager.getConfigs(['ai.models', 'ai.default_models']);
      if (revision !== loadRevisionRef.current) return;
      const allModels = (configs['ai.models'] as AIModelConfig[] | undefined) || [];
      const defaultModelsConfig = configs['ai.default_models'] as Partial<DefaultModels> | undefined;

      setModels(allModels);
      const confirmed = normalizeDefaultModels(defaultModelsConfig);
      setDefaultModels(current => mergeConfirmedDefaults(
        current,
        confirmed,
        pendingDefaultSlotsRef.current,
      ));
    } catch (error) {
      log.error('Failed to load data', error);
      notificationService.error(t('messages.loadFailed'));
    } finally {
      if (revision === loadRevisionRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!externallyLoaded) return;
    setModels(providedModels!);
    setDefaultModels(current => mergeConfirmedDefaults(current, providedDefaults!, pendingDefaultSlotsRef.current));
    setLoading(providedLoading ?? false);
  }, [externallyLoaded, providedModels, providedDefaults, providedLoading]);

  useEffect(() => {
    if (externallyLoaded) return;
    let disposed = false;
    let refreshQueued = false;
    void loadData(true);

    const refresh = () => {
      if (refreshQueued) return;
      refreshQueued = true;
      queueMicrotask(() => {
        refreshQueued = false;
        if (!disposed) void loadData(false);
      });
    };

    const unsubscribeModels = configManager.watch('ai.models', refresh);
    const unsubscribeDefaultModels = configManager.watch('ai.default_models', refresh);

    return () => {
      disposed = true;
      unsubscribeModels();
      unsubscribeDefaultModels();
    };
  }, [loadData, externallyLoaded]);

  
  const getModelName = useCallback((modelId: string | null | undefined): string | undefined => {
    if (!modelId) return undefined;
    const model = models.find(m => m.id === modelId);
    return model?.model_name;
  }, [models]);

  
  const slotLabel = useCallback((slot: DefaultModelSlot): string => {
    switch (slot) {
      case 'primary':
        return t('core.primary.label');
      case 'fast':
        return t('core.fast.label');
      case 'image_understanding':
        return t('optional.capabilities.image_understanding.label');
      case 'speech_recognition':
        return t('optional.capabilities.speech_recognition.label');
      default: {
        const exhaustive: never = slot;
        return exhaustive;
      }
    }
  }, [t]);

  const handleDefaultModelChange = async (slot: DefaultModelSlot, modelId: string | number) => {
    const modelIdStr = modelId ? String(modelId) : null;
    const previousValue = defaultModels[slot];
    const revision = ++slotMutationRevisionRef.current[slot];
    pendingDefaultSlotsRef.current.add(slot);
    setDefaultModels(previous => ({ ...previous, [slot]: modelIdStr }));
    try {
      await configManager.setConfig(`ai.default_models.${slot}`, modelIdStr);
      const confirmed = normalizeDefaultModels(
        await configManager.getConfig<Partial<DefaultModels>>('ai.default_models'),
      );
      if (slotMutationRevisionRef.current[slot] !== revision) return;
      onDefaultModelsChange?.(confirmed);
      const pendingSlots = new Set(pendingDefaultSlotsRef.current);
      pendingSlots.delete(slot);
      setDefaultModels(current => mergeConfirmedDefaults(current, confirmed, pendingSlots));

      const modelName = getModelName(modelIdStr);
      let successMessage: string;
      if (modelIdStr) {
        successMessage = t('messages.modelUpdated', {
          slot: slotLabel(slot),
          name: modelName || modelIdStr,
        });
      } else if (slot === 'fast') {
        successMessage = t('messages.fastModelCleared');
      } else {
        successMessage = t('messages.modelCleared', { slot: slotLabel(slot) });
      }
      notificationService.success(
        successMessage,
        { duration: 2000 }
      );
    } catch (error) {
      log.error('Failed to update default model', { slot, modelId: modelIdStr, error });
      if (slotMutationRevisionRef.current[slot] === revision) {
        try {
          const confirmed = normalizeDefaultModels(
            await configManager.getConfig<Partial<DefaultModels>>('ai.default_models'),
          );
          const pendingSlots = new Set(pendingDefaultSlotsRef.current);
          pendingSlots.delete(slot);
          setDefaultModels(current => mergeConfirmedDefaults(current, confirmed, pendingSlots));
        } catch {
          setDefaultModels(previous => ({ ...previous, [slot]: previousValue }));
        }
      }
      notificationService.error(t('messages.updateFailed'));
    } finally {
      if (slotMutationRevisionRef.current[slot] === revision) {
        pendingDefaultSlotsRef.current.delete(slot);
      }
    }
  };

  
  // Keep the primary/fast slots aligned with the ChatInput selector: enabled
  // non-chat models must never become a text-generation default by accident.
  const enabledModels = filterSelectableTextChatModels(models);
  const imageUnderstandingModels = models.filter(model => (
    isSelectableModelForCapability(model, 'image_understanding')
  ));
  const speechRecognitionModels = models.filter(model => (
    isSelectableModelForCapability(model, 'speech_recognition')
  ));

  if (loading && !compact) {
    return (
      <div className="default-model-config__loading" data-bitfun-component="default-model-config" data-bitfun-part="loading" data-bitfun-state="loading">
        <Spinner size="sm" />
        <p>{t('loading')}</p>
      </div>
    );
  }

  if (models.length === 0 && !compact) {
    return (
      <ConfigEmptyState
        data-bitfun-component="default-model-config"
        data-bitfun-part="empty"
        data-bitfun-state="empty"
        icon={<Layers size={36} aria-hidden="true" />}
        description={t('empty.noModels')}
      />
    );
  }

  return (
    <div className={`default-model-config${compact ? ' default-model-config--compact' : ''}`} data-bitfun-component="default-model-config" data-bitfun-part="root">
      <ConfigPageRow
        label={renderSlotLabel(t('core.primary.label'), t('core.primary.description'))}
        description={compact ? undefined : t('core.primary.description')}
        multiline={compact}
        required
        align="center"
      >
        <Combobox
          aria-required="true"
          data-bitfun-component="default-model-config"
          data-bitfun-part="primaryModel"
          value={defaultModels.primary || ''}
          onValueChange={(value) => handleDefaultModelChange('primary', normalizeSelectValue(value))}
          placeholder={t('core.primary.placeholder')}
          options={enabledModels.map(buildModelOption)}
          disabled={loading || disabled || enabledModels.length === 0}
          size="sm"
          triggerTestId="default-primary-model-select"
          panelTestId="default-primary-model-select-menu"
        />
      </ConfigPageRow>

      <ConfigPageRow
        label={compact ? renderSlotLabel(t('core.fast.label'), t('core.fast.description')) : renderOptionalLabel(t('core.fast.label'))}
        description={compact ? undefined : t('core.fast.description')}
        multiline={compact}
        align="center"
      >
        <Combobox
          data-bitfun-component="default-model-config"
          data-bitfun-part="lightweightModel"
          value={defaultModels.fast || ''}
          onValueChange={(value) => handleDefaultModelChange('fast', normalizeSelectValue(value))}
          placeholder={t('core.fast.placeholder')}
          options={[
            { label: t('core.fast.notSet'), value: '' },
            ...enabledModels.map(buildModelOption),
          ]}
          disabled={loading || disabled || models.length === 0}
          size="sm"
          triggerTestId="default-fast-model-select"
          panelTestId="default-fast-model-select-menu"
        />
      </ConfigPageRow>

      <ConfigPageRow
        label={compact ? renderSlotLabel(t('optional.capabilities.image_understanding.label'), t('optional.capabilities.image_understanding.description')) : renderOptionalLabel(t('optional.capabilities.image_understanding.label'))}
        description={compact ? undefined : t('optional.capabilities.image_understanding.description')}
        multiline={compact}
        align="center"
      >
        <Combobox
          data-bitfun-component="default-model-config"
          data-bitfun-part="embeddingModel"
          value={defaultModels.image_understanding || ''}
          onValueChange={(value) => handleDefaultModelChange('image_understanding', normalizeSelectValue(value))}
          disabled={loading || disabled || models.length === 0}
          placeholder={t('optional.selectModel')}
          options={[
            { label: t('optional.notSet'), value: '' },
            ...imageUnderstandingModels.map(buildModelOption),
          ]}
          size="sm"
        />
      </ConfigPageRow>

      <ConfigPageRow
        label={compact ? renderSlotLabel(t('optional.capabilities.speech_recognition.label'), t('optional.capabilities.speech_recognition.description')) : renderOptionalLabel(t('optional.capabilities.speech_recognition.label'))}
        description={compact ? undefined : t('optional.capabilities.speech_recognition.description')}
        multiline={compact}
        align="center"
      >
        <Combobox
          value={defaultModels.speech_recognition || ''}
          onValueChange={(value) => handleDefaultModelChange('speech_recognition', normalizeSelectValue(value))}
          placeholder={t('optional.notSet')}
          options={[
            { label: t('optional.notSet'), value: '' },
            ...speechRecognitionModels.map(buildModelOption),
          ]}
          className="default-model-config__model-select"
          disabled={speechRecognitionModels.length === 0}
          size="sm"
        />
      </ConfigPageRow>
    </div>
  );
};

export default DefaultModelConfig;
