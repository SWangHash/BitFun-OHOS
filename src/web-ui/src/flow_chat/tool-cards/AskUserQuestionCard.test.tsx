// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowToolItem, ToolCardConfig } from '../types/flow-chat';
import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const templates: Record<string, string> = {
        'toolCards.askUser.submitPathNotFound': '{{field}}路径不存在：{{path}}',
      };
      const template = templates[key] ?? key;
      if (!options) return template;
      return Object.entries(options).reduce(
        (acc, [name, value]) =>
          acc.replace(new RegExp(`{{\\s*${name}\\s*}}`, 'g'), String(value)),
        template,
      );
    },
  }),
}));

vi.mock('@/component-library', () => ({
  Button: ({
    children,
    isLoading: _isLoading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { isLoading?: boolean }) => (
    <button type="button" {...props}>{children}</button>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/infrastructure/api/service-api/ToolAPI', () => ({
  toolAPI: {
    submitUserAnswers: vi.fn(),
  },
}));

import { AskUserQuestionCard } from './AskUserQuestionCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const config: ToolCardConfig = {
  toolName: 'AskUserQuestion',
  displayName: 'Ask User',
  icon: 'Q',
  requiresConfirmation: false,
  resultDisplayType: 'detailed',
};

function questionTool(status: FlowToolItem['status']): FlowToolItem {
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
          multiSelect: false,
          options: [{
            label: 'PostgreSQL',
            description: 'Use PostgreSQL',
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

describe('AskUserQuestionCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(toolAPI.submitUserAnswers).mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('updates from unresolved raw params to the backend questionRequest payload', () => {
    const unresolved = questionTool('pending_confirmation');
    unresolved.toolCall.input = { templateId: 'qt-migration-paths', questions: [] };

    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={unresolved}
          config={config}
          isLastItem
        />,
      );
    });

    expect(container.querySelector('.error-message')).not.toBeNull();
    expect(container.querySelectorAll('.ask-question-item')).toHaveLength(0);

    const resolved = {
      ...unresolved,
      questionRequest: {
        params: { templateId: 'qt-migration-paths', questions: [] },
        resolvedQuestions: [{
          field: 'source_project',
          header: 'Source project',
          question: 'Which source project?',
          options: [{ label: 'Browse', description: 'Choose a project' }],
          multiSelect: false,
          inputPlaceholder: 'Enter the source project path',
          required: true,
        }],
        templateId: 'qt-migration-paths',
        templateVersion: '1',
      },
    };

    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={resolved}
          config={config}
          isLastItem
        />,
      );
    });

    expect(container.querySelector('.error-message')).toBeNull();
    expect(container.querySelectorAll('.ask-question-item')).toHaveLength(1);
  });

  it('renders backend-resolved template questions when raw tool input has no questions', () => {
    const item = questionTool('pending_confirmation');
    item.toolCall.input = { templateId: 'qt-migration-paths', questions: [] };
    item.questionRequest = {
      params: { templateId: 'qt-migration-paths', questions: [] },
      resolvedQuestions: [{
        field: 'source_project',
        header: '原始工程',
        question: '你希望从哪个原始工程开始迁移？',
        options: [{ label: '路径', description: '工程路径' }],
        multiSelect: false,
        inputPlaceholder: '请填写原始工程路径',
        required: true,
      }],
      presentation: {
        layout: 'wizard',
        allowSkip: false,
        introKey: 'askUser.qtMigration.pathsIntro',
      },
      templateId: 'qt-migration-paths',
      templateVersion: '1',
    };

    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={item}
          config={config}
          isLastItem
        />,
      );
    });

    const intro = container.querySelector('.ask-user-question-intro');
    const card = container.querySelector('.ask-user-question-card');
    expect(intro?.textContent).toBe('toolCards.askUser.qtMigration.pathsIntro');
    expect(intro?.nextElementSibling).toBe(card);
    expect(container.querySelector('.error-message')).toBeNull();
    expect(container.querySelectorAll('.ask-question-item')).toHaveLength(1);
    expect(container.querySelector('input.custom-input-inline')).not.toBeNull();
  });

  it('submits a selected template option when the custom path input is blank', async () => {
    const item = questionTool('pending_confirmation');
    item.toolCall.input = { templateId: 'qt-migration-paths', questions: [] };
    item.questionRequest = {
      params: { templateId: 'qt-migration-paths', questions: [] },
      resolvedQuestions: [{
        field: 'source_project',
        header: '原始工程',
        question: '你希望从哪个原始工程开始迁移？',
        options: [
          { label: '默认路径', description: '使用默认路径' },
          { label: '备选路径', description: '使用备选路径' },
        ],
        multiSelect: false,
        inputPlaceholder: '请填写原始工程路径',
        required: true,
      }],
      presentation: {
        layout: 'wizard',
        allowSkip: false,
        introKey: 'askUser.qtMigration.pathsIntro',
      },
      templateId: 'qt-migration-paths',
      templateVersion: '1',
    };

    await act(async () => {
      root.render(
        <AskUserQuestionCard
          toolItem={item}
          config={config}
          isLastItem
        />,
      );
    });

    const option = container.querySelector<HTMLInputElement>('input[value="使用默认路径"]');
    const alternateOption = container.querySelector<HTMLInputElement>('input[value="使用备选路径"]');
    const customInput = container.querySelector<HTMLInputElement>('input.custom-input-inline');
    const submit = container.querySelector<HTMLButtonElement>('.submit-button');
    expect(option).not.toBeNull();
    expect(alternateOption).not.toBeNull();
    expect(customInput).not.toBeNull();
    expect(submit).not.toBeNull();
    expect(option?.checked).toBe(true);
    expect(alternateOption?.checked).toBe(false);
    expect(submit?.disabled).toBe(false);

    await act(async () => {
      customInput?.focus();
      if (customInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(customInput, 'D:/projects/source');
        customInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    expect(option?.checked).toBe(false);
    expect(alternateOption?.checked).toBe(false);
    expect(submit?.disabled).toBe(false);

    await act(async () => {
      submit?.click();
    });
    expect(toolAPI.submitUserAnswers).toHaveBeenCalledWith('question-tool-1', {
      source_project: 'D:/projects/source',
    });
  });

  it('shows the backend validation error and keeps the question editable', async () => {
    vi.mocked(toolAPI.submitUserAnswers).mockRejectedValueOnce(
      new Error('qt_migration_path_not_found: field=source_project; path=D:/missing'),
    );
    const item = questionTool('pending_confirmation');

    await act(async () => {
      root.render(
        <AskUserQuestionCard
          toolItem={item}
          config={config}
          isLastItem
        />,
      );
    });

    const submit = container.querySelector<HTMLButtonElement>('.submit-button');
    await act(async () => {
      submit?.click();
    });

    // The rejection must render through i18n (localized template + field
    // label), not echo the raw backend message.
    const errorText = container.querySelector('.submission-error-message')?.textContent ?? '';
    expect(errorText).toContain('路径不存在');
    expect(errorText).toContain('D:/missing');
    expect(errorText).not.toContain('qt_migration_path_not_found');
    expect(container.querySelector<HTMLInputElement>('input[type="radio"]')?.disabled).toBe(false);
    expect(submit?.disabled).toBe(false);
  });

  it('falls back to the raw backend message for unrecognized rejections', async () => {
    vi.mocked(toolAPI.submitUserAnswers).mockRejectedValueOnce(
      new Error('Unrelated backend failure'),
    );
    const item = questionTool('pending_confirmation');

    await act(async () => {
      root.render(
        <AskUserQuestionCard
          toolItem={item}
          config={config}
          isLastItem
        />,
      );
    });

    const submit = container.querySelector<HTMLButtonElement>('.submit-button');
    await act(async () => {
      submit?.click();
    });

    expect(container.querySelector('.submission-error-message')?.textContent).toContain(
      'Unrelated backend failure',
    );
    expect(submit?.disabled).toBe(false);
  });

  it('keeps a just-completed tail question visible until newer content arrives', () => {
    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('pending_confirmation')}
          config={config}
          isLastItem
        />,
      );
    });
    expect(container.querySelector('.questions-container')).not.toBeNull();
    expect(container.querySelector('.completed-summary')).toBeNull();

    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('completed')}
          config={config}
          isLastItem
        />,
      );
    });
    expect(container.querySelector('.questions-container')).not.toBeNull();
    expect(container.querySelector('.completed-summary')).toBeNull();

    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={questionTool('completed')}
          config={config}
          isLastItem={false}
        />,
      );
    });
    expect(container.querySelector('.completed-summary')).not.toBeNull();
  });
});
