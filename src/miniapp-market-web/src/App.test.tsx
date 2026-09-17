// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';

const mocks = vi.hoisted(() => ({ config: vi.fn(), me: vi.fn() }));
vi.mock('./api', async (original) => ({
  ...await original<typeof import('./api')>(),
  marketApi: mocks,
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  window.history.replaceState({}, '', '/miniapp/submit?listingId=listing-1&slug=my-app&release=2');
  mocks.config.mockResolvedValue({ webSubmissionsEnabled: true, githubAuthConfigured: true });
  mocks.me.mockResolvedValue({ user: { login: 'publisher', avatarUrl: '' }, isAdmin: false });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('preserves native submission fields and update constraints on the actual submit route', async () => {
  await act(async () => root.render(<App />));
  const form = container.querySelector('form');
  expect(form).not.toBeNull();
  const data = new FormData(form!);
  expect(data.get('slug')).toBe('my-app');
  expect(data.get('releaseNumber')).toBe('2');
  expect(data.get('icon')).toBe('✦');
  expect(data.get('licenseValue')).toBe('MIT');
  const slug = form!.elements.namedItem('slug') as HTMLInputElement;
  const release = form!.elements.namedItem('releaseNumber') as HTMLInputElement;
  expect(slug.readOnly).toBe(true);
  expect(slug.pattern).toBe('[a-z0-9][a-z0-9-]{2,62}');
  expect(release.readOnly).toBe(true);
  expect(release.min).toBe('1');
  expect(slug.closest('[data-bitfun-component="input"]')).not.toBeNull();
  expect(form!.querySelectorAll('input[type="file"]')).toHaveLength(2);
  expect((form!.elements.namedItem('screenshots') as HTMLInputElement).multiple).toBe(true);
  expect(form!.querySelector<HTMLButtonElement>('.submit-button')!.type).toBe('submit');
  const description = form!.elements.namedItem('description') as HTMLTextAreaElement;
  expect(description.rows).toBe(3);
  expect(description.maxLength).toBe(500);
  expect(description.required).toBe(true);
  expect(description.closest('[data-bitfun-component="textarea"]')).not.toBeNull();
  expect(form!.checkValidity()).toBe(false);
});

it('keeps web submissions unavailable when the server disables them', async () => {
  mocks.config.mockResolvedValue({ webSubmissionsEnabled: false });
  await act(async () => root.render(<App />));
  expect(container.querySelector('form')).toBeNull();
  expect(container.querySelector('input[type="file"]')).toBeNull();
});
