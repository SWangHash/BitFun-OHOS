import { useEffect, useState } from 'react';
import { Icon } from '@bitfun/ui';
import { workspaceAPI } from '@/infrastructure/api/service-api/WorkspaceAPI';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import { i18nService, useI18n } from '@/infrastructure/i18n';
import { ImageLightbox, type ImageLightboxState } from '@/shared/ui/ImageLightbox';
import type { ImageContext } from '@/types/context';
import { getMimeTypeFromFilename } from '../utils/imageUtils';

export function ChatInputImagePreview({ image, surfaceEpoch }: {
  image: ImageContext;
  surfaceEpoch: number;
}) {
  const { t } = useI18n('tools');
  const embedded = image.thumbnailUrl || image.dataUrl;
  const path = image.imagePath;
  const [loaded, setLoaded] = useState<{ path: string; epoch: number; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The attachment owns the overlay for the bytes it resolved.
  const [preview, setPreview] = useState<ImageLightboxState | null>(null);
  const source = embedded || (loaded?.path === path && loaded.epoch === surfaceEpoch ? loaded.source : undefined);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    if (!embedded && path) {
      // Paths belong to the runtime host, just like sent-message attachments.
      // Read through the transport; never turn them into controller asset URLs.
      void workspaceAPI.readFileContent(path, 'base64').then(content => {
        if (!cancelled && getActiveSurfaceScope().epoch === surfaceEpoch) {
          setLoaded({ path, epoch: surfaceEpoch,
            source: `data:${image.mimeType || getMimeTypeFromFilename(path)};base64,${content}` });
        }
      }).catch(cause => {
        if (!cancelled && getActiveSurfaceScope().epoch === surfaceEpoch) setError(String(cause));
      });
    }
    return () => { cancelled = true; };
  }, [embedded, path, image.mimeType, surfaceEpoch]);

  useEffect(() => {
    // A surface switch invalidates the bytes behind an open preview.
    setPreview(null);
  }, [surfaceEpoch]);

  return source && !error ? (
    <>
      <button
        type="button"
        className="bitfun-chat-input__image-chip-preview"
        aria-label={i18nService.t('components:imageLightbox.label')}
        onClick={() => setPreview({ source, alt: image.imageName })}
      >
        <img className="bitfun-chat-input__image-chip-thumb"
          data-bitfun-component="chat-input" data-bitfun-part="imagePreview"
          src={source} alt={image.imageName} onError={() => setError(image.imageName)} />
      </button>
      <ImageLightbox image={preview} onClose={() => setPreview(null)} />
    </>
  ) : (
    <div className="bitfun-chat-input__image-chip-thumb bitfun-chat-input__image-chip-thumb--placeholder"
      data-bitfun-component="chat-input" data-bitfun-part="imagePreview"
      role={error ? 'img' : undefined}
      aria-label={error ? t('editor.imageViewer.loadImageFailedWithMessage', { message: error }) : undefined}
      title={error ? t('editor.imageViewer.loadImageFailedWithMessage', { message: error }) : image.imageName}>
      <Icon name="image" size="sm" />
    </div>
  );
}
