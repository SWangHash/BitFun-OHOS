import { Button, PageHeader } from '@openbitfun/ui';
import { ArrowRight, CircleCheck, CircleX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '../components/BrandMark';
import { ProgressBar } from '../components/ProgressBar';
import { InstallErrorPanel } from '../components/InstallErrorPanel';
import type { InstallProgress } from '../types/installer';

interface ProgressProps {
  progress: InstallProgress;
  error: string | null;
  canConfirmProgress: boolean;
  onConfirmProgress: () => void;
  onRetry: () => Promise<void>;
  onBackToOptions: () => void;
}

export function ProgressPage({
  progress,
  error,
  canConfirmProgress,
  onConfirmProgress,
  onRetry,
  onBackToOptions,
}: ProgressProps) {
  const { t } = useTranslation();
  const isCompleted = canConfirmProgress && !error;
  const percent = Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, progress.percent)) : 0;
  const stepLabels: Record<string, string> = {
    prepare: t('progress.prepare'),
    extract: t('progress.extract'),
    registry: t('progress.registry'),
    shortcuts: t('progress.shortcuts'),
    path: t('progress.path'),
    config: t('progress.config'),
    complete: t('progress.complete'),
  };
  const stepLabel = isCompleted
    ? t('progress.completed')
    : stepLabels[progress.step] || progress.step || t('progress.starting');

  return (
    <div className="page-shell">
      <div className="page-scroll">
        <div className="page-container page-container--center progress-content">
          <div className="progress-brand">
            <BrandMark working={!error && !isCompleted} />
            {isCompleted && <CircleCheck className="progress-brand__status status-success" size={24} aria-hidden="true" />}
            {error && <CircleX className="progress-brand__status status-danger" size={24} aria-hidden="true" />}
          </div>
          <div role="status" aria-live="polite">
            <PageHeader
              align="center"
              className="page-heading"
              title={error ? t('progress.failed') : isCompleted ? t('progress.completed') : t('progress.title')}
              description={error ? undefined : isCompleted ? t('progress.completedDescription') : t('progress.description')}
            />
          </div>
          {error ? (
            <InstallErrorPanel message={error} variant="bare" />
          ) : (
            <div className="progress-details">
              <div className="progress-meta">
                <span>{stepLabel}</span>
                <span className="progress-percent">{percent}%</span>
              </div>
              <ProgressBar percent={percent} completed={isCompleted} label={stepLabel} />
            </div>
          )}
        </div>
      </div>

      <div className="page-footer">
        {error ? (
          <>
            <Button variant="fill" onClick={onBackToOptions}>{t('options.title')}</Button>
            <Button variant="primary" onClick={() => { void onRetry(); }}>{t('progress.retry')}</Button>
          </>
        ) : canConfirmProgress ? (
          <Button variant="primary" trailingIcon={<ArrowRight />} onClick={onConfirmProgress}>
            {t('progress.confirmContinue')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
