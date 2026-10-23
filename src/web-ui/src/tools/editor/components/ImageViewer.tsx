import { useEditorDocument } from '../services/EditorDocument';
/**
 * Image Viewer Component
 * 
 * Previews image files in the editor.
 * @module components/ImageViewer
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ZoomIn, ZoomOut, RotateCw, Maximize2, Minimize2 } from 'lucide-react';
import { OverflowText, Button, Icon, IconButton, Toolbar, ToolbarGroup, ToolbarSeparator, Tooltip } from '@bitfun/ui';
import { createLogger } from '@/shared/utils/logger';
import { useNotification } from '@/shared/notification-system';

import { useI18n } from '@/infrastructure/i18n';
import { formatBytes } from '@/shared/utils/format';
import { downloadWorkspaceFileToDisk } from '@/tools/file-system/services/workspaceFileTransfer';
import { getAppearanceOverlayHost } from '@/infrastructure/appearance/runtime/AppearanceOverlayHost';
import { createBrowserImageDataUrl } from '@/shared/utils/imageDataUrl';
import './ImageViewer.scss';

const log = createLogger('ImageViewer');

/** Tiny images are blown up to at least this display size (pixels). */
const MIN_SMALL_IMAGE_DISPLAY_SIZE = 32;

/**
 * Low-resolution images previously rendered at their natural 1:1 size and
 * looked broken (tiny blob in a large canvas). Returns the upscale factor
 * that presents a small image at a usable size; normal images return 1.
 */
export function getSmallImageDisplayScale(width: number, height: number): number {
  if (width <= 0 || height <= 0 || width > MIN_SMALL_IMAGE_DISPLAY_SIZE || height > MIN_SMALL_IMAGE_DISPLAY_SIZE) {
    return 1;
  }
  return Math.max(1, MIN_SMALL_IMAGE_DISPLAY_SIZE / Math.max(width, height));
}

export interface ImageViewerProps {
  /** Image file path */
  filePath: string;
  isActiveTab?: boolean;
  /** File name */
  fileName?: string;
  /** Workspace path (for relative path resolution) */
  workspacePath?: string;
  /** CSS class name */
  className?: string;
  /** Immutable bytes supplied by a session provider; never read filePath locally. */
  imageSource?: { dataUrl: string; size: number };
}

