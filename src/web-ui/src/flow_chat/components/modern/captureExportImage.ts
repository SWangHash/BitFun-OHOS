import type { Context } from 'modern-screenshot';
import { createLogger } from '@/shared/utils/logger';
import { elapsedMs, nowMs, withTimeout } from '@/shared/utils/timing';

const log = createLogger('ExportImageButton');

export type ImageCaptureStage = 'preparing' | 'cloning' | 'assets' | 'rendering' | 'encoding';

export const LOGO_PLACEHOLDER_CLASS = 'export-content__logo-placeholder';

export class ImageCaptureError extends Error {
  constructor(
    readonly reason: 'contentSizeUnavailable' | 'canvasUnavailable' | 'pngEncodingFailed',
    message: string,
  ) {
    super(message);
    this.name = 'ImageCaptureError';
  }
}

export class ImageCaptureTimeoutError extends Error {
  constructor(readonly timeoutMs: number, readonly stage: ImageCaptureStage) {
    super(`Image capture timed out during ${stage} after ${timeoutMs}ms`);
    this.name = 'ImageCaptureTimeoutError';
  }
}

/** Flatten the authored thinking mask before it enters the capture's SVG foreignObject. */
async function rasterizeThinkingIcons(container: HTMLElement, scale: number): Promise<void> {
  const rasters = new Map<string, Promise<string>>();
  const images: HTMLImageElement[] = [];
  const icons = container.querySelectorAll<HTMLElement>(
    '[data-bitfun-component="icon"][data-bitfun-name="thinking"][data-bitfun-source="catalog"]',
  );
  const pendingIcons = Array.from(icons, async icon => {
    const style = getComputedStyle(icon);
    const mask = style.getPropertyValue('mask-image') || style.getPropertyValue('-webkit-mask-image');
    const source = mask.match(/^url\((["']?)(.*?)\1\)$/)?.[2];
    if (!source) return;

    const bounds = icon.getBoundingClientRect();
    const width = Math.ceil(bounds.width * scale);
    const height = Math.ceil(bounds.height * scale);
    const key = JSON.stringify([source, style.color, width, height]);
    let raster = rasters.get(key);
    if (!raster) {
      raster = new Promise<string>((resolve, reject) => {
        const image = new window.Image();
        images.push(image);
        image.crossOrigin = 'anonymous';
        image.onload = () => {
          const canvas = document.createElement('canvas');
          try {
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('No canvas context for thinking icon');
            context.drawImage(image, 0, 0, width, height);
            context.globalCompositeOperation = 'source-in';
            context.fillStyle = style.color;
            context.fillRect(0, 0, width, height);
            resolve(canvas.toDataURL('image/png'));
          } catch (error) {
            reject(error);
          } finally {
            canvas.width = canvas.height = 0;
          }
        };
        image.onerror = reject;
        image.src = source;
      });
      rasters.set(key, raster);
    }

    return { icon, dataUrl: await raster };
  });

  try {
    const rasterizedIcons = await withTimeout(Promise.all(pendingIcons), 15_000, 'Thinking icon rasterization');
    // Apply only completed preparation; failed or late loads leave the original icons intact.
    for (const result of rasterizedIcons) {
      if (!result) continue;
      const { icon, dataUrl } = result;
      icon.style.setProperty('mask-image', 'none');
      icon.style.setProperty('-webkit-mask-image', 'none');
      icon.style.backgroundColor = 'transparent';
      icon.style.backgroundImage = `url("${dataUrl}")`;
      icon.style.backgroundPosition = 'center';
      icon.style.backgroundRepeat = 'no-repeat';
      icon.style.backgroundSize = 'contain';
    }
  } finally {
    for (const image of images) {
      image.onload = image.onerror = null;
      image.removeAttribute('src');
    }
  }
}

/** Own one capture through settlement, including timeout, encoding and resource cleanup. */
export async function captureExportImage(
  container: HTMLElement,
  backgroundColor: string,
  logoImage: HTMLImageElement | null,
  onStage: (stage: ImageCaptureStage | 'stopping') => void,
): Promise<Blob> {
  const modernScreenshot = await import('modern-screenshot');
  const startedAt = nowMs();
  const bounds = container.getBoundingClientRect();
  const width = bounds.width;
  const height = bounds.height;
  if (width <= 0 || height <= 0) {
    throw new ImageCaptureError('contentSizeUnavailable', 'Export content has no rendered size');
  }

  const nodeCount = container.querySelectorAll('*').length + 1;
  // A working bitmap budget (64 MiB of RGBA), not a claim about the engine's limit.
  // Preserve all content and the CSS layout width; only the output resolution changes.
  const scale = Math.min(2, Math.sqrt(16_777_216 / (width * height)), 32_768 / Math.max(width, height));
  // This is a conservative deadline, not an ETA. DOM work and full content geometry
  // still grow even when the output bitmap is downscaled.
  const timeoutMs = Math.min(120_000, Math.max(30_000,
    Math.ceil((15_000 + nodeCount * 8 + width * height / 500) / 1_000) * 1_000,
  ));
  const metrics = { width, height, nodeCount, scale, timeoutMs };
  const phaseDurations: Partial<Record<ImageCaptureStage, number>> = {};
  let stage: ImageCaptureStage = 'preparing';
  let phaseStartedAt = startedAt;
  let lastYieldAt = startedAt;
  let clonedNodes = 0;
  let timeoutError: ImageCaptureTimeoutError | undefined;
  const abortController = new AbortController();
  const stopCapture = () => {
    if (timeoutError) return;
    timeoutError = new ImageCaptureTimeoutError(timeoutMs, stage);
    abortController.abort();
    onStage('stopping');
  };
  const checkDeadline = () => {
    if (nowMs() - startedAt >= timeoutMs) stopCapture();
    if (timeoutError) throw timeoutError;
  };
  const setStage = (next: ImageCaptureStage) => {
    checkDeadline();
    phaseDurations[stage] = elapsedMs(phaseStartedAt);
    stage = next;
    phaseStartedAt = nowMs();
    onStage(next);
  };
  const timer = setTimeout(stopCapture, timeoutMs);
  let context: Context<HTMLElement> | undefined;
  let canvas: HTMLCanvasElement | undefined;
  log.info('Image capture started', metrics);

  try {
    onStage(stage);
    try {
      await rasterizeThinkingIcons(container, scale);
    } catch (error) {
      log.warn('Thinking icon rasterization failed, continuing with original icons', { error });
    }
    checkDeadline();

    context = await modernScreenshot.createContext(container, {
      width,
      height,
      scale,
      backgroundColor,
      timeout: timeoutMs,
      font: false,
      fetch: { bypassingCache: true, requestInit: { signal: abortController.signal, cache: 'no-cache' } },
      features: { removeControlCharacter: true, fixSvgXmlDecode: true },
      filter: node => !(node instanceof HTMLElement && node.matches(
        '.model-round-item__footer, .user-message-item__actions, .tool-card__actions, '
        + '[data-bitfun-component="flow-chat-tool-card"][data-bitfun-part="actionRegion"], '
        + '[data-bitfun-component="flow-chat-tool-card"][data-bitfun-part="expanded"]',
      )),
      onCloneEachNode: async () => {
        clonedNodes++;
        checkDeadline();
        // Awaiting promises alone keeps cloning in the microtask queue. Yield a
        // browser task after a short time slice so input and transport can run.
        if (nowMs() - lastYieldAt >= 8) {
          await new Promise(resolve => setTimeout(resolve, 0));
          lastYieldAt = nowMs();
          checkDeadline();
        }
      },
      onCloneNode: () => setStage('assets'),
      onEmbedNode: () => setStage('rendering'),
      onCreateForeignObjectSvg: () => checkDeadline(),
    });
    // Keep the default-style document stable across our task yields. The lazy
    // srcdoc navigation otherwise replaces its body while cloning is suspended.
    // An attached about:blank document needs no asynchronous navigation.
    const sandbox = container.ownerDocument.createElement('iframe');
    sandbox.width = sandbox.height = '0';
    sandbox.style.visibility = 'hidden';
    sandbox.style.position = 'fixed';
    sandbox.setAttribute('aria-hidden', 'true');
    sandbox.tabIndex = -1;
    context.sandbox = sandbox;
    container.ownerDocument.body.appendChild(sandbox);
    setStage('cloning');
    lastYieldAt = nowMs();
    // Do not race this promise against a timer: image decoding/drawing may not
    // be interruptible. Keep ownership until it settles, then discard late output.
    canvas = await modernScreenshot.domToCanvas(context);
    checkDeadline();

    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) {
      throw new ImageCaptureError('canvasUnavailable', 'Image canvas could not be created');
    }
    const placeholder = container.querySelector<HTMLElement>(`.${LOGO_PLACEHOLDER_CLASS}`);
    if (logoImage && placeholder) {
      const rect = placeholder.getBoundingClientRect();
      const scaleX = canvas.width / width;
      const scaleY = canvas.height / height;
      const dx = (rect.left - bounds.left) * scaleX;
      const dy = (rect.top - bounds.top) * scaleY;
      const dw = rect.width * scaleX;
      const dh = rect.height * scaleY;
      const radius = (parseFloat(getComputedStyle(placeholder).borderRadius) || 0) * Math.min(scaleX, scaleY);
      ctx.save();
      if (radius > 0) {
        const path = new Path2D();
        const r = Math.min(radius, dw / 2, dh / 2);
        path.moveTo(dx + r, dy);
        path.lineTo(dx + dw - r, dy);
        path.quadraticCurveTo(dx + dw, dy, dx + dw, dy + r);
        path.lineTo(dx + dw, dy + dh - r);
        path.quadraticCurveTo(dx + dw, dy + dh, dx + dw - r, dy + dh);
        path.lineTo(dx + r, dy + dh);
        path.quadraticCurveTo(dx, dy + dh, dx, dy + dh - r);
        path.lineTo(dx, dy + r);
        path.quadraticCurveTo(dx, dy, dx + r, dy);
        path.closePath();
        ctx.clip(path);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(logoImage, dx, dy, dw, dh);
      ctx.restore();
    } else {
      log.warn('Logo overlay skipped', { hasLogo: !!logoImage, hasBox: !!placeholder });
    }

    setStage('encoding');
    // Let the status paint before encoding. PNG is encoded once, without an
    // intermediate base64 PNG, image decode or second full-size canvas.
    await new Promise(resolve => setTimeout(resolve, 0));
    checkDeadline();
    const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/png'));
    checkDeadline();
    if (!blob?.size) throw new ImageCaptureError('pngEncodingFailed', 'PNG encoding returned no image data');
    log.info('Image capture completed', { ...metrics, bytes: blob.size });
    return blob;
  } catch (error) {
    log.error('Image capture failed', { ...metrics, stage, error: timeoutError ?? error });
    throw timeoutError ?? error;
  } finally {
    clearTimeout(timer);
    abortController.abort();
    if (context) modernScreenshot.destroyContext(context);
    if (canvas) canvas.width = canvas.height = 0;
    phaseDurations[stage] = elapsedMs(phaseStartedAt);
    log.info('Image capture finished', {
      ...metrics, durationMs: elapsedMs(startedAt), phaseDurations, clonedNodes,
    });
  }
}
