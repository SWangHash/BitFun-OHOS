import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isNativeDragPositionOverElement,
  parseOhosNativeDropPayload,
} from '@/infrastructure/hooks/useNativeFileDrop';
import { resolveNativeDroppedPaths } from './nativeFileDrop';

describe('resolveNativeDroppedPaths', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates file, directory, and image contexts from native paths', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const metadata = vi.fn(async (path: string) => ({
      size: path.endsWith('photo.png') ? 42 : 12,
      isFile: !path.endsWith('folder'),
      isDir: path.endsWith('folder'),
    }));

    const contexts = await resolveNativeDroppedPaths([
      'C:\\outside\\notes.txt',
      'C:\\outside\\folder',
      '/tmp/photo.png',
    ], metadata);

    expect(contexts.map((context) => context.type)).toEqual(['file', 'directory', 'image']);
    expect(contexts[0]).toMatchObject({ filePath: 'C:\\outside\\notes.txt', fileName: 'notes.txt' });
    expect(contexts[1]).toMatchObject({ directoryPath: 'C:\\outside\\folder', directoryName: 'folder' });
    expect(contexts[2]).toMatchObject({ imagePath: '/tmp/photo.png', imageName: 'photo.png', mimeType: 'image/png' });
    expect(new Set(contexts.map((context) => context.id)).size).toBe(3);
  });

  it('skips unreadable and unsupported native paths without dropping valid ones', async () => {
    const onError = vi.fn();
    const contexts = await resolveNativeDroppedPaths(
      ['missing.txt', 'device', 'valid.md'],
      async (path) => {
        if (path === 'missing.txt') throw new Error('missing');
        if (path === 'device') return { size: 0, isFile: false, isDir: false };
        return { size: 5, isFile: true, isDir: false };
      },
      onError,
    );

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ type: 'file', fileName: 'valid.md' });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('matches physical native coordinates against CSS pixel bounds', () => {
    const element = {
      getBoundingClientRect: () => ({ left: 100, right: 300, top: 50, bottom: 150 }),
    } as HTMLElement;

    expect(isNativeDragPositionOverElement({ x: 400, y: 200 }, 2, element)).toBe(true);
    expect(isNativeDragPositionOverElement({ x: 700, y: 400 }, 2, element)).toBe(false);
  });

  it('accepts OHOS native drop payloads injected as objects or JSON strings', () => {
    const payload = { type: 'drop', paths: ['/storage/Users/currentUser/Documents/notes.txt'] };

    expect(parseOhosNativeDropPayload(payload)).toEqual(payload);
    expect(parseOhosNativeDropPayload(JSON.stringify(payload))).toEqual(payload);
  });

  it('rejects malformed OHOS native drop payloads', () => {
    expect(parseOhosNativeDropPayload('{')).toBeNull();
    expect(parseOhosNativeDropPayload({ paths: ['/tmp/notes.txt'] })).toBeNull();
  });
});
