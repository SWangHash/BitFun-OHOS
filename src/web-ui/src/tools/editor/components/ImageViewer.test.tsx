/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageViewer, {
  getImagePreviewLimit,
  getSmallImageDisplayScale,
  isImagePreviewAllowed,
} from './ImageViewer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Icon({ name }: { name: string }) {
  return <svg data-icon={name} />;
}

vi.mock('lucide-react', () => ({
  Download: () => <Icon name="download" />,
  Maximize2: () => <Icon name="maximize2" />,
  RotateCw: () => <Icon name="rotate-cw" />,
  ZoomIn: () => <Icon name="zoom-in" />,
  ZoomOut: () => <Icon name="zoom-out" />,
}));

vi.mock('@/component-library', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@/shared/utils/imageDataUrl', () => ({
  createBrowserImageDataUrl: vi.fn(async () => 'data:image/png;base64,x'),
  getImageMimeType: vi.fn(() => 'image/png'),
  isTiffPath: (p: string) => /\.tiff?$/i.test(p),
}));

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const workspaceApiMock = vi.hoisted(() => ({
  getFileMetadata: vi.fn(),
  readFileBinary: vi.fn(),
  readFileContent: vi.fn(),
}));

vi.mock('@/infrastructure/api', () => ({
  workspaceAPI: workspaceApiMock,
}));

vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({
  apiClient: {
    getAdapter: vi.fn(() => ({})),
  },
}));

vi.mock('@/infrastructure/api/adapters', () => ({
  TauriTransportAdapter: class MockTauriTransportAdapter {},
}));

function getDisplayedSize(width: number, height: number, zoom: number) {
  const displayScale = getSmallImageDisplayScale(width, height);
  return {
    width: (width * displayScale * zoom) / 100,
    height: (height * displayScale * zoom) / 100,
  };
}

describe('ImageViewer small image scaling', () => {
  it('makes a 1 by 1 image visible without changing its reported dimensions', () => {
    expect(getSmallImageDisplayScale(1, 1)).toBe(32);
  });

  it('keeps a 1 by 1 image square at low zoom levels', () => {
    expect(getDisplayedSize(1, 1, 25)).toEqual({ width: 8, height: 8 });
    expect(getDisplayedSize(1, 1, 100)).toEqual({ width: 32, height: 32 });
  });

  it('preserves the natural scale for normal images', () => {
    expect(getSmallImageDisplayScale(640, 480)).toBe(1);
  });

  it('does not scale invalid dimensions', () => {
    expect(getSmallImageDisplayScale(0, 1)).toBe(1);
  });
});

describe('ImageViewer preview limits', () => {
  it('rejects a 300 MB image before reading its content', () => {
    expect(isImagePreviewAllowed('large.png', 300 * 1024 * 1024)).toBe(false);
  });

  it('allows regular images up to 64 MB', () => {
    const limit = getImagePreviewLimit('photo.jpg');
    expect(limit).toBe(64 * 1024 * 1024);
    expect(isImagePreviewAllowed('photo.jpg', limit)).toBe(true);
    expect(isImagePreviewAllowed('photo.jpg', limit + 1)).toBe(false);
  });

  it('uses a lower limit for TIFF images decoded on the main thread', () => {
    const limit = getImagePreviewLimit('scan.tiff');
    expect(limit).toBe(16 * 1024 * 1024);
    expect(isImagePreviewAllowed('scan.tif', limit + 1)).toBe(false);
  });
});

describe('ImageViewer file-missing reporting', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('reports missing=false after a successful load and missing=true once the file disappears', async () => {
    vi.useFakeTimers();
    const onMissing = vi.fn();
    workspaceApiMock.getFileMetadata.mockResolvedValue({ isFile: true, size: 64 });
    workspaceApiMock.readFileContent.mockResolvedValue('aGk=');

    await act(async () => {
      root.render(
        <ImageViewer
          filePath="C:/w/cat.png"
          fileName="cat.png"
          onFileMissingFromDiskChange={onMissing}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(onMissing).toHaveBeenLastCalledWith(false);

    workspaceApiMock.getFileMetadata.mockRejectedValue(
      new Error('failed to get metadata: No such file or directory (os error 2)'),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(onMissing).toHaveBeenCalledTimes(2);
    expect(onMissing).toHaveBeenLastCalledWith(true);
  });

  it('reports missing=true when the initial load hits a not-found error', async () => {
    vi.useFakeTimers();
    const onMissing = vi.fn();
    workspaceApiMock.getFileMetadata.mockRejectedValue(
      new Error('open failed: The system cannot find the file specified. (os error 2)'),
    );

    await act(async () => {
      root.render(
        <ImageViewer
          filePath="C:/w/ghost.png"
          fileName="ghost.png"
          onFileMissingFromDiskChange={onMissing}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(onMissing).toHaveBeenLastCalledWith(true);
    expect(workspaceApiMock.readFileContent).not.toHaveBeenCalled();
  });

  it('still renders the error state without a reporting callback', async () => {
    vi.useFakeTimers();
    workspaceApiMock.getFileMetadata.mockRejectedValue(
      new Error('failed to get metadata: No such file or directory (os error 2)'),
    );

    await act(async () => {
      root.render(<ImageViewer filePath="C:/w/ghost2.png" fileName="ghost2.png" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(container.querySelector('[data-bf-part="error"]')).toBeTruthy();
  });
});
