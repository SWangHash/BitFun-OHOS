// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillMarketItem } from '@/infrastructure/config/types';
import { useSkillMarket } from './useSkillMarket';

const listSkillMarketMock = vi.hoisted(() => vi.fn());
const searchSkillMarketMock = vi.hoisted(() => vi.fn());
const downloadSkillMarketMock = vi.hoisted(() => vi.fn());
const getSkillDescriptionsMock = vi.hoisted(() => vi.fn());
const installedChangedMock = vi.hoisted(() => vi.fn());
const notificationMocks = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/infrastructure/api', () => ({
  configAPI: {
    listSkillMarket: listSkillMarketMock,
    searchSkillMarket: searchSkillMarketMock,
    downloadSkillMarket: downloadSkillMarketMock,
    getSkillDescriptions: getSkillDescriptionsMock,
  },
}));
vi.mock('@/infrastructure/hooks/useWorkspaceManagerSync', () => ({
  useWorkspaceManagerSync: () => ({
    workspacePath: 'D:/workspace/project',
    hasWorkspace: true,
    isRemoteWorkspace: false,
    isAssistantWorkspace: false,
  }),
}));
vi.mock('@/shared/notification-system', () => ({
  useNotification: () => notificationMocks,
}));

interface HarnessProps {
  enabled: boolean;
  installedDirNamesByLevel?: { user: Set<string>; project: Set<string> };
  installedMarketIds?: Set<string>;
}

let currentMarket: ReturnType<typeof useSkillMarket> | null = null;

function Harness({
  enabled,
  installedDirNamesByLevel = { user: new Set<string>(), project: new Set<string>() },
  installedMarketIds = new Set<string>(),
}: HarnessProps) {
  const market = useSkillMarket({
    searchQuery: '',
    installedMarketIds,
    installedDirNamesByLevel,
    enabled,
    onInstalledChanged: installedChangedMock,
  });
  currentMarket = market;
  return <span>{market.marketLoading ? 'loading' : 'idle'}</span>;
}

const SKILL_FOO: SkillMarketItem = {
  id: 'foo',
  name: 'foo',
  description: '',
  source: 'test',
  installs: 0,
  url: 'https://example.com/foo',
  installId: 'org/repo@foo',
};

