// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCompanionActivityPayload, AgentCompanionTaskStatus } from '@/flow_chat/utils/agentCompanionActivity';
import { AgentCompanionInAppPet } from './AgentCompanionInAppPet';

/**
 * In-app activity source: the OHOS overlay subscribes directly to
 * `useAgentCompanionActivity()` instead of listening for cross-window Tauri
 * events, so the test drives the hook return value rather than emitting events.
 */
const useAgentCompanionActivityMock = vi.hoisted(() => vi.fn());

const handleCommandMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const openSessionMock = vi.hoisted(() => vi.fn(() => Promise.resolve(false)));
const openSettingsMock = vi.hoisted(() => vi.fn());

vi.mock('@/flow_chat/hooks/useAgentCompanionActivity', () => ({
  useAgentCompanionActivity: useAgentCompanionActivityMock,
}));

vi.mock('@/app/services/agentCompanionPetCommands', () => ({
  handleAgentCompanionPetCommand: handleCommandMock,
}));

vi.mock('@/app/services/openAgentCompanionSession', () => ({
  openAgentCompanionSession: openSessionMock,
}));

vi.mock('@/shared/services/ide-control', () => ({
  quickActions: { openSettings: openSettingsMock },
}));

vi.mock('@/infrastructure/config/services/AIExperienceConfigService', () => ({
  aiExperienceConfigService: {
    getSettings: () => ({
      enable_agent_companion: true,
      agent_companion_display_mode: 'desktop',
      agent_companion_pet: null,
    }),
    getSettingsAsync: () => Promise.resolve({
      enable_agent_companion: true,
      agent_companion_display_mode: 'desktop',
      agent_companion_pet: null,
    }),
    addChangeListener: () => () => {},
  },
}));

vi.mock('@/flow_chat/components/ChatInputPixelPet', () => ({
  ChatInputPixelPet: () => <div data-testid="pixel-pet" />,
}));

function task(overrides: Partial<AgentCompanionTaskStatus> = {}): AgentCompanionTaskStatus {
  return {
    sessionId: 'session-1',
    title: 'Refactor login',
    mood: 'working',
    state: 'running',
    labelKey: 'agentCompanion.activity.working',
    defaultLabel: 'Working',
    startedAt: 1,
    updatedAt: 2,
    canReply: true,
    ...overrides,
  };
}

function activity(payload: Partial<AgentCompanionActivityPayload> = {}): AgentCompanionActivityPayload {
  return { mood: 'rest', tasks: [], ...payload };
}

function typeInto(input: HTMLInputElement, value: string): void {
  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  act(() => {
    nativeValueSetter?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: 'en-US',
    fallbackLng: 'en-US',
    resources: {
      'en-US': {
        'flow-chat': {
          agentCompanion: {
            activity: { working: 'Working', completed: 'Completed' },
            menu: {
              switchPet: 'Switch pet',
              closePet: 'Close pet',
              closeBubble: 'Close this bubble',
            },
            composer: {
              openTitle: 'Send a message to this session',
              ariaLabel: 'Send a message to this session',
              placeholder: 'Type a message, Enter to send',
              cancel: 'Cancel',
              send: 'Send',
            },
          },
        },
      },
    },
    interpolation: { escapeValue: false },
  });
});

