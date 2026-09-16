import { FileText } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';
import { useI18n } from '@/infrastructure/i18n';
import type { FileDropPreview, FileDropPosition } from '@/shared/types/fileDropPreview';
import { FileDropPreviewCards } from './FileDropPreviewCards';

/** Keep the stationary drop hint separate from the cursor's file previews and count. */
export function ChatFileDropOverlay({ preview, positionRef }: {
  preview?: FileDropPreview | null;
  positionRef?: RefObject<FileDropPosition | null>;
}) {
  const { t } = useI18n('flow-chat');
  const overlayRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const showPreview = Boolean(preview?.files.length);

  useEffect(() => {
    if (!showPreview || !positionRef) return;
    let frame = 0;
    let lastPosition: FileDropPosition | null = null;
    const update = () => {
      const position = positionRef.current;
      const cursor = cursorRef.current;
      const overlay = overlayRef.current;
      if (position && cursor && overlay && position !== lastPosition) {
        const bounds = overlay.getBoundingClientRect();
        const width = cursor.offsetWidth;
        const height = cursor.offsetHeight;
        const x = Math.max(12, Math.min(position.x - bounds.left + 20, bounds.width - width - 12));
        const y = Math.max(12, Math.min(position.y - bounds.top - height - 20, bounds.height - height - 12));
        cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        cursor.style.visibility = 'visible';
        lastPosition = position;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [positionRef, showPreview]);

  return (
    <div ref={overlayRef} className="openbitfun-chat-pane__drop-overlay" role="status"
      data-testid="chat-pane-drop-overlay">
      <div className="openbitfun-chat-pane__drop-content">
        <FileText className="openbitfun-chat-pane__drop-emblem"
          size={56} strokeWidth={1.5} aria-hidden="true" />
        <div className="openbitfun-chat-pane__drop-copy">
          <div className="openbitfun-chat-pane__drop-title">{t('context.dropToAdd')}</div>
          <div className="openbitfun-chat-pane__drop-description">
            {t(preview?.unavailable ? 'context.dropPreviewUnavailable' : 'context.dropFilesHint')}
          </div>
        </div>
      </div>
      {showPreview && preview && <div ref={cursorRef} className="openbitfun-chat-pane__drop-cursor">
        <FileDropPreviewCards preview={preview} />
      </div>}
    </div>
  );
}
