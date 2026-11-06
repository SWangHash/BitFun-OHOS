// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowToolItem, ToolCardConfig } from '../types/flow-chat';
import {
  LOCAL_SURFACE_ID,
  activateSurface,
} from '@/infrastructure/peer-device/deviceSurface';
import { PeerDeviceContext } from '@/infrastructure/peer-device/peerDeviceContextState';
import { askUserQuestionDraftStore, askUserQuestionDraftKey } from '../store/askUserQuestionDraftStore';
import { FlowChatReaderState } from '../timeline/readerState';
import { useTimelineInteraction } from '../timeline/useTimelineInteraction';

const sendFollowUp = vi.hoisted(() => vi.fn());
vi.mock('../services/FlowChatManager', () => ({
  FlowChatManager: { getInstance: () => ({ sendMessage: sendFollowUp }) },
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      options?.count === undefined ? key : `${key}:${String(options.count)}`
    ),
  }),
}));

vi.mock('@/infrastructure/api/service-api/ToolAPI', () => ({
  toolAPI: {
    submitUserAnswers: vi.fn(),
    startUserQuestionInteraction: vi.fn(),
  },
}));

vi.mock('@/infrastructure/api/service-api/SystemAPI', () => ({
  systemAPI: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/infrastructure/peer-device/pickWorkspaceDirectory', () => ({
  pickWorkspaceDirectory: vi.fn(),
}));

import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';
import { systemAPI } from '@/infrastructure/api/service-api/SystemAPI';
import { pickWorkspaceDirectory } from '@/infrastructure/peer-device/pickWorkspaceDirectory';
import { AskUserQuestionCard } from './AskUserQuestionCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const config: ToolCardConfig = {
  toolName: 'AskUserQuestion',
  displayName: 'Ask User',
  icon: 'Q',
  requiresConfirmation: false,
  resultDisplayType: 'detailed',
};

