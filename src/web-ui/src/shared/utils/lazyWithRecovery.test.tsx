// @vitest-environment jsdom
import React, { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { lazyWithRecovery } from './lazyWithRecovery';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@bitfun/ui', () => ({
  Alert: ({ title, description }: { title: React.ReactNode; description: React.ReactNode }) => <div>{title}{description}</div>,
  Button: ({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button onClick={onClick}>{children}</button>,
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('allows the lazy owner to retry a rejected import without remounting its parent', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const importer = vi.fn().mockRejectedValueOnce(new Error('Module unavailable'))
    .mockResolvedValueOnce({ default: () => <span>Loaded settings</span> });
  const Page = lazyWithRecovery(importer);
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Suspense fallback="Loading"><Page /></Suspense>));
  expect(container.textContent).toContain('moduleLoad.title');
  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toBe('Loaded settings');
  expect(importer).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});
