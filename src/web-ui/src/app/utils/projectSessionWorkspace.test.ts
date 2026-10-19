import { describe, expect, it } from 'vitest';
import { WorkspaceKind, type WorkspaceInfo } from '@/shared/types';
import {
  findReusableEmptySessionId,
  pickPrimaryAssistantWorkspace,
} from './projectSessionWorkspace';

const createWorkspace = (): WorkspaceInfo => ({
  id: 'workspace-1',
  name: 'BitFun',
  rootPath: '/workspace/BitFun',
  workspaceKind: WorkspaceKind.Normal,
  workspaceType: 'local' as never,
  languages: [],
  openedAt: '',
  lastAccessed: '',
  tags: [],
});

describe('findReusableEmptySessionId', () => {
  it('never reuses an existing session', () => {
    const workspace = createWorkspace();
    expect(findReusableEmptySessionId(workspace, 'Standard')).toBeNull();
  });

  it('returns null regardless of requested mode', () => {
    const workspace = createWorkspace();
    expect(findReusableEmptySessionId(workspace, 'Cowork')).toBeNull();
    expect(findReusableEmptySessionId(workspace, 'Claw')).toBeNull();
    expect(findReusableEmptySessionId(workspace, undefined)).toBeNull();
  });
});

describe('pickPrimaryAssistantWorkspace', () => {
  const createAssistantWorkspace = (
    id: string,
    assistantId?: string,
  ): WorkspaceInfo => ({
    id,
    name: id,
    rootPath: `/assistants/${id}`,
    workspaceKind: WorkspaceKind.Assistant,
    assistantId,
  });

  it('selects the primary assistant even when a named assistant appears first', () => {
    const namedAssistant = createAssistantWorkspace('named', 'assistant-1');
    const primaryAssistant = createAssistantWorkspace('primary');

    expect(
      pickPrimaryAssistantWorkspace([namedAssistant, primaryAssistant])
    ).toBe(primaryAssistant);
  });

  it('selects the configured primary assistant by workspace id', () => {
    const firstAssistant = createAssistantWorkspace('first', 'assistant-1');
    const configuredPrimary = createAssistantWorkspace('configured', 'assistant-2');

    expect(pickPrimaryAssistantWorkspace([firstAssistant, configuredPrimary], 'configured'))
      .toBe(configuredPrimary);
  });

  it('does not fall back to a named assistant', () => {
    const namedAssistant = createAssistantWorkspace('named', 'assistant-1');

    expect(pickPrimaryAssistantWorkspace([namedAssistant])).toBeNull();
  });
});