describe('useSkillMarket', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listSkillMarketMock.mockReset().mockResolvedValue([]);
    searchSkillMarketMock.mockReset().mockResolvedValue([]);
    downloadSkillMarketMock.mockReset().mockResolvedValue({ installedSkills: ['foo'] });
    getSkillDescriptionsMock.mockReset().mockResolvedValue({});
    installedChangedMock.mockReset();
    notificationMocks.success.mockReset();
    notificationMocks.warning.mockReset();
    notificationMocks.error.mockReset();
    currentMarket = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('prioritizes only the installed repository when market skills share a name', async () => {
    const first = {
      id: 'first/skills/eli5', name: 'eli5', source: 'first/skills',
      installId: 'first/skills@eli5', installs: 1, description: '', url: '',
    };
    const second = {
      ...first, id: 'second/skills/eli5', source: 'second/skills',
      installId: 'second/skills@eli5', installs: 100,
    };
    listSkillMarketMock.mockResolvedValue([second, first]);
    await act(async () => {
      root.render(<Harness enabled installedMarketIds={new Set(['first/skills@eli5'])} />);
    });
    expect(currentMarket?.marketSkills.map(skill => skill.id)).toEqual([first.id, second.id]);

    await act(async () => {
      root.render(<Harness enabled installedMarketIds={new Set(['second/skills@eli5'])} />);
    });
    expect(currentMarket?.marketSkills.map(skill => skill.id)).toEqual([second.id, first.id]);
    expect(listSkillMarketMock).toHaveBeenCalledTimes(1);
  });

  it('does not query the skill market outside the desktop app', async () => {
    await act(async () => {
      root.render(<Harness enabled={false} />);
      await Promise.resolve();
    });

    expect(listSkillMarketMock).not.toHaveBeenCalled();
    expect(searchSkillMarketMock).not.toHaveBeenCalled();
    expect(downloadSkillMarketMock).not.toHaveBeenCalled();
    expect(container.textContent).toBe('idle');

    await act(async () => {
      root.render(<Harness enabled />);
      await Promise.resolve();
    });

    expect(listSkillMarketMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a market load that finishes after switching away', async () => {
    let resolveLoad: ((skills: SkillMarketItem[]) => void) | undefined;
    listSkillMarketMock.mockReturnValueOnce(new Promise<SkillMarketItem[]>((resolve) => {
      resolveLoad = resolve;
    }));

    await act(async () => {
      root.render(<Harness enabled />);
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<Harness enabled={false} />);
      await Promise.resolve();
    });
    await act(async () => {
      resolveLoad?.([{
        id: 'test',
        name: 'test',
        description: '',
        source: 'test',
        installs: 0,
        url: 'https://example.com/test',
        installId: 'test',
      }]);
      await Promise.resolve();
    });

    expect(currentMarket?.marketSkills).toEqual([]);
    expect(container.textContent).toBe('idle');
  });

  it('does not notify or reload after a pending download loses desktop capability', async () => {
    let resolveDownload: ((result: { installedSkills: string[] }) => void) | undefined;
    downloadSkillMarketMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveDownload = resolve;
    }));
    const skill: SkillMarketItem = {
      id: 'test',
      name: 'test',
      description: '',
      source: 'test',
      installs: 0,
      url: 'https://example.com/test',
      installId: 'test',
    };

    await act(async () => {
      root.render(<Harness enabled />);
      await Promise.resolve();
    });
    let download: Promise<void> | undefined;
    await act(async () => {
      download = currentMarket?.handleDownload(skill, 'user');
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<Harness enabled={false} />);
      await Promise.resolve();
    });
    await act(async () => {
      resolveDownload?.({ installedSkills: ['test'] });
      await download;
    });

    expect(notificationMocks.success).not.toHaveBeenCalled();
    expect(notificationMocks.error).not.toHaveBeenCalled();
    expect(installedChangedMock).not.toHaveBeenCalled();
  });

  it('blocks download with an error when the same-level dirName is already installed', async () => {
    await act(async () => {
      root.render(
        <Harness
          enabled
          installedDirNamesByLevel={{ user: new Set<string>(), project: new Set(['foo']) }}
        />
      );
      await Promise.resolve();
    });

    let download: Promise<void> | undefined;
    await act(async () => {
      download = currentMarket?.handleDownload(SKILL_FOO, 'project');
      await download;
    });

    expect(notificationMocks.error).toHaveBeenCalledTimes(1);
    expect(notificationMocks.error).toHaveBeenCalledWith('messages.nameConflict');
    expect(downloadSkillMarketMock).not.toHaveBeenCalled();
    expect(installedChangedMock).not.toHaveBeenCalled();
  });

  it('allows download when the dirName exists only in a different level', async () => {
    await act(async () => {
      root.render(
        <Harness
          enabled
          installedDirNamesByLevel={{ user: new Set(['foo']), project: new Set<string>() }}
        />
      );
      await Promise.resolve();
    });

    await act(async () => {
      await currentMarket?.handleDownload(SKILL_FOO, 'project');
    });

    expect(notificationMocks.error).not.toHaveBeenCalled();
    expect(downloadSkillMarketMock).toHaveBeenCalledTimes(1);
  });

  it('loads subsequent pages via offset pagination and appends only new skills', async () => {
    const all = Array.from({ length: 11 }, (_, i) => ({
      id: `skill-${i}`,
      name: `skill-${i}`,
      description: '',
      source: 'test',
      installs: i,
      url: `https://example.com/skill-${i}`,
      installId: `test@skill-${i}`,
    }));
    listSkillMarketMock.mockImplementation((_query: unknown, limit?: number, offset?: number) => {
      const start = offset ?? 0;
      return Promise.resolve(all.slice(start, start + (limit ?? 10)));
    });

    await act(async () => {
      root.render(<Harness enabled />);
      await Promise.resolve();
    });
    expect(currentMarket?.marketSkills).toHaveLength(10);
    expect(currentMarket?.hasMore).toBe(true);
    expect(listSkillMarketMock).toHaveBeenLastCalledWith(undefined, 11, 0);

    await act(async () => {
      await currentMarket?.goToNextPage();
    });

    expect(listSkillMarketMock).toHaveBeenLastCalledWith(undefined, 11, 10);
    expect(currentMarket?.marketSkills).toHaveLength(11);
    expect(currentMarket?.marketSkills.map((skill) => skill.id)).toContain('skill-10');
    expect(currentMarket?.hasMore).toBe(false);
  });
});
