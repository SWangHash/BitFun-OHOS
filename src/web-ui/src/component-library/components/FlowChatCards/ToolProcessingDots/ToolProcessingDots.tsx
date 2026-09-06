/**
 * Compact three-dot pulse for tool "pending / parsing" states (replaces clock icon).
 */

import React from 'react';
import './ToolProcessingDots.scss';

export type ToolProcessingDotsSize = 10 | 12 | 14 | 16;

export interface ToolProcessingDotsProps {
  /** Visual scale aligned with common lucide-react icon sizes in tool headers */
  size?: ToolProcessingDotsSize;
  className?: string;
}

export const ToolProcessingDots: React.FC<ToolProcessingDotsProps> = ({
  size = 14,
  className = '',
}) => (
  <span
    className={`openbitfun-tool-processing-dots openbitfun-tool-processing-dots--s${size} ${className}`.trim()}
    data-openbitfun-component="flow-chat-card"
    data-openbitfun-part="processing"
    aria-hidden
    role="presentation"
  >
    <span className="openbitfun-tool-processing-dots__dot" data-openbitfun-component="flow-chat-card" data-openbitfun-part="processingDot" />
    <span className="openbitfun-tool-processing-dots__dot" data-openbitfun-component="flow-chat-card" data-openbitfun-part="processingDot" />
    <span className="openbitfun-tool-processing-dots__dot" data-openbitfun-component="flow-chat-card" data-openbitfun-part="processingDot" />
  </span>
);
