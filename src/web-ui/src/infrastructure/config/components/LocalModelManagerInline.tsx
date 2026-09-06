/**
 * LocalModelManagerInline — inline local AI model management panel rendered
 * inside the AI Model selection form when the selected provider is the local
 * (Ollama) provider. It is the only provider that exposes download / pause /
 * refresh actions.
 *
 * State resolution rule: model.status from the backend is the single source
 * of truth. pullingModels / pausingModels are only used for optimistic
 * button disabling.
 *
 * The downloaded-model list for the model picker dropdown is fetched
 * separately by the parent via the provider catalog (/v1/models). This panel
 * only owns pull / pause / refresh and notifies the parent through
 * onModelsChanged whenever the downloaded set changes.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
  Download,
  Pause,
  HardDrive,
  CheckCircle,
  AlertCircle,
  Loader,
} from 'lucide-react';
import { Button, IconButton } from '@/component-library';
import { localModelApi } from '@/infrastructure/api';
import type {
  LocalModel,
  LocalServiceStatus,
  LocalModelPullProgress,
  LocalModelStatus,
} from '@/infrastructure/api/service-api/LocalModelAPI';
import { ConfigMessage } from './common';
import { createLogger } from '@/shared/utils/logger';
import './LocalModelManagerInline.scss';

const log = createLogger('LocalModelManagerInline');

interface LocalModelManagerInlineProps {
  /** Called when the local model set changes (pull completed / refreshed). */
  onModelsChanged?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function StatusIcon({ status }: { status: LocalModelStatus }) {
  switch (status) {
    case 'downloaded':
      return <CheckCircle size={16} className="local-model-manager__status-icon local-model-manager__status-icon--downloaded" />;
    case 'downloading':
      return <Loader size={16} className="local-model-manager__status-icon local-model-manager__status-icon--downloading" />;
    case 'paused':
      return <Pause size={16} className="local-model-manager__status-icon local-model-manager__status-icon--paused" />;
    case 'failed':
      return <AlertCircle size={16} className="local-model-manager__status-icon local-model-manager__status-icon--failed" />;
    default:
      return <HardDrive size={16} className="local-model-manager__status-icon local-model-manager__status-icon--undownloaded" />;
  }
}

