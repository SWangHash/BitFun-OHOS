import { useI18n } from '@/infrastructure/i18n';
import type { ContextItem, ImageContext } from '@/shared/types/context';
import { isConversationExcerpt } from '@/shared/utils/conversationExcerpt';
import { ConversationExcerptAttachments } from '../selection/ConversationExcerptAttachments';
import { ChatInputAttachment } from './ChatInputAttachment';
import { ChatInputImagePreview } from './ChatInputImagePreview';

export function ChatInputAttachments({ contexts, surfaceEpoch, onRemove, onUpdate }: {
  contexts: ContextItem[];
  surfaceEpoch: number;
  onRemove: (id: string) => void;
  onUpdate: (id: string, comment: string) => void;
}) {
  const { t } = useI18n('flow-chat');
  const images = contexts.filter((context): context is ImageContext => context.type === 'image');
  if (!images.length && !contexts.some(isConversationExcerpt)) return null;
  return <div className="bitfun-chat-input__image-strip"
    data-bitfun-component="chat-input" data-bitfun-part="imageStrip" data-testid="chat-input-image-strip">
    {images.map(image => (
      <ChatInputAttachment key={image.id} label={image.imageName}
        removeLabel={t('input.removeImage')} onRemove={() => onRemove(image.id)}>
        <ChatInputImagePreview image={image} surfaceEpoch={surfaceEpoch} />
      </ChatInputAttachment>
    ))}
    <ConversationExcerptAttachments contexts={contexts} inline onRemove={onRemove} onUpdate={onUpdate} />
  </div>;
}
