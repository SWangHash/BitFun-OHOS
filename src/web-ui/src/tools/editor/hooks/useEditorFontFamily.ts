import { useSyncExternalStore } from 'react';
import { appearanceRuntime } from '@/infrastructure/appearance';
import { resolveEditorFontFamily } from '../config/defaults';

/** Monaco needs a concrete family and must refresh when the active font changes. */
export function useEditorFontFamily(fontFamily?: string): string {
  useSyncExternalStore(appearanceRuntime.subscribe, appearanceRuntime.getSnapshot, appearanceRuntime.getSnapshot);
  return resolveEditorFontFamily(fontFamily);
}
