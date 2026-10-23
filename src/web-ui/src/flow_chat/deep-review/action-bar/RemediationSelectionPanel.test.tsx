import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemediationSelectionPanel } from './RemediationSelectionPanel';
import type { ReviewRemediationItem } from '../../utils/codeReviewRemediation';

const messages: Record<string, string> = {
  'deepReviewActionBar.remediationStatus.fixed': 'Fixed',
  'deepReviewActionBar.remediationStatus.fixing': 'Fixing',
  'reviewActionBar.needsDecisionTag': 'Decision',
  'toolCards.codeReview.remediationActions.collapseOptions': 'Hide options',
  'toolCards.codeReview.remediationActions.expandOptions': 'Show options',
  'toolCards.codeReview.remediationActions.noSelectionHint': 'Select at least one remediation item to start fixing.',
  'toolCards.codeReview.remediationActions.recommended': 'recommended',
  'toolCards.codeReview.remediationActions.selectionCount': '{{selected}}/{{total}} selected',
  'toolCards.codeReview.remediationActions.ungrouped': 'Other',
};

function t(key: string, options?: Record<string, unknown> & { defaultValue?: string }): string {
  const template = messages[key] ?? options?.defaultValue ?? key;
  return template.replace(/{{(\w+)}}/g, (_match, token: string) => String(options?.[token] ?? _match));
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t,
  }),
}));

vi.mock('@bitfun/ui', async importOriginal => ({
  Icon: ({ name }: { name: string }) => <span data-bitfun-component="icon" data-bitfun-name={name} />,
  Button: ({
    children,
    disabled,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
  }) => <button type="button" disabled={disabled}>{children}</button>,
  Checkbox: (await importOriginal<typeof import('@bitfun/ui')>()).Checkbox,
  Tooltip: (await importOriginal<typeof import('@bitfun/ui')>()).Tooltip,
}));

vi.mock('@/infrastructure/event-bus', () => ({
  globalEventBus: {
    emit: vi.fn(),
  },
}));

const baseProps = {
  showRemediationList: true,
  onToggleRemediation: vi.fn(),
  onToggleAll: vi.fn(),
  onToggleGroup: vi.fn(),
  onToggleList: vi.fn(),
  onToggleDecisionExpansion: vi.fn(),
  onSetDecisionSelection: vi.fn(),
};

let JSDOMCtor: (new (
  html?: string,
  options?: { pretendToBeVisual?: boolean; url?: string }
) => { window: Window & typeof globalThis }) | null = null;

try {
  const jsdom = await import('jsdom');
  JSDOMCtor = jsdom.JSDOM as typeof JSDOMCtor;
} catch {
  JSDOMCtor = null;
}

const describeWithJsdom = JSDOMCtor ? describe : describe.skip;

describe('RemediationSelectionPanel', () => {
  it('renders grouped remediation counts and the empty-selection hint', () => {
    const remediationItems: ReviewRemediationItem[] = [
      {
        id: 'must-fix-1',
        index: 0,
        groupIndex: 0,
        plan: 'Fix critical issue',
        issueIndex: 0,
        groupId: 'must_fix',
        defaultSelected: true,
      },
    ];

    const html = renderToStaticMarkup(
      <RemediationSelectionPanel
        {...baseProps}
        remediationItems={remediationItems}
        selectedRemediationIds={new Set()}
        completedRemediationIds={new Set()}
        decisionSelections={{}}
        expandedDecisionIds={new Set()}
      />,
    );

    expect(html).toContain('0/1 selected');
    expect(html).toContain('must_fix');
    expect(html).toContain('0/1');
    expect(html).toContain('Select at least one remediation item to start fixing.');
  });

  it('renders completed and expanded decision remediation items', () => {
    const remediationItems: ReviewRemediationItem[] = [
      {
        id: 'decision-1',
        index: 0,
        groupIndex: 0,
        plan: 'Choose a migration strategy',
        issueIndex: 0,
        groupId: 'needs_decision',
        requiresDecision: true,
        decisionContext: {
          question: 'Which migration strategy should we use?',
          tradeoffs: 'Fast path is risky; staged path is safer.',
          options: ['Fast path', 'Staged path'],
          recommendation: 1,
        },
        defaultSelected: true,
      },
    ];

    const html = renderToStaticMarkup(
      <RemediationSelectionPanel
        {...baseProps}
        remediationItems={remediationItems}
        selectedRemediationIds={new Set(['decision-1'])}
        completedRemediationIds={new Set(['decision-1'])}
        decisionSelections={{ 'decision-1': 1 }}
        expandedDecisionIds={new Set(['decision-1'])}
      />,
    );

    expect(html).toContain('Decision');
    expect(html).toContain('Which migration strategy should we use?');
    expect(html).toContain('Fast path is risky; staged path is safer.');
    expect(html).toContain('Staged path (recommended)');
    expect(html).toContain('deep-review-action-bar__remediation-item--completed');
    expect(html).not.toContain('title=');
  });
});

