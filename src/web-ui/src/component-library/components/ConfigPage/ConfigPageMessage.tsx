import React from 'react';
import { Alert } from '../Alert';
import './ConfigPage.scss';

export interface ConfigPageMessageData {
  type: 'success' | 'error' | 'info' | 'warning';
  text: string;
}

export interface ConfigPageMessageProps {
  message: ConfigPageMessageData | null;
  className?: string;
}

export const ConfigPageMessage: React.FC<ConfigPageMessageProps> = ({
  message,
  className = '',
}) => {
  if (!message) return null;

  return (
    <div className={`openbitfun-config-page-message ${className}`} data-openbitfun-component="config-page" data-openbitfun-part="message">
      <Alert type={message.type} message={message.text} />
    </div>
  );
};

