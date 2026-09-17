/**
 * Image analysis card component.
 * Displays analysis progress and results.
 */

import { OverflowText, Button, Icon } from '@bitfun/ui';
import React, { useState } from 'react';
import { Loader, AlertCircle } from 'lucide-react';
import type { FlowImageAnalysisItem } from '../types/flow-chat';
import './ImageAnalysisCard.scss';

export interface ImageAnalysisCardProps {
  analysisItem: FlowImageAnalysisItem;
  onRetry?: () => void;
  onExpand?: () => void;
}

export const ImageAnalysisCard: React.FC<ImageAnalysisCardProps> = ({
  analysisItem,
  onRetry,
}) => {
  const [expanded, setExpanded] = useState(false);
  const { imageContext, result, status, error } = analysisItem;
  
  const duration = result?.analysis_time_ms 
    ? `${result.analysis_time_ms}ms`
    : '';
  
  return (
    <div data-bitfun-component="image-analysis-card" data-bitfun-part="root" data-bitfun-status={status} data-bitfun-state={expanded ? 'expanded' : ''} className="image-analysis-card" data-status={status}>
      <div data-bitfun-component="image-analysis-card" data-bitfun-part="header" className="image-analysis-card__header">
        <div data-bitfun-component="image-analysis-card" data-bitfun-part="thumbnail" className="image-analysis-card__thumbnail">
          {imageContext.thumbnailUrl || imageContext.dataUrl ? (
            <img 
              src={imageContext.thumbnailUrl || imageContext.dataUrl} 
              alt={imageContext.imageName}
            />
          ) : (
            <div data-bitfun-component="image-analysis-card" data-bitfun-part="placeholder" className="image-analysis-card__thumbnail-placeholder">
              <Icon name="eye" size="lg" />
            </div>
          )}
        </div>
        
        <div data-bitfun-component="image-analysis-card" data-bitfun-part="info" className="image-analysis-card__info">
          <div data-bitfun-component="image-analysis-card" data-bitfun-part="filename" className="image-analysis-card__filename"><OverflowText>
            {imageContext.imageName}
          </OverflowText></div>
          
          {status === 'analyzing' && (
            <div data-bitfun-component="image-analysis-card" data-bitfun-part="status" className="image-analysis-card__status analyzing">
              <Loader className="spinner" size={14} />
              <span>AI is analyzing the image...</span>
            </div>
          )}
          
          {status === 'completed' && result && (
            <div data-bitfun-component="image-analysis-card" data-bitfun-part="status" className="image-analysis-card__status completed">
              <Icon name="check-circle" size="sm" className="icon" />
              <span>Analysis complete</span>
              {duration && (
                <span className="time">{duration}</span>
              )}
            </div>
          )}
          
          {status === 'error' && (
            <div data-bitfun-component="image-analysis-card" data-bitfun-part="status" className="image-analysis-card__status error">
              <AlertCircle className="icon" size={14} />
              <span>Analysis failed</span>
              {onRetry && (
                <Button
                  className="image-analysis-card__retry"
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      
      {status === 'completed' && result && (
        <div data-bitfun-component="image-analysis-card" data-bitfun-part="content" className="image-analysis-card__content">
          <div data-bitfun-component="image-analysis-card" data-bitfun-part="summary" className="image-analysis-card__summary">
            <Icon name="spark" size="sm" className="summary-icon" />
            <span>{result.summary}</span>
          </div>
          
          <Button
            className="image-analysis-card__toggle"
            variant="outline"
            size="sm"
            leadingIcon={expanded ? <Icon name="chevron-up" size="sm" /> : <Icon name="chevron-down" size="sm" />}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Collapse details' : 'View detailed analysis'}
          </Button>
          
          {expanded && (
            <div data-bitfun-component="image-analysis-card" data-bitfun-part="details" className="image-analysis-card__detailed">
              <div data-bitfun-component="image-analysis-card" data-bitfun-part="section" className="detail-section">
                <h4>Detailed description</h4>
                <p>{result.detailed_description}</p>
              </div>
              
              {result.detected_elements.length > 0 && (
                <div data-bitfun-component="image-analysis-card" data-bitfun-part="section" className="detail-section">
                  <h4>Key elements detected</h4>
                  <div data-bitfun-component="image-analysis-card" data-bitfun-part="tags" className="tags">
                    {result.detected_elements.map((elem, idx) => (
                      <span key={idx} className="tag">{elem}</span>
                    ))}
                  </div>
                </div>
              )}
              
              <div data-bitfun-component="image-analysis-card" data-bitfun-part="metadata" className="detail-section metadata">
                <span className="meta-item">
                  Confidence: {(result.confidence * 100).toFixed(1)}%
                </span>
                <span className="meta-separator">•</span>
                <span className="meta-item">
                  Analysis time: {result.analysis_time_ms}ms
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      
      {status === 'error' && error && (
        <div data-bitfun-component="image-analysis-card" data-bitfun-part="error" className="image-analysis-card__error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export default ImageAnalysisCard;
