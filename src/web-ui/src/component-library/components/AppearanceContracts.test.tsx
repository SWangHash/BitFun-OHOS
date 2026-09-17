// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button/Button';
import { Card, CardBody, CardFooter, CardHeader } from './Card/Card';
import { Input } from './Input/Input';
import { Modal } from './Modal/Modal';

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe('component appearance contracts', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.getElementById('bitfun-appearance-overlay-host')?.remove();
    container.remove();
  });

  it('exposes stable part, facet, and state attributes for base components', () => {
    const button = renderToStaticMarkup(<Button variant="danger" size="small" isLoading>Run</Button>);
    expect(button).toContain('data-bitfun-component="button"');
    expect(button).toContain('data-bitfun-part="root"');
    expect(button).toContain('data-bitfun-variant="danger"');
    expect(button).toContain('data-bitfun-state="loading"');
    expect(button).toContain('data-bitfun-part="loadingIcon"');

    const card = renderToStaticMarkup(
      <Card variant="accent" padding="large" interactive>
        <CardHeader title="Title" subtitle="Subtitle" />
        <CardBody>Body</CardBody>
        <CardFooter align="between">Footer</CardFooter>
      </Card>,
    );
    expect(card).toContain('data-bitfun-component="card"');
    expect(card).toContain('data-bitfun-part="title"');
    expect(card).toContain('data-bitfun-align="between"');
    expect(card).toContain('data-bitfun-state="interactive"');

    const input = renderToStaticMarkup(<Input variant="filled" size="large" error errorMessage="Invalid" />);
    expect(input).toContain('data-bitfun-component="input"');
    expect(input).toContain('data-bitfun-part="container"');
    expect(input).toContain('data-bitfun-size="large"');
    expect(input).toContain('data-bitfun-state="error"');
  });

  it('renders Modal through the shared overlay host with stable parts', async () => {
    await act(async () => {
      root.render(
        <Modal isOpen onClose={vi.fn()} title="Contract" size="large" contentInset resizable>
          Content
        </Modal>,
      );
    });
    const host = document.getElementById('bitfun-appearance-overlay-host');
    expect(host).not.toBeNull();
    expect(host?.querySelector('[data-bitfun-component="modal"][data-bitfun-part="overlay"]')).not.toBeNull();
    expect(host?.querySelector('[data-bitfun-part="dialog"][data-bitfun-size="large"]')).not.toBeNull();
    expect(host?.querySelector('[data-bitfun-part="content"][data-bitfun-state="contentInset"]')).not.toBeNull();
    expect(host?.querySelectorAll('[data-bitfun-part="resizeHandle"]')).toHaveLength(8);
  });
});