export const ImageViewer: React.FC<ImageViewerProps> = ({
  filePath,
  fileName,
  imageSource,
  isActiveTab = true,
  className = ''
}) => {
  const documentSession = useEditorDocument();
  const { t } = useI18n('tools');
  const notification = useNotification();
  const [retryKey, setRetryKey] = useState(0);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadedOrigin, setLoadedOrigin] = useState<{ filePath: string; imageSource: typeof imageSource; documentSession: typeof documentSession }>();
  const originCurrent = loadedOrigin?.filePath === filePath && loadedOrigin.imageSource === imageSource && loadedOrigin.documentSession === documentSession;
  const [fileSize, setFileSize] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setLoadedOrigin({ filePath, imageSource, documentSession });
    setImageUrl('');
    setImageDimensions(null);
    setDisplayScale(1);
    if (imageSource) {
      setImageUrl(imageSource.dataUrl);
      setFileSize(imageSource.size);
      setError(null);
      setLoading(false);
      return;
    }
    if (filePath.startsWith('dispatch-file://')) {
      setImageUrl('');
      setError(t('editor.imageViewer.filePathEmpty'));
      setLoading(false);
      return;
    }
    const loadImage = async () => {
      if (!filePath) {
        setError(t('editor.imageViewer.filePathEmpty'));
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const workspaceAPI = documentSession?.files ?? (await import('@/infrastructure/api')).workspaceAPI;
        // Request base64 explicitly: the default read returns decoded text,
        // which produces invalid data URLs for binary images and SVG. The
        // shared helper picks the right MIME per extension and decodes TIFF
        // (unsupported by the browser) through utif into a PNG data URL.
        const result = await workspaceAPI.readFileContent(filePath, 'base64');

        if (cancelled) return;
        const dataUrl = await createBrowserImageDataUrl(filePath, result);
        if (cancelled) return;

        setImageUrl(dataUrl);
        setFileSize(Math.floor(result.length * 3 / 4) - (result.endsWith('==') ? 2 : result.endsWith('=') ? 1 : 0));
        setLoading(false);

      } catch (err) {
        if (cancelled) return;
        log.error('Failed to load image', err);
        setError(t('editor.imageViewer.loadImageFailedWithMessage', { message: String(err) }));
        setLoading(false);
      }
    };

    void loadImage();
    return () => { cancelled = true; };
  }, [filePath, imageSource, t, documentSession, retryKey]);

  const errorRef = useRef(error);
  errorRef.current = error;
  useEffect(() => {
    // Retry on reactivation, not on each failure (which would loop forever).
    if (isActiveTab && errorRef.current && documentSession?.isCurrent()) setRetryKey(key => key + 1);
  }, [documentSession, isActiveTab]);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;

    setImageDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight
    });
    setDisplayScale(getSmallImageDisplayScale(img.naturalWidth, img.naturalHeight));
  }, []);

  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    log.error('Image load error', { filePath, srcLength: e.currentTarget.src.length });
    setError(t('editor.imageViewer.decodeFailed'));
    setLoading(false);
  }, [filePath, t]);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 25, 500));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 25, 25));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(100);
  }, []);

  const handleRotate = useCallback(() => {
    // Keep the angle cumulative instead of wrapping at 360: the CSS rotate
    // transition animates between consecutive values, and 270 → 0 would spin
    // counter-clockwise across three quarters instead of one quarter.
    setRotation(prev => prev + 90);
  }, []);

  const handleDownload = useCallback(() => {
    // Anchor-based downloads (href + download attribute) are silently dropped
    // by some embedded WebViews (e.g. ArkWeb on HarmonyOS). Route through the
    // shared workspace download pipeline, which owns the platform save dialog
    // and transfer progress on every host. This no longer depends on a
    // mounted FilesPanel to handle the event.
    if (filePath && !filePath.startsWith('dispatch-file://')) {
      downloadWorkspaceFileToDisk(filePath, null, () => {}, undefined, false)
        .then(() => {
          notification.success(t('editor.imageViewer.downloadSucceeded'));
        })
        .catch((err) => {
          log.error('Failed to download image', err);
          notification.error(t('editor.imageViewer.loadImageFailedWithMessage', { message: String(err) }));
        });
      return;
    }

    // Session-provided images have no workspace path: fall back to a blob
    // download from the in-memory data URL (desktop WebViews).
    try {
      const name = fileName || filePath.split(/[/\\]/).pop() || 'image';
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      notification.success(t('editor.imageViewer.downloadSucceeded'));
    } catch (err) {
      log.error('Failed to download image', err);
      notification.error(t('editor.imageViewer.loadImageFailedWithMessage', { message: String(err) }));
    }
  }, [imageUrl, fileName, filePath, notification, t]);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Fullscreen renders through a portal on document.body: the editor-area
  // ancestors apply transforms/stacking that would otherwise contain a
  // position:fixed overlay inside the pane instead of covering the window.
  const viewerNode = (
    <div
      className={`bitfun-image-viewer ${className} ${isFullscreen ? 'fullscreen' : ''}`}
      data-bitfun-component="image-viewer"
      data-bitfun-part="root"
      data-bitfun-state={isFullscreen ? 'fullscreen' : undefined}
    >
      <Toolbar
        className="bitfun-image-viewer__toolbar"
        leading={
          <div data-bitfun-component="image-viewer" data-bitfun-part="info" className="bitfun-image-viewer__info">
            <OverflowText className="bitfun-image-viewer__filename">{fileName || filePath.split(/[/\\]/).pop()}</OverflowText>
            {originCurrent && imageDimensions && (
              <span className="bitfun-image-viewer__dimensions">
                {imageDimensions.width} × {imageDimensions.height}
              </span>
            )}
            {originCurrent && fileSize > 0 && (
              <span className="bitfun-image-viewer__filesize">
                {formatBytes(fileSize)}
              </span>
            )}
          </div>
        }
        trailing={
          <>
            <ToolbarGroup>
              <Tooltip content={t('editor.imageViewer.zoomOut')} placement="bottom">
                <IconButton
                  aria-label={t('editor.imageViewer.zoomOut')}
                  size="sm"
                  variant="quiet"
                  icon={<ZoomOut size={14} />}
                  onClick={handleZoomOut}
                  disabled={zoom <= 25}
                />
              </Tooltip>
              <Tooltip content={t('editor.imageViewer.zoomReset')} placement="bottom">
                <Button
                  size="sm"
                  variant="text"
                  className="bitfun-image-viewer__zoom-display"
                  onClick={handleZoomReset}
                >
                  {zoom}%
                </Button>
              </Tooltip>
              <Tooltip content={t('editor.imageViewer.zoomIn')} placement="bottom">
                <IconButton
                  aria-label={t('editor.imageViewer.zoomIn')}
                  size="sm"
                  variant="quiet"
                  icon={<ZoomIn size={14} />}
                  onClick={handleZoomIn}
                  disabled={zoom >= 500}
                />
              </Tooltip>
            </ToolbarGroup>
            <ToolbarSeparator />
            <ToolbarGroup>
              <Tooltip content={t('editor.imageViewer.rotate90')} placement="bottom">
                <IconButton
                  aria-label={t('editor.imageViewer.rotate90')}
                  size="sm"
                  variant="quiet"
                  icon={<RotateCw size={14} />}
                  onClick={handleRotate}
                />
              </Tooltip>
              <Tooltip content={t('editor.imageViewer.download')} placement="bottom">
                <IconButton
                  aria-label={t('editor.imageViewer.download')}
                  size="sm"
                  variant="quiet"
                  icon={<Icon name="arrow-down" size="sm" />}
                  onClick={handleDownload}
                  disabled={!originCurrent || loading || Boolean(error) || !imageUrl}
                />
              </Tooltip>
              <Tooltip
                content={isFullscreen ? t('editor.imageViewer.exitFullscreen') : t('editor.imageViewer.enterFullscreen')}
                placement="bottom"
              >
                <IconButton
                  aria-label={isFullscreen ? t('editor.imageViewer.exitFullscreen') : t('editor.imageViewer.enterFullscreen')}
                  size="sm"
                  variant="quiet"
                  icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  onClick={handleToggleFullscreen}
                />
              </Tooltip>
            </ToolbarGroup>
          </>
        }
      />

      <div data-bitfun-component="image-viewer" data-bitfun-part="container" className="bitfun-image-viewer__container">
        {(!originCurrent || loading) && (
          <div data-bitfun-component="image-viewer" data-bitfun-part="loading" className="bitfun-image-viewer__loading">
            <div className="bitfun-image-viewer__spinner" />
            <p>{t('editor.common.loading')}</p>
          </div>
        )}

        {originCurrent && error && (
          <div data-bitfun-component="image-viewer" data-bitfun-part="error" className="bitfun-image-viewer__error">
            <p>{error}</p>
            <p className="bitfun-image-viewer__error-path">{filePath}</p>
          </div>
        )}

        {originCurrent && !loading && !error && imageUrl && (
          <div data-bitfun-component="image-viewer" data-bitfun-part="imageWrapper" className="bitfun-image-viewer__image-wrapper">
            <img
              src={imageUrl}
              alt={fileName || filePath}
              className="bitfun-image-viewer__image"
              data-bitfun-component="image-viewer"
              data-bitfun-part="image"
              style={{
                width: imageDimensions ? `${imageDimensions.width * displayScale * zoom / 100}px` : undefined,
                height: imageDimensions ? `${imageDimensions.height * displayScale * zoom / 100}px` : undefined,
                transform: `rotate(${rotation}deg)`,
                imageRendering: displayScale > 1 ? 'pixelated' : undefined,
              }}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          </div>
        )}
        
        {originCurrent && !loading && !error && !imageUrl && (
          <div data-bitfun-component="image-viewer" data-bitfun-part="error" className="bitfun-image-viewer__error">
            <p>{t('editor.imageViewer.imageUrlEmpty')}</p>
          </div>
        )}
      </div>
    </div>
  );

  if (isFullscreen && typeof document !== 'undefined') {
    return createPortal(viewerNode, getAppearanceOverlayHost());
  }
  return viewerNode;
};

export default ImageViewer;
