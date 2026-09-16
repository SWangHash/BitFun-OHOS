// @vitest-environment jsdom

import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disclosure } from '@openbitfun/ui';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Disclosure presentation contracts', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps native toggle events, refs and content lifetime under browser control', async () => {
    const ref = createRef<HTMLDetailsElement>();
    const onToggle = vi.fn();
    act(() => root.render(
      <Disclosure presentation="native" ref={ref} onToggle={onToggle} summary="Details">
        <input aria-label="Draft" defaultValue="Initial draft" />
      </Disclosure>,
    ));
    const details = container.querySelector('details')!;
    const summary = details.querySelector('summary')!;
    const input = details.querySelector('input')!;
    expect(ref.current).toBe(details);
    expect(details.open).toBe(false);
    expect(summary.parentElement).toBe(details);
    expect(input.parentElement).toBe(details);
    expect(details.querySelector('button')).toBeNull();

    await act(async () => {
      summary.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(details.open).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
    input.value = 'Draft to retain';
    await act(async () => {
      summary.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(details.open).toBe(false);
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(details.querySelector('input')).toBe(input);

    await act(async () => {
      details.open = true;
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(onToggle).toHaveBeenCalledTimes(3);
    expect(input.value).toBe('Draft to retain');
    expect(details.querySelector('[inert]')).toBeNull();
  });

  it('retains the default controlled trigger and collapsed focus exclusion', () => {
    const onOpenChange = vi.fn();
    const render = (open: boolean) => act(() => root.render(
      <Disclosure open={open} onOpenChange={onOpenChange} summary="Advanced">
        <input aria-label="Draft" defaultValue="Saved" />
      </Disclosure>,
    ));
    render(false);
    const trigger = container.querySelector('button')!;
    const region = container.querySelector('[role="region"]')!;
    const input = container.querySelector('input')!;
    expect(trigger.getAttribute('aria-controls')).toBe(region.id);
    expect(region.hasAttribute('inert')).toBe(true);
    act(() => trigger.click());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(region.hasAttribute('inert')).toBe(true);
    render(true);
    expect(region.hasAttribute('inert')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('input')).toBe(input);
  });
  it('cancels delayed unmount when a composed header reopens the same draft', () => {
    vi.useFakeTimers();
    try {
      const action = vi.fn();
      act(() => root.render(
        <Disclosure summary="Settings" unmountOnClose exitDurationMs={180}
          renderHeader={trigger => <div><button {...trigger}>Details</button><button onClick={action}>Action</button></div>}>
          <input defaultValue="Initial" />
        </Disclosure>,
      ));
      const [toggle, other] = container.querySelectorAll('button');
      act(() => other.click());
      expect(action).toHaveBeenCalledTimes(1);
      expect(container.querySelector('input')).toBeNull();
      act(() => toggle.click());
      const input = container.querySelector('input')!;
      input.value = 'Draft';
      act(() => toggle.click());
      expect(input.closest('[inert]')).not.toBeNull();
      act(() => vi.advanceTimersByTime(179));
      act(() => toggle.click());
      act(() => vi.advanceTimersByTime(180));
      expect(container.querySelector('input')).toBe(input);
      expect(input.value).toBe('Draft');
      expect(input.closest('[inert]')).toBeNull();
      expect(toggle.getAttribute('aria-controls')).toBe(input.closest('[role="region"]')!.id);
      act(() => toggle.click());
      act(() => vi.advanceTimersByTime(180));
      expect(container.querySelector('input')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

});