function questionTool(
  status: FlowToolItem['status'],
  multiSelect = false,
  inputPlaceholder?: string,
): FlowToolItem {
  return {
    id: 'question-tool-1',
    type: 'tool',
    toolName: 'AskUserQuestion',
    timestamp: 1,
    status,
    toolCall: {
      id: 'question-call-1',
      input: {
        questions: [{
          header: 'Database',
          question: 'Which database?',
          multiSelect,
          ...(inputPlaceholder ? { inputPlaceholder } : {}),
          // A plain question opens unanswered, so the restore/isolation cases
          // below click the option they mean instead of relying on a default.
          options: [{
            label: 'PostgreSQL',
            description: 'Use PostgreSQL',
          }, {
            label: 'SQLite',
            description: 'Use SQLite',
          }],
        }],
      },
    },
    ...(status === 'completed'
      ? {
          toolResult: {
            success: true,
            result: {
              answers: {
                0: 'PostgreSQL',
              },
            },
          },
        }
      : {}),
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AskUserQuestionCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    activateSurface(LOCAL_SURFACE_ID);
    askUserQuestionDraftStore.setState({ drafts: {}, inputOrigins: {} });
    sendFollowUp.mockReset().mockResolvedValue(undefined);
    vi.mocked(toolAPI.startUserQuestionInteraction).mockReset();
    vi.mocked(toolAPI.startUserQuestionInteraction).mockResolvedValue(undefined);
    vi.mocked(toolAPI.submitUserAnswers).mockReset();
    vi.mocked(toolAPI.submitUserAnswers).mockResolvedValue(undefined);
    vi.mocked(pickWorkspaceDirectory).mockReset();
    vi.mocked(pickWorkspaceDirectory).mockResolvedValue('D:/work/myqt');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('pages through questions, retains answers on Back, and submits only from the last step', async () => {
    let acknowledgeSubmission!: () => void;
    vi.mocked(toolAPI.submitUserAnswers).mockReturnValueOnce(new Promise<void>((resolve) => {
      acknowledgeSubmission = resolve;
    }));
    const tool = questionTool('pending_confirmation');
    tool.toolCall.input = {
      questions: [
        { question: 'Which database?', options: [{ label: 'PostgreSQL' }], multiSelect: false },
        { question: 'What should the update cover?', options: [{ label: 'Milestones' }, { label: 'Open risks' }], multiSelect: true },
        { question: 'Anything else?', options: [{ label: 'Nothing else' }], multiSelect: false },
      ],
    };
    const takeReading = vi.fn();
    const reader = new FlowChatReaderState();
    function Transcript() {
      const ref = React.useRef<HTMLDivElement>(null);
      useTimelineInteraction(ref, reader, () => true, undefined, takeReading);
      return <div ref={ref}><div className="virtual-item-wrapper" data-virtual-item-key="question">
        <AskUserQuestionCard toolItem={tool} config={config} sessionId="session-a" isLastItem />
      </div></div>;
    }
    const renderCard = () => root.render(<Transcript />);
    const next = () => container.querySelector<HTMLButtonElement>('[data-bitfun-part="next"] button')!;
    const back = () => container.querySelector<HTMLButtonElement>('[data-bitfun-part="back"] button')!;
    const choose = async (value: string) => {
      await act(async () => container.querySelector<HTMLInputElement>(`input[value="${value}"]`)!.click());
    };

    act(renderCard);
    expect(container.querySelectorAll('fieldset')).toHaveLength(1);
    expect(container.querySelector('progress')?.value).toBe(1);
    expect(back()).toBeNull();
    expect(next().disabled).toBe(true);
    expect(container.querySelector('[data-bitfun-part="submit"]')).toBeNull();

    await choose('PostgreSQL');
    expect(next().disabled).toBe(false);
    act(() => next().click());
    expect(container.querySelector('progress')?.value).toBe(2);
    expect(document.activeElement).toBe(container.querySelector('legend'));
    expect(container.querySelectorAll('[data-bitfun-component="checkbox"]')).toHaveLength(3);
    await choose('Milestones');
    await choose('Open risks');
    act(() => back().click());
    expect(container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.checked).toBe(true);
    act(() => next().click());
    expect(container.querySelector<HTMLInputElement>('input[value="Milestones"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[value="Open risks"]')?.checked).toBe(true);
    expect(toolAPI.submitUserAnswers).not.toHaveBeenCalled();

    act(() => next().click());
    expect(container.querySelector('progress')?.value).toBe(3);
    expect(next()).toBeNull();
    await choose('Other');
    const customInput = container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input')!;
    const submit = () => container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')!;
    expect(submit().disabled).toBe(true);
    act(() => setInputValue(customInput, 'Send a follow-up'));
    act(() => back().click());
    act(() => next().click());
    expect(container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input')?.value).toBe('Send a follow-up');
    expect(submit().disabled).toBe(false);
    act(() => submit().click());
    expect(container.querySelector('[data-bitfun-part="answers"]')).toBeNull();
    expect(submit().disabled).toBe(true);
    await act(async () => acknowledgeSubmission());
    expect(toolAPI.submitUserAnswers).toHaveBeenCalledExactlyOnceWith(
      tool.id,
      { 0: 'PostgreSQL', 1: ['Milestones', 'Open risks'], 2: 'Send a follow-up' },
      'session-a',
    );
    const answeredContent = () => Array.from(container.querySelectorAll('[data-bitfun-part="answer-pair"]'))
      .map((pair) => ({
        question: pair.querySelector('dt')?.textContent,
        answers: Array.from(pair.querySelectorAll('[data-bitfun-part="answer-value"]')).map((answer) => answer.textContent),
      }));
    const expectedContent = [
      { question: 'Which database?', answers: ['PostgreSQL'] },
      { question: 'What should the update cover?', answers: ['Milestones', 'Open risks'] },
      { question: 'Anything else?', answers: ['Send a follow-up'] },
    ];
    expect(answeredContent()).toEqual(expectedContent);
    expect(container.querySelector('input, button, progress, svg')).toBeNull();
    // Answering, question navigation and custom-answer autofocus continue the
    // live conversation; they must not turn its viewport into a history reader.
    expect(takeReading).not.toHaveBeenCalled();
    act(() => root.render(null));
    act(renderCard);
    expect(answeredContent()).toEqual(expectedContent);
    expect(container.querySelector('input, button, progress, svg')).toBeNull();
  });

  it('resumes at an unanswered question after remount and requires nonblank custom text before Next', async () => {
    const tool = questionTool('pending_confirmation');
    tool.toolCall.input = {
      questions: [
        { question: 'Which database?', options: [{ label: 'PostgreSQL' }] },
        { question: 'Which region?', options: [{ label: 'Asia' }] },
      ],
    };
    const renderCard = () => root.render(
      <AskUserQuestionCard toolItem={tool} config={config} sessionId="session-a" isLastItem />,
    );
    const next = () => container.querySelector<HTMLButtonElement>('[data-bitfun-part="next"] button')!;
    act(renderCard);
    await act(async () => container.querySelector<HTMLInputElement>('input[value="Other"]')!.click());
    expect(next().disabled).toBe(true);
    const input = container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input')!;
    act(() => setInputValue(input, '   '));
    expect(next().disabled).toBe(true);
    await act(async () => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')!.click());
    act(() => next().click());
    act(() => root.render(null));
    act(renderCard);
    expect(container.querySelector('legend')?.textContent).toBe('Which region?');
    expect(container.querySelector('progress')?.value).toBe(2);
    expect(toolAPI.submitUserAnswers).not.toHaveBeenCalled();
  });

  it('uses the host deadline across remounts and supports unlimited waits', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date', 'performance'] });
    vi.setSystemTime(1000000);
    const tool = questionTool('waiting');
    tool.userQuestionWait = { deadlineMs: Date.now() + 180000, monotonicDeadlineMs: performance.now() + 180000, interactionStarted: false };
    const render = () => act(() => root.render(
      <AskUserQuestionCard toolItem={tool} config={config} sessionId="timer-session" />,
    ));
    try {
      render();
      expect(container.querySelector('[role="timer"]')?.textContent).toBe('3:00');
      act(() => vi.advanceTimersByTime(65000));
      expect(container.querySelector('[role="timer"]')?.textContent).toBe('1:55');
      vi.setSystemTime(Date.now() + 86400000);
      act(() => vi.advanceTimersByTime(1000));
      expect(container.querySelector('[role="timer"]')?.textContent).toBe('1:54');
      act(() => root.render(null));
      render();
      expect(container.querySelector('[role="timer"]')?.textContent).toBe('1:54');
      act(() => vi.advanceTimersByTime(114000));
      expect(container.querySelector('[role="timer"]')?.textContent)
        .toBe('toolCards.askUser.awaitingTimeoutConfirmation');
      expect(toolAPI.submitUserAnswers).not.toHaveBeenCalled();
      tool.userQuestionWait.deadlineMs = null;
      render();
      expect(container.querySelector('[role="timer"]')).toBeNull();
      expect(container.querySelector('button[aria-label="toolCards.askUser.cancelCountdown"]')).toBeNull();
      expect(container.querySelector('[data-bitfun-part="wait-settled"]')?.textContent)
        .toBe('toolCards.askUser.unlimitedWait');
      tool.userQuestionWait.interactionStarted = true;
      render();
      expect(container.querySelector('[role="timer"]')).toBeNull();
      expect(container.querySelector('[data-bitfun-part="wait-settled"]')).toBeNull();
      tool.userQuestionWait.interactionStarted = false;
      delete tool.userQuestionWait.deadlineMs;
      render();
      expect(container.querySelector('[role="timer"]')).toBeNull();
      expect(container.querySelector('[data-bitfun-part="wait-settled"]')?.textContent)
        .toBe('toolCards.askUser.unlimitedWait');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the countdown only after host acknowledgement and deduplicates clicks', async () => {
    let acknowledge!: () => void;
    vi.mocked(toolAPI.startUserQuestionInteraction).mockReturnValue(new Promise<void>(resolve => { acknowledge = resolve; }));
    const tool = questionTool('waiting');
    tool.userQuestionWait = { deadlineMs: Date.now() + 180000, monotonicDeadlineMs: performance.now() + 180000, interactionStarted: false };
    act(() => root.render(<AskUserQuestionCard toolItem={tool} config={config} sessionId="timer-session" />));
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="toolCards.askUser.cancelCountdown"]')!;
    expect(button.querySelector('[role="timer"]')).not.toBeNull();
    expect(button.querySelector('svg')).not.toBeNull();
    act(() => button.focus());
    expect(toolAPI.startUserQuestionInteraction).not.toHaveBeenCalled();
    act(() => { button.click(); button.click(); });
    expect(toolAPI.startUserQuestionInteraction).toHaveBeenCalledExactlyOnceWith(tool.id, 'timer-session');
    expect(container.querySelector('[role="timer"]')).not.toBeNull();
    await act(async () => acknowledge());
    expect(container.querySelector('[role="timer"]')).toBeNull();
    expect(toolAPI.submitUserAnswers).not.toHaveBeenCalled();
  });

  it('keeps the countdown available for retry when cancellation fails', async () => {
    vi.mocked(toolAPI.startUserQuestionInteraction).mockRejectedValueOnce(new Error('offline'));
    const tool = questionTool('waiting');
    tool.userQuestionWait = { deadlineMs: Date.now() + 180000, monotonicDeadlineMs: performance.now() + 180000, interactionStarted: false };
    act(() => root.render(<AskUserQuestionCard toolItem={tool} config={config} sessionId="timer-session" />));
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="toolCards.askUser.cancelCountdown"]')!;
    await act(async () => button.click());
    expect(container.querySelector('[role="timer"]')).not.toBeNull();
    await act(async () => button.click());
    expect(toolAPI.startUserQuestionInteraction).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="timer"]')).toBeNull();
  });

  it('shows the question and answer immediately on completion, including at the conversation tail', () => {
    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('pending_confirmation')}
          config={config}
          isLastItem
        />,
      );
    });
    expect(container.querySelector('[data-bitfun-part="body"]')).not.toBeNull();
    expect(container.querySelector('[data-bitfun-part="answers"]')).toBeNull();

    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('completed')}
          config={config}
          isLastItem
        />,
      );
    });
    expect(container.querySelector('[data-bitfun-part="answered-question"]')?.textContent).toBe('Which database?');
    expect(container.querySelector('[data-bitfun-part="answer"]')?.textContent).toBe('PostgreSQL');
    expect(container.querySelector('input, button, progress, svg')).toBeNull();

    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('completed')}
          config={config}
          isLastItem={false}
        />,
      );
    });
    expect(container.textContent).toBe('Which database?PostgreSQL');
    expect(container.querySelector('input, button, progress, svg')).toBeNull();
  });

  it('restores answer text from a serialized completed result without showing unselected choices', () => {
    const tool = questionTool('completed', true);
    tool.toolResult = { success: true, result: JSON.stringify({ answers: { 0: ['PostgreSQL', 'Custom\ndatabase'] } }) };
    act(() => root.render(<AskUserQuestionCard toolItem={tool} config={config} sessionId="session-a" />));
    expect(container.querySelector('[data-bitfun-part="answered-question"]')?.textContent).toBe('Which database?');
    expect(Array.from(container.querySelectorAll('[data-bitfun-part="answer-value"]')).map((answer) => answer.textContent))
      .toEqual(['PostgreSQL', 'Custom\ndatabase']);
    expect(container.querySelector('input, button, progress, svg')).toBeNull();
    expect(container.textContent).not.toContain('toolCards.askUser.other');
    expect(container.textContent).not.toContain('Use PostgreSQL');
  });

  it('submits ACP option values by field and respects a form that disallows custom answers', async () => {
    const tool = questionTool('running');
    tool.questionRequest = { questions: [{
      field: 'database', header: 'Database', question: 'Which database?',
      allowCustomInput: false,
      options: [{ label: 'SQLite', value: 'sqlite' }, { label: 'PostgreSQL', value: 'postgres' }],
    }] };
    act(() => root.render(<AskUserQuestionCard toolItem={tool} config={config} sessionId="acp-session" isLastItem />));
    expect(container.querySelector('input[value="Other"]')).toBeNull();
    act(() => container.querySelector<HTMLInputElement>('input[value="sqlite"]')?.click());
    const submitButton = container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button');
    expect(submitButton?.disabled).toBe(false);
    await act(async () => submitButton?.click());
    expect(toolAPI.submitUserAnswers).toHaveBeenCalledWith('question-tool-1', { database: 'sqlite' }, 'acp-session');
  });

  it('restores an unsubmitted answer after the session card is remounted', () => {
    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('pending_confirmation')}
          config={config}
          sessionId="session-a"
          isLastItem
        />,
      );
    });

    const radio = container.querySelector<HTMLInputElement>('input[value="SQLite"]');
    expect(radio).not.toBeNull();
    act(() => radio?.click());
    expect(radio?.checked).toBe(true);

    act(() => root.render(null));
    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('pending_confirmation')}
          config={config}
          sessionId="session-b"
          isLastItem
        />,
      );
    });
    // Another session's card is a fresh draft, and a plain question has no
    // default: nothing is checked until that session's user picks.
    expect(
      container.querySelector<HTMLInputElement>('input[value="SQLite"]')?.checked,
    ).toBe(false);
    expect(
      container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.checked,
    ).toBe(false);

    act(() => root.render(null));
    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('pending_confirmation')}
          config={config}
          sessionId="session-a"
          isLastItem
        />,
      );
    });
    expect(
      container.querySelector<HTMLInputElement>('input[value="SQLite"]')?.checked,
    ).toBe(true);
  });

  it('switches to the draft owned by the newly activated device surface', () => {
    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('pending_confirmation')}
          config={config}
          sessionId="session-a"
          isLastItem
        />,
      );
    });

    const localRadio = container.querySelector<HTMLInputElement>('input[value="SQLite"]');
    act(() => localRadio?.click());
    expect(localRadio?.checked).toBe(true);

    act(() => {
      activateSurface('peer-device-b');
    });

    // The peer surface owns a separate draft, so the local surface's click is
    // not shown there; a plain question shows no default either.
    expect(
      container.querySelector<HTMLInputElement>('input[value="SQLite"]')?.checked,
    ).toBe(false);
    expect(
      container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.checked,
    ).toBe(false);
  });

  it('explains why an older CLI peer cannot answer instead of exposing a dead form', () => {
    activateSurface('peer-cli');
    act(() => {
      root.render(
        <PeerDeviceContext.Provider value={{
          peerMode: { active: true, deviceId: 'peer-cli', deviceName: 'CLI' },
          attachments: [],
          currentPeerCapabilities: {
            idempotentDialogSubmit: true,
            targetedSessionRollback: true,
            tokenUsageStatistics: true,
            miniAppAgentContextFilesV1: false,
            cancelTool: false,
            toolCatalog: false,
            userQuestionResponse: null,
            hostKind: 'cli',
          },
          switchToDevice: vi.fn(),
          switchToLocal: vi.fn(),
          disconnectDevice: vi.fn(),
          disconnectAllDevices: vi.fn(),
        }}>
          <AskUserQuestionCard
            toolItem={questionTool('pending_confirmation')}
            config={config}
            sessionId="session-a"
            isLastItem
          />
        </PeerDeviceContext.Provider>,
      );
    });

    expect(container.querySelector('[data-bitfun-component="ask-user"]')?.getAttribute('data-bitfun-state'))
      .toBe('error');
    expect(container.querySelector('[data-bitfun-part="status-label"]')?.textContent)
      .toBe('toolCards.askUser.unsupportedOnPeer');
    expect(container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.disabled)
      .toBe(true);
  });

  it('restores an unsubmitted custom input after the card is remounted', () => {
    const renderCard = () => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('pending_confirmation')}
          config={config}
          sessionId="session-a"
          isLastItem
        />,
      );
    };

    act(renderCard);
    const otherRadio = container.querySelector<HTMLInputElement>('input[value="Other"]');
    expect(otherRadio).not.toBeNull();
    act(() => otherRadio?.click());

    const customInput = container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input');
    expect(customInput).not.toBeNull();
    act(() => {
      if (customInput) {
        setInputValue(customInput, 'CockroachDB');
      }
    });
    expect(customInput?.value).toBe('CockroachDB');

    act(() => root.render(null));
    act(renderCard);

    expect(container.querySelector<HTMLInputElement>('input[value="Other"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input')?.value).toBe('CockroachDB');
  });

  it('keeps the custom input mounted and focused during Chinese IME composition', () => {
    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('pending_confirmation')}
          config={config}
          sessionId="session-a"
          isLastItem
        />,
      );
    });

    const otherRadio = container.querySelector<HTMLInputElement>('input[value="Other"]');
    act(() => otherRadio?.click());

    const customInput = container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input');
    expect(customInput).not.toBeNull();
    act(() => {
      customInput?.focus();
      customInput?.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      if (customInput) {
        setInputValue(customInput, 'n');
        setInputValue(customInput, '');
      }
    });

    expect(container.querySelector('[data-bitfun-part="custom-input"] input')).toBe(customInput);
    expect(document.activeElement).toBe(customInput);
    expect(container.querySelector<HTMLInputElement>('input[value="Other"]')?.checked).toBe(true);

    act(() => {
      if (customInput) {
        setInputValue(customInput, '你');
        customInput.dispatchEvent(new CompositionEvent('compositionend', {
          bubbles: true,
          data: '你',
        }));
      }
    });

    expect(container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input')?.value).toBe('你');
    expect(document.activeElement).toBe(customInput);
  });

  it.each([
    { sessionId: 'session-a', multiSelect: false },
    { sessionId: undefined, multiSelect: false },
    { sessionId: 'session-a', multiSelect: true },
    { sessionId: undefined, multiSelect: true },
  ])('retains Other selection and input focus after clearing text ($sessionId, multiple=$multiSelect)', async ({ sessionId, multiSelect }) => {
    act(() => root.render(
      <AskUserQuestionCard
        toolItem={questionTool('pending_confirmation', multiSelect)}
        config={config}
        sessionId={sessionId}
      />,
    ));
    await act(async () => container.querySelector<HTMLInputElement>('input[value="Other"]')!.click());
    const input = container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input')!;
    expect(document.activeElement).toBe(input);
    act(() => setInputValue(input, 'Custom database'));

    for (const value of ['', '   ']) {
      act(() => setInputValue(input, value));
      expect(container.querySelector('[data-bitfun-part="custom-input"] input')).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(container.querySelector<HTMLInputElement>('input[value="Other"]')?.checked).toBe(true);
      expect(container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')?.disabled).toBe(true);
    }

    act(() => setInputValue(input, 'New database'));
    expect(input.value).toBe('New database');
    expect(document.activeElement).toBe(input);
    expect(container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')?.disabled).toBe(false);
  });

  it('keeps a blank multi-select Other answer selected and omits it from submission', async () => {
    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('pending_confirmation', true)}
          config={config}
          sessionId="session-a"
          isLastItem
        />,
      );
    });

    const databaseCheckbox = container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]');
    const otherCheckbox = container.querySelector<HTMLInputElement>('input[value="Other"]');
    act(() => {
      databaseCheckbox?.click();
      otherCheckbox?.click();
    });

    const customInput = container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input');
    expect(customInput).not.toBeNull();
    act(() => {
      if (customInput) {
        setInputValue(customInput, 'Custom database');
        setInputValue(customInput, '');
      }
    });

    expect(container.querySelector<HTMLInputElement>('input[value="Other"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.checked).toBe(true);

    const submitButton = container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button');
    expect(submitButton?.disabled).toBe(false);
    await act(async () => submitButton?.click());

    expect(toolAPI.submitUserAnswers).toHaveBeenCalledWith(
      'question-tool-1',
      { 0: ['PostgreSQL'] },
      'session-a',
    );
  });

  it('keeps the form retryable and reports a failed response submission', async () => {
    vi.mocked(toolAPI.submitUserAnswers).mockRejectedValueOnce(new Error('peer unavailable'));
    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('pending_confirmation')}
          config={config}
          sessionId="session-a"
          isLastItem
        />,
      );
    });

    act(() => {
      container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.click();
    });
    const submitButton = container.querySelector<HTMLButtonElement>(
      '[data-bitfun-part="submit"] button',
    );
    await act(async () => submitButton?.click());

    expect(container.querySelector('[data-bitfun-part="status-label"]')?.textContent)
      .toBe('toolCards.askUser.submitFailed');
    expect(submitButton?.disabled).toBe(false);
  });
  it.each([
    ['cancelled', undefined, 'toolCards.default.cancelled'],
    ['rejected', undefined, 'toolCards.default.rejected'],
    ['error', undefined, 'toolCards.default.failed'],
    ['completed', 'cancelled', 'toolCards.default.cancelled'],
    ['completed', 'timeout', 'toolCards.askUser.skippedAnswer'],
  ] as const)('renders %s/%s as a terminal notice, even with stale streaming params', (status, resultStatus, label) => {
    const item = questionTool(status);
    item.isParamsStreaming = true;
    item.partialParams = item.toolCall.input;
    if (resultStatus) item.toolResult = { success: true, result: { status: resultStatus } };
    act(() => root.render(<AskUserQuestionCard toolItem={item} config={config} sessionId="session-a" />));
    expect(container.textContent).toContain(label);
    expect(container.textContent).not.toContain('toolCards.askUser.waitingAnswer');
    expect(container.textContent).not.toContain('questionsAnswered');
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('[data-bitfun-part="submit"]')).toBeNull();
    expect(toolAPI.submitUserAnswers).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'completed'] as const)('lets a cancelled %s call reopen every received question without allowing answers', (status) => {
    const item = questionTool('running');
    item.toolCall.input.questions.push({
      header: 'Region',
      question: 'Which region?',
      multiSelect: true,
      options: [{ label: 'Asia', description: 'Use the Asia region' }],
    });
    act(() => root.render(<AskUserQuestionCard toolItem={item} config={config} sessionId="session-a" />));
    const cancelledItem = {
      ...item,
      status,
      isParamsStreaming: true,
      partialParams: item.toolCall.input,
      ...(status === 'completed' ? {
        toolResult: { success: true, result: JSON.stringify({ status: 'cancelled' }) },
      } : {}),
    };
    const renderCancelledCard = () => root.render(
      <AskUserQuestionCard toolItem={cancelledItem} config={config} sessionId="session-a" />,
    );
    const expand = () => container.querySelector<HTMLButtonElement>('[data-bitfun-part="disclosure"]')!.click();

    act(renderCancelledCard);
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('toolCards.default.cancelled');
    act(expand);
    expect(Array.from(container.querySelectorAll('legend'), (legend) => legend.textContent))
      .toEqual(['Which database?', 'Which region?']);
    expect(container.textContent).toContain('Use PostgreSQL');
    expect(container.textContent).toContain('Use the Asia region');
    expect(container.textContent).toContain('toolCards.default.cancelled');
    expect(container.querySelector('[data-bitfun-part="submit"]')).toBeNull();
    expect(container.querySelector('[data-bitfun-part="next"]')).toBeNull();
    container.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
      expect(input.disabled).toBe(true);
      act(() => input.click());
      expect(input.checked).toBe(false);
    });
    expect(toolAPI.startUserQuestionInteraction).not.toHaveBeenCalled();
    expect(toolAPI.submitUserAnswers).not.toHaveBeenCalled();
    expect(sendFollowUp).not.toHaveBeenCalled();
    expect(askUserQuestionDraftStore.getState().drafts).toEqual({});

    act(() => container.querySelector<HTMLButtonElement>('[data-bitfun-part="collapse"]')!.click());
    expect(container.querySelector('input')).toBeNull();
    act(() => root.render(null));
    act(renderCancelledCard);
    act(expand);
    expect(container.querySelectorAll('fieldset')).toHaveLength(2);
  });

  it('keeps an empty cancelled call as a notice without a disclosure', () => {
    const item = questionTool('cancelled');
    item.toolCall.input = {};
    act(() => root.render(<AskUserQuestionCard toolItem={item} config={config} sessionId="session-a" />));
    expect(container.textContent).toContain('toolCards.default.cancelled');
    expect(container.querySelector('button, input')).toBeNull();
  });

  it('shows only the live question form beside an obsolete retry', async () => {
    const old = questionTool('cancelled');
    old.interruptionReason = 'retry_superseded';
    const live = questionTool('running');
    live.id = 'live-tool';
    live.toolCall = { ...live.toolCall, id: 'live-tool' };
    act(() => root.render(<>
      <AskUserQuestionCard toolItem={old} config={config} sessionId="session-a" />
      <AskUserQuestionCard toolItem={live} config={config} sessionId="session-a" />
    </>));
    expect(container.querySelectorAll('[data-bitfun-part="submit"]')).toHaveLength(1);
    act(() => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')?.click());
    expect(toolAPI.submitUserAnswers).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toolAPI.submitUserAnswers).mock.calls[0][0]).toBe('live-tool');
  });

  it('does not render partial questions as a disabled form and uses final parameters after streaming', () => {
    const item = questionTool('preparing');
    item.isParamsStreaming = true;
    item.partialParams = item.toolCall.input;
    act(() => root.render(<AskUserQuestionCard toolItem={item} config={config} sessionId="session-a" />));
    expect(container.textContent).toContain('toolCards.askUser.loadingQuestions');
    expect(container.querySelector('input')).toBeNull();
    const final = { ...item, status: 'running' as const, isParamsStreaming: false,
      toolCall: { ...item.toolCall, input: { questions: [{ ...item.toolCall.input.questions[0], question: 'Final question' }] } } };
    act(() => root.render(<AskUserQuestionCard toolItem={final} config={config} sessionId="session-a" />));
    expect(container.textContent).toContain('Final question');
    expect(container.textContent).not.toContain('Which database?');
    expect(container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.disabled).toBe(false);
  });

  it.each(['resolve', 'reject'] as const)('does not revive a draft when an in-flight submission settles after timeout: %s', async (outcome) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    vi.mocked(toolAPI.submitUserAnswers).mockImplementationOnce(() => new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
    const item = questionTool('running');
    act(() => root.render(<AskUserQuestionCard toolItem={item} config={config} sessionId="session-a" />));
    act(() => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.click());
    act(() => container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')?.click());
    const timedOut = { ...item, status: 'completed' as const, toolResult: { success: true, result: { status: 'timeout' } } };
    act(() => root.render(<AskUserQuestionCard toolItem={timedOut} config={config} sessionId="session-a" />));
    await act(async () => { if (outcome === 'resolve') resolve(); else reject(new Error('expired question')); });
    expect(container.textContent).toContain('toolCards.askUser.skippedAnswer');
    expect(container.querySelector('[data-bitfun-part="submit"]')).toBeNull();
    expect(askUserQuestionDraftStore.getState().drafts).toEqual({});
  });

  it('reopens a skipped questionnaire and sends actual answers once as an owning-session follow-up', async () => {
    let accept!: () => void;
    sendFollowUp.mockReturnValueOnce(new Promise<void>(resolve => { accept = resolve; }));
    const item = questionTool('completed');
    item.toolResult = { success: true, result: { status: 'timeout' } };
    item.toolCall.input = { questions: [
      { question: 'Which database?', options: [{ label: 'PostgreSQL' }] },
      { question: 'Which regions?', multiSelect: true, options: [{ label: 'Asia' }] },
    ] };
    const renderCard = () => root.render(<AskUserQuestionCard toolItem={item} config={config} sessionId="owner-session" />);
    act(renderCard);
    const expand = () => container.querySelector<HTMLButtonElement>('[data-bitfun-part="disclosure"]')!.click();
    expect(container.querySelector('[data-bitfun-part="header-icon"]')?.getAttribute('data-bitfun-name')).toBe('message-circle-question');
    act(expand);
    expect(container.querySelector('[data-bitfun-part="header-icon"]')?.getAttribute('data-bitfun-name')).toBe('message-circle-question');
    expect(document.activeElement).toBe(container.querySelector('legend'));
    act(() => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[data-bitfun-part="next"] button')!.click());
    act(() => container.querySelector<HTMLInputElement>('input[value="Asia"]')!.click());
    act(() => container.querySelector<HTMLInputElement>('input[value="Other"]')!.click());
    act(() => setInputValue(container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input')!, '  Europe  '));
    act(() => container.querySelector<HTMLButtonElement>('[data-bitfun-part="collapse"]')!.click());
    expect(container.querySelector('input')).toBeNull();
    act(() => askUserQuestionDraftStore.getState().reconcilePendingTools(LOCAL_SURFACE_ID, 'owner-session', []));
    act(expand);
    expect(container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input')?.value).toBe('  Europe  ');
    const submit = container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')!;
    act(() => { submit.click(); submit.click(); });
    expect(sendFollowUp).toHaveBeenCalledExactlyOnceWith(
      'Which database?\nPostgreSQL\n\nWhich regions?\nAsia\nEurope',
      'owner-session',
      'Which database?\nPostgreSQL\n\nWhich regions?\nAsia\nEurope',
      undefined, undefined, { sendImmediately: true },
    );
    expect(toolAPI.submitUserAnswers).not.toHaveBeenCalled();
    expect(toolAPI.startUserQuestionInteraction).not.toHaveBeenCalled();
    // Virtualization can unmount the card before the host acknowledges it.
    act(() => root.render(null));
    await act(async () => accept());
    act(renderCard);
    expect(container.querySelectorAll('[data-bitfun-part="answer-pair"]')).toHaveLength(2);
    expect(container.textContent).toContain('Europe');
    expect(container.querySelector('input, button, progress')).toBeNull();
  });

  it('keeps a failed follow-up editable and retries with the saved answer', async () => {
    sendFollowUp.mockRejectedValueOnce(new Error('offline'));
    const item = questionTool('completed');
    item.toolResult = { success: true, result: { status: 'timeout' } };
    act(() => root.render(<AskUserQuestionCard toolItem={item} config={config} sessionId="session-a" />));
    act(() => container.querySelector<HTMLButtonElement>('[data-bitfun-part="disclosure"]')!.click());
    act(() => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')!.click());
    expect(container.textContent).toContain('toolCards.askUser.submitFailed');
    expect(container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.checked).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')!.click());
    expect(sendFollowUp).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-bitfun-part="answer-value"]')?.textContent).toBe('PostgreSQL');
  });

  it('isolates a skipped follow-up from another device surface while the send is in flight', async () => {
    let accept!: () => void;
    sendFollowUp.mockReturnValueOnce(new Promise<void>(resolve => { accept = resolve; }));
    const item = questionTool('completed');
    item.toolResult = { success: true, result: { status: 'timeout' } };
    act(() => root.render(<AskUserQuestionCard toolItem={item} config={config} sessionId="same-session" />));
    act(() => container.querySelector<HTMLButtonElement>('[data-bitfun-part="disclosure"]')!.click());
    act(() => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')!.click());
    act(() => activateSurface('other-peer'));
    await act(async () => accept());
    expect(container.querySelector('[data-bitfun-part="answers"]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[data-bitfun-part="disclosure"]')!.click());
    expect(container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.checked).toBe(false);
    expect(sendFollowUp).toHaveBeenCalledTimes(1);
    expect(toolAPI.submitUserAnswers).not.toHaveBeenCalled();
  });

  it('does not fall back to the active session for a skipped card without an owning session', () => {
    const item = questionTool('completed');
    item.toolResult = { success: true, result: { status: 'timeout' } };
    act(() => root.render(<AskUserQuestionCard toolItem={item} config={config} />));
    expect(container.querySelector('button, input')).toBeNull();
    expect(container.querySelector('[role="status"] [data-bitfun-name="circle-arrow-right"]')).not.toBeNull();
    expect(sendFollowUp).not.toHaveBeenCalled();
  });

  it.each(['preparing', 'streaming', 'pending'] as const)('does not offer answers before a %s call starts executing', (status) => {
    const item = questionTool(status);
    item.isParamsStreaming = false;
    act(() => root.render(<AskUserQuestionCard toolItem={item} config={config} sessionId="session-a" />));
    expect(container.textContent).toContain('toolCards.askUser.loadingQuestions');
    expect(container.querySelector('[data-bitfun-part="submit"]')).toBeNull();
  });

  it('acknowledges the first option click once without submitting answers', async () => {
    act(() => root.render(<AskUserQuestionCard toolItem={questionTool('running')} config={config} sessionId="session-a" />));
    expect(toolAPI.startUserQuestionInteraction).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.click());
    await act(async () => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.click());
    expect(toolAPI.startUserQuestionInteraction).toHaveBeenCalledExactlyOnceWith('question-tool-1', 'session-a');
    expect(toolAPI.submitUserAnswers).not.toHaveBeenCalled();
  });

  it('acknowledges input focus without requiring any text or selection', async () => {
    act(() => root.render(<AskUserQuestionCard toolItem={questionTool('running')} config={config} sessionId="session-a" />));
    await act(async () => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.focus());
    expect(toolAPI.startUserQuestionInteraction).toHaveBeenCalledExactlyOnceWith('question-tool-1', 'session-a');
    expect(toolAPI.submitUserAnswers).not.toHaveBeenCalled();
  });

  it('reports a failed activity acknowledgement and retries on the next interaction', async () => {
    vi.mocked(toolAPI.startUserQuestionInteraction).mockRejectedValueOnce(new Error('host unavailable'));
    act(() => root.render(<AskUserQuestionCard toolItem={questionTool('running')} config={config} sessionId="session-a" />));
    await act(async () => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.click());
    expect(container.textContent).toContain('toolCards.askUser.interactionFailed');
    await act(async () => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.click());
    expect(toolAPI.startUserQuestionInteraction).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('toolCards.askUser.interactionFailed');
  });

  it('keeps legacy peer answers working and explicitly reports unsupported timeout cancellation', async () => {
    act(() => root.render(
      <PeerDeviceContext.Provider value={{
        peerMode: { active: true, deviceId: 'legacy-peer', deviceName: 'Legacy' },
        attachments: [],
        currentPeerCapabilities: {
          idempotentDialogSubmit: true, targetedSessionRollback: true, tokenUsageStatistics: true,
          miniAppAgentContextFilesV1: false, cancelTool: false, toolCatalog: false,
          userQuestionResponse: true, hostKind: 'desktop',
        },
        switchToDevice: vi.fn(), switchToLocal: vi.fn(), disconnectDevice: vi.fn(), disconnectAllDevices: vi.fn(),
      }}>
        <AskUserQuestionCard toolItem={questionTool('running')} config={config} sessionId="session-a" />
      </PeerDeviceContext.Provider>,
    ));
    await act(async () => container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.click());
    expect(toolAPI.startUserQuestionInteraction).not.toHaveBeenCalled();
    expect(container.textContent).toContain('toolCards.askUser.interactionFailed');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')?.click());
    expect(toolAPI.submitUserAnswers).toHaveBeenCalledTimes(1);
  });

  // Qt migration intake: the backend resolves the template and emits its own
  // question shape on the `qtMigrationQuestions` envelope field, which the card
  // selected by `templateId` renders. A candidate option submits its `path`
  // (never the "Default path" role label), and the Qt major version is a
  // structured badge instead of text appended to the path. Answers are
  // re-validated by field id.
  function qtMigrationTool(): FlowToolItem {
    return {
      id: 'question-tool-1',
      type: 'tool',
      toolName: 'AskUserQuestion',
      timestamp: 1,
      status: 'waiting',
      toolCall: {
        id: 'question-call-1',
        // Runtime shape: the model sends only the template id. The resolved
        // questions arrive on `questionRequest` from the ToolAwaitingUserInput
        // event; routing them through `toolCall.input` here is what used to
        // hide the card's missing envelope read.
        input: { templateId: 'qt-migration-paths' },
      },
      questionRequest: {
        templateId: 'qt-migration-paths',
        templateVersion: '1',
        // The generic projection still rides along for consumers that only know
        // the shared contract; the Qt card must render its own shape instead.
        resolvedQuestions: [
          {
            field: 'source_project',
            header: 'askUser.qtMigration.field.sourceProject',
            question: 'askUser.qtMigration.question.sourceProject',
            inputPlaceholder: 'askUser.qtMigration.placeholder.sourceProject',
            options: [
              { label: 'askUser.qtMigration.option.default', description: 'D:/work/myqt' },
            ],
          },
        ],
        qtMigrationQuestions: [
          {
            field: 'source_project',
            header: 'askUser.qtMigration.field.sourceProject',
            prompt: 'askUser.qtMigration.question.sourceProject',
            placeholder: 'askUser.qtMigration.placeholder.sourceProject',
            required: true,
            options: [
              { label: 'askUser.qtMigration.option.default', path: 'D:/work/myqt' },
            ],
          },
          {
            field: 'toolchain',
            header: 'askUser.qtMigration.field.toolchain',
            prompt: 'askUser.qtMigration.question.toolchain',
            placeholder: 'askUser.qtMigration.placeholder.toolchain',
            required: true,
            options: [
              {
                label: 'askUser.qtMigration.option.default',
                path: 'D:/ohos/qt5-kit',
                version: 5,
              },
              {
                label: 'askUser.qtMigration.option.alternate',
                path: 'D:/ohos/qt6-kit',
                version: 6,
              },
            ],
          },
          {
            field: 'template',
            header: 'askUser.qtMigration.field.template',
            prompt: 'askUser.qtMigration.question.template',
            placeholder: 'askUser.qtMigration.placeholder.template',
            required: true,
            options: [
              {
                label: 'askUser.qtMigration.option.officialTemplate',
                description: 'askUser.qtMigration.option.officialDescription',
                path: '',
                value: '__official__',
              },
            ],
          },
        ],
      },
    };
  }

  it('routes the Qt template to the Qt card and localizes its own copy keys', () => {
    act(() => root.render(
      <AskUserQuestionCard toolItem={qtMigrationTool()} config={config} sessionId="session-a" />,
    ));

    // The Qt payload parsed: three questions rendered from `qtMigrationQuestions`
    // (the generic projection on the same envelope carries a different count).
    expect(container.textContent).toContain('toolCards.askUser.questionsCount:3');
    // Template text is an i18n key; it must be resolved through the catalog
    // rather than rendered literally.
    expect(container.textContent).toContain('toolCards.askUser.qtMigration.question.sourceProject');
  });

  it('renders the Qt major version as its own badge, never inside the path', () => {
    act(() => root.render(
      <AskUserQuestionCard toolItem={qtMigrationTool()} config={config} sessionId="session-a" />,
    ));

    // Both toolchain candidates are badged. The badge lives on the option's role
    // line: the path line below is one clipped, right-edge-faded line, so a
    // trailing badge would be invisible behind a long toolchain path.
    const badges = Array.from(
      container.querySelectorAll('[data-bitfun-part="label"] span'),
    ).map((badge) => badge.textContent)
      .filter((text) => /^Qt\d+$/.test(text ?? ''));
    expect(badges).toEqual(['Qt5', 'Qt6']);
    // The path line keeps the clean path and no version text.
    const pathLines = Array.from(
      container.querySelectorAll('[data-bitfun-part="description"]'),
    ).map((line) => line.textContent ?? '');
    expect(pathLines).toContain('D:/ohos/qt5-kit');
    expect(pathLines.some((text) => text.includes('(Qt'))).toBe(false);
    // The clickable value is the clean path; the version is not part of it.
    expect(container.querySelector<HTMLInputElement>('input[value="D:/ohos/qt5-kit"]'))
      .not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[value="D:/ohos/qt5-kit (Qt5)"]'))
      .toBeNull();
  });

  it('renders the backend toolchain notice with a link that opens the guide externally', async () => {
    const tool = qtMigrationTool();
    const guideUrl = 'https://wiki.qt.io/Qt_for_HarmonyOS/development_with_6.12.0_Beta2_zh';
    const qtQuestions = (tool.questionRequest as unknown as {
      qtMigrationQuestions: Array<Record<string, unknown>>;
    }).qtMigrationQuestions;
    qtQuestions[2] = {
      ...qtQuestions[2],
      options: [],
      notice: 'askUser.qtMigration.notice.qt6ToolchainManualInstall',
      noticeUrl: guideUrl,
    };
    act(() => root.render(
      <AskUserQuestionCard toolItem={tool} config={config} sessionId="session-a" />,
    ));

    const notices = container.querySelectorAll('[data-qt-migration-notice]');
    expect(notices).toHaveLength(1);
    expect(notices[0].textContent).toContain(
      'toolCards.askUser.qtMigration.notice.qt6ToolchainManualInstall',
    );
    const link = notices[0].querySelector<HTMLAnchorElement>('a');
    expect(link?.textContent).toBe('toolCards.askUser.qtMigration.notice.openGuide');
    await act(async () => link?.click());
    expect(systemAPI.openExternal).toHaveBeenCalledWith(guideUrl);
  });

  it('submits a plain option value instead of its display label', async () => {
    // 版本策略问题由模型自拟（文案是它的），运行时只按选项取值判断用户选择：所以普通问题的
    // 选项带 value 时，提交的必须是 value 而不是文案。
    const tool: FlowToolItem = {
      id: 'question-tool-1',
      type: 'tool',
      toolName: 'AskUserQuestion',
      timestamp: 1,
      status: 'waiting',
      toolCall: {
        id: 'question-call-1',
        input: {
          questions: [{
            header: 'Qt 版本',
            question: '原始工程是 Qt6、工具链是 Qt5，是否按 Qt5 降级迁移？',
            multiSelect: false,
            options: [
              { label: '降级到 Qt5 迁移', description: '按工具链的 Qt5 构建', value: 'continue_migration' },
              { label: '不迁移', description: '终止本次迁移', value: 'abort' },
            ],
          }],
        },
      },
    };
    act(() => root.render(
      <AskUserQuestionCard toolItem={tool} config={config} sessionId="session-a" />,
    ));

    const text = container.textContent ?? '';
    expect(text).toContain('降级到 Qt5 迁移');
    expect(text).not.toContain('continue_migration');

    act(() => container.querySelector<HTMLInputElement>('input[value="continue_migration"]')?.click());
    const submitButton = container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button');
    expect(submitButton?.disabled).toBe(false);
    await act(async () => submitButton?.click());

    // 普通问题按位置下标提交（模板问题才用字段 id）。
    expect(toolAPI.submitUserAnswers).toHaveBeenCalledWith(
      'question-tool-1',
      { 0: 'continue_migration' },
      'session-a',
    );
  });

  it('submits template answers by field id using the resolved path, not the display label', async () => {
    act(() => root.render(
      <AskUserQuestionCard toolItem={qtMigrationTool()} config={config} sessionId="session-a" />,
    ));

    // The candidate option submits the probed path, not the "Default path"
    // label the backend would reject as a placeholder.
    const pathOption = container.querySelector<HTMLInputElement>('input[value="D:/work/myqt"]');
    expect(pathOption).not.toBeNull();
    act(() => pathOption?.click());
    // The alternate toolchain candidate proves the version badge does not leak
    // into the submitted value.
    act(() => container.querySelector<HTMLInputElement>('input[value="D:/ohos/qt6-kit"]')?.click());

    // The managed download option carries an explicit value.
    const officialOption = container.querySelector<HTMLInputElement>('input[value="__official__"]');
    expect(officialOption).not.toBeNull();
    act(() => officialOption?.click());

    const submitButton = container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button');
    expect(submitButton?.disabled).toBe(false);
    await act(async () => submitButton?.click());

    expect(toolAPI.submitUserAnswers).toHaveBeenCalledWith(
      'question-tool-1',
      { source_project: 'D:/work/myqt', toolchain: 'D:/ohos/qt6-kit', template: '__official__' },
      'session-a',
    );
  });

  it('restores completed template answers stored under field ids', () => {
    const tool = qtMigrationTool();
    tool.status = 'completed';
    tool.toolResult = {
      success: true,
      result: {
        answers: {
          source_project: 'D:/work/myqt',
          toolchain: 'D:/ohos/qt5-kit',
          template: '__official__',
        },
      },
    };
    act(() => root.render(
      <AskUserQuestionCard toolItem={tool} config={config} sessionId="session-a" />,
    ));

    // Both field-keyed answers are recognized as option selections, so the
    // summary shows them instead of treating them as typed custom values.
    expect(container.textContent).toContain('D:/work/myqt');
    expect(container.textContent).toContain('D:/ohos/qt5-kit');
    expect(container.textContent).not.toContain('toolCards.askUser.notAnswered');
  });

  it('keeps an answer picked into a question input on that input once the card completes', async () => {
    // 复现 #271：候选路径没被选中，而是通过目录选择器把同一条路径填进输入框，提交后
    // 已完成卡片按持久化答案值回放，若不做区分就会改成"候选项选中 + 输入框清空"。
    act(() => root.render(
      <AskUserQuestionCard toolItem={qtMigrationTool()} config={config} sessionId="session-a" />,
    ));

    // The browse button lives inside the "Other" option, so check it first.
    act(() => container.querySelector<HTMLInputElement>('input[value="Other"]')?.click());
    await act(async () => {});

    act(() => container.querySelectorAll<HTMLButtonElement>('[data-bitfun-part="browse"]')[0]?.click());
    await act(async () => {});
    expect(pickWorkspaceDirectory).toHaveBeenCalledWith({
      title: 'toolCards.askUser.qtMigration.question.sourceProject',
      defaultPath: undefined,
    });

    const sourceInput = container
      .querySelectorAll<HTMLInputElement>('[data-bitfun-part="custom-input"] input')[0];
    // 提交前：输入框持有该路径，"Other"选项处于选中态，同名候选项不选中。
    expect(sourceInput?.value).toBe('D:/work/myqt');
    expect(container.querySelector<HTMLInputElement>('input[value="Other"]')?.checked)
      .toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[value="D:/work/myqt"]')?.checked)
      .toBe(false);

    const submitButton = container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button');
    await act(async () => submitButton?.click());
    expect(toolAPI.submitUserAnswers).toHaveBeenCalledWith(
      'question-tool-1',
      { source_project: 'D:/work/myqt', toolchain: 'D:/ohos/qt5-kit', template: '__official__' },
      'session-a',
    );

    const completed = qtMigrationTool();
    completed.status = 'completed';
    completed.toolResult = {
      success: true,
      result: {
        answers: {
          source_project: 'D:/work/myqt',
          toolchain: 'D:/ohos/qt5-kit',
          template: '__official__',
        },
      },
    };
    act(() => root.render(
      <AskUserQuestionCard toolItem={completed} config={config} sessionId="session-a" />,
    ));

    // 提交后：已完成卡片按持久化答案值回放；按候选项回答的问题仍显示为选中。
    // The picked path is shown as the answer for the source project question;
    // "Other" is checked so the inline input with the path is visible, the
    // candidate option with the same path is not checked, and the toolchain
    // candidate remains selected.
    expect(container.textContent).toContain('D:/work/myqt');
    expect(container.querySelector<HTMLInputElement>('input[value="other"]')?.checked)
      .toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[value="D:/work/myqt"]')?.checked)
      .toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[value="D:/ohos/qt5-kit"]')?.checked)
      .toBe(true);
  });

  it('keeps the own input and the options of a question as one field (#353)', async () => {
    // 复现 #353：问卷收集卡片里手动输入路径后，候选项仍是选中态；提交值却取自输入框，
    // 于是"选中的项"和"实际提交的值"不一致。两者是同一个字段，后动的那一方赢。
    act(() => root.render(
      <AskUserQuestionCard toolItem={qtMigrationTool()} config={config} sessionId="session-a" />,
    ));

    const candidate = () => container.querySelector<HTMLInputElement>('input[value="D:/work/myqt"]');
    const otherOption = () => container.querySelector<HTMLInputElement>('input[value="Other"]');
    const sourceInput = () => container
      .querySelectorAll<HTMLInputElement>('[data-bitfun-part="custom-input"] input')[0];
    expect(candidate()?.checked).toBe(true);

    // The input lives inside the "Other" option, so check it first.
    act(() => otherOption()?.click());
    await act(async () => {});
    expect(candidate()?.checked).toBe(false);

    act(() => {
      const input = sourceInput();
      if (input) setInputValue(input, 'D:/elsewhere/myqt');
    });
    expect(sourceInput()?.value).toBe('D:/elsewhere/myqt');

    // Re-clicking the candidate clears the "Other" selection (radio replacement).
    act(() => candidate()?.click());
    expect(candidate()?.checked).toBe(true);

    // Re-check "Other" and type the path again.
    act(() => otherOption()?.click());
    await act(async () => {});
    act(() => {
      const input = sourceInput();
      if (input) setInputValue(input, 'D:/elsewhere/myqt');
    });
    await act(async () => container
      .querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')?.click());
    expect(toolAPI.submitUserAnswers).toHaveBeenCalledWith(
      'question-tool-1',
      {
        source_project: 'D:/elsewhere/myqt',
        toolchain: 'D:/ohos/qt5-kit',
        template: '__official__',
      },
      'session-a',
    );
  });

  it('submits the typed text when a multi-select question declares its own input (#86 review)', async () => {
    // 多选问法同时带常驻输入框时，勾选"Other"并键入文本后，提交值应当是那段文本。
    act(() => root.render(
      <AskUserQuestionCard
        toolItem={questionTool('pending_confirmation', true, '/path/to/dir')}
        config={config}
        sessionId="session-a"
        isLastItem
      />,
    ));

    act(() => {
      container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.click();
    });
    // The input lives inside the "Other" option, so check it first.
    act(() => {
      container.querySelector<HTMLInputElement>('input[value="Other"]')?.click();
    });
    await act(async () => {});
    act(() => {
      const input = container.querySelector<HTMLInputElement>('[data-bitfun-part="custom-input"] input');
      if (input) setInputValue(input, 'Custom database');
    });

    await act(async () => container
      .querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button')?.click());

    expect(toolAPI.submitUserAnswers).toHaveBeenCalledWith(
      'question-tool-1',
      { 0: ['PostgreSQL', 'Custom database'] },
      'session-a',
    );
  });

  it('leaves a plain single-select question unanswered until the user picks', () => {
    act(() => root.render(
      <AskUserQuestionCard
        toolItem={questionTool('pending_confirmation')}
        config={config}
        sessionId="session-a"
        isLastItem
      />,
    ));

    // No pre-selection on a model-authored question: the default would become
    // the submitted answer, so the form must not be submittable before the user
    // chooses.
    expect(container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.checked)
      .toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[value="SQLite"]')?.checked)
      .toBe(false);
    const submitButton = container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button');
    expect(submitButton?.disabled).toBe(true);
  });

  it('pre-selects the first option of a single-select template question', async () => {
    act(() => root.render(
      <AskUserQuestionCard toolItem={qtMigrationTool()} config={config} sessionId="session-a" />,
    ));

    // The intake opts in to the candidate default, so it opens on the backend's
    // first candidate per field and the submit rule agrees with what is shown.
    // A plain question has no such default.
    expect(container.querySelector<HTMLInputElement>('input[value="D:/work/myqt"]')?.checked)
      .toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[value="D:/ohos/qt5-kit"]')?.checked)
      .toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[value="__official__"]')?.checked)
      .toBe(true);

    const submitButton = container.querySelector<HTMLButtonElement>('[data-bitfun-part="submit"] button');
    expect(submitButton?.disabled).toBe(false);
    await act(async () => submitButton?.click());

    expect(toolAPI.submitUserAnswers).toHaveBeenCalledWith(
      'question-tool-1',
      { source_project: 'D:/work/myqt', toolchain: 'D:/ohos/qt5-kit', template: '__official__' },
      'session-a',
    );
  });

  it('fails loudly when a Qt request arrives without its own question shape', () => {
    const tool = qtMigrationTool();
    tool.questionRequest = { templateId: 'qt-migration-paths', templateVersion: '1' };
    act(() => root.render(
      <AskUserQuestionCard toolItem={tool} config={config} sessionId="session-a" />,
    ));

    // Routing is by template id, so the Qt card stays selected even with an
    // incomplete payload instead of silently rendering the generic projection.
    expect(container.textContent).toContain('toolCards.askUser.parseError');
  });

  it('renders an unregistered template through the generic card', () => {
    // A template id the frontend does not know renders the shared contract,
    // not nothing.
    const tool = qtMigrationTool();
    tool.questionRequest = {
      templateId: 'future-template',
      templateVersion: '1',
      resolvedQuestions: [
        {
          field: 'target_dir',
          header: 'Destination',
          question: 'Where should the result go?',
          inputPlaceholder: '/path/to/dir',
          options: [],
        },
      ],
    };
    act(() => root.render(
      <AskUserQuestionCard toolItem={tool} config={config} sessionId="session-a" />,
    ));

    expect(container.textContent).toContain('Where should the result go?');
    expect(container.textContent).not.toContain('toolCards.askUser.parseError');
  });

  it('keeps a restored draft instead of overwriting it with the default', () => {
    // Only a card that opts in has a default, so the case that matters is the
    // Qt intake: its restored answer must survive, while fields the user has not
    // touched still open on their candidate.
    askUserQuestionDraftStore.getState().setSingleAnswer(
      askUserQuestionDraftKey('session-a', 'question-call-1'),
      1,
      'D:/ohos/qt6-kit',
    );

    act(() => root.render(
      <AskUserQuestionCard toolItem={qtMigrationTool()} config={config} sessionId="session-a" />,
    ));

    expect(container.querySelector<HTMLInputElement>('input[value="D:/ohos/qt6-kit"]')?.checked)
      .toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[value="D:/ohos/qt5-kit"]')?.checked)
      .toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[value="D:/work/myqt"]')?.checked)
      .toBe(true);
  });

  it('leaves a multi-select question unselected until the user opts in', () => {
    act(() => root.render(
      <AskUserQuestionCard
        toolItem={questionTool('pending_confirmation', true)}
        config={config}
        sessionId="session-a"
        isLastItem
      />,
    ));

    // Answers stay opt-in by default: only a card that opts in opens on a
    // candidate (the Qt intake), and multi-select is always opt-in.
    expect(container.querySelector<HTMLInputElement>('input[value="PostgreSQL"]')?.checked)
      .toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[value="SQLite"]')?.checked)
      .toBe(false);
  });

});
