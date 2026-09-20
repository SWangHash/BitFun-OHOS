import type { MouseEvent, ReactNode } from 'react';
import { Icon } from '@bitfun/ui';
import './ChatInputAttachment.scss';

/** Images and annotations share the same composer attachment shell. */
export function ChatInputAttachment({ children, label, removeLabel, onRemove, kind = 'image' }: {
  children: ReactNode;
  label: string;
  removeLabel: string;
  onRemove: () => void;
  kind?: 'image' | 'annotation';
}) {
  const remove = (event: MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); onRemove(); };
  // Keep the existing image Appearance parts while sharing layout and behavior.
  if (kind === 'image') return <div className="bitfun-chat-input__attachment" title={label}
    data-bitfun-component="chat-input" data-bitfun-part="image">
    {children}
    <button type="button" className="bitfun-chat-input__attachment-remove"
      data-bitfun-component="chat-input" data-bitfun-part="imageRemove" aria-label={removeLabel} onClick={remove}>
      <Icon name="xmark" size="xs" />
    </button>
  </div>;
  return <div className="bitfun-chat-input__attachment" title={label}
    data-bitfun-component="chat-input" data-bitfun-part="attachment">
    {children}
    <button type="button" className="bitfun-chat-input__attachment-remove"
      data-bitfun-component="chat-input" data-bitfun-part="attachmentRemove" aria-label={removeLabel} onClick={remove}>
      <Icon name="xmark" size="xs" />
    </button>
  </div>;
}