export const LocalModelManagerInline: React.FC<LocalModelManagerInlineProps> = ({
  onModelsChanged,
}) => {
  const { t } = useTranslation('settings/local-model');

  const [serviceStatus, setServiceStatus] = useState<LocalServiceStatus | null>(null);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  // Optimistic UI: tracks in-flight pull/pause requests for button disabling only.
  const [pullingModels, setPullingModels] = useState<Set<string>>(new Set());
  const [pausingModels, setPausingModels] = useState<Set<string>>(new Set());
  const [progressMap, setProgressMap] = useState<Record<string, LocalModelPullProgress>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isMounted = useRef(false);
  // Track which models we initiated a pull for, so we can keep pullingModels
  // in sync with the backend status.
  const activePulls = useRef<Set<string>>(new Set());
  // Track the last downloaded-model name set, so we only notify the parent
  // when the set actually changes.
  const lastDownloadedNames = useRef<Set<string>>(new Set());

  const notifyIfDownloadedChanged = useCallback((list: LocalModel[]) => {
    const nextDownloaded = new Set(
      list.filter((m) => m.status === 'downloaded').map((m) => m.name),
    );
    const changed =
      nextDownloaded.size !== lastDownloadedNames.current.size
      || Array.from(nextDownloaded).some((name) => !lastDownloadedNames.current.has(name));
    lastDownloadedNames.current = nextDownloaded;
    if (changed) {
      onModelsChanged?.();
    }
  }, [onModelsChanged]);

  // --- Refresh model list from backend ---
  const refreshModels = useCallback(async () => {
    try {
      const list = await localModelApi.listModels();
      if (isMounted.current) {
        setModels(list);
        notifyIfDownloadedChanged(list);
        // Sync pullingModels: remove entries whose backend status is no longer "downloading"
        // (handles external state changes like CLI pause/cancel/complete)
        setPullingModels((prev) => {
          const next = new Set(prev);
          for (const name of next) {
            const backendModel = list.find((m) => m.name === name);
            if (!backendModel || backendModel.status !== 'downloading') {
              next.delete(name);
              activePulls.current.delete(name);
            }
          }
          return next;
        });
      }
      return list;
    } catch (e) {
      log.error('Failed to refresh local models', e);
      return null;
    }
  }, [notifyIfDownloadedChanged]);

  // --- Detect service and load models on mount ---
  const detectAndLoad = useCallback(async () => {
    setDetecting(true);
    setMessage(null);
    try {
      const status = await localModelApi.detectService();
      if (!isMounted.current) return;
      setServiceStatus(status);

      if (status.available) {
        setLoadingModels(true);
        try {
          await refreshModels();
        } catch (e) {
          log.error('Failed to list local models', e);
          if (isMounted.current) {
            setMessage({ type: 'error', text: t('error.listFailed') });
          }
        } finally {
          if (isMounted.current) setLoadingModels(false);
        }
      } else {
        setModels([]);
        lastDownloadedNames.current = new Set();
      }
    } catch (e) {
      log.error('Failed to detect local model service', e);
      if (isMounted.current) {
        setServiceStatus({ available: false, port: 0, models: [] });
        setMessage({ type: 'error', text: t('error.detectFailed') });
      }
    } finally {
      if (isMounted.current) setDetecting(false);
    }
  }, [t, refreshModels]);

  useEffect(() => {
    isMounted.current = true;
    void detectAndLoad();
    return () => { isMounted.current = false; };
  }, [detectAndLoad]);

  // --- Listen for pull progress events (best-effort; may not work on all platforms) ---
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    (async () => {
      try {
        unlistenFn = await localModelApi.onPullProgress((progress) => {
          if (cancelled || !isMounted.current) return;
          log.info('Pull progress event', {
            model: progress.modelName,
            status: progress.status,
            total: progress.total,
            completed: progress.completed,
          });

          // Always update progress map for visual feedback
          setProgressMap((prev) => ({ ...prev, [progress.modelName]: progress }));

          // On terminal states, refresh the model list to get authoritative status
          if (progress.status === 'success' || progress.status === 'failed' || progress.status === 'paused') {
            activePulls.current.delete(progress.modelName);
            setPullingModels((prev) => {
              const next = new Set(prev);
              next.delete(progress.modelName);
              return next;
            });

            void refreshModels();

            // Clear progress after a delay for terminal states
            if (progress.status === 'success' || progress.status === 'failed') {
              setTimeout(() => {
                if (isMounted.current) {
                  setProgressMap((prev) => {
                    const next = { ...prev };
                    delete next[progress.modelName];
                    return next;
                  });
                }
              }, 2000);
            }
          }
        });
      } catch (e) {
        log.error('Failed to subscribe to pull progress events', e);
      }
    })();

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [refreshModels]);

  // --- Polling fallback: refresh model list while downloads are active ---
  // On OHOS the Tauri event bridge may not deliver push events to the WebView,
  // so we poll listModels every 2 s whenever any model is downloading.
  useEffect(() => {
    const hasDownloading = models.some((m) => m.status === 'downloading')
      || pullingModels.size > 0;

    if (!hasDownloading || !serviceStatus?.available) return;

    const interval = setInterval(() => {
      if (isMounted.current) {
        void refreshModels();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [models, pullingModels, serviceStatus, refreshModels]);

  // --- Pull a model ---
  const handlePull = useCallback(async (modelName: string) => {
    setPullingModels((prev) => new Set(prev).add(modelName));
    activePulls.current.add(modelName);
    setMessage(null);
    try {
      await localModelApi.pullModel(modelName);
    } catch (e) {
      log.error('Failed to pull model', e);
      activePulls.current.delete(modelName);
      setPullingModels((prev) => {
        const next = new Set(prev);
        next.delete(modelName);
        return next;
      });
      setMessage({ type: 'error', text: t('error.pullFailed', { name: modelName }) });
    }
  }, [t]);

  // --- Pause a download ---
  const handlePause = useCallback(async (modelName: string) => {
    setPausingModels((prev) => new Set(prev).add(modelName));
    setMessage(null);
    try {
      await localModelApi.pauseDownload(modelName);
      // Refresh to get the authoritative paused status
      await refreshModels();
    } catch (e) {
      log.error('Failed to pause download', e);
      setMessage({ type: 'error', text: t('error.pauseFailed', { name: modelName }) });
    } finally {
      setPausingModels((prev) => {
        const next = new Set(prev);
        next.delete(modelName);
        return next;
      });
    }
  }, [t, refreshModels]);

  // --- Refresh model list (manual) ---
  const handleRefresh = useCallback(async () => {
    setMessage(null);
    setLoadingModels(true);
    try {
      const status = await localModelApi.detectService();
      setServiceStatus(status);
      if (status.available) {
        await refreshModels();
      } else {
        setModels([]);
        lastDownloadedNames.current = new Set();
      }
    } catch (e) {
      log.error('Failed to refresh local models', e);
      setMessage({ type: 'error', text: t('error.refreshFailed') });
    } finally {
      setLoadingModels(false);
    }
  }, [refreshModels, t]);

  // --- Compute effective display status ---
  // Use backend model.status as the single source of truth, with two
  // optimistic overrides so the progress bar appears the instant a pull is
  // in flight (before the backend / events confirm "downloading"):
  //   1. a progress event reporting downloading/pulling
  //   2. pullingModels (we initiated a pull this session)
  // pullingModels is resynced to the backend status by refreshModels, so it
  // never sticks in "downloading" once the backend reports otherwise.
  const getEffectiveStatus = useCallback((model: LocalModel): LocalModelStatus => {
    // If we have a progress event showing "downloading", trust that
    const progress = progressMap[model.name];
    if (progress && (progress.status === 'downloading' || progress.status === 'pulling')) {
      return 'downloading';
    }
    // Optimistic: a pull we initiated is in flight -> show as downloading
    if (pullingModels.has(model.name)) {
      return 'downloading';
    }
    // Otherwise, trust backend status
    return model.status;
  }, [progressMap, pullingModels]);

  // --- Render helpers ---
  const renderModelRow = (model: LocalModel) => {
    const isPulling = pullingModels.has(model.name);
    const isPausing = pausingModels.has(model.name);
    const progress = progressMap[model.name];
    const effectiveStatus = getEffectiveStatus(model);

    const downloadPercent =
      progress && progress.total > 0
        ? Math.round((progress.completed / progress.total) * 100)
        : model.completed && model.size > 0
          ? Math.round((model.completed / model.size) * 100)
          : 0;

    // Determine if progress bar should show: downloading OR paused with partial progress
    const hasProgress = effectiveStatus === 'downloading'
      || (effectiveStatus === 'paused' && (downloadPercent > 0 || (progress && progress.total > 0)));
    // Indeterminate: a download is in flight but no byte progress is known yet
    // (events/polling haven't reported total/completed). Show a shimmer instead
    // of an empty 0% bar so the activity is clearly visible.
    const isIndeterminate = effectiveStatus === 'downloading'
      && downloadPercent === 0
      && !(progress && progress.total > 0);

    return (
      <div key={model.name} className="local-model-manager__model-row" data-openbitfun-component="local-model-manager" data-openbitfun-part="modelRow">
        <div className="local-model-manager__model-row-top">
          <div className="local-model-manager__model-info">
            <StatusIcon status={effectiveStatus} />
            <div className="local-model-manager__model-details">
              <span className="local-model-manager__model-name">{model.name}</span>
              <span className="local-model-manager__model-meta">
                {model.details.family && <span className="local-model-manager__model-family">{model.details.family}</span>}
                {model.details.parameterSize && <span>{model.details.parameterSize}</span>}
                {model.size > 0 && <span>{formatBytes(model.size)}</span>}
              </span>
            </div>
          </div>

          <div className="local-model-manager__model-actions">
            {/* Action buttons — mutually exclusive based on effectiveStatus */}

          {effectiveStatus === 'undownloaded' && (
            <Button
              size="small"
              variant="secondary"
              onClick={() => void handlePull(model.name)}
              disabled={isPulling}
            >
              {isPulling ? <Loader size={14} className="local-model-manager__spin" /> : <Download size={14} />}
              {isPulling ? t('status.downloading') : t('action.download')}
            </Button>
          )}

          {effectiveStatus === 'downloading' && (
            <Button
              size="small"
              variant="secondary"
              onClick={() => void handlePause(model.name)}
              disabled={isPausing}
            >
              {isPausing ? <Loader size={14} className="local-model-manager__spin" /> : <Pause size={14} />}
              {isPausing ? t('action.pausing') : t('action.pause')}
            </Button>
          )}

          {effectiveStatus === 'paused' && (
            <Button
              size="small"
              variant="secondary"
              onClick={() => void handlePull(model.name)}
              disabled={isPulling}
            >
              {isPulling ? <Loader size={14} className="local-model-manager__spin" /> : <Download size={14} />}
              {isPulling ? t('status.downloading') : t('action.resume')}
            </Button>
          )}

          {effectiveStatus === 'downloaded' && (
            <span className="local-model-manager__ready-badge" data-openbitfun-component="local-model-manager" data-openbitfun-part="readyBadge">
              <CheckCircle size={14} />
              {t('status.ready')}
            </span>
          )}

          {effectiveStatus === 'failed' && (
            <Button
              size="small"
              variant="secondary"
              onClick={() => void handlePull(model.name)}
              disabled={isPulling}
            >
              {isPulling ? <Loader size={14} className="local-model-manager__spin" /> : <Download size={14} />}
              {t('action.retry')}
            </Button>
          )}
        </div>
        </div>

        {/* Full-width progress bar below the info/actions row */}
        {hasProgress && (
          <div className="local-model-manager__progress" data-openbitfun-component="local-model-manager" data-openbitfun-part="progress">
            <div className="local-model-manager__progress-bar">
              <div
                className={
                  isIndeterminate
                    ? 'local-model-manager__progress-fill local-model-manager__progress-fill--indeterminate'
                    : `local-model-manager__progress-fill${effectiveStatus === 'paused' ? ' local-model-manager__progress-fill--paused' : ''}`
                }
                style={isIndeterminate ? undefined : { width: `${downloadPercent}%` }}
              />
            </div>
            <span className="local-model-manager__progress-text">
              {isIndeterminate
                ? t('status.downloading')
                : `${downloadPercent}%${progress && progress.total > 0 ? ` (${formatBytes(progress.completed)} / ${formatBytes(progress.total)})` : ''}`}
            </span>
          </div>
        )}
      </div>
    );
  };

  // --- Main render ---
  const isAvailable = serviceStatus?.available ?? false;
  const isBusy = detecting || loadingModels;

  return (
    <div className="local-model-manager" data-openbitfun-component="local-model-manager" data-openbitfun-part="root">
      <div className="local-model-manager__header" data-openbitfun-component="local-model-manager" data-openbitfun-part="header">
        <span className="local-model-manager__header-title">{t('section.title')}</span>
        <IconButton
          variant="ghost"
          size="small"
          onClick={() => void handleRefresh()}
          tooltip={t('action.refresh')}
          disabled={isBusy}
        >
          <RefreshCw size={16} className={isBusy ? 'local-model-manager__spin' : ''} />
        </IconButton>
      </div>

      {/* Service status banner */}
      {!isAvailable && !detecting && (
        <ConfigMessage
          message={{ type: 'info', text: t('service.unavailable') }}
        />
      )}

      {isAvailable && serviceStatus && (
        <div className="local-model-manager__service-info" data-openbitfun-component="local-model-manager" data-openbitfun-part="serviceInfo">
          <span className="local-model-manager__service-name">
            {serviceStatus.serviceName || 'Ollama'}
          </span>
          {serviceStatus.version && (
            <span className="local-model-manager__service-version">
              v{serviceStatus.version}
            </span>
          )}
        </div>
      )}

      {/* Message */}
      {message && (
        <ConfigMessage
          message={{ type: message.type, text: message.text }}
        />
      )}

      {/* Model list */}
      {isAvailable && models.length > 0 && (
        <div className="local-model-manager__model-list" data-openbitfun-component="local-model-manager" data-openbitfun-part="modelList">
          {models.map(renderModelRow)}
        </div>
      )}

      {/* Empty state */}
      {isAvailable && models.length === 0 && !loadingModels && (
        <div className="local-model-manager__empty" data-openbitfun-component="local-model-manager" data-openbitfun-part="empty">
          {t('empty.description')}
        </div>
      )}

      {/* Loading state */}
      {loadingModels && (
        <div className="local-model-manager__loading" data-openbitfun-component="local-model-manager" data-openbitfun-part="loading">
          {t('loading')}
        </div>
      )}
    </div>
  );
};

export default LocalModelManagerInline;
