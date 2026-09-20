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
        'toolCards.askUser.submitOutputArtifact':
          '{{field}}指向历史迁移产物，禁止覆盖：{{path}}。请为本次迁移改用其他输出目录。',
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

  it('renders the migration-artifact output rejection and keeps the question editable', async () => {
    vi.mocked(toolAPI.submitUserAnswers).mockRejectedValueOnce(
      new Error('qt_migration_output_is_artifact: field=output_project; path=D:/out/calculator-ohos'),
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
    expect(errorText).toContain('禁止覆盖');
    expect(errorText).toContain('D:/out/calculator-ohos');
    expect(errorText).not.toContain('qt_migration_output_is_artifact');
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

  it('rehydrates a typed custom answer into the input when re-viewing a completed template card', () => {
    const item = questionTool('completed');
    item.toolCall.input = { templateId: 'qt-migration-paths', questions: [] };
    item.questionRequest = {
      params: { templateId: 'qt-migration-paths', questions: [] },
      resolvedQuestions: [{
        field: 'toolchain',
        header: '迁移工具链',
        question: '使用哪个迁移工具链？',
        options: [
          { label: '默认路径', description: 'D:/sdk/default' },
          { label: '备选路径', description: 'D:/sdk/alt' },
        ],
        multiSelect: false,
        inputPlaceholder: '请填写迁移工具链路径',
        required: true,
      }],
      templateId: 'qt-migration-paths',
      templateVersion: '1',
    };
    item.toolResult = {
      success: true,
      result: {
        questions: [{ question: '使用哪个迁移工具链？', header: '迁移工具链' }],
        answers: { toolchain: 'D:/custom/typed-path' },
        status: 'answered',
      },
    } as FlowToolItem['toolResult'];

    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={item}
          config={config}
          isLastItem={false}
        />,
      );
    });

    // 折叠摘要直接回显提交的自定义路径
    const summary = container.querySelector('.summary-answer');
    expect(summary?.textContent).toContain('D:/custom/typed-path');

    // 展开后：键入值回填输入框，选项保持未选（不得预选第一个推荐项）
    act(() => {
      container.querySelector<HTMLElement>('.completed-summary')?.click();
    });
    const input = container.querySelector<HTMLInputElement>('input.custom-input-inline');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('D:/custom/typed-path');
    expect(container.querySelector('input[type="radio"]:checked')).toBeNull();
  });

  it('rehydrates a selected option answer when re-viewing a completed template card', () => {
    const item = questionTool('completed');
    item.toolCall.input = { templateId: 'qt-migration-paths', questions: [] };
    item.questionRequest = {
      params: { templateId: 'qt-migration-paths', questions: [] },
      resolvedQuestions: [{
        field: 'toolchain',
        header: '迁移工具链',
        question: '使用哪个迁移工具链？',
        options: [
          { label: '默认路径', description: 'D:/sdk/default' },
          { label: '备选路径', description: 'D:/sdk/alt' },
        ],
        multiSelect: false,
        inputPlaceholder: '请填写迁移工具链路径',
        required: true,
      }],
      templateId: 'qt-migration-paths',
      templateVersion: '1',
    };
    item.toolResult = {
      success: true,
      result: {
        questions: [{ question: '使用哪个迁移工具链？', header: '迁移工具链' }],
        answers: { toolchain: 'D:/sdk/alt' },
        status: 'answered',
      },
    } as FlowToolItem['toolResult'];

    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={item}
          config={config}
          isLastItem={false}
        />,
      );
    });

    const summary = container.querySelector('.summary-answer');
    expect(summary?.textContent).toContain('D:/sdk/alt');

    act(() => {
      container.querySelector<HTMLElement>('.completed-summary')?.click();
    });
    const checked = container.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    expect(checked?.value).toBe('D:/sdk/alt');
    const input = container.querySelector<HTMLInputElement>('input.custom-input-inline');
    expect(input?.value).toBe('');
  });

  it('rehydrates a non-first option on a plain completed card (summary and expanded view)', () => {
    // 普通问题卡片：用户提交的是第二个选项，回看时摘要与展开视图都必须
    // 显示第二个选项，而不是被预选 effect 覆盖成第一个选项。
    const item = questionTool('completed');
    item.toolCall.input.questions = [{
      header: 'Database',
      question: 'Which database?',
      multiSelect: false,
      options: [
        { label: 'PostgreSQL' },
        { label: 'MySQL' },
      ],
    }];
    item.toolResult = {
      success: true,
      result: {
        questions: [{ question: 'Which database?', header: 'Database' }],
        answers: { 0: 'MySQL' },
        status: 'answered',
      },
    } as FlowToolItem['toolResult'];

    act(() => {
      root.render(
        <AskUserQuestionCard
          toolItem={item}
          config={config}
          isLastItem={false}
        />,
      );
    });

    const summary = container.querySelector('.summary-answer');
    expect(summary?.textContent).toContain('MySQL');

    act(() => {
      container.querySelector<HTMLElement>('.completed-summary')?.click();
    });
    const checked = container.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    expect(checked?.value).toBe('MySQL');
  });

  it('scopes radio names per card instance so a pending option selects on first click', async () => {
    // 两个问题卡片同时挂载（已完成卡片展开回看 + 新待答卡片）时，radio 的
    // name 若只按题目序号命名，会在整个文档范围内构成同一互斥组：完成卡片
    // 的 radio 抢占 checked，待答卡片第一次点击会被 react-dom 的受控恢复
    // 逻辑弹回（表现为"要点两次才选中"）。name 必须带卡片实例前缀。
    const completedItem = questionTool('completed');
    completedItem.toolCall.input.questions = [{
      header: 'Database',
      question: 'Which database?',
      multiSelect: false,
      options: [{ label: 'PostgreSQL' }, { label: 'MySQL' }],
    }];
    completedItem.toolResult = {
      success: true,
      result: {
        questions: [{ question: 'Which database?', header: 'Database' }],
        answers: { 0: 'PostgreSQL' },
        status: 'answered',
      },
    } as FlowToolItem['toolResult'];

    const pendingItem = questionTool('pending_confirmation');
    pendingItem.id = 'question-tool-2';
    pendingItem.toolCall = {
      ...pendingItem.toolCall,
      id: 'question-call-2',
      input: {
        questions: [{
          header: 'Database',
          question: 'Which database?',
          multiSelect: false,
          options: [{ label: 'PostgreSQL' }, { label: 'MySQL' }],
        }],
      },
    };

    await act(async () => {
      root.render(
        <>
          <AskUserQuestionCard toolItem={completedItem} config={config} isLastItem={false} />
          <AskUserQuestionCard toolItem={pendingItem} config={config} isLastItem />
        </>,
      );
    });

    // Radio names are instance-scoped: no name is shared across the two cards.
    // (The completed card starts collapsed; its radios mount on expand. Each
    // card's question also renders an "Other" radio, hence 3 per card.)
    await act(async () => {
      container.querySelector<HTMLElement>('.completed-summary')?.click();
    });
    const names = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .map(input => input.name);
    // 同题选项共享 name 是 radio 组的正确设计；唯一性要求是卡片实例之间
    // 不共享（name 带卡片 toolId 前缀），跨实例互斥因此消失。
    expect(names.length).toBe(6);
    expect(names.every(name => name.startsWith('question-tool-1:') || name.startsWith('question-tool-2:'))).toBe(true);
    const tool1Names = names.filter(name => name.startsWith('question-tool-1:'));
    const tool2Names = names.filter(name => name.startsWith('question-tool-2:'));
    expect(tool1Names.length).toBe(3);
    expect(tool2Names.length).toBe(3);

    // First click on the pending card's second option must select it.
    const pendingOptionB = document.querySelector<HTMLInputElement>(
      'input[name="question-tool-2:question-0"][value="MySQL"]',
    );
    expect(pendingOptionB).not.toBeNull();
    await act(async () => {
      pendingOptionB?.click();
    });
    expect(pendingOptionB?.checked).toBe(true);

    // The completed card's own selection is untouched (no cross-instance steal).
    const completedChecked = document.querySelector<HTMLInputElement>(
      'input[name="question-tool-1:question-0"]:checked',
    );
    expect(completedChecked?.value).toBe('PostgreSQL');
  });
});
