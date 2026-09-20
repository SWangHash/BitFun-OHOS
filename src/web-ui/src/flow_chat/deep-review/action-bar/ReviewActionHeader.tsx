import React from 'react';
import { Minus } from 'lucide-react';
import { CodeReviewReportExportActions } from '../../tool-cards/CodeReviewReportExportActions';

type ExportableReviewData = React.ComponentProps<typeof CodeReviewReportExportActions>['reviewData'];

interface ReviewActionHeaderProps {
  reviewData?: ExportableReviewData | null;
  isReviewRunning?: boolean;
  PhaseIcon: React.ComponentType<{
    size?: number | string;
    style?: React.CSSProperties;
    className?: string;
  }>;
  phaseIconClass: string;
  phaseTitle: string;
  errorMessage?: string | null;
  errorSummary?: string;
  errorDetailsLabel?: string;
  minimizeLabel: string;
  onMinimize: () => void;
}

export const ReviewActionHeader: React.FC<ReviewActionHeaderProps> = ({
  reviewData,
  isReviewRunning = false,
  PhaseIcon,
  phaseIconClass,
  phaseTitle,
  errorMessage,
  errorSummary,
  errorDetailsLabel,
  minimizeLabel,
  onMinimize,
}) => (
  <>
    <div className="deep-review-action-bar__controls">
      {(reviewData || isReviewRunning) && (
        <CodeReviewReportExportActions
          reviewData={reviewData}
          actions={['copy', 'save']}
        />
      )}
      <span className="deep-review-action-bar__controls-divider" />
      <button
        type="button"
        className="deep-review-action-bar__controls-btn"
        onClick={onMinimize}
        aria-label={minimizeLabel}
      >
        <Minus size={14} />
      </button>
    </div>

    <div className="deep-review-action-bar__status" role="status" aria-live="polite">
      <PhaseIcon
        size={18}
        className={`deep-review-action-bar__icon ${phaseIconClass}`}
      />
      <span className="deep-review-action-bar__status-title">{phaseTitle}</span>
    </div>
    {errorMessage && (
      <div className="deep-review-action-bar__error-message" role="status">
        {errorSummary && errorSummary !== errorMessage && (
          <div>{errorSummary}</div>
        )}
        {errorDetailsLabel && <div>{errorDetailsLabel}</div>}
        <div>{errorMessage}</div>
      </div>
    )}
  </>
);