describeWithJsdom('RemediationSelectionPanel interactions', () => {
  let dom: { window: Window & typeof globalThis };
  let container: HTMLDivElement;
  let root: Root;

  function mount(element: React.ReactElement): void {
    act(() => {
      root.render(element);
    });
  }

  function remediationItems(): ReviewRemediationItem[] {
    return [
      {
        id: 'remediation-should-improve-1',
        index: 0,
        groupIndex: 0,
        plan: 'Improve error copy',
        issueIndex: -1,
        groupId: 'should_improve',
        defaultSelected: false,
      },
      {
        id: 'remediation-should-improve-2',
        index: 1,
        groupIndex: 1,
        plan: 'Improve retry state',
        issueIndex: -1,
        groupId: 'should_improve',
        defaultSelected: false,
      },
    ];
  }

  beforeEach(() => {
    dom = new JSDOMCtor!('<!doctype html><html><body></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost',
    });

    const { window } = dom;
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('navigator', window.navigator);
    vi.stubGlobal('HTMLElement', window.HTMLElement);
    vi.stubGlobal('HTMLDivElement', window.HTMLDivElement);
    vi.stubGlobal('requestAnimationFrame', window.requestAnimationFrame.bind(window));
    vi.stubGlobal('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    dom.window.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([true, false])('keeps list visibility when selecting all (expanded=%s)', (expanded) => {
    const onToggleAll = vi.fn();
    const onToggleList = vi.fn();
    function Panel() {
      const [selected, setSelected] = React.useState(new Set<string>());
      const [visible, setVisible] = React.useState(expanded);
      return (
        <RemediationSelectionPanel
          {...baseProps}
          remediationItems={remediationItems()}
          selectedRemediationIds={selected}
          completedRemediationIds={new Set()}
          decisionSelections={{}}
          expandedDecisionIds={new Set()}
          showRemediationList={visible}
          onToggleAll={() => {
            onToggleAll();
            setSelected(selected.size ? new Set() : new Set(remediationItems().map((item) => item.id)));
          }}
          onToggleList={() => {
            onToggleList();
            setVisible(!visible);
          }}
        />
      );
    }
    mount(<Panel />);
    const header = container.querySelector<HTMLElement>('.deep-review-action-bar__remediation-toggle')!;
    const checkbox = header.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const box = header.querySelector<HTMLElement>('[data-bitfun-part="box"]')!;

    for (const target of [checkbox, box]) {
      act(() => { target.click(); });
      expect(checkbox.checked).toBe(target === checkbox);
      expect(Boolean(container.querySelector('.deep-review-action-bar__remediation-list'))).toBe(expanded);
      expect(onToggleList).not.toHaveBeenCalled();
    }
    expect(onToggleAll).toHaveBeenCalledTimes(2);

    act(() => { header.querySelector<HTMLElement>('.deep-review-action-bar__remediation-label')!.click(); });
    expect(onToggleList).toHaveBeenCalledTimes(1);
    expect(Boolean(container.querySelector('.deep-review-action-bar__remediation-list'))).toBe(!expanded);
    expect(onToggleAll).toHaveBeenCalledTimes(2);
  });

  it('toggles a remediation group once when clicking the root checkbox', () => {
    const onToggleGroup = vi.fn();

    mount(
      <RemediationSelectionPanel
        {...baseProps}
        remediationItems={remediationItems()}
        selectedRemediationIds={new Set()}
        completedRemediationIds={new Set()}
        decisionSelections={{}}
        expandedDecisionIds={new Set()}
        onToggleGroup={onToggleGroup}
      />,
    );

    const groupCheckbox = container.querySelector<HTMLInputElement>(
      '.deep-review-action-bar__remediation-group-header input[type="checkbox"]',
    );
    expect(groupCheckbox).toBeTruthy();

    act(() => {
      groupCheckbox!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onToggleGroup).toHaveBeenCalledTimes(1);
    expect(onToggleGroup).toHaveBeenCalledWith('should_improve');
  });

  it('shows decision options immediately when selected and keeps unselected previews outside clipped summaries', () => {
    const style = document.createElement('style');
    style.textContent = compile(fileURLToPath(new URL('../../components/btw/DeepReviewActionBar.scss', import.meta.url))).css;
    document.head.appendChild(style);
    const onToggleRemediation = vi.fn();
    const onSelect = vi.fn();
    const item: ReviewRemediationItem = {
      id: 'decision-1', index: 0, groupIndex: 0, issueIndex: -1,
      groupId: 'needs_decision', requiresDecision: true, defaultSelected: false,
      plan: 'Wait for the user to choose before changing either document.',
      decisionContext: {
        question: 'Should both documents remove the placeholder text or both include the same placeholder text?',
        plan: 'Wait for the user to choose before changing either document.',
        tradeoffs: 'Removing placeholders keeps the documents ready to publish. Keeping them preserves draft context but requires cleanup before publication.',
        options: ['Remove the placeholder text from both documents.', 'Keep the placeholder text in both documents.'],
      },
    };
    function Panel() {
      const [expanded, setExpanded] = React.useState(false);
      const [selected, setSelected] = React.useState(false);
      const [selection, setSelection] = React.useState<Record<string, number>>({});
      return (
        <RemediationSelectionPanel
          {...baseProps}
          remediationItems={[item, ...remediationItems()]}
          selectedRemediationIds={new Set(selected ? [item.id] : [])}
          completedRemediationIds={new Set()}
          decisionSelections={selection}
          expandedDecisionIds={new Set(expanded ? [item.id] : [])}
          onToggleRemediation={() => {
            onToggleRemediation();
            setSelected(!selected);
          }}
          onToggleDecisionExpansion={() => setExpanded(!expanded)}
          onSetDecisionSelection={(id, index) => {
            onSelect(id, index);
            setSelection({ [id]: index });
          }}
        />
      );
    }
    mount(<Panel />);
    const toggle = container.querySelector<HTMLButtonElement>('.deep-review-action-bar__decision-toggle')!;
    const row = toggle.closest('.deep-review-action-bar__remediation-item')!;
    const summary = row.querySelector('.deep-review-action-bar__remediation-text')!;
    const assertNotClipped = (control: Element) => {
      for (let ancestor = control.parentElement; ancestor && ancestor !== row; ancestor = ancestor.parentElement) {
        const css = window.getComputedStyle(ancestor);
        expect(css.overflow).not.toBe('hidden');
        expect(css.getPropertyValue('-webkit-line-clamp')).not.toBe('2');
      }
    };
    expect(window.getComputedStyle(summary).getPropertyValue('-webkit-line-clamp')).toBe('2');
    assertNotClipped(toggle);
    const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => checkbox.click());
    expect(checkbox.checked).toBe(true);
    expect(row.querySelector('.deep-review-action-bar__decision-toggle')).toBeNull();
    expect(window.getComputedStyle(summary).getPropertyValue('-webkit-line-clamp')).toBe('unset');
    expect(window.getComputedStyle(summary).overflow).toBe('visible');
    expect(row.textContent).toContain(item.decisionContext!.tradeoffs);
    const list = container.querySelector('.deep-review-action-bar__remediation-list')!;
    expect(window.getComputedStyle(list).maxHeight).toBe('none');
    expect(window.getComputedStyle(list).overflow).toBe('visible');
    expect(summary.getAttribute('for')).toBe(checkbox.id);
    const options = row.querySelectorAll<HTMLButtonElement>('.deep-review-action-bar__decision-option button');
    expect(options).toHaveLength(2);
    options.forEach((option) => {
      assertNotClipped(option);
      expect(option.closest('label')).toBeNull();
      expect(option.getAttribute('aria-pressed')).toBe('false');
    });
    expect(row.querySelector('.deep-review-action-bar__decision-option.is-selected')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    act(() => options[1].click());
    expect(onSelect).toHaveBeenCalledWith(item.id, 1);
    expect(options[1].getAttribute('aria-pressed')).toBe('true');
    expect(onToggleRemediation).toHaveBeenCalledTimes(1);
    act(() => checkbox.click());
    expect(row.querySelector('.deep-review-action-bar__decision-options')).toBeNull();
    expect(window.getComputedStyle(list).maxHeight).not.toBe('none');
    expect(window.getComputedStyle(summary).getPropertyValue('-webkit-line-clamp')).toBe('2');
    const preview = row.querySelector<HTMLButtonElement>('.deep-review-action-bar__decision-toggle')!;
    act(() => preview.click());
    expect(preview.getAttribute('aria-expanded')).toBe('true');
    expect(row.querySelectorAll('.deep-review-action-bar__decision-option')).toHaveLength(2);
    expect(checkbox.checked).toBe(false);
    act(() => preview.click());
    expect(preview.getAttribute('aria-expanded')).toBe('false');
    expect(row.querySelector('.deep-review-action-bar__decision-options')).toBeNull();
  });

  it.each([
    ['ordinary', false], ['ordinary', true],
    ['completed', false], ['completed', true],
    ['fixing', false], ['fixing', true],
    ['empty-plan', true],
  ] as const)(
    'preserves the original hint eligibility for %s (decisionContext=%s)',
    (state, hasDecisionContext) => {
      vi.useFakeTimers();
      const item = remediationItems()[0];
      if (hasDecisionContext) {
        item.decisionContext = { question: 'Which approach?', options: ['A', 'B'] };
      }
      if (state === 'empty-plan') item.plan = '';
      const originalHint = item.decisionContext
        ? `${item.decisionContext.question}\n${item.plan}`
        : item.plan;
      mount(
        <RemediationSelectionPanel
          {...baseProps}
          remediationItems={[item]}
          selectedRemediationIds={new Set()}
          completedRemediationIds={new Set(state === 'completed' ? [item.id] : [])}
          fixingRemediationIds={new Set(state === 'fixing' ? [item.id] : [])}
          selectionDisabled={state === 'fixing'}
          decisionSelections={{}}
          expandedDecisionIds={new Set()}
        />,
      );
      const trigger = container.querySelector<HTMLElement>('.deep-review-action-bar__remediation-text')!;
      expect(trigger.hasAttribute('title')).toBe(false);
      act(() => {
        trigger.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
        vi.advanceTimersByTime(500);
      });
      act(() => { vi.advanceTimersByTime(32); });
      const tooltip = document.querySelector('[role="tooltip"]');
      if (!originalHint) {
        expect(tooltip).toBeNull();
        return;
      }
      expect(tooltip?.textContent).toBe(originalHint);
      expect(tooltip?.getAttribute('data-bitfun-state')).toBe('visible');
      expect(tooltip?.closest('[data-bitfun-overlay-host="true"]')).not.toBeNull();
      act(() => {
        trigger.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true }));
      });
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    },
  );

  it.each(['fixing', 'completed'])('keeps the tree visible but disables item and option selection when %s', (phase) => {
    const onToggleRemediation = vi.fn();
    const onToggleGroup = vi.fn();
    const onSelect = vi.fn();
    const decision: ReviewRemediationItem = {
      id: 'decision', index: 2, groupIndex: 0, issueIndex: -1,
      plan: 'Choose a migration', groupId: 'needs_decision', requiresDecision: true,
      decisionContext: { question: 'Which migration?', plan: 'Choose a migration', options: ['Fast', 'Staged'] },
      defaultSelected: false,
    };

    mount(
      <RemediationSelectionPanel
        {...baseProps}
        remediationItems={[...remediationItems(), decision]}
        selectedRemediationIds={new Set(['remediation-should-improve-1', decision.id])}
        completedRemediationIds={new Set(phase === 'completed' ? [decision.id] : [])}
        fixingRemediationIds={new Set(phase === 'fixing' ? ['remediation-should-improve-1'] : [])}
        decisionSelections={{ [decision.id]: 1 }}
        expandedDecisionIds={new Set([decision.id])}
        selectionDisabled
        onSetDecisionSelection={onSelect}
        onToggleRemediation={onToggleRemediation}
        onToggleGroup={onToggleGroup}
      />,
    );

    expect(container.textContent).toContain('Improve error copy');
    expect(container.textContent).toContain(phase === 'fixing' ? 'Fixing' : 'Fixed');
    const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(checkboxes.length).toBeGreaterThan(0);
    expect(checkboxes.every((checkbox) => checkbox.disabled)).toBe(true);

    act(() => {
      checkboxes[checkboxes.length - 1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onToggleRemediation).not.toHaveBeenCalled();
    expect(onToggleGroup).not.toHaveBeenCalled();
    const options = container.querySelectorAll<HTMLButtonElement>('.deep-review-action-bar__decision-option button');
    expect(options).toHaveLength(2);
    expect([...options].every((option) => option.disabled)).toBe(true);
    act(() => options[0].click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(options[1].getAttribute('aria-pressed')).toBe('true');
  });
});
