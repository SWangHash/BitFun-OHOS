// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogRenderer } from './ConfirmDialogRenderer';
import { confirmDialogChoice, useConfirmDialogStore } from './confirmDialogService';

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('shared confirmation action roles', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useConfirmDialogStore.setState({ isOpen: false, options: null, resolve: null });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<ConfirmDialogRenderer />));
  });

  afterEach(() => {
    act(() => root.unmount());
    useConfirmDialogStore.getState().cancel();
    host.remove();
  });

  it.each((['inline', 'start'] as const).flatMap(secondaryActionPlacement =>
    (['cancel', 'secondary', 'confirm'] as const).map(choice => ({ secondaryActionPlacement, choice })),
  ))('keeps $choice distinct with $secondaryActionPlacement secondary placement', async ({ secondaryActionPlacement, choice }) => {
    let result!: ReturnType<typeof confirmDialogChoice>;
    act(() => {
      result = confirmDialogChoice({ title: 'Run command?', cancelText: 'Cancel', secondaryText: 'Always allow', confirmText: 'Allow once', secondaryActionPlacement });
    });
    const buttons = document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] footer button');
    const atStart = secondaryActionPlacement === 'start';
    const order = atStart ? ['secondary', 'cancel', 'confirm'] : ['cancel', 'secondary', 'confirm'];
    expect([...buttons].map(button => button.textContent)).toEqual(atStart ? ['Always allow', 'Cancel', 'Allow once'] : ['Cancel', 'Always allow', 'Allow once']);
    expect([...buttons].map(button => button.getAttribute('data-bitfun-variant'))).toEqual(atStart ? ['text', 'fill', 'primary'] : ['fill', 'outline', 'primary']);
    act(() => buttons[order.indexOf(choice)].click());
    await expect(result).resolves.toBe(choice);
  });

  it('retains the danger tone when the primary confirmation is destructive', async () => {
    let result!: ReturnType<typeof confirmDialogChoice>;
    act(() => {
      result = confirmDialogChoice({ title: 'Delete?', confirmDanger: true, confirmText: 'Delete' });
    });
    const button = document.querySelector<HTMLButtonElement>('[role="alertdialog"] footer button[data-bitfun-variant="primary"]')!;
    expect(button.getAttribute('data-bitfun-tone')).toBe('danger');
    act(() => button.click());
    await expect(result).resolves.toBe('confirm');
  });

  it('resolves a mask dismissal without pretending the cancel action ran', async () => {
    let result!: ReturnType<typeof confirmDialogChoice>;
    act(() => {
      result = confirmDialogChoice({
        title: 'Close BitFun?',
        cancelText: 'Minimize to tray',
        confirmText: 'Quit',
      });
    });
    const overlay = document.querySelector<HTMLElement>('[data-bitfun-part="overlay"]');
    expect(overlay).not.toBeNull();
    act(() => {
      overlay!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    await expect(result).resolves.toBe('dismissed');
  });

  it('still reports an explicit cancel button press as cancel', async () => {
    let result!: ReturnType<typeof confirmDialogChoice>;
    act(() => {
      result = confirmDialogChoice({ title: 'Close BitFun?', cancelText: 'Minimize to tray' });
    });
    const buttons = document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] footer button');
    act(() => buttons[0].click());
    await expect(result).resolves.toBe('cancel');
  });
});
