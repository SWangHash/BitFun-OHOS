// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

// Model the design-system presence contract: a closed overlay stays mounted for exit.
vi.mock('@openbitfun/ui', () => ({ Dialog: ({ open, children }: React.PropsWithChildren<{ open: boolean }>) => <div data-state={open ? 'open' : 'exiting'}>{children}</div> }));
import { EcosystemDialog } from './EcosystemDialog';

it('retains the last committed title, body and footer throughout exit and replaces them on reopen', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); const root = createRoot(container);
  const render = async (open: boolean, text: string | null) => act(async () => root.render(<EcosystemDialog open={open} onOpenChange={() => {}}>{text ? <><h2>{text}</h2><p>Reviewed content</p><footer>Confirm</footer></> : null}</EcosystemDialog>));
  try {
    await render(true, 'First'); await render(false, null);
    expect(container.querySelector('[data-state="exiting"]')?.textContent).toBe('FirstReviewed contentConfirm');
    await render(false, 'Unrelated update');
    expect(container.textContent).toBe('FirstReviewed contentConfirm');
    await render(true, 'Second'); expect(container.textContent).toBe('SecondReviewed contentConfirm');
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