describe('AgentCompanionInAppPet', () => {
  let container: HTMLDivElement;
  let root: Root;
  let activityValue: AgentCompanionActivityPayload;

  // The overlay portals into document.body, so queries reach for it directly.
  const query = <T extends Element>(selector: string): T | null =>
    document.body.querySelector<T>(selector);

  const dispatch = (element: Element, type: string, at?: { clientX: number; clientY: number }) => {
    act(() => {
      element.dispatchEvent(new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        ...at,
      }));
    });
  };

  beforeEach(async () => {
    handleCommandMock.mockClear();
    openSessionMock.mockClear();
    openSettingsMock.mockClear();
    activityValue = activity();
    useAgentCompanionActivityMock.mockImplementation(() => activityValue);

    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(
        <I18nextProvider i18n={i18n}>
          <AgentCompanionInAppPet />
        </I18nextProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    // Strip any portal nodes left on document.body between tests.
    document.body
      .querySelectorAll('.bitfun-agent-companion-inapp')
      .forEach(node => node.remove());
  });

  const setActivity = (next: AgentCompanionActivityPayload): void => {
    activityValue = next;
    act(() => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <AgentCompanionInAppPet />
        </I18nextProvider>,
      );
    });
  };

  it('renders the pet sprite on the HarmonyOS in-app surface', () => {
    expect(query('[data-testid="pixel-pet"]')).not.toBeNull();
    expect(query('.bitfun-agent-companion-window__pet-hitbox')).not.toBeNull();
    expect(query('.bitfun-agent-companion-inapp')).not.toBeNull();
  });

  it('closes the pet from the context menu by toggling the persisted setting', () => {
    dispatch(query('.bitfun-agent-companion-window__pet-hitbox')!, 'contextmenu', {
      clientX: 300,
      clientY: 200,
    });

    const menuItems = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.bitfun-agent-companion-window__menu-item'),
    );
    expect(menuItems.map(item => item.textContent)).toEqual(['Switch pet', 'Close pet']);

    act(() => {
      menuItems[1]!.click();
    });

    expect(handleCommandMock).toHaveBeenCalledWith({ type: 'close-desktop-pet' });
    expect(query('.bitfun-agent-companion-window__menu-item')).toBeNull();
  });

  it('opens the settings surface in-window from the context menu (no show_main_window IPC)', () => {
    dispatch(query('.bitfun-agent-companion-window__pet-hitbox')!, 'contextmenu', {
      clientX: 300,
      clientY: 200,
    });

    const switchPet = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.bitfun-agent-companion-window__menu-item'),
    ).find(item => item.textContent === 'Switch pet');

    act(() => {
      switchPet!.click();
    });

    expect(openSettingsMock).toHaveBeenCalledWith('session-personalization');
    // The in-app host never goes through cross-window pet commands for this.
    expect(handleCommandMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'open-pet-settings' }),
    );
  });

  it('dispatches a send-message command directly from the bubble composer', async () => {
    setActivity(activity({ mood: 'working', tasks: [task()] }));

    const composeButton = query<HTMLButtonElement>('.bitfun-agent-companion-window__bubble-compose');
    expect(composeButton).not.toBeNull();

    act(() => {
      composeButton!.click();
    });

    const input = query<HTMLInputElement>(
      '.bitfun-agent-companion-window__bubble .bitfun-agent-companion-window__bubble-composer-input',
    );
    expect(input).not.toBeNull();
    typeInto(input!, '  ship it  ');

    act(() => {
      query<HTMLButtonElement>('.bitfun-agent-companion-window__bubble-composer-send')!.click();
    });

    expect(handleCommandMock).toHaveBeenCalledWith({
      type: 'send-message',
      sessionId: 'session-1',
      message: 'ship it',
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(query('.bitfun-agent-companion-window__bubble-composer-input')).toBeNull();
  });

  it('opens the task session in-window when a bubble is clicked', () => {
    setActivity(activity({ mood: 'working', tasks: [task()] }));

    act(() => {
      query<HTMLButtonElement>('.bitfun-agent-companion-window__bubble')!.click();
    });

    expect(openSessionMock).toHaveBeenCalledWith('session-1');
  });

  it('acknowledges a finished bubble directly when dismissed', () => {
    setActivity(activity({
      mood: 'rest',
      tasks: [task({ state: 'completed', labelKey: 'agentCompanion.activity.completed', defaultLabel: 'Completed' })],
    }));

    dispatch(query('.bitfun-agent-companion-window__bubble-shell')!, 'contextmenu');

    const menuItem = query<HTMLButtonElement>('.bitfun-agent-companion-window__menu-item');
    expect(menuItem?.textContent).toBe('Close this bubble');

    act(() => {
      menuItem!.click();
    });

    expect(query('.bitfun-agent-companion-window__bubble')).toBeNull();
    expect(handleCommandMock).toHaveBeenCalledWith({
      type: 'dismiss-task',
      sessionId: 'session-1',
    });
  });
});
