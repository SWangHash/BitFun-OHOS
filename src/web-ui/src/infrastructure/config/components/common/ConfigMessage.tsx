import React from 'react';
import { Alert } from '@bitfun/ui';
import './ConfigPageState.scss';

export interface ConfigMessageData {
  type: 'success' | 'error' | 'info' | 'warning';
  text: string;
}

export interface ConfigMessageProps {
  message: ConfigMessageData | null;
  className?: string;
}

export const ConfigMessage: React.FC<ConfigMessageProps> = ({
  message,
  className = '',
}) => {
  if (!message) return null;

  return (
    <div
      className={['bitfun-config-message', className].filter(Boolean).join(' ')}
      data-bitfun-component="config"
      data-bitfun-part="message"
    >
      <Alert tone={message.type} message={message.text} />
    </div>
  );
};
