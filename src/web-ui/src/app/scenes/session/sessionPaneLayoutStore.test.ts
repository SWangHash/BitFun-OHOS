import { describe, expect, it, vi } from 'vitest';
import { createSessionPaneLayoutStore, SESSION_PANE_DISPLAY_MODE_KEY } from './sessionPaneLayoutStore';

describe('session panel presentation preference', () => {
  it('keeps split layout for existing records and round-trips an explicit overlay selection', () => {
    let saved: string | null = null;
    const storage = { getItem: () => saved, setItem: vi.fn((_key: string, value: string) => { saved = value; }) };
    const store = createSessionPaneLayoutStore(storage);
    expect(store.getState().displayMode).toBe('split');
    expect(storage.setItem).not.toHaveBeenCalled();
    store.getState().setDisplayMode('overlay');
    expect(storage.setItem).toHaveBeenCalledWith(SESSION_PANE_DISPLAY_MODE_KEY, 'overlay');
    expect(createSessionPaneLayoutStore(storage).getState().displayMode).toBe('overlay');
    store.getState().setDisplayMode('split');
    expect(createSessionPaneLayoutStore(storage).getState().displayMode).toBe('split');
  });
});
